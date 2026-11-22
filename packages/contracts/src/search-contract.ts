/**
 * The search contract: what every SearchIndex must do, run against each one. The
 * factory receives the documents to index; an empty list means "no index has been
 * built yet" and must yield empty results, never an error.
 */
import type { SearchIndex } from '@purr/domain';
import { describe, expect, it } from 'vitest';
import type { IndexedDoc } from './indexed-doc.js';

const AT = '2026-11-22T10:00:00.000Z';

export const SEARCH_FIXTURE: IndexedDoc[] = [
  {
    kind: 'task',
    id: 'P1-1',
    taskRef: 'P1-1',
    projectId: 'p1',
    epicRefs: ['EPIC-1'],
    title: 'Order stepper driver DRV8825-X1',
    text: 'Buy the DRV8825-X1 part for the printer.',
    updatedAt: AT,
  },
  {
    kind: 'task',
    id: 'P1-2',
    taskRef: 'P1-2',
    projectId: 'p1',
    epicRefs: [],
    title: 'Kata boots from microsd',
    text: 'The board reads its firmware from the microsd slot at startup.',
    updatedAt: AT,
  },
  {
    kind: 'task',
    id: 'P2-1',
    taskRef: 'P2-1',
    projectId: 'p2',
    epicRefs: [],
    title: 'Garden sensor wired to the router',
    text: 'Run the ethernet cable along the fence.',
    updatedAt: AT,
  },
  {
    kind: 'task',
    id: 'P2-2',
    taskRef: 'P2-2',
    projectId: 'p2',
    epicRefs: [],
    title: 'Replace flap batteries',
    text: 'The cat flap needs new batteries.',
    updatedAt: AT,
  },
  {
    kind: 'comment',
    id: 'c-1',
    taskRef: 'P1-1',
    projectId: 'p1',
    epicRefs: ['EPIC-1'],
    title: 'Order stepper driver DRV8825-X1',
    text: 'Ordered the printer part from the supplier on Monday.',
    updatedAt: AT,
  },
  {
    kind: 'epic',
    id: 'EPIC-1',
    epicRef: 'EPIC-1',
    projectIds: ['p1'],
    title: 'Printer upgrades',
    text: 'Everything needed to improve the printer.',
    updatedAt: AT,
  },
];

const ids = (hits: { id: string }[]) => hits.map((h) => h.id);

export function runSearchContract(name: string, make: (docs: IndexedDoc[]) => Promise<SearchIndex>): void {
  describe(`search contract: ${name}`, () => {
    const index = () => make(SEARCH_FIXTURE);

    it('exact part number found by fulltext', async () => {
      const hits = await (await index()).query({ text: 'DRV8825-X1', mode: 'fulltext' });
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0]?.id).toBe('P1-1');
      expect(hits[0]?.taskRef).toBe('P1-1');
      expect(hits[0]?.projectId).toBe('p1');
      expect(hits[0]?.snippet).toContain('DRV8825-X1');
    });

    it('meaning-only query found by semantic', async () => {
      const idx = await index();
      // No shared words: fulltext finds nothing, semantic finds the right task.
      expect(await idx.query({ text: 'sd card', mode: 'fulltext' })).toEqual([]);
      expect((await idx.query({ text: 'sd card', mode: 'semantic' }))[0]?.id).toBe('P1-2');
      expect(await idx.query({ text: 'connected', mode: 'fulltext' })).toEqual([]);
      expect((await idx.query({ text: 'connected', mode: 'semantic' }))[0]?.id).toBe('P2-1');
    });

    it('hybrid fuses both with RRF (k=60)', async () => {
      const idx = await index();
      const q = 'DRV8825-X1 connected';
      const full = await idx.query({ text: q, mode: 'fulltext' });
      const sem = await idx.query({ text: q, mode: 'semantic' });
      const hybrid = await idx.query({ text: q, mode: 'hybrid' });
      expect(ids(full)).toContain('P1-1');
      expect(ids(sem)).toContain('P2-1');
      // Both the keyword hit and the meaning hit survive fusion.
      expect(ids(hybrid)).toEqual(expect.arrayContaining(['P1-1', 'P2-1']));
      // Scores are reciprocal-rank sums: 1/(60+rank) per list the document appears in.
      const expected = (id: string) =>
        [full, sem].reduce((sum, list) => {
          const rank = ids(list).indexOf(id);
          return rank < 0 ? sum : sum + 1 / (60 + rank + 1);
        }, 0);
      for (const hit of hybrid) expect(hit.score).toBeCloseTo(expected(hit.id), 9);
      // A document found by both lists outranks one found by a single list.
      expect(hybrid[0]?.id).toBe('P1-1');
    });

    it('query against a missing snapshot returns []', async () => {
      const idx = await make([]);
      for (const mode of ['hybrid', 'semantic', 'fulltext'] as const)
        expect(await idx.query({ text: 'printer', mode })).toEqual([]);
    });

    it('filters by projectId, epicRef and kinds', async () => {
      const idx = await index();
      const q = { text: 'printer', mode: 'fulltext' } as const;
      expect(ids(await idx.query({ ...q, projectId: 'p1' })).sort()).toEqual(['EPIC-1', 'P1-1', 'c-1']);
      expect(await idx.query({ ...q, projectId: 'p2' })).toEqual([]);
      expect(ids(await idx.query({ ...q, epicRef: 'EPIC-1' })).sort()).toEqual(['EPIC-1', 'P1-1', 'c-1']);
      expect(await idx.query({ ...q, epicRef: 'EPIC-9' })).toEqual([]);
      expect(ids(await idx.query({ ...q, kinds: ['epic'] }))).toEqual(['EPIC-1']);
      expect(ids(await idx.query({ ...q, kinds: ['comment', 'epic'] })).sort()).toEqual(['EPIC-1', 'c-1']);
      // Filters apply before ranking, so they hold in semantic and hybrid modes too.
      for (const mode of ['semantic', 'hybrid'] as const) {
        const hits = await idx.query({ text: 'connected printer', mode, projectId: 'p1' });
        expect(hits.length).toBeGreaterThan(0);
        expect(hits.every((h) => h.projectId === 'p1' || h.kind === 'epic')).toBe(true);
      }
    });

    it('respects limit', async () => {
      const idx = await index();
      const hits = await idx.query({ text: 'printer', mode: 'fulltext', limit: 2 });
      expect(hits).toHaveLength(2);
    });
  });
}
