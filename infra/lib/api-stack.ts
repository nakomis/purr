import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import type * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import type * as s3 from 'aws-cdk-lib/aws-s3';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import * as schedulerTargets from 'aws-cdk-lib/aws-scheduler-targets';
import type { Construct } from 'constructs';
import { ALLOWED_EMAILS, type DeployEnv } from './config';

export interface ApiStackProps extends cdk.StackProps {
  deployEnv: DeployEnv;
  version: string;
  table: dynamodb.ITableV2;
  dataBucket: s3.IBucket;
  userPoolId: string;
  userPoolClientId: string;
}

const REPO_ROOT = path.join(__dirname, '..', '..');
const EMBEDDING_MODEL = 'amazon.titan-embed-text-v2:0';

/**
 * The HTTP API (one Lambda routing every /api path, authenticating in-process) and
 * the search indexer (a Lambda that rebuilds the index snapshot, nightly and on demand). Both run
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
        USER_POOL_ID: props.userPoolId,
        USER_POOL_CLIENT_ID: props.userPoolClientId,
        ALLOWED_EMAILS: ALLOWED_EMAILS[deployEnv].join(','),
      },
    });
    props.table.grantReadWriteData(apiFn);
    props.dataBucket.grantRead(apiFn, 'search/*');

    const indexerFn = new nodejs.NodejsFunction(this, 'IndexerFunction', {
      ...common,
      functionName: `purr-indexer-${deployEnv}`,
      entry: path.join(REPO_ROOT, 'apps/api/src/handlers/indexer.ts'),
      memorySize: 1536,
      // A first build embeds thousands of texts at the paced rate; each run spends
      // up to INDEX_BUDGET_MS embedding, saves, and the next carries on.
      timeout: cdk.Duration.minutes(15),
      environment: {
        ...common.environment,
        // 8/s = 480/min, under the account's 600/min Titan v2 on-demand quota.
        EMBED_RPS: '8',
        INDEX_BUDGET_MS: String(13 * 60 * 1000),
      },
      // One rebuild at a time: two would race to write the same snapshot. A second
      // caller is throttled, which the API reads as "busy" and waits for this one.
      reservedConcurrentExecutions: 1,
    });
    props.table.grantReadData(indexerFn);
    props.dataBucket.grantReadWrite(indexerFn, 'search/*');

    // The index is rebuilt on demand (the API invokes the indexer when a search needs
    // it newer than the last build) and nightly, just after midnight London time, so
    // a search with the default upUntil (midnight) almost never waits.
    indexerFn.grantInvoke(apiFn);
    apiFn.addEnvironment('INDEXER_FUNCTION_NAME', indexerFn.functionName);
    new scheduler.Schedule(this, 'NightlyIndex', {
      scheduleName: `purr-nightly-index-${deployEnv}`,
      description: 'Rebuild the search index just after midnight, London time',
      schedule: scheduler.ScheduleExpression.cron({
        minute: '5',
        hour: '0',
        timeZone: cdk.TimeZone.EUROPE_LONDON,
      }),
      target: new schedulerTargets.LambdaInvoke(indexerFn, {
        input: scheduler.ScheduleTargetInput.fromObject({}),
      }),
    });

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

    // Alarms: errors in either function.
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
