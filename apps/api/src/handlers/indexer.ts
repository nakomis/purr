import { rebuildIndex } from '@purr/search';
import type { SQSBatchResponse, SQSEvent } from 'aws-lambda';
import { makeEmbedder, makeSnapshotStore, makeStorage, makeVectorCache, readEnv } from '../composition.js';

/**
 * One rebuild per batch of domain events (the event source gathers up to a minute
 * of them). The events only say "something changed"; the rebuild reads current
 * state, and cached vectors mean only new or changed text is embedded. A failure
 * fails the whole batch, so SQS redelivers it and, after five tries, dead-letters it.
 */
export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const env = readEnv();
  try {
    const result = await rebuildIndex({
      storage: makeStorage(env),
      embedder: makeEmbedder(env),
      store: makeSnapshotStore(env),
      cache: makeVectorCache(env),
    });
    console.log(JSON.stringify({ msg: 'search index rebuilt', events: event.Records.length, ...result }));
    return { batchItemFailures: [] };
  } catch (error) {
    console.error('search index rebuild failed', error);
    return { batchItemFailures: event.Records.map((r) => ({ itemIdentifier: r.messageId })) };
  }
}
