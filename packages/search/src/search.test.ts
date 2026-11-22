import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { createFakeEmbedder, type IndexedDoc, SEARCH_FIXTURE } from '@purr/contracts';
import type { Embedder } from '@purr/domain';
import { createMemoryStorage } from '@purr/storage-memory';
import { describe, expect, it, vi } from 'vitest';
import {
  buildSnapshot,
  cosine,
  createSearchIndex,
  dequantise,
  docKey,
  documentsFor,
  MemoryVectorCache,
  parseSnapshot,
  quantise,
  rebuildIndex,
  type S3Like,
  S3SnapshotStore,
  S3VectorCache,
  type Snapshot,
  serialiseSnapshot,
  snippetFor,
} from './index.js';

const embedder = createFakeEmbedder();

/** An in-memory S3: keeps bytes by bucket/key and answers like the real one. */
function fakeS3() {
  const objects = new Map<string, Uint8Array>();
  const client: S3Like = {
    async send(command) {
      if (command instanceof PutObjectCommand) {
        const { Bucket, Key, Body } = command.input;
        objects.set(`${Bucket}/${Key}`, Body as Uint8Array);
        return {};
      }
      if (command instanceof GetObjectCommand) {
        const { Bucket, Key } = command.input;
        const body = objects.get(`${Bucket}/${Key}`);
        if (!body) throw Object.assign(new Error('missing'), { name: 'NoSuchKey' });
        return { Body: { transformToByteArray: async () => body } };
      }
      throw new Error('unexpected command');
    },
  };
  return { client, objects };
}

async function vectorsFor(docs: IndexedDoc[]) {
  return new Map(
    await Promise.all(
      docs.map(
        async (d) =>
          [docKey(d), (await embedder.embed([`${d.title}\n${d.text}`]))[0] as Float32Array] as const,
      ),
    ),
  );
}

describe('quantisation', () => {
  it('int8 quantisation keeps cosine within 0.01', async () => {
    const [a, b] = await embedder.embed(['stepper driver for the printer', 'printer stepper']);
    const real = cosine(a as Float32Array, b as Float32Array);
    const approx = cosine(dequantise(quantise(a as Float32Array)), dequantise(quantise(b as Float32Array)));
    expect(Math.abs(real - approx)).toBeLessThan(0.01);
    // and against a random dense 1,024-dim vector
    const r = Float32Array.from({ length: 1024 }, (_, i) => Math.sin(i * 1.7) * Math.cos(i * 0.3));
    expect(Math.abs(cosine(r, dequantise(quantise(r))) - 1)).toBeLessThan(0.01);
  });

  it('quantises a zero vector to zeros', () => {
    const q = quantise(new Float32Array(4));
    expect(q.scale).toBe(0);
    expect([...dequantise(q)]).toEqual([0, 0, 0, 0]);
  });
});

describe('fake embedder', () => {
  it('is deterministic, normalised and puts synonyms close', async () => {
    const [a, b, c] = await embedder.embed(['sd card', 'microsd', 'printer']);
    expect(embedder.dimensions).toBe(64);
    expect(Math.hypot(...(a as Float32Array))).toBeCloseTo(1, 5);
    expect(cosine(a as Float32Array, b as Float32Array)).toBeGreaterThan(0.5);
    expect(cosine(a as Float32Array, c as Float32Array)).toBeLessThan(0.5);
    expect((await embedder.embed(['sd card']))[0]).toEqual(a);
    expect(
      cosine(...((await embedder.embed(['esp32', 's3'])) as [Float32Array, Float32Array])),
    ).toBeGreaterThan(0.5);
  });
});

describe('snapshot', () => {
  it('round-trips through the compact serialised form', async () => {
    const snap = buildSnapshot(
      SEARCH_FIXTURE,
      await vectorsFor(SEARCH_FIXTURE),
      embedder.model,
      embedder.dimensions,
    );
    const back = parseSnapshot(serialiseSnapshot(snap));
    expect(back.docs).toEqual(SEARCH_FIXTURE);
    expect(back.dimensions).toBe(64);
    expect(back.model).toBe(embedder.model);
    expect(back.scales).toEqual(snap.scales);
    expect(back.vectors.map((v) => [...v])).toEqual(snap.vectors.map((v) => [...v]));
  });

  it('gives a document without a vector a zero vector', () => {
    const snap = buildSnapshot(SEARCH_FIXTURE.slice(0, 1), new Map(), embedder.model, 8);
    expect([...(snap.vectors[0] as Int8Array)]).toEqual(new Array(8).fill(0));
  });

  it('rejects an unknown version', () => {
    const snap = buildSnapshot([], new Map());
    expect(() => parseSnapshot(serialiseSnapshot({ ...snap, version: 99 }))).toThrow(/version/);
  });

  it('stays small: about 1.1 KB a document at 1,024 dimensions', () => {
    const dims = 1024;
    const docs: IndexedDoc[] = Array.from({ length: 1000 }, (_, i) => ({
      kind: 'task',
      id: `P-${i}`,
      taskRef: `P-${i}`,
      projectId: 'p',
      epicRefs: [],
      title: `Task ${i} about thing ${i % 37}`,
      text: `Description of task ${i}. It covers ${['wiring', 'firmware', 'sensors', 'printing'][i % 4]} and the plan.`,
      updatedAt: '2026-11-22T10:00:00.000Z',
    }));
    const vectors = new Map(
      docs.map((d, i) => [
        docKey(d),
        Float32Array.from({ length: dims }, (_, j) => Math.sin((i + 1) * (j + 1) * 0.37)),
      ]),
    );
    const bytes = serialiseSnapshot(buildSnapshot(docs, vectors, 'm', dims));
    // Dense random-ish vectors barely compress, so this is close to the worst case.
    expect(bytes.length).toBeLessThan(1000 * (dims + 400));
  });
});

describe('createSearchIndex', () => {
  const snapshot = async (): Promise<Snapshot> =>
    buildSnapshot(SEARCH_FIXTURE, await vectorsFor(SEARCH_FIXTURE), embedder.model, embedder.dimensions);

  it('loads lazily, once, and caches per warm instance', async () => {
    const snap = await snapshot();
    const load = vi.fn(async () => snap);
    const idx = createSearchIndex({ load, embedder });
    expect(load).not.toHaveBeenCalled();
    await Promise.all([
      idx.query({ text: 'printer', mode: 'fulltext' }),
      idx.query({ text: 'printer', mode: 'fulltext' }),
    ]);
    await idx.query({ text: 'printer', mode: 'hybrid' });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('reloads after cacheMs, picking up a new snapshot', async () => {
    const snap = await snapshot();
    let current: Snapshot | undefined;
    const idx = createSearchIndex({ load: async () => current, embedder, cacheMs: 0 });
    expect(await idx.query({ text: 'printer', mode: 'fulltext' })).toEqual([]);
    current = snap;
    expect((await idx.query({ text: 'printer', mode: 'fulltext' })).length).toBeGreaterThan(0);
  });

  it('returns nothing for blank text, and no semantic hits across a model change', async () => {
    const snap = await snapshot();
    const idx = createSearchIndex({ load: async () => snap, embedder: createFakeEmbedder(32) });
    expect(await idx.query({ text: '   ', mode: 'hybrid' })).toEqual([]);
    expect(await idx.query({ text: 'sd card', mode: 'semantic' })).toEqual([]);
    // hybrid degrades to fulltext rather than failing
    expect((await idx.query({ text: 'printer', mode: 'hybrid' })).length).toBeGreaterThan(0);
  });

  it('does not call the embedder for fulltext queries', async () => {
    const snap = await snapshot();
    const embed = vi.fn(embedder.embed);
    const idx = createSearchIndex({ load: async () => snap, embedder: { ...embedder, embed } });
    await idx.query({ text: 'printer', mode: 'fulltext' });
    expect(embed).not.toHaveBeenCalled();
  });
});

describe('snippetFor', () => {
  const long = `${'intro '.repeat(80)}the DRV8825-X1 stepper driver arrives soon ${'outro '.repeat(80)}`;
  it('centres on the query terms', () => {
    const s = snippetFor(long, 'drv8825 stepper');
    expect(s.length).toBeLessThanOrEqual(204);
    expect(s).toContain('DRV8825-X1');
    expect(s.startsWith('…')).toBe(true);
  });
  it('falls back to the start, and leaves short text alone', () => {
    expect(snippetFor(long, 'zzz').startsWith('intro')).toBe(true);
    expect(snippetFor('short', 'short')).toBe('short');
  });
});

describe('S3 stores', () => {
  it('snapshot store: missing is undefined; save then load round-trips', async () => {
    const { client, objects } = fakeS3();
    const store = new S3SnapshotStore({ bucket: 'b', client });
    expect(await store.load()).toBeUndefined();
    const snap = buildSnapshot(SEARCH_FIXTURE, await vectorsFor(SEARCH_FIXTURE), embedder.model, 64);
    await store.save(snap);
    expect([...objects.keys()]).toEqual(['b/search/snapshot.bin.gz']);
    expect((await store.load())?.docs).toEqual(SEARCH_FIXTURE);
  });

  it('snapshot store rethrows errors other than a missing key', async () => {
    const client: S3Like = {
      async send() {
        throw Object.assign(new Error('denied'), { name: 'AccessDenied' });
      },
    };
    await expect(new S3SnapshotStore({ bucket: 'b', client }).load()).rejects.toThrow('denied');
  });

  it('vector cache: keyed by model and text, persists, prunes', async () => {
    const { client, objects } = fakeS3();
    const cache = new S3VectorCache({ bucket: 'b', client });
    const k1 = cache.key('m', 'hello');
    expect(cache.key('m', 'hello')).toBe(k1);
    expect(cache.key('other', 'hello')).not.toBe(k1);
    expect(await cache.get(k1)).toBeUndefined();
    const [v] = await embedder.embed(['hello world']);
    cache.put(k1, v as Float32Array);
    cache.put(cache.key('m', 'bye'), v as Float32Array);
    cache.prune(new Set([k1]));
    await cache.save();
    expect(objects.has('b/search/vectors.bin.gz')).toBe(true);

    const fresh = new S3VectorCache({ bucket: 'b', client });
    const got = await fresh.get(k1);
    expect(cosine(got as Float32Array, v as Float32Array)).toBeGreaterThan(0.99);
    expect(await fresh.get(cache.key('m', 'bye'))).toBeUndefined();
  });
});

describe('documentsFor and rebuildIndex', () => {
  async function seeded() {
    const storage = createMemoryStorage();
    const project = await storage.projects.create({ prefix: 'HOME', name: 'Home' });
    const other = await storage.projects.create({ prefix: 'CAT', name: 'Cats' });
    const t1 = await storage.tasks.create(
      {
        projectId: project.id,
        title: 'Kata boots from microsd',
        description: 'Read firmware from the card.',
      },
      'martin',
    );
    await storage.tasks.create({ projectId: other.id, title: 'Cat flap', description: '' }, 'martin');
    await storage.comments.add(t1.ref, 'Tried a faster card.', 'claude');
    const epic = await storage.epics.create({ name: 'Firmware', description: 'All firmware work' }, 'martin');
    await storage.epics.addTask(epic.ref, t1.ref);
    return { storage, project, t1, epic };
  }

  it('documentsFor covers every task, comment and epic, with epic membership', async () => {
    const { storage, t1, epic, project } = await seeded();
    const docs = await documentsFor(storage);
    expect(docs.map((d) => d.kind).sort()).toEqual(['comment', 'epic', 'task', 'task']);
    const task = docs.find((d) => d.id === t1.ref);
    expect(task).toMatchObject({
      kind: 'task',
      projectId: project.id,
      epicRefs: [epic.ref],
      title: t1.title,
    });
    const comment = docs.find((d) => d.kind === 'comment');
    expect(comment).toMatchObject({ taskRef: t1.ref, text: 'Tried a faster card.', epicRefs: [epic.ref] });
    expect(docs.find((d) => d.kind === 'epic')).toMatchObject({
      epicRef: epic.ref,
      title: 'Firmware',
      projectIds: [project.id],
    });
  });

  it('documentsFor pages through tasks and comments', async () => {
    const storage = createMemoryStorage();
    const p = await storage.projects.create({ prefix: 'BIG', name: 'Big' });
    for (let i = 0; i < 5; i++) await storage.tasks.create({ projectId: p.id, title: `t${i}` }, 'system');
    const real = storage.tasks.listByProject.bind(storage.tasks);
    storage.tasks.listByProject = (id, opts) => real(id, { ...opts, limit: 2 });
    expect((await documentsFor(storage)).filter((d) => d.kind === 'task')).toHaveLength(5);
  });

  it('rebuildIndex embeds only cache misses, then search finds the result', async () => {
    const { storage, t1 } = await seeded();
    const embed = vi.fn(embedder.embed);
    const counting: Embedder = { ...embedder, embed };
    const saved: Snapshot[] = [];
    const store = { load: async () => saved.at(-1), save: async (s: Snapshot) => void saved.push(s) };
    const cache = new MemoryVectorCache();

    expect(await rebuildIndex({ storage, embedder: counting, store, cache })).toMatchObject({
      docs: 4,
      embedded: 4,
      complete: true,
    });
    expect(cache.saves).toBe(1);

    // Nothing changed: nothing is embedded.
    embed.mockClear();
    expect(await rebuildIndex({ storage, embedder: counting, store, cache })).toMatchObject({
      docs: 4,
      embedded: 0,
      complete: true,
    });
    expect(embed).not.toHaveBeenCalled();

    // One edit: one embedding.
    const task = await storage.tasks.get(t1.ref);
    await storage.tasks.update(t1.ref, { description: 'Now with new words' }, task.version, 'martin');
    expect(await rebuildIndex({ storage, embedder: counting, store, cache })).toMatchObject({
      docs: 4,
      embedded: 1,
      complete: true,
    });
    // The superseded vector is pruned: 4 live entries, not 5.
    expect(cache.entries.size).toBe(4);

    const idx = createSearchIndex({ load: store.load, embedder });
    expect((await idx.query({ text: 'sd card', mode: 'semantic' }))[0]?.taskRef).toBe(t1.ref);
    expect((await idx.query({ text: 'Cat flap', mode: 'fulltext' }))[0]?.title).toBe('Cat flap');
  });

  it('rebuildIndex embeds duplicate texts once and batches large runs', async () => {
    const storage = createMemoryStorage();
    const p = await storage.projects.create({ prefix: 'DUP', name: 'Dup' });
    for (let i = 0; i < 150; i++)
      await storage.tasks.create({ projectId: p.id, title: `unique ${i}` }, 'system');
    await storage.tasks.create({ projectId: p.id, title: 'unique 0' }, 'system');
    const sizes: number[] = [];
    const counting: Embedder = {
      ...embedder,
      embed: async (texts) => {
        sizes.push(texts.length);
        return embedder.embed(texts);
      },
    };
    const store = { load: async () => undefined, save: async () => {} };
    const res = await rebuildIndex({ storage, embedder: counting, store, cache: new MemoryVectorCache() });
    expect(res).toMatchObject({ docs: 151, embedded: 150, complete: true });
    expect(sizes).toEqual([64, 64, 22]);
  });
});
