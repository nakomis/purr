/**
 * Persistence for the index: the snapshot object and the vector cache, both in S3.
 * The S3 client is injectable (anything with `send`), so tests never touch AWS.
 */
import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { dequantise, type QuantisedVector, quantise } from './quantise.js';
import { parseSnapshot, type Snapshot, serialiseSnapshot } from './snapshot.js';

/** The slice of S3Client the stores use. */
export interface S3Like {
  send(command: GetObjectCommand | PutObjectCommand | HeadObjectCommand): Promise<unknown>;
}

export interface SnapshotStore {
  load(): Promise<Snapshot | undefined>;
  save(snapshot: Snapshot): Promise<void>;
  /** When the stored snapshot was built (ISO), read without fetching it; undefined if none or unrecorded. */
  builtAt(): Promise<string | undefined>;
}

export interface VectorCache {
  /** The cache key for a text under a model. */
  key(model: string, text: string): string;
  get(key: string): Promise<Float32Array | undefined>;
  put(key: string, vector: Float32Array): void;
  /** Drops every entry whose key is not in `keep`. */
  prune(keep: Set<string>): void;
  save(): Promise<void>;
}

export const cacheKey = (model: string, text: string): string =>
  createHash('sha256').update(model).update('\0').update(text).digest('hex');

async function getBytes(client: S3Like, bucket: string, key: string): Promise<Uint8Array | undefined> {
  try {
    const res = (await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))) as {
      Body?: { transformToByteArray(): Promise<Uint8Array> };
    };
    return res.Body ? await res.Body.transformToByteArray() : undefined;
  } catch (err) {
    const e = err as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
    if (e.name === 'NoSuchKey' || e.Code === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404)
      return undefined;
    throw err;
  }
}

async function putBytes(
  client: S3Like,
  bucket: string,
  key: string,
  body: Uint8Array,
  metadata?: Record<string, string>,
): Promise<void> {
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: 'application/gzip',
      CacheControl: 'no-store',
      ...(metadata ? { Metadata: metadata } : {}),
    }),
  );
}

const isNotFound = (err: unknown): boolean => {
  const e = err as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
  return (
    e.name === 'NoSuchKey' ||
    e.name === 'NotFound' ||
    e.Code === 'NoSuchKey' ||
    e.$metadata?.httpStatusCode === 404
  );
};

export class S3SnapshotStore implements SnapshotStore {
  private readonly client: S3Like;
  private readonly bucket: string;
  private readonly key: string;

  constructor(opts: { bucket: string; key?: string; client?: S3Like }) {
    this.bucket = opts.bucket;
    this.key = opts.key ?? 'search/snapshot.bin.gz';
    this.client = opts.client ?? new S3Client({});
  }

  /** undefined when no snapshot has been written yet. */
  async load(): Promise<Snapshot | undefined> {
    const bytes = await getBytes(this.client, this.bucket, this.key);
    return bytes ? parseSnapshot(bytes) : undefined;
  }

  async save(snapshot: Snapshot): Promise<void> {
    await putBytes(
      this.client,
      this.bucket,
      this.key,
      serialiseSnapshot(snapshot),
      snapshot.builtAt ? { 'built-at': snapshot.builtAt } : undefined,
    );
  }

  async builtAt(): Promise<string | undefined> {
    try {
      const res = (await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: this.key }))) as {
        Metadata?: Record<string, string>;
      };
      return res.Metadata?.['built-at'];
    } catch (err) {
      if (isNotFound(err)) return undefined;
      throw err;
    }
  }
}

/** The vectors already computed, so a rebuild only embeds new or changed text. */
export class S3VectorCache implements VectorCache {
  private readonly client: S3Like;
  private readonly bucket: string;
  private readonly objectKey: string;
  private entries: Map<string, QuantisedVector> | undefined;

  constructor(opts: { bucket: string; key?: string; client?: S3Like }) {
    this.bucket = opts.bucket;
    this.objectKey = opts.key ?? 'search/vectors.bin.gz';
    this.client = opts.client ?? new S3Client({});
  }

  key = cacheKey;

  private async ensure(): Promise<Map<string, QuantisedVector>> {
    if (this.entries) return this.entries;
    const bytes = await getBytes(this.client, this.bucket, this.objectKey);
    this.entries = bytes ? decodeEntries(bytes) : new Map();
    return this.entries;
  }

  async get(key: string): Promise<Float32Array | undefined> {
    const q = (await this.ensure()).get(key);
    return q ? dequantise(q) : undefined;
  }

  put(key: string, vector: Float32Array): void {
    // Callers always `get` first, so the map is loaded by now.
    this.entries ??= new Map();
    this.entries.set(key, quantise(vector));
  }

  prune(keep: Set<string>): void {
    for (const key of this.entries?.keys() ?? []) if (!keep.has(key)) this.entries?.delete(key);
  }

  async save(): Promise<void> {
    await putBytes(this.client, this.bucket, this.objectKey, encodeEntries(await this.ensure()));
  }
}

/** The same cache held in memory, for tests and one-off tools. */
export class MemoryVectorCache implements VectorCache {
  readonly entries = new Map<string, QuantisedVector>();
  saves = 0;
  key = cacheKey;
  async get(key: string): Promise<Float32Array | undefined> {
    const q = this.entries.get(key);
    return q ? dequantise(q) : undefined;
  }
  put(key: string, vector: Float32Array): void {
    this.entries.set(key, quantise(vector));
  }
  prune(keep: Set<string>): void {
    for (const key of this.entries.keys()) if (!keep.has(key)) this.entries.delete(key);
  }
  async save(): Promise<void> {
    this.saves++;
  }
}

/** [4-byte header length][JSON {dimensions, keys, scales}][int8 vectors], gzipped. */
export function encodeEntries(entries: Map<string, QuantisedVector>): Uint8Array {
  const keys = [...entries.keys()];
  const dimensions = entries.values().next().value?.values.length ?? 0;
  const header = Buffer.from(
    JSON.stringify({ dimensions, keys, scales: keys.map((k) => entries.get(k)?.scale ?? 0) }),
  );
  const body = Buffer.alloc(4 + header.length + keys.length * dimensions);
  body.writeUInt32BE(header.length, 0);
  header.copy(body, 4);
  let offset = 4 + header.length;
  for (const k of keys) {
    const v = entries.get(k)?.values;
    if (v) body.set(new Uint8Array(v.buffer, v.byteOffset, v.byteLength), offset);
    offset += dimensions;
  }
  return gzipSync(body);
}

export function decodeEntries(bytes: Uint8Array): Map<string, QuantisedVector> {
  const body = gunzipSync(bytes);
  const headerLength = body.readUInt32BE(0);
  const header = JSON.parse(body.subarray(4, 4 + headerLength).toString('utf8')) as {
    dimensions: number;
    keys: string[];
    scales: number[];
  };
  const out = new Map<string, QuantisedVector>();
  let offset = 4 + headerLength;
  for (const [i, key] of header.keys.entries()) {
    const start = body.byteOffset + offset;
    out.set(key, {
      values: new Int8Array(body.buffer.slice(start, start + header.dimensions)),
      scale: header.scales[i] ?? 0,
    });
    offset += header.dimensions;
  }
  return out;
}

/** A SnapshotStore in memory, for tests and local runs. */
export class MemorySnapshotStore implements SnapshotStore {
  saved: Snapshot | undefined;

  async load(): Promise<Snapshot | undefined> {
    return this.saved;
  }

  async save(snapshot: Snapshot): Promise<void> {
    this.saved = snapshot;
  }

  async builtAt(): Promise<string | undefined> {
    return this.saved?.builtAt;
  }
}
