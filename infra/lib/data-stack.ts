import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import type { Construct } from 'constructs';
import type { DeployEnv } from './config';

export interface DataStackProps extends cdk.StackProps {
  deployEnv: DeployEnv;
}

/**
 * Everything that holds state: the single DynamoDB table (key design in
 * packages/storage-dynamo/README.md) and the bucket for search snapshots and
 * cached vectors.
 */
export class DataStack extends cdk.Stack {
  readonly table: dynamodb.TableV2;
  readonly bucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);
    const { deployEnv } = props;
    const isProd = deployEnv === 'prod';

    this.table = new dynamodb.TableV2(this, 'Table', {
      tableName: `purr-${deployEnv}`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billing: dynamodb.Billing.onDemand(),
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      deletionProtection: isProd,
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      globalSecondaryIndexes: [
        {
          indexName: 'GSI1',
          partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
          sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
        },
      ],
    });

    this.bucket = new s3.Bucket(this, 'DataBucket', {
      bucketName: `purr-data-${this.account}-${deployEnv}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: false,
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: !isProd,
      lifecycleRules: [{ prefix: 'exports/', expiration: cdk.Duration.days(90) }],
    });

    new cdk.CfnOutput(this, 'TableName', { value: this.table.tableName });
    new cdk.CfnOutput(this, 'DataBucketName', { value: this.bucket.bucketName });
  }
}
