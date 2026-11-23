export type { IndexedDoc } from '@purr/contracts';
export { documentsFor } from './documents.js';
export {
  createSearchIndex,
  type ReloadableSearchIndex,
  type SearchIndexOptions,
  snippetFor,
} from './engine.js';
export {
  createFreshness,
  type Freshness,
  type FreshnessDeps,
  type FreshnessResult,
  startOfDayLondon,
} from './freshness.js';
export { cosine, dequantise, type QuantisedVector, quantise } from './quantise.js';
export { type RebuildOptions, type RebuildResult, rebuildIndex } from './rebuild.js';
export {
  cacheKey,
  MemorySnapshotStore,
  MemoryVectorCache,
  type S3Like,
  S3SnapshotStore,
  S3VectorCache,
  type SnapshotStore,
  type VectorCache,
} from './s3-snapshot.js';
export { buildSnapshot, docKey, parseSnapshot, type Snapshot, serialiseSnapshot } from './snapshot.js';
