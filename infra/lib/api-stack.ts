import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import type * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as eventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import type * as s3 from 'aws-cdk-lib/aws-s3';
import type * as sqs from 'aws-cdk-lib/aws-sqs';
import type { Construct } from 'constructs';
import { ALLOWED_EMAILS, type DeployEnv } from './config';

export interface ApiStackProps extends cdk.StackProps {
  deployEnv: DeployEnv;
  version: string;
  table: dynamodb.ITableV2;
  dataBucket: s3.IBucket;
  eventsQueue: sqs.IQueue;
  userPoolId: string;
  userPoolClientId: string;
}

const REPO_ROOT = path.join(__dirname, '..', '..');
const EMBEDDING_MODEL = 'amazon.titan-embed-text-v2:0';

/**
 * The HTTP API (one Lambda routing every /api path, authenticating in-process) and
 * the search indexer (an SQS-fed Lambda that rebuilds the index snapshot). Both run
 * outside any VPC, so there is no NAT gateway to pay for.
 */
export class ApiStack extends cdk.Stack {
  readonly httpApi: apigwv2.HttpApi;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);
    const { deployEnv } = props;

    const bundling: nodejs.BundlingOptions = {
      format: nodejs.OutputFormat.ESM,
      target: 'node22',
      minify: true,
      sourceMap: true,
      // Bundle everything, the AWS SDK included, so a function never depends on
      // what happens to be in the runtime image.
      externalModules: [],
      // esbuild ESM output needs require() for any CommonJS dependency.
      banner: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
    };
    const common = {
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      projectRoot: REPO_ROOT,
      depsLockFilePath: path.join(REPO_ROOT, 'pnpm-lock.yaml'),
      bundling,
      environment: {
        NODE_OPTIONS: '--enable-source-maps',
        DEPLOY_ENV: deployEnv,
        TABLE_NAME: props.table.tableName,
        DATA_BUCKET: props.dataBucket.bucketName,
        EMBEDDING_MODEL,
        VERSION: props.version,
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
    };

    const apiFn = new nodejs.NodejsFunction(this, 'ApiFunction', {
      ...common,
      functionName: `purr-api-${deployEnv}`,
      entry: path.join(REPO_ROOT, 'apps/api/src/handlers/api.ts'),
      memorySize: 1024,
      timeout: cdk.Duration.seconds(29),
      environment: {
        ...common.environment,
        EVENTS_QUEUE_URL: props.eventsQueue.queueUrl,
        USER_POOL_ID: props.userPoolId,
        USER_POOL_CLIENT_ID: props.userPoolClientId,
        ALLOWED_EMAILS: ALLOWED_EMAILS[deployEnv].join(','),
      },
    });
    props.table.grantReadWriteData(apiFn);
    props.eventsQueue.grantSendMessages(apiFn);
    props.dataBucket.grantRead(apiFn, 'search/*');

    const indexerFn = new nodejs.NodejsFunction(this, 'IndexerFunction', {
      ...common,
      functionName: `purr-indexer-${deployEnv}`,
      entry: path.join(REPO_ROOT, 'apps/api/src/handlers/indexer.ts'),
      memorySize: 1536,
      timeout: cdk.Duration.minutes(5),
      // One rebuild at a time: two would race to write the same snapshot.
      reservedConcurrentExecutions: 1,
    });
    props.table.grantReadData(indexerFn);
    props.dataBucket.grantReadWrite(indexerFn, 'search/*');
    indexerFn.addEventSource(
      new eventSources.SqsEventSource(props.eventsQueue, {
        batchSize: 1000,
        // Gather a minute of events into one rebuild.
        maxBatchingWindow: cdk.Duration.seconds(60),
        reportBatchItemFailures: true,
      }),
    );

    // Both embed: the API for query text, the indexer for documents.
    const bedrock = new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: [`arn:aws:bedrock:${this.region}::foundation-model/${EMBEDDING_MODEL}`],
    });
    apiFn.addToRolePolicy(bedrock);
    indexerFn.addToRolePolicy(bedrock);

    this.httpApi = new apigwv2.HttpApi(this, 'HttpApi', {
      apiName: `purr-${deployEnv}`,
      description: 'Purr API, served under /api through CloudFront',
      defaultIntegration: new integrations.HttpLambdaIntegration('ApiIntegration', apiFn),
      createDefaultStage: true,
    });

    // Alarms: errors in either function, anything in the dead-letter queue's source backing up.
    new cloudwatch.Alarm(this, 'ApiErrors', {
      alarmName: `purr-api-errors-${deployEnv}`,
      metric: apiFn.metricErrors({ period: cdk.Duration.minutes(5) }),
      threshold: 5,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    new cloudwatch.Alarm(this, 'IndexerErrors', {
      alarmName: `purr-indexer-errors-${deployEnv}`,
      metric: indexerFn.metricErrors({ period: cdk.Duration.minutes(15) }),
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    new cdk.CfnOutput(this, 'HttpApiUrl', { value: this.httpApi.apiEndpoint });
  }
}
