/**
 * Building the real adapters from the Lambda environment. Kept apart from the
 * handlers so each piece is created once per warm instance, and so the only place
 * that names DynamoDB, S3 or Bedrock in the API is here.
 */
import { LambdaClient } from '@aws-sdk/client-lambda';
import { createServices, nullPublisher, type SearchIndex, type Storage } from '@purr/domain';
import { createBedrockEmbedder } from '@purr/embedder-bedrock';
import {
  createFreshness,
  createSearchIndex,
  type Freshness,
  S3SnapshotStore,
  S3VectorCache,
} from '@purr/search';
import { createDynamoStorage } from '@purr/storage-dynamo';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import type { AuthDeps } from './auth.js';
import { indexerRebuilder } from './indexer-client.js';
import { buildRouter } from './routes.js';

export interface Env {
  TABLE_NAME: string;
  DATA_BUCKET: string;
  /** The indexer Lambda the API asks for a rebuild when a search needs a fresher index. */
  INDEXER_FUNCTION_NAME?: string;
  USER_POOL_ID?: string;
  USER_POOL_CLIENT_ID?: string;
  ALLOWED_EMAILS?: string;
  EMBEDDING_MODEL?: string;
  VERSION?: string;
  /** The indexer's embedding pace (requests per second), under the Bedrock quota. */
  EMBED_RPS?: number;
  /** How long one indexer run may embed before saving and handing over to the next. */
  INDEX_BUDGET_MS?: number;
}

export function readEnv(env: NodeJS.ProcessEnv = process.env): Env {
  const need = (name: string): string => {
    const v = env[name];
    if (!v) throw new Error(`${name} is not set`);
    return v;
  };
  return {
    TABLE_NAME: need('TABLE_NAME'),
    DATA_BUCKET: need('DATA_BUCKET'),
    INDEXER_FUNCTION_NAME: env.INDEXER_FUNCTION_NAME,
    USER_POOL_ID: env.USER_POOL_ID,
    USER_POOL_CLIENT_ID: env.USER_POOL_CLIENT_ID,
    ALLOWED_EMAILS: env.ALLOWED_EMAILS,
    EMBEDDING_MODEL: env.EMBEDDING_MODEL,
    VERSION: env.VERSION,
    ...(env.EMBED_RPS ? { EMBED_RPS: Number(env.EMBED_RPS) } : {}),
    ...(env.INDEX_BUDGET_MS ? { INDEX_BUDGET_MS: Number(env.INDEX_BUDGET_MS) } : {}),
  };
}

export function makeStorage(env: Env): Storage {
  return createDynamoStorage({ tableName: env.TABLE_NAME });
}

export function makeEmbedder(env: Env) {
  return createBedrockEmbedder({
    ...(env.EMBEDDING_MODEL ? { modelId: env.EMBEDDING_MODEL } : {}),
    ...(env.EMBED_RPS ? { maxPerSecond: env.EMBED_RPS } : {}),
  });
}

/**
 * The search index, and (with an indexer to call) the freshness check that rebuilds
 * it on demand. A newer build than the one loaded makes the index reload it.
 */
export function makeSearch(env: Env): { search: SearchIndex; freshness?: Freshness } {
  const store = new S3SnapshotStore({ bucket: env.DATA_BUCKET });
  const search = createSearchIndex({ load: () => store.load(), embedder: makeEmbedder(env) });
  if (!env.INDEXER_FUNCTION_NAME) return { search };
  const freshness = createFreshness({
    liveBuiltAt: () => store.builtAt(),
    rebuild: indexerRebuilder(env.INDEXER_FUNCTION_NAME, new LambdaClient({})),
    onNewer: () => search.invalidate(),
  });
  return { search, freshness };
}

export function makeVectorCache(env: Env): S3VectorCache {
  return new S3VectorCache({ bucket: env.DATA_BUCKET });
}

export function makeSnapshotStore(env: Env): S3SnapshotStore {
  return new S3SnapshotStore({ bucket: env.DATA_BUCKET });
}

export function makeApi(env: Env) {
  const storage = makeStorage(env);
  // Writes publish nothing: the index is rebuilt nightly and on demand, when a
  // search asks for something newer than the last build.
  const { search, freshness } = makeSearch(env);
  const router = buildRouter({
    services: createServices(storage, nullPublisher),
    storage,
    search,
    ...(freshness ? { freshness } : {}),
    version: env.VERSION ?? 'unknown',
  });
  const verifier =
    env.USER_POOL_ID && env.USER_POOL_CLIENT_ID
      ? CognitoJwtVerifier.create({
          userPoolId: env.USER_POOL_ID,
          tokenUse: 'id',
          clientId: env.USER_POOL_CLIENT_ID,
        })
      : undefined;
  const auth: AuthDeps = {
    apiKeys: storage.apiKeys,
    allowedEmails: (env.ALLOWED_EMAILS ?? '')
      .split(',')
      .map((e) => e.trim())
      .filter(Boolean),
    ...(verifier
      ? { verifyIdToken: (token: string) => verifier.verify(token) as Promise<Record<string, unknown>> }
      : {}),
  };
  return { router, auth };
}
