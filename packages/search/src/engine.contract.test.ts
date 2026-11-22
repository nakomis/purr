import { createFakeEmbedder, type IndexedDoc, runSearchContract } from '@purr/contracts';
import { buildSnapshot, createSearchIndex, docKey, parseSnapshot, serialiseSnapshot } from './index.js';

const embedder = createFakeEmbedder();

runSearchContract('minisearch + fake embedder', async (docs: IndexedDoc[]) => {
  if (docs.length === 0) return createSearchIndex({ load: async () => undefined, embedder });
  const vectors = new Map(
    await Promise.all(
      docs.map(
        async (d) =>
          [docKey(d), (await embedder.embed([`${d.title}\n${d.text}`]))[0] as Float32Array] as const,
      ),
    ),
  );
  // Through the serialised form, as in production.
  const bytes = serialiseSnapshot(buildSnapshot(docs, vectors, embedder.model, embedder.dimensions));
  return createSearchIndex({ load: async () => parseSnapshot(bytes), embedder });
});
