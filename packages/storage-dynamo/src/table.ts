/** The table's shape, and the client the adapter builds when it isn't given one. */
import {
  type CreateTableCommandInput,
  DynamoDBClient,
  type DynamoDBClientConfig,
} from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

export const GSI1 = 'GSI1';

/**
 * CreateTable input for a Purr table: string keys PK/SK, GSI1 (GSI1PK/GSI1SK)
 * projecting everything, on-demand billing. Used by the tests; the CDK stack
 * declares the same shape.
 */
export function createTableInput(tableName: string): CreateTableCommandInput {
  return {
    TableName: tableName,
    BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions: [
      { AttributeName: 'PK', AttributeType: 'S' },
      { AttributeName: 'SK', AttributeType: 'S' },
      { AttributeName: 'GSI1PK', AttributeType: 'S' },
      { AttributeName: 'GSI1SK', AttributeType: 'S' },
    ],
    KeySchema: [
      { AttributeName: 'PK', KeyType: 'HASH' },
      { AttributeName: 'SK', KeyType: 'RANGE' },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: GSI1,
        KeySchema: [
          { AttributeName: 'GSI1PK', KeyType: 'HASH' },
          { AttributeName: 'GSI1SK', KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
      },
    ],
  };
}

/** Wraps a low-level client for plain JavaScript values; undefined fields are dropped. */
export function documentClient(client: DynamoDBClient): DynamoDBDocumentClient {
  return DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } });
}

export function defaultClient(endpoint?: string): DynamoDBClient {
  const config: DynamoDBClientConfig = endpoint
    ? {
        endpoint,
        region: process.env.AWS_REGION ?? 'eu-west-2',
        credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
      }
    : {};
  return new DynamoDBClient(config);
}
