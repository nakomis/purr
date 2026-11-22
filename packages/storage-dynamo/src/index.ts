import type { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import type { Storage } from '@purr/domain';
import { activityRepository } from './activity.js';
import { apiKeyRepository } from './apikeys.js';
import { boardRepository } from './board.js';
import { commentRepository } from './comments.js';
import { Db } from './db.js';
import { epicRepository } from './epics.js';
import { projectRepository } from './projects.js';
import { defaultClient, documentClient } from './table.js';
import { taskRepository } from './tasks.js';

export { createTableInput } from './table.js';

export interface DynamoStorageOptions {
  tableName: string;
  /** A ready client (tests, custom config). Defaults to one built from the environment. */
  client?: DynamoDBClient;
  /** Point at DynamoDB Local; builds a client with fake credentials. Ignored if `client` is given. */
  endpoint?: string;
}

/** Every Purr port over one DynamoDB table. See the package README for the key layout. */
export function createDynamoStorage(opts: DynamoStorageOptions): Storage {
  const db = new Db(documentClient(opts.client ?? defaultClient(opts.endpoint)), opts.tableName);
  return {
    projects: projectRepository(db),
    tasks: taskRepository(db),
    comments: commentRepository(db),
    epics: epicRepository(db),
    board: boardRepository(db),
    activity: activityRepository(db),
    apiKeys: apiKeyRepository(db),
  };
}
