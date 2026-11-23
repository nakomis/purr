import type { Embedder, Storage } from '@purr/domain';
import { documentsFor } from './documents.js';
import type { SnapshotStore, VectorCache } from './s3-snapshot.js';
import { buildSnapshot, docKey } from './snapshot.js';

const BATCH = 64;

export interface RebuildOptions {
  storage: Storage;
  embedder: Embedder;
  store: SnapshotStore;
  cache: VectorCache;
  /**
   * How long embedding may run before the rebuild stops and saves what it has
   * (milliseconds). A first build of thousands of documents can outlast a Lambda
   * on a modest Bedrock quota; with a budget, each attempt makes progress and the
   * next one carries on from the cached vectors.
   */
  budgetMs?: number;
  /** Save the vector cache after every this many batches (a checkpoint). */
  checkpointEvery?: number;
  now?: () => number;
}

export interface RebuildResult {
  /** When this run started reading the data (ISO): the new snapshot's builtAt. */
  builtAt: string;
  docs: number;
  /** Texts embedded in this run. */
  embedded: number;
  /** False when embedding stopped early (budget spent, or Bedrock kept refusing). */
  complete: boolean;
  /** Texts still waiting for a vector. */
  pending: number;
  /** Why it stopped early, if it did. */
  stoppedBecause?: string;
}

/** What gets embedded for a document. */
const embedText = (d: { title: string; text: string }) => (d.text ? `${d.title}\n${d.text}` : d.title);

/**
 * Gathers every document, embeds only those whose text the cache has not seen under
 * this model, then writes the cache and a fresh snapshot. Embedding checkpoints the
 * cache as it goes and stops early when the budget is spent or Bedrock keeps
 * refusing; the snapshot is written either way, so full-text search covers every
 * document at once and semantic search fills in as vectors arrive.
 */
export async function rebuildIndex(opts: RebuildOptions): Promise<RebuildResult> {
  const { storage, embedder, store, cache } = opts;
  const now = opts.now ?? Date.now;
  const started = now();
  const builtAt = new Date(started).toISOString();
  const budget = opts.budgetMs ?? Number.POSITIVE_INFINITY;
  const checkpointEvery = Math.max(1, opts.checkpointEvery ?? 4);
  const docs = await documentsFor(storage);
  const vectors = new Map<string, Float32Array>();
  const keep = new Set<string>();
  const misses: { docId: string; key: string; text: string }[] = [];

  for (const doc of docs) {
    const text = embedText(doc);
    const key = cache.key(embedder.model, text);
    keep.add(key);
    const hit = await cache.get(key);
    if (hit) vectors.set(docKey(doc), hit);
    else misses.push({ docId: docKey(doc), key, text });
  }

  // Identical texts under different documents are embedded once.
  const unique = [...new Map(misses.map((m) => [m.key, m])).values()];
  let embeddedCount = 0;
  let stoppedBecause: string | undefined;
  for (let i = 0, batchNo = 1; i < unique.length; i += BATCH, batchNo++) {
    if (now() - started >= budget) {
      stoppedBecause = 'time budget spent';
      break;
    }
    const batch = unique.slice(i, i + BATCH);
    let embedded: Float32Array[];
    try {
      embedded = await embedder.embed(batch.map((m) => m.text));
    } catch (error) {
      stoppedBecause = `embedding failed: ${error instanceof Error ? error.message : String(error)}`;
      break;
    }
    for (const [j, m] of batch.entries()) {
      const v = embedded[j];
      if (v) {
        cache.put(m.key, v);
        embeddedCount++;
      }
    }
    if (batchNo % checkpointEvery === 0) await cache.save();
  }
  for (const m of misses) {
    const v = await cache.get(m.key);
    if (v) vectors.set(m.docId, v);
  }

  // Prune only after a complete pass: an early stop must not drop vectors a
  // document still needs but which this run never reached.
  const complete = stoppedBecause === undefined;
  if (complete) cache.prune(keep);
  await cache.save();
  await store.save(buildSnapshot(docs, vectors, embedder.model, embedder.dimensions, builtAt));
  const pending = unique.length - embeddedCount;
  return {
    builtAt,
    docs: docs.length,
    embedded: embeddedCount,
    complete,
    pending,
    ...(stoppedBecause ? { stoppedBecause } : {}),
  };
}
