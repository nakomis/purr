export type { IndexedDoc } from '@purr/contracts';
export { documentsFor } from './documents.js';
export { createSearchIndex, type SearchIndexOptions, snippetFor } from './engine.js';
export { cosine, dequantise, type QuantisedVector, quantise } from './quantise.js';
export { type RebuildOptions, rebuildIndex } from './rebuild.js';
export {
  cacheKey,
  MemoryVectorCache,
  type S3Like,
  S3SnapshotStore,
  S3VectorCache,
  type SnapshotStore,
  type VectorCache,
} from './s3-snapshot.js';
export { buildSnapshot, docKey, parseSnapshot, type Snapshot, serialiseSnapshot } from './snapshot.js';
