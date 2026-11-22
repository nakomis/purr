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
}

/** What gets embedded for a document. */
const embedText = (d: { title: string; text: string }) => (d.text ? `${d.title}\n${d.text}` : d.title);

/**
 * Gathers every document, embeds only those whose text the cache has not seen under
 * this model, then writes the cache and a fresh snapshot.
 */
export async function rebuildIndex(opts: RebuildOptions): Promise<{ docs: number; embedded: number }> {
  const { storage, embedder, store, cache } = opts;
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
  for (let i = 0; i < unique.length; i += BATCH) {
    const batch = unique.slice(i, i + BATCH);
    const embedded = await embedder.embed(batch.map((m) => m.text));
    for (const [j, m] of batch.entries()) {
      const v = embedded[j];
      if (v) cache.put(m.key, v);
    }
  }
  for (const m of misses) {
    const v = await cache.get(m.key);
    if (v) vectors.set(m.docId, v);
  }

  cache.prune(keep);
  await cache.save();
  await store.save(buildSnapshot(docs, vectors, embedder.model, embedder.dimensions));
  return { docs: docs.length, embedded: unique.length };
}
