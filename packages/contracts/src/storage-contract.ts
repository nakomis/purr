/**
 * The storage contract: what every Storage adapter must do, run against each one
 * (design section 6). A new adapter (Postgres, say) is ready when this passes.
 */
import {
  AlreadyExistsError,
  ConflictError,
  NotFoundError,
  rankBetween,
  type State,
  type Storage,
  VersionMismatchError,
} from '@purr/domain';
import { beforeEach, describe, expect, it } from 'vitest';

const STATES: State[] = [
  { id: 's-backlog', name: 'Backlog', group: 'backlog', order: 1 },
  { id: 's-todo', name: 'Todo', group: 'unstarted', order: 2 },
  { id: 's-doing', name: 'In progress', group: 'started', order: 3 },
  { id: 's-done', name: 'Done', group: 'completed', order: 4 },
];

export function runStorageContract(name: string, make: () => Promise<Storage>): void {
  describe(`storage contract: ${name}`, () => {
    let s: Storage;
    let home: string;
    let cat: string;

    beforeEach(async () => {
      s = await make();
      home = (await s.projects.create({ prefix: 'HOME', name: 'Home infra', states: STATES })).id;
      cat = (await s.projects.create({ prefix: 'CAT', name: 'Cats', states: STATES })).id;
    });

    describe('projects', () => {
      it('creates, gets by prefix and id, and lists', async () => {
        const p = await s.projects.get('HOME');
        expect(p.name).toBe('Home infra');
        expect(p.version).toBe(1);
        expect(p.metadata.bauEnabled).toBe(false);
        expect((await s.projects.getById(home)).prefix).toBe('HOME');
        expect((await s.projects.list()).map((x) => x.prefix)).toEqual(['CAT', 'HOME']);
      });

      it('refuses a duplicate prefix', async () => {
        await expect(s.projects.create({ prefix: 'HOME', name: 'Again' })).rejects.toBeInstanceOf(
          AlreadyExistsError,
        );
      });

      it('throws NotFound for an unknown project', async () => {
        await expect(s.projects.get('NOPE')).rejects.toBeInstanceOf(NotFoundError);
        await expect(s.projects.getById('nope')).rejects.toBeInstanceOf(NotFoundError);
      });

      it('updates with optimistic concurrency and merges metadata', async () => {
        const p = await s.projects.update(
          'HOME',
          { metadata: { bauEnabled: true, repo: 'nakomis/home-infra' } },
          1,
        );
        expect(p.version).toBe(2);
        expect(p.metadata).toMatchObject({ bauEnabled: true, repo: 'nakomis/home-infra' });
        await expect(s.projects.update('HOME', { name: 'x' }, 1)).rejects.toBeInstanceOf(
          VersionMismatchError,
        );
      });

      it('hides archived projects unless asked', async () => {
        await s.projects.update('CAT', { archived: true }, 1);
        expect((await s.projects.list()).map((x) => x.prefix)).toEqual(['HOME']);
        expect(await s.projects.list({ includeArchived: true })).toHaveLength(2);
      });
    });

    describe('tasks', () => {
      it('create allocates HOME-1, HOME-2', async () => {
        const a = await s.tasks.create({ projectId: home, title: 'one', stateId: 's-todo' }, 'claude');
        const b = await s.tasks.create({ projectId: home, title: 'two', stateId: 's-todo' }, 'claude');
        expect([a.ref, b.ref]).toEqual(['HOME-1', 'HOME-2']);
        expect(a.version).toBe(1);
        expect(a.createdBy).toBe('claude');
        expect(a.epics).toEqual([]);
        expect(a.projectRank < b.projectRank).toBe(true);
      });

      it('20 concurrent creates allocate 20 distinct consecutive refs', async () => {
        const made = await Promise.all(
          Array.from({ length: 20 }, (_, i) => s.tasks.create({ projectId: home, title: `t${i}` }, 'bau')),
        );
        const seqs = made.map((t) => t.sequence).sort((x, y) => x - y);
        expect(seqs).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
      });

      it('create with sequence 42 raises the counter so the next is 43', async () => {
        const old = await s.tasks.create({ projectId: home, title: 'imported', sequence: 42 }, 'system');
        expect(old.ref).toBe('HOME-42');
        const next = await s.tasks.create({ projectId: home, title: 'new' }, 'claude');
        expect(next.ref).toBe('HOME-43');
        await expect(
          s.tasks.create({ projectId: home, title: 'dup', sequence: 42 }, 'system'),
        ).rejects.toBeInstanceOf(AlreadyExistsError);
      });

      it('keeps imported timestamps', async () => {
        const t = await s.tasks.create(
          {
            projectId: home,
            title: 'old',
            sequence: 7,
            createdAt: '2026-01-02T03:04:05.000Z',
            updatedAt: '2026-02-01T00:00:00.000Z',
          },
          'system',
        );
        expect(t.createdAt).toBe('2026-01-02T03:04:05.000Z');
        expect(t.updatedAt).toBe('2026-02-01T00:00:00.000Z');
      });

      it('numbers each project independently', async () => {
        await s.tasks.create({ projectId: home, title: 'h' }, 'claude');
        const c = await s.tasks.create({ projectId: cat, title: 'c' }, 'claude');
        expect(c.ref).toBe('CAT-1');
      });

      it('gets, getMany in input order omitting missing, and NotFound', async () => {
        await s.tasks.create({ projectId: home, title: 'one' }, 'claude');
        await s.tasks.create({ projectId: home, title: 'two' }, 'claude');
        expect((await s.tasks.get('HOME-2')).title).toBe('two');
        expect((await s.tasks.getMany(['HOME-2', 'HOME-9', 'HOME-1'])).map((t) => t.ref)).toEqual([
          'HOME-2',
          'HOME-1',
        ]);
        await expect(s.tasks.get('HOME-99')).rejects.toBeInstanceOf(NotFoundError);
      });

      it('update with stale version throws VersionMismatch', async () => {
        await s.tasks.create({ projectId: home, title: 'one' }, 'claude');
        const v2 = await s.tasks.update('HOME-1', { title: 'by claude' }, 1, 'claude');
        expect(v2.version).toBe(2);
        expect(v2.updatedBy).toBe('claude');
        await expect(s.tasks.update('HOME-1', { title: 'by bau' }, 1, 'bau')).rejects.toBeInstanceOf(
          VersionMismatchError,
        );
        expect((await s.tasks.get('HOME-1')).title).toBe('by claude');
      });

      it('update can clear the parent and the points', async () => {
        await s.tasks.create({ projectId: home, title: 'p' }, 'claude');
        await s.tasks.create({ projectId: home, title: 'c', parent: 'HOME-1', points: 3 }, 'claude');
        const t = await s.tasks.update('HOME-2', { parent: undefined, points: undefined }, 1, 'claude');
        expect(t.parent).toBeUndefined();
        expect(t.points).toBeUndefined();
      });

      it('listByProject pages tasks in projectRank order with an opaque cursor', async () => {
        for (let i = 0; i < 5; i++) await s.tasks.create({ projectId: home, title: `t${i}` }, 'claude');
        const first = await s.tasks.get('HOME-1');
        await s.tasks.moveInProject('HOME-5', rankBetween(undefined, first.projectRank), 'claude');
        const p1 = await s.tasks.listByProject(home, { limit: 3 });
        expect(p1.items.map((t) => t.ref)).toEqual(['HOME-5', 'HOME-1', 'HOME-2']);
        expect(typeof p1.cursor).toBe('string');
        const p2 = await s.tasks.listByProject(home, { limit: 3, cursor: p1.cursor as string });
        expect(p2.items.map((t) => t.ref)).toEqual(['HOME-3', 'HOME-4']);
        expect(p2.cursor).toBeUndefined();
      });

      it('filters by state and label', async () => {
        await s.tasks.create({ projectId: home, title: 'a', stateId: 's-todo', labels: ['infra'] }, 'claude');
        await s.tasks.create({ projectId: home, title: 'b', stateId: 's-done' }, 'claude');
        expect((await s.tasks.listByProject(home, { stateIds: ['s-done'] })).items.map((t) => t.ref)).toEqual(
          ['HOME-2'],
        );
        expect((await s.tasks.listByProject(home, { label: 'infra' })).items.map((t) => t.ref)).toEqual([
          'HOME-1',
        ]);
      });

      it('lists children by parent', async () => {
        await s.tasks.create({ projectId: home, title: 'parent' }, 'claude');
        await s.tasks.create({ projectId: home, title: 'child', parent: 'HOME-1' }, 'claude');
        await s.tasks.create({ projectId: cat, title: 'other child', parent: 'HOME-1' }, 'claude');
        expect((await s.tasks.listChildren('HOME-1')).map((t) => t.ref).sort()).toEqual(['CAT-1', 'HOME-2']);
      });

      it('addRelation writes the inverse on the target', async () => {
        await s.tasks.create({ projectId: home, title: 'a' }, 'claude');
        await s.tasks.create({ projectId: cat, title: 'b' }, 'claude');
        await s.tasks.addRelation('HOME-1', 'blocks', 'CAT-1', 'claude');
        await s.tasks.addRelation('HOME-1', 'blocks', 'CAT-1', 'claude'); // idempotent
        expect((await s.tasks.get('HOME-1')).relations).toEqual([{ type: 'blocks', target: 'CAT-1' }]);
        expect((await s.tasks.get('CAT-1')).relations).toEqual([{ type: 'blocked_by', target: 'HOME-1' }]);
        await s.tasks.removeRelation('HOME-1', 'blocks', 'CAT-1', 'claude');
        expect((await s.tasks.get('HOME-1')).relations).toEqual([]);
        expect((await s.tasks.get('CAT-1')).relations).toEqual([]);
      });

      it('activity records creation and changed fields, oldest first', async () => {
        await s.tasks.create({ projectId: home, title: 'one', stateId: 's-todo' }, 'claude');
        await s.tasks.update('HOME-1', { stateId: 's-doing', title: 'one' }, 1, 'bau');
        const log = await s.activity.list('HOME-1');
        expect(log.map((a) => a.action)).toEqual(['created', 'updated']);
        expect(log[1]?.actor).toBe('bau');
        expect(log[1]?.changes).toEqual({ stateId: { from: 's-todo', to: 's-doing' } });
      });
    });

    describe('comments', () => {
      it('comments list oldest first and page', async () => {
        await s.tasks.create({ projectId: home, title: 'one' }, 'claude');
        await s.comments.add('HOME-1', 'second', 'bau', '2026-11-02T00:00:00.000Z');
        await s.comments.add('HOME-1', 'first', 'claude', '2026-11-01T00:00:00.000Z');
        await s.comments.add('HOME-1', 'third', 'martin', '2026-11-03T00:00:00.000Z');
        const p1 = await s.comments.list('HOME-1', { limit: 2 });
        expect(p1.items.map((c) => c.body)).toEqual(['first', 'second']);
        const p2 = await s.comments.list('HOME-1', { limit: 2, cursor: p1.cursor as string });
        expect(p2.items.map((c) => c.body)).toEqual(['third']);
      });

      it('refuses a comment on a missing task', async () => {
        await expect(s.comments.add('HOME-9', 'x', 'claude')).rejects.toBeInstanceOf(NotFoundError);
      });
    });

    describe('epics', () => {
      beforeEach(async () => {
        await s.tasks.create({ projectId: home, title: 'h1' }, 'claude');
        await s.tasks.create({ projectId: home, title: 'h2' }, 'claude');
        await s.tasks.create({ projectId: cat, title: 'c1' }, 'claude');
      });

      it('creates EPIC-1, EPIC-2 and lists them', async () => {
        const a = await s.epics.create({ name: 'Mace replaces Luke' }, 'claude');
        const b = await s.epics.create({ name: 'Purr' }, 'claude');
        expect([a.ref, b.ref]).toEqual(['EPIC-1', 'EPIC-2']);
        expect(a.projectIds).toEqual([]);
        expect((await s.epics.list()).map((e) => e.ref)).toEqual(['EPIC-1', 'EPIC-2']);
      });

      it('addTask flags the task project on the epic and lists in rank order', async () => {
        const e = await s.epics.create({ name: 'x' }, 'claude');
        await s.epics.addTask(e.ref, 'CAT-1');
        await s.epics.addTask(e.ref, 'HOME-1');
        const first = (await s.epics.listTasks(e.ref))[0];
        await s.epics.addTask(e.ref, 'HOME-2', rankBetween(undefined, first?.rank));
        expect((await s.epics.listTasks(e.ref)).map((m) => m.taskRef)).toEqual(['HOME-2', 'CAT-1', 'HOME-1']);
        expect((await s.epics.get(e.ref)).projectIds.sort()).toEqual([cat, home].sort());
        expect((await s.tasks.get('HOME-1')).epics).toEqual([e.ref]);
      });

      it('addTask is idempotent', async () => {
        const e = await s.epics.create({ name: 'x' }, 'claude');
        const m1 = await s.epics.addTask(e.ref, 'HOME-1');
        const m2 = await s.epics.addTask(e.ref, 'HOME-1');
        expect(m2).toEqual(m1);
        expect(await s.epics.listTasks(e.ref)).toHaveLength(1);
      });

      it('a task in two epics has independent ranks', async () => {
        const a = await s.epics.create({ name: 'a' }, 'claude');
        const b = await s.epics.create({ name: 'b' }, 'claude');
        await s.epics.addTask(a.ref, 'HOME-1');
        await s.epics.addTask(a.ref, 'HOME-2');
        await s.epics.addTask(b.ref, 'HOME-2');
        await s.epics.addTask(b.ref, 'HOME-1');
        expect((await s.epics.listTasks(a.ref)).map((m) => m.taskRef)).toEqual(['HOME-1', 'HOME-2']);
        expect((await s.epics.listTasks(b.ref)).map((m) => m.taskRef)).toEqual(['HOME-2', 'HOME-1']);
        const bFirst = (await s.epics.listTasks(b.ref))[0];
        await s.epics.moveTask(
          a.ref,
          'HOME-2',
          rankBetween(undefined, (await s.epics.listTasks(a.ref))[0]?.rank),
        );
        expect((await s.epics.listTasks(a.ref)).map((m) => m.taskRef)).toEqual(['HOME-2', 'HOME-1']);
        expect((await s.epics.listTasks(b.ref))[0]).toEqual(bFirst);
        expect((await s.tasks.get('HOME-1')).epics.sort()).toEqual([a.ref, b.ref].sort());
      });

      it('removeTask keeps the project flag', async () => {
        const e = await s.epics.create({ name: 'x' }, 'claude');
        await s.epics.addTask(e.ref, 'CAT-1');
        await s.epics.removeTask(e.ref, 'CAT-1');
        expect(await s.epics.listTasks(e.ref)).toEqual([]);
        expect((await s.epics.get(e.ref)).projectIds).toEqual([cat]);
        expect((await s.tasks.get('CAT-1')).epics).toEqual([]);
        await expect(s.epics.removeTask(e.ref, 'CAT-1')).rejects.toBeInstanceOf(NotFoundError);
      });

      it('flags a project with no tasks, idempotently', async () => {
        const e = await s.epics.create({ name: 'x' }, 'claude');
        await s.epics.flagProject(e.ref, home);
        const again = await s.epics.flagProject(e.ref, home);
        expect(again.projectIds).toEqual([home]);
      });

      it('unflagProject with remaining members throws Conflict', async () => {
        const e = await s.epics.create({ name: 'x' }, 'claude');
        await s.epics.addTask(e.ref, 'HOME-1');
        await expect(s.epics.unflagProject(e.ref, home)).rejects.toBeInstanceOf(ConflictError);
        await s.epics.removeTask(e.ref, 'HOME-1');
        expect((await s.epics.unflagProject(e.ref, home)).projectIds).toEqual([]);
      });

      it('listByProject returns epics flagged on the project', async () => {
        const a = await s.epics.create({ name: 'a' }, 'claude');
        const b = await s.epics.create({ name: 'b' }, 'claude');
        await s.epics.flagProject(a.ref, home);
        await s.epics.addTask(b.ref, 'CAT-1');
        expect((await s.epics.listByProject(home)).map((e) => e.ref)).toEqual([a.ref]);
        expect((await s.epics.listByProject(cat)).map((e) => e.ref)).toEqual([b.ref]);
      });

      it('updates with optimistic concurrency and hides archived', async () => {
        const e = await s.epics.create({ name: 'x' }, 'claude');
        const v2 = await s.epics.update(e.ref, { state: 'archived' }, 1);
        expect(v2.state).toBe('archived');
        await expect(s.epics.update(e.ref, { name: 'y' }, 1)).rejects.toBeInstanceOf(VersionMismatchError);
        expect(await s.epics.list()).toEqual([]);
        expect(await s.epics.list({ includeArchived: true })).toHaveLength(1);
      });

      it('throws NotFound for an unknown epic or task', async () => {
        await expect(s.epics.get('EPIC-99')).rejects.toBeInstanceOf(NotFoundError);
        const e = await s.epics.create({ name: 'x' }, 'claude');
        await expect(s.epics.addTask(e.ref, 'HOME-99')).rejects.toBeInstanceOf(NotFoundError);
      });
    });

    describe('board', () => {
      it('puts, replaces and removes cards', async () => {
        await s.board.put({ kind: 'project', id: home, column: 'backlog', rank: 'a' });
        await s.board.put({ kind: 'epic', id: 'EPIC-1', column: 'up_next', rank: 'b' });
        await s.board.put({ kind: 'project', id: home, column: 'in_progress', rank: 'c' });
        const cards = (await s.board.list()).sort((a, b) => a.rank.localeCompare(b.rank));
        expect(cards).toEqual([
          { kind: 'epic', id: 'EPIC-1', column: 'up_next', rank: 'b' },
          { kind: 'project', id: home, column: 'in_progress', rank: 'c' },
        ]);
        await s.board.remove('epic', 'EPIC-1');
        expect(await s.board.list()).toHaveLength(1);
      });
    });

    describe('api keys', () => {
      it('finds a key by its hash', async () => {
        await s.apiKeys.put({
          id: 'k1',
          actor: 'bau',
          hash: 'abc123',
          createdAt: '2026-11-22T00:00:00.000Z',
        });
        expect((await s.apiKeys.findByHash('abc123'))?.actor).toBe('bau');
        expect(await s.apiKeys.findByHash('nope')).toBeUndefined();
      });
    });
  });
}
