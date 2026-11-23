import { type RebuildResult, rebuildIndex, startOfDayLondon } from '@purr/search';
import { makeEmbedder, makeSnapshotStore, makeStorage, makeVectorCache, readEnv } from '../composition.js';

/**
 * Rebuilds the search index, when asked to and only if it needs to. Two callers:
 *  - the API, synchronously, when a search needs the index newer than the last
 *    build: `{ upUntil }`;
 *  - a nightly schedule just after midnight, London time, with no upUntil: then it
 *    means "covers the start of today".
 * Either way it first reads the live build time, and skips the rebuild when that
 * already covers upUntil: another caller got there first. The indexer's reserved
 * concurrency is one, so two rebuilds never race to write the snapshot.
 *
 * A rebuild that runs out of time (or is throttled by Bedrock) still writes a
 * snapshot, with full-text for everything; the next one carries on embedding from
 * the cached vectors.
 */
export interface IndexerEvent {
  upUntil?: string;
}

export type IndexerResult = { builtAt: string; skipped: true } | (RebuildResult & { skipped: false });

export async function handler(event: IndexerEvent = {}): Promise<IndexerResult> {
  const env = readEnv();
  const store = makeSnapshotStore(env);
  const upUntil = event.upUntil ? new Date(event.upUntil).toISOString() : startOfDayLondon(new Date());
  const live = await store.builtAt();
  if (live && live >= upUntil) {
    console.log(JSON.stringify({ msg: 'search index already covers upUntil', upUntil, builtAt: live }));
    return { builtAt: live, skipped: true };
  }
  const result = await rebuildIndex({
    storage: makeStorage(env),
    embedder: makeEmbedder(env),
    store,
    cache: makeVectorCache(env),
    ...(env.INDEX_BUDGET_MS ? { budgetMs: env.INDEX_BUDGET_MS } : {}),
  });
  console.log(JSON.stringify({ msg: 'search index rebuilt', upUntil, ...result }));
  return { ...result, skipped: false };
}
