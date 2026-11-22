import { createMemoryStorage } from '@purr/storage-memory';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictError, NotFoundError, ValidationError, VersionMismatchError } from '../errors.js';
import { RecordingPublisher } from '../events.js';
import { createServices, type Services } from '../index.js';
import type { Storage } from '../ports.js';

let storage: Storage;
let events: RecordingPublisher;
let svc: Services;

beforeEach(async () => {
  storage = createMemoryStorage();
  events = new RecordingPublisher();
  svc = createServices(storage, events);
  await svc.projects.create({ prefix: 'HOME', name: 'Home infra' });
  await svc.projects.create({ prefix: 'CAT', name: 'Cats' });
});

describe('ProjectService', () => {
  it('gives a new project the default states and validates input', async () => {
    const p = await svc.projects.get('home');
    expect(p.states.map((s) => s.group)).toEqual([
      'backlog',
      'unstarted',
      'started',
      'completed',
      'cancelled',
    ]);
    await expect(svc.projects.create({ prefix: 'bad', name: 'x' })).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.projects.create({ prefix: 'OK', name: ' ' })).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.projects.update('HOME', { states: [] }, 1)).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('TaskService', () => {
  it('creates in the backlog state, adds unknown labels to the project and publishes', async () => {
    const t = await svc.tasks.create('HOME', { title: ' Fix it ', labels: ['infra', 'infra'] }, 'claude');
    const p = await svc.projects.get('HOME');
    expect(t.title).toBe('Fix it');
    expect(p.states.find((s) => s.id === t.stateId)?.group).toBe('backlog');
    expect(t.labels).toEqual(['infra']);
    expect(p.labels).toContain('infra');
    expect(events.events).toContainEqual({ type: 'TaskChanged', ref: 'HOME-1' });
  });

  it('refuses an empty title, bad points and an unknown state', async () => {
    await expect(svc.tasks.create('HOME', { title: '' }, 'claude')).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.tasks.create('HOME', { title: 'x', points: -1 }, 'claude')).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(svc.tasks.create('HOME', { title: 'x', state: 'Nope' }, 'claude')).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('pickUp moves to the first started state', async () => {
    await svc.tasks.create('HOME', { title: 'x' }, 'claude');
    const t = await svc.tasks.pickUp('home-1', 'bau');
    const p = await svc.projects.get('HOME');
    expect(p.states.find((s) => s.id === t.stateId)?.name).toBe('In progress');
  });

  it('pickUp is a Conflict when the project has no started state', async () => {
    await svc.projects.create({
      prefix: 'NOSTART',
      name: 'x',
      states: [{ id: 'b', name: 'Backlog', group: 'backlog', order: 1 }],
    });
    await svc.tasks.create('NOSTART', { title: 'x' }, 'claude');
    await expect(svc.tasks.pickUp('NOSTART-1', 'claude')).rejects.toBeInstanceOf(ConflictError);
  });

  it('setState accepts a state name and is a no-op when already there', async () => {
    await svc.tasks.create('HOME', { title: 'x' }, 'claude');
    const done = await svc.tasks.setState('HOME-1', 'done', 'claude');
    const again = await svc.tasks.setState('HOME-1', 'Done', 'claude');
    expect(again.version).toBe(done.version);
  });

  it('update needs the current version', async () => {
    await svc.tasks.create('HOME', { title: 'x' }, 'claude');
    await svc.tasks.update('HOME-1', { title: 'y', state: 'Todo' }, 1, 'claude');
    await expect(svc.tasks.update('HOME-1', { title: 'z' }, 1, 'bau')).rejects.toBeInstanceOf(
      VersionMismatchError,
    );
    await expect(svc.tasks.update('HOME-1', { parent: 'HOME-1' }, 2, 'bau')).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('labels, links, points and parents', async () => {
    await svc.tasks.create('HOME', { title: 'p' }, 'claude');
    await svc.tasks.create('HOME', { title: 'c' }, 'claude');
    await svc.tasks.addLabel('HOME-2', 'cats', 'claude');
    await svc.tasks.addLabel('HOME-2', 'cats', 'claude');
    expect((await svc.tasks.get('HOME-2')).labels).toEqual(['cats']);
    await svc.tasks.removeLabel('HOME-2', 'cats', 'claude');
    const link = await svc.tasks.addLink('HOME-2', 'https://example.com/form', 'Form', 'claude');
    await expect(svc.tasks.addLink('HOME-2', 'not a url', undefined, 'claude')).rejects.toBeInstanceOf(
      ValidationError,
    );
    await svc.tasks.removeLink('HOME-2', link.id, 'claude');
    await expect(svc.tasks.removeLink('HOME-2', link.id, 'claude')).rejects.toBeInstanceOf(NotFoundError);
    expect((await svc.tasks.setPoints('HOME-2', 3, 'claude')).points).toBe(3);
    await svc.tasks.setParent('HOME-2', 'HOME-1', 'claude');
    expect((await svc.tasks.children('HOME-1')).map((t) => t.ref)).toEqual(['HOME-2']);
    await expect(svc.tasks.setParent('HOME-1', 'HOME-2', 'claude')).rejects.toBeInstanceOf(ValidationError);
    expect((await svc.tasks.setParent('HOME-2', undefined, 'claude')).parent).toBeUndefined();
  });

  it('relations and comments', async () => {
    await svc.tasks.create('HOME', { title: 'a' }, 'claude');
    await svc.tasks.create('CAT', { title: 'b' }, 'claude');
    await svc.tasks.addRelation('HOME-1', 'blocks', 'cat-1', 'claude');
    expect((await svc.tasks.get('CAT-1')).relations).toEqual([{ type: 'blocked_by', target: 'HOME-1' }]);
    await expect(svc.tasks.addRelation('HOME-1', 'blocks', 'HOME-1', 'claude')).rejects.toBeInstanceOf(
      ValidationError,
    );
    await svc.tasks.removeRelation('HOME-1', 'blocks', 'CAT-1', 'claude');
    const c = await svc.tasks.addComment('HOME-1', 'Done it', 'bau');
    expect(events.events).toContainEqual({ type: 'CommentAdded', taskRef: 'HOME-1', commentId: c.id });
    await expect(svc.tasks.addComment('HOME-1', ' ', 'bau')).rejects.toBeInstanceOf(ValidationError);
  });

  it('moveInProject reorders within the project only', async () => {
    for (const t of ['a', 'b', 'c']) await svc.tasks.create('HOME', { title: t }, 'claude');
    await svc.tasks.moveInProject('HOME-3', 'HOME-1', 'claude');
    const order = (await svc.tasks.allInProject((await svc.projects.get('HOME')).id)).map((t) => t.ref);
    expect(order).toEqual(['HOME-3', 'HOME-1', 'HOME-2']);
    await svc.tasks.moveInProject('HOME-3', undefined, 'claude');
    expect((await svc.tasks.allInProject((await svc.projects.get('HOME')).id)).map((t) => t.ref)).toEqual([
      'HOME-1',
      'HOME-2',
      'HOME-3',
    ]);
  });

  it('a failing publisher does not fail the write', async () => {
    const warn = vi.fn();
    const broken = createServices(storage, {
      publish: async () => {
        throw new Error('queue down');
      },
    });
    // Reach the deps to inject a quiet warn: services share one deps object.
    (broken.tasks as unknown as { deps: { warn: typeof warn } }).deps.warn = warn;
    const t = await broken.tasks.create('HOME', { title: 'still saved' }, 'claude');
    expect((await storage.tasks.get(t.ref)).title).toBe('still saved');
    expect(warn).toHaveBeenCalled();
  });
});

describe('EpicService', () => {
  beforeEach(async () => {
    for (const t of ['h1', 'h2']) await svc.tasks.create('HOME', { title: t }, 'claude');
    await svc.tasks.create('CAT', { title: 'c1' }, 'claude');
  });

  it('holds tasks from several projects in its own order and flags them', async () => {
    const e = await svc.epics.create({ name: 'Purr' }, 'claude');
    await svc.epics.addTask(e.ref, 'HOME-1');
    await svc.epics.addTask(e.ref, 'CAT-1');
    await svc.epics.addTask(e.ref, 'HOME-2', 'HOME-1');
    const { tasks, epic } = await svc.epics.tasks(e.ref);
    expect(tasks.map((t) => t.ref)).toEqual(['HOME-2', 'HOME-1', 'CAT-1']);
    expect(epic.projectIds).toHaveLength(2);
    await svc.epics.moveTask(e.ref, 'CAT-1', 'HOME-2');
    expect((await svc.epics.tasks(e.ref)).tasks.map((t) => t.ref)).toEqual(['CAT-1', 'HOME-2', 'HOME-1']);
    expect((await svc.epics.forTask('HOME-1')).map((x) => x.ref)).toEqual([e.ref]);
  });

  it('flags and unflags projects by prefix', async () => {
    const e = await svc.epics.create({ name: 'x' }, 'claude');
    await svc.epics.flagProject(e.ref, 'home');
    expect((await svc.epics.forProject('HOME')).map((x) => x.ref)).toEqual([e.ref]);
    await svc.epics.addTask(e.ref, 'HOME-1');
    await expect(svc.epics.unflagProject(e.ref, 'HOME')).rejects.toBeInstanceOf(ConflictError);
    await svc.epics.removeTask(e.ref, 'HOME-1');
    expect((await svc.epics.unflagProject(e.ref, 'HOME')).projectIds).toEqual([]);
  });

  it('validates names and membership moves', async () => {
    await expect(svc.epics.create({ name: '' }, 'claude')).rejects.toBeInstanceOf(ValidationError);
    const e = await svc.epics.create({ name: 'x' }, 'claude');
    await expect(svc.epics.moveTask(e.ref, 'HOME-1')).rejects.toBeInstanceOf(ValidationError);
    expect((await svc.epics.update(e.ref, { name: 'y' }, 1)).name).toBe('y');
  });
});

describe('BoardService', () => {
  let homeId: string;
  beforeEach(async () => {
    homeId = (await svc.projects.get('HOME')).id;
    await svc.tasks.create('HOME', { title: 'h1', points: 2 }, 'claude');
    await svc.tasks.create('HOME', { title: 'h2', points: 3 }, 'claude');
    await svc.tasks.create('CAT', { title: 'c1', points: 5 }, 'claude');
    await svc.tasks.setState('HOME-2', 'Done', 'claude');
  });

  it('getBoard column points count a task once', async () => {
    const e = await svc.epics.create({ name: 'Purr' }, 'claude');
    await svc.epics.addTask(e.ref, 'HOME-1');
    await svc.epics.addTask(e.ref, 'CAT-1');
    await svc.board.move('project', 'HOME', 'up_next');
    await svc.board.move('epic', e.ref, 'up_next');
    const board = await svc.board.getBoard();
    const upNext = board.columns.find((c) => c.column === 'up_next');
    expect(upNext?.cards.map((c) => [c.kind, c.key, c.points])).toEqual([
      ['project', 'HOME', 2],
      ['epic', 'EPIC-1', 7],
    ]);
    expect(upNext?.points).toBe(7);
    const all = await svc.board.getBoard({ all: true });
    expect(all.columns.find((c) => c.column === 'up_next')?.cards[0]?.tasks).toHaveLength(2);
    expect(board.columns.map((c) => c.column)).toEqual(['backlog', 'up_next', 'in_progress']);
    expect(upNext?.cards[0]?.id).toBe(homeId);
  });

  it('move places before another card, and validates', async () => {
    await svc.board.move('project', 'HOME', 'backlog');
    await svc.board.move('project', 'CAT', 'backlog', homeId);
    const backlog = (await svc.board.getBoard()).columns[0];
    expect(backlog?.cards.map((c) => c.key)).toEqual(['CAT', 'HOME']);
    await expect(svc.board.move('project', 'HOME', 'nowhere' as never)).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(svc.board.move('project', 'CAT', 'backlog', 'missing')).rejects.toBeInstanceOf(
      ValidationError,
    );
    await svc.board.remove('project', 'CAT');
    expect((await svc.board.getBoard()).columns[0]?.cards.map((c) => c.key)).toEqual(['HOME']);
  });

  it('next walks in_progress then up_next and skips completed', async () => {
    await svc.board.move('project', 'CAT', 'up_next');
    await svc.board.move('project', 'HOME', 'in_progress');
    const n = await svc.board.next();
    expect(n.next?.ref).toBe('HOME-1');
    expect(n.runnersUp.map((t) => t.ref)).toEqual(['CAT-1']);
  });

  it('priority lists each open task once in board order', async () => {
    const e = await svc.epics.create({ name: 'x' }, 'claude');
    await svc.epics.addTask(e.ref, 'CAT-1');
    await svc.epics.addTask(e.ref, 'HOME-1');
    await svc.board.move('epic', e.ref, 'in_progress');
    await svc.board.move('project', 'HOME', 'backlog');
    expect(await svc.board.priority()).toEqual(['CAT-1', 'HOME-1']);
  });

  it('ignores cards whose project or epic no longer exists', async () => {
    await storage.board.put({ kind: 'epic', id: 'EPIC-404', column: 'backlog', rank: 'a' });
    await storage.board.put({ kind: 'project', id: 'gone', column: 'backlog', rank: 'b' });
    expect((await svc.board.getBoard()).columns[0]?.cards).toEqual([]);
  });
});
