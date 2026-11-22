import { createFakeEmbedder } from '@purr/contracts';
import { createServices, type Embedder, nullPublisher } from '@purr/domain';
import { createMemoryStorage } from '@purr/storage-memory';
import { describe, expect, it } from 'vitest';
import { MemoryVectorCache, type Snapshot, type SnapshotStore } from './index.js';
import { rebuildIndex } from './rebuild.js';

async function seeded(n: number) {
  const storage = createMemoryStorage();
  const svc = createServices(storage, nullPublisher);
  await svc.projects.create({ prefix: 'HOME', name: 'Home' });
  for (let i = 0; i < n; i++) await svc.tasks.create('HOME', { title: `task number ${i}` }, 'claude');
  return storage;
}

function memoryStore(): SnapshotStore & { saved?: Snapshot } {
  const store = {
    saved: undefined as Snapshot | undefined,
    async load() {
      return store.saved;
    },
    async save(s: Snapshot) {
      store.saved = s;
    },
  };
  return store as SnapshotStore & { saved?: Snapshot };
}

describe('rebuildIndex across attempts', () => {
  it('stops at the budget, saves what it has, and the next attempt carries on', async () => {
    const storage = await seeded(200);
    const cache = new MemoryVectorCache();
    const store = memoryStore();
    let clock = 0;
    const embedder = createFakeEmbedder();
    const slow: Embedder = {
      ...embedder,
      model: embedder.model,
      dimensions: embedder.dimensions,
      embed: async (texts) => {
        clock += 1000;
        return embedder.embed(texts);
      },
    };
    const first = await rebuildIndex({
      storage,
      embedder: slow,
      store,
      cache,
      budgetMs: 1500,
      now: () => clock,
    });
    expect(first.complete).toBe(false);
    expect(first.stoppedBecause).toBe('time budget spent');
    expect(first.embedded).toBeGreaterThan(0);
    expect(first.pending).toBeGreaterThan(0);
    expect(store.saved).toBeDefined();

    const second = await rebuildIndex({ storage, embedder: slow, store, cache, now: () => clock });
    expect(second.complete).toBe(true);
    expect(second.embedded).toBe(first.pending);
    expect(second.pending).toBe(0);
  });

  it('stops cleanly when Bedrock keeps refusing, keeping earlier vectors', async () => {
    const storage = await seeded(150);
    const cache = new MemoryVectorCache();
    const store = memoryStore();
    const embedder = createFakeEmbedder();
    let calls = 0;
    const flaky: Embedder = {
      ...embedder,
      model: embedder.model,
      dimensions: embedder.dimensions,
      embed: async (texts) => {
        if (++calls > 1) throw new Error('Too many requests');
        return embedder.embed(texts);
      },
    };
    const result = await rebuildIndex({ storage, embedder: flaky, store, cache, checkpointEvery: 1 });
    expect(result.complete).toBe(false);
    expect(result.stoppedBecause).toContain('Too many requests');
    expect(result.embedded).toBe(64);
    expect(store.saved).toBeDefined();
  });
});
