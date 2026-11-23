import { createServices, nullPublisher, type SearchIndex, type Storage } from '@purr/domain';
import { createMemoryStorage } from '@purr/storage-memory';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleEvent } from './app.js';
import { type AuthDeps, hashApiKey } from './auth.js';
import { errorResponse } from './http.js';
import { buildRouter } from './routes.js';

const CLAUDE_KEY = 'claude-test-key-0123456789abcdef';
const BAU_KEY = 'bau-test-key-0123456789abcdef0123';

let storage: Storage;
let auth: AuthDeps;
let search: SearchIndex;
let router: ReturnType<typeof buildRouter>;

function event(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string | undefined> = {},
): APIGatewayProxyEventV2 {
  const [rawPath, rawQueryString = ''] = path.split('?');
  const qs = Object.fromEntries(new URLSearchParams(rawQueryString));
  return {
    version: '2.0',
    routeKey: '$default',
    rawPath: rawPath as string,
    rawQueryString,
    headers: { 'x-api-key': CLAUDE_KEY, ...headers },
    ...(rawQueryString ? { queryStringParameters: qs } : {}),
    requestContext: { http: { method, path: rawPath } } as APIGatewayProxyEventV2['requestContext'],
    ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
    isBase64Encoded: false,
  } as APIGatewayProxyEventV2;
}

async function call(
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string | undefined>,
) {
  const res = (await handleEvent(
    event(method, path, body, headers),
    router,
    auth,
  )) as APIGatewayProxyStructuredResultV2;
  return { status: res.statusCode as number, body: res.body ? JSON.parse(res.body) : undefined };
}

beforeEach(async () => {
  storage = createMemoryStorage();
  await storage.apiKeys.put({
    id: 'k1',
    actor: 'claude',
    hash: hashApiKey(CLAUDE_KEY),
    createdAt: '2026-11-22T00:00:00Z',
  });
  await storage.apiKeys.put({
    id: 'k2',
    actor: 'bau',
    hash: hashApiKey(BAU_KEY),
    createdAt: '2026-11-22T00:00:00Z',
  });
  search = {
    query: vi.fn(async () => [
      { kind: 'task', id: 'HOME-1', taskRef: 'HOME-1', title: 't', snippet: 's', score: 1 },
    ]),
  } as SearchIndex;
  router = buildRouter({
    services: createServices(storage, nullPublisher),
    storage,
    search,
    version: '0.1.0',
  });
  auth = {
    apiKeys: storage.apiKeys,
    allowedEmails: ['martin@nakomis.com'],
    verifyIdToken: async (token) => {
      if (token === 'good') return { email: 'Martin@nakomis.com' };
      if (token === 'stranger') return { email: 'someone@example.com' };
      throw new Error('bad token');
    },
  };
  await call('POST', '/api/projects', { prefix: 'HOME', name: 'Home infra' });
  await call('POST', '/api/projects', { prefix: 'CAT', name: 'Cats', icon: '/icons/CAT.png' });
});

describe('authentication', () => {
  it('authoriser rejects missing, unknown and malformed credentials', async () => {
    for (const headers of [
      { 'x-api-key': 'unknown-key-0123456789abcdefghij' },
      { 'x-api-key': 'short' },
      { 'x-api-key': undefined as unknown as string, authorization: 'Basic abc' },
      { 'x-api-key': undefined as unknown as string, authorization: 'Bearer nope' },
      { 'x-api-key': undefined as unknown as string },
    ]) {
      const res = await call('GET', '/api/projects', undefined, headers);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORISED');
    }
  });

  it('maps API keys and allowed Cognito users to actors', async () => {
    expect((await call('GET', '/api/me')).body).toEqual({ actor: 'claude' });
    expect((await call('GET', '/api/me', undefined, { 'x-api-key': BAU_KEY })).body).toEqual({
      actor: 'bau',
    });
    const martin = await call('GET', '/api/me', undefined, {
      'x-api-key': undefined as unknown as string,
      authorization: 'Bearer good',
    });
    expect(martin.body).toEqual({ actor: 'martin' });
    const stranger = await call('GET', '/api/me', undefined, {
      'x-api-key': undefined as unknown as string,
      authorization: 'Bearer stranger',
    });
    expect(stranger.status).toBe(403);
  });

  it('serves health without credentials', async () => {
    const res = await call('GET', '/api/health', undefined, { 'x-api-key': undefined as unknown as string });
    expect(res).toEqual({ status: 200, body: { ok: true, version: '0.1.0' } });
  });
});

describe('errors', () => {
  it('maps domain errors to statuses with the standard body', async () => {
    expect((await call('GET', '/api/projects/NOPE')).status).toBe(404);
    expect((await call('POST', '/api/projects', { prefix: 'HOME', name: 'again' })).status).toBe(409);
    expect((await call('POST', '/api/projects', { prefix: 'x', name: 'bad' })).body.error.code).toBe(
      'VALIDATION',
    );
    expect((await call('POST', '/api/projects', '{not json')).status).toBe(400);
    expect((await call('GET', '/api/nowhere')).body.error.code).toBe('ROUTE_NOT_FOUND');
    expect((await call('DELETE', '/api/projects')).status).toBe(405);
  });

  it('hides unexpected errors behind a 500', () => {
    const res = errorResponse(new Error('secret detail'), () => {});
    expect(res).toEqual({
      status: 500,
      body: { error: { code: 'INTERNAL', message: 'Something went wrong' } },
    });
  });
});

describe('projects and tasks', () => {
  it('creates, reads, filters and updates tasks', async () => {
    const created = await call('POST', '/api/projects/home/tasks', {
      title: 'Wire the SD card',
      description: 'See [the form](https://example.com)',
      labels: ['esp32'],
      points: 2,
      priority: 'high',
    });
    expect(created.status).toBe(201);
    expect(created.body.ref).toBe('HOME-1');
    expect(created.body.createdBy).toBe('claude');
    await call('POST', '/api/projects/HOME/tasks', { title: 'Second' });

    const detail = await call('GET', '/api/tasks/home-1');
    expect(detail.body.project).toMatchObject({ prefix: 'HOME', name: 'Home infra' });
    expect(detail.body.state.group).toBe('backlog');
    expect(detail.body.comments).toEqual([]);

    const patched = await call('PATCH', '/api/tasks/HOME-1', {
      version: 1,
      title: 'Wired the SD card',
      state: 'Todo',
    });
    expect(patched.body.version).toBe(2);
    expect((await call('PATCH', '/api/tasks/HOME-1', { version: 1, title: 'stale' })).body.error.code).toBe(
      'VERSION_MISMATCH',
    );
    expect((await call('PATCH', '/api/tasks/HOME-1', { title: 'no version' })).status).toBe(400);

    expect(
      (await call('GET', '/api/projects/HOME/tasks')).body.items.map((t: { ref: string }) => t.ref),
    ).toEqual(['HOME-1', 'HOME-2']);
    expect((await call('GET', '/api/projects/HOME/tasks?label=esp32')).body.items).toHaveLength(1);
    await call('POST', '/api/tasks/HOME-2/state', { state: 'Done' });
    expect((await call('GET', '/api/projects/HOME/tasks')).body.items).toHaveLength(1);
    expect((await call('GET', '/api/projects/HOME/tasks?all=true')).body.items).toHaveLength(2);
    expect((await call('GET', '/api/projects/HOME/tasks?state=done')).body.items).toHaveLength(1);
    expect((await call('GET', '/api/projects/HOME/tasks?state=nope')).status).toBe(400);
    expect((await call('GET', '/api/projects/HOME/tasks?limit=1')).body.cursor).toBeUndefined();
  });

  it('pick-up, points, labels, links, relations, parents, comments and activity', async () => {
    await call('POST', '/api/projects/HOME/tasks', { title: 'a' });
    await call('POST', '/api/projects/CAT/tasks', { title: 'b' });
    expect((await call('POST', '/api/tasks/HOME-1/pick-up')).body.stateId).toBeDefined();
    expect((await call('PUT', '/api/tasks/HOME-1/points', { points: 3 })).body.points).toBe(3);
    expect((await call('PUT', '/api/tasks/HOME-1/points', { points: null })).body.points).toBeUndefined();
    expect((await call('PUT', '/api/tasks/HOME-1/points', {})).status).toBe(400);
    expect((await call('PUT', '/api/tasks/HOME-1/labels/infra')).body.labels).toEqual(['infra']);
    expect((await call('DELETE', '/api/tasks/HOME-1/labels/infra')).body.labels).toEqual([]);
    const link = await call('POST', '/api/tasks/HOME-1/links', {
      url: 'https://example.com',
      title: 'Example',
    });
    expect(link.status).toBe(201);
    expect((await call('DELETE', `/api/tasks/HOME-1/links/${link.body.id}`)).body.links).toEqual([]);
    expect(
      (await call('POST', '/api/tasks/HOME-1/relations', { type: 'blocks', target: 'CAT-1' })).status,
    ).toBe(204);
    expect(
      (await call('POST', '/api/tasks/HOME-1/relations', { type: 'eats', target: 'CAT-1' })).status,
    ).toBe(400);
    expect(
      (await call('DELETE', '/api/tasks/HOME-1/relations', { type: 'blocks', target: 'CAT-1' })).status,
    ).toBe(204);
    expect((await call('PUT', '/api/tasks/CAT-1/parent', { parent: 'HOME-1' })).body.parent).toBe('HOME-1');
    expect(
      (await call('GET', '/api/tasks/HOME-1/children')).body.items.map((t: { ref: string }) => t.ref),
    ).toEqual(['CAT-1']);
    expect(
      (await call('POST', '/api/tasks/HOME-1/comments', { body: 'Done' }, { 'x-api-key': BAU_KEY })).body
        .author,
    ).toBe('bau');
    expect((await call('GET', '/api/tasks/HOME-1/comments')).body.items).toHaveLength(1);
    expect((await call('GET', '/api/tasks/HOME-9/comments')).status).toBe(404);
    expect((await call('GET', '/api/tasks/HOME-1/activity')).body.items[0].action).toBe('created');
    expect((await call('GET', '/api/tasks/HOME-1')).body.children).toHaveLength(1);
  });

  it('assigns, filters by and unassigns tasks', async () => {
    await call('POST', '/api/projects/HOME/tasks', { title: 'a', assignee: 'bau' });
    await call('POST', '/api/projects/HOME/tasks', { title: 'b' });
    expect((await call('GET', '/api/tasks/HOME-1')).body.assignee).toBe('bau');
    const refs = async (q: string) =>
      (await call('GET', `/api/projects/HOME/tasks?assignee=${q}`)).body.items.map(
        (t: { ref: string }) => t.ref,
      );
    expect(await refs('bau')).toEqual(['HOME-1']);
    expect(await refs('none')).toEqual(['HOME-2']);
    expect((await call('GET', '/api/projects/HOME/tasks?assignee=nobody')).status).toBe(400);
    expect((await call('PUT', '/api/tasks/HOME-2/assignee', { assignee: 'claude' })).body.assignee).toBe(
      'claude',
    );
    expect(
      (await call('PUT', '/api/tasks/HOME-1/assignee', { assignee: null })).body.assignee,
    ).toBeUndefined();
    expect((await call('PUT', '/api/tasks/HOME-1/assignee', { assignee: 'system' })).status).toBe(400);
    expect((await call('PUT', '/api/tasks/HOME-1/assignee', {})).status).toBe(400);
    const v = (await call('GET', '/api/tasks/HOME-2')).body.version;
    expect(
      (await call('PATCH', '/api/tasks/HOME-2', { version: v, assignee: null })).body.assignee,
    ).toBeUndefined();
  });

  it('reorders tasks within their project only', async () => {
    for (const t of ['a', 'b', 'c']) await call('POST', '/api/projects/HOME/tasks', { title: t });
    await call('POST', '/api/projects/CAT/tasks', { title: 'x' });
    await call('POST', '/api/projects/HOME/tasks/reorder', { ref: 'HOME-3', before: 'HOME-1' });
    expect(
      (await call('GET', '/api/projects/HOME/tasks')).body.items.map((t: { ref: string }) => t.ref),
    ).toEqual(['HOME-3', 'HOME-1', 'HOME-2']);
    expect((await call('POST', '/api/projects/HOME/tasks/reorder', { ref: 'CAT-1' })).status).toBe(400);
  });

  it('patches project metadata and validates it', async () => {
    const p = await call('PATCH', '/api/projects/HOME', {
      version: 1,
      metadata: { bauEnabled: true, repo: 'nakomis/home-infra' },
    });
    expect(p.body.metadata).toMatchObject({ bauEnabled: true, repo: 'nakomis/home-infra' });
    expect(
      (await call('PATCH', '/api/projects/HOME', { version: 2, metadata: { bauEnabled: 'yes' } })).status,
    ).toBe(400);
    expect((await call('PATCH', '/api/projects/HOME', { version: 2, archived: true })).body.archived).toBe(
      true,
    );
    expect((await call('GET', '/api/projects')).body.items.map((x: { prefix: string }) => x.prefix)).toEqual([
      'CAT',
    ]);
    expect((await call('GET', '/api/projects?archived=true')).body.items).toHaveLength(2);
  });
});

describe('epics', () => {
  it('creates with flags, adds across projects, orders, unflags and details', async () => {
    await call('POST', '/api/projects/HOME/tasks', { title: 'h1', points: 2 });
    await call('POST', '/api/projects/CAT/tasks', { title: 'c1', points: 3 });
    const epic = await call('POST', '/api/epics', { name: 'Purr', projects: ['home'] });
    expect(epic.status).toBe(201);
    expect(epic.body.ref).toBe('EPIC-1');
    await call('PUT', '/api/epics/EPIC-1/tasks/CAT-1');
    await call('PUT', '/api/epics/epic-1/tasks/HOME-1', { before: 'CAT-1' });
    const detail = await call('GET', '/api/epics/EPIC-1');
    expect(
      detail.body.tasks.map((t: { ref: string; projectPrefix: string }) => [t.ref, t.projectPrefix]),
    ).toEqual([
      ['HOME-1', 'HOME'],
      ['CAT-1', 'CAT'],
    ]);
    expect(detail.body.projects.map((p: { prefix: string }) => p.prefix).sort()).toEqual(['CAT', 'HOME']);
    await call('POST', '/api/epics/EPIC-1/tasks/reorder', { ref: 'HOME-1' });
    expect(
      (await call('GET', '/api/epics/EPIC-1/tasks')).body.items.map((t: { ref: string }) => t.ref),
    ).toEqual(['CAT-1', 'HOME-1']);
    expect((await call('DELETE', '/api/epics/EPIC-1/projects/CAT')).status).toBe(409);
    expect((await call('DELETE', '/api/epics/EPIC-1/tasks/CAT-1')).status).toBe(204);
    expect((await call('DELETE', '/api/epics/EPIC-1/projects/CAT')).body.projectIds).toHaveLength(1);
    expect((await call('PUT', '/api/epics/EPIC-1/projects/CAT')).body.projectIds).toHaveLength(2);
    expect((await call('GET', '/api/projects/CAT/epics')).body.items).toHaveLength(1);
    expect(
      (await call('GET', '/api/tasks/HOME-1/epics')).body.items.map((e: { ref: string }) => e.ref),
    ).toEqual(['EPIC-1']);
    expect((await call('PATCH', '/api/epics/EPIC-1', { version: 99, name: 'x' })).status).toBe(409);
    const fresh = await call('GET', '/api/epics/EPIC-1');
    expect(
      (await call('PATCH', '/api/epics/EPIC-1', { version: fresh.body.version, state: 'done' })).body.state,
    ).toBe('done');
    expect(
      (await call('PATCH', '/api/epics/EPIC-1', { version: fresh.body.version + 1, state: 'nope' })).status,
    ).toBe(400);
    expect((await call('GET', '/api/epics')).body.items).toHaveLength(1);
  });
});

describe('board, next and priority', () => {
  it('moves cards and answers what is next', async () => {
    await call('POST', '/api/projects/HOME/tasks', { title: 'h1', points: 2 });
    await call('POST', '/api/projects/CAT/tasks', { title: 'c1', points: 3 });
    await call('POST', '/api/epics', { name: 'Purr' });
    await call('PUT', '/api/epics/EPIC-1/tasks/CAT-1');
    expect(
      (await call('POST', '/api/board/move', { kind: 'project', id: 'HOME', column: 'up_next' })).status,
    ).toBe(200);
    expect(
      (await call('POST', '/api/board/move', { kind: 'epic', id: 'epic-1', column: 'in_progress' })).status,
    ).toBe(200);
    expect(
      (await call('POST', '/api/board/move', { kind: 'thing', id: 'x', column: 'up_next' })).status,
    ).toBe(400);
    expect(
      (await call('POST', '/api/board/move', { kind: 'project', id: 'HOME', column: 'later' })).status,
    ).toBe(400);
    const board = await call('GET', '/api/board');
    expect(board.body.columns.map((c: { column: string; points: number }) => [c.column, c.points])).toEqual([
      ['backlog', 0],
      ['up_next', 2],
      ['in_progress', 3],
    ]);
    expect((await call('GET', '/api/next')).body.next.ref).toBe('CAT-1');
    expect((await call('GET', '/api/priority')).body.items).toEqual(['CAT-1', 'HOME-1']);
    expect((await call('DELETE', '/api/board/epic/EPIC-1')).status).toBe(204);
    expect((await call('GET', '/api/board?all=true')).body.columns[2].cards).toEqual([]);
  });
});

describe('search', () => {
  it('passes filters to the index and validates the query', async () => {
    await call('POST', '/api/epics', { name: 'Purr' });
    const res = await call(
      'GET',
      '/api/search?q=sd+card&mode=semantic&project=HOME&epic=epic-1&kind=task,comment&limit=5',
    );
    expect(res.body.items[0].taskRef).toBe('HOME-1');
    expect(search.query).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'sd card',
        mode: 'semantic',
        epicRef: 'EPIC-1',
        kinds: ['task', 'comment'],
        limit: 5,
      }),
    );
    expect((await call('GET', '/api/search')).status).toBe(400);
    expect((await call('GET', '/api/search?q=x&mode=psychic')).status).toBe(400);
    expect((await call('GET', '/api/search?q=x&kind=dog')).status).toBe(400);
  });

  it('returns no hits when search is not configured', async () => {
    router = buildRouter({ services: createServices(storage, nullPublisher), storage, version: 'x' });
    expect((await call('GET', '/api/search?q=anything')).body).toEqual({ items: [] });
  });
});
