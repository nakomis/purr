/**
 * The index file: documents, a MiniSearch (BM25) index and int8 vectors, gzipped.
 *
 * Layout before gzip: a 4-byte big-endian header length, the JSON header
 * (documents, MiniSearch index, scales), then the vectors as raw int8, one
 * `dimensions`-long run per document in document order.
 */
import { gunzipSync, gzipSync } from 'node:zlib';
import type { IndexedDoc } from '@purr/contracts';
import MiniSearch from 'minisearch';
import { type QuantisedVector, quantise } from './quantise.js';

export const SNAPSHOT_VERSION = 1;

export interface Snapshot {
  version: number;
  /** The embedding model the vectors came from (empty when there are none). */
  model: string;
  dimensions: number;
  docs: IndexedDoc[];
  /** MiniSearch's toJSON() output; document ids are positions in `docs`. */
  index: object;
  vectors: Int8Array[];
  scales: number[];
}

/** The key under which a document's vector is looked up. */
export const docKey = (d: Pick<IndexedDoc, 'kind' | 'id'>): string => `${d.kind}:${d.id}`;

export const MINISEARCH_OPTIONS = {
  fields: ['title', 'text'],
  idField: 'n',
  storeFields: [] as string[],
};

export function buildSnapshot(
  docs: IndexedDoc[],
  vectors: Map<string, Float32Array>,
  model = '',
  dimensions = 0,
): Snapshot {
  const ms = new MiniSearch(MINISEARCH_OPTIONS);
  ms.addAll(docs.map((d, n) => ({ n, title: d.title, text: d.text })));
  const dims = dimensions || (vectors.values().next().value?.length ?? 0);
  const qs: QuantisedVector[] = docs.map((d) => {
    const v = vectors.get(docKey(d));
    return v && v.length === dims ? quantise(v) : { values: new Int8Array(dims), scale: 0 };
  });
  return {
    version: SNAPSHOT_VERSION,
    model,
    dimensions: dims,
    docs,
    index: ms.toJSON() as unknown as object,
    vectors: qs.map((q) => q.values),
    scales: qs.map((q) => q.scale),
  };
}

export function serialiseSnapshot(s: Snapshot): Uint8Array {
  const header = Buffer.from(
    JSON.stringify({
      version: s.version,
      model: s.model,
      dimensions: s.dimensions,
      docs: s.docs,
      index: s.index,
      scales: s.scales,
    }),
  );
  const body = Buffer.alloc(4 + header.length + s.vectors.length * s.dimensions);
  body.writeUInt32BE(header.length, 0);
  header.copy(body, 4);
  let offset = 4 + header.length;
  for (const v of s.vectors) {
    body.set(new Uint8Array(v.buffer, v.byteOffset, v.byteLength), offset);
    offset += s.dimensions;
  }
  return gzipSync(body);
}

export function parseSnapshot(bytes: Uint8Array): Snapshot {
  const body = gunzipSync(bytes);
  const headerLength = body.readUInt32BE(0);
  const header = JSON.parse(body.subarray(4, 4 + headerLength).toString('utf8'));
  if (header.version !== SNAPSHOT_VERSION) throw new Error(`Unsupported snapshot version ${header.version}`);
  const { dimensions } = header as { dimensions: number };
  const vectors: Int8Array[] = [];
  let offset = 4 + headerLength;
  for (let i = 0; i < header.docs.length; i++) {
    // Copy, so the vectors don't pin the whole decompressed buffer.
    const start = body.byteOffset + offset;
    vectors.push(new Int8Array(body.buffer.slice(start, start + dimensions)));
    offset += dimensions;
  }
  return { ...header, vectors };
}
