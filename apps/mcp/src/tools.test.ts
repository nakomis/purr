import { describe, expect, it } from 'vitest';
import { PurrApiError, PurrClient } from './client.js';
import { loadConfig } from './config.js';
import { createServer } from './server.js';
import { runTool, TOOLS } from './tools.js';

interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: unknown;
}

/** A fake fetch keyed by "METHOD /path?query"; unmatched requests get a 404 API error. */
function fake(routes: Record<string, unknown>) {
  const calls: Call[] = [];
  const fetchImpl = async (input: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const url = new URL(input);
    calls.push({
      method,
      url: input,
      headers: init?.headers as Record<string, string>,
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    });
    const key = `${method} ${url.pathname.replace(/^\/api/, '')}${url.search}`;
    if (key in routes) {
      const v = routes[key];
      if (v === undefined) return new Response(null, { status: 204 });
      return new Response(JSON.stringify(v), { status: 200 });
    }
    return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: `no route ${key}` } }), {
      status: 404,
    });
  };
  const client = new PurrClient({ url: 'https://purr.test', apiKey: 'k3y' }, fetchImpl);
  return { client, calls };
}

const task = (over: Record<string, unknown> = {}) => ({
  id: 'i1',
  ref: 'HOME-42',
  title: 'Fix the thing',
  description: 'Body',
  stateId: 's2',
  labels: ['bug'],
  priority: 'high',
  points: 3,
  links: [],
  relations: [],
  epics: [],
  version: 7,
  ...over,
});

const project = {
  id: 'p1',
  prefix: 'HOME',
  name: 'Home infrastructure',
  description: 'Servers',
  states: [
    { id: 's1', name: 'New', group: 'unstarted', order: 1 },
    { id: 's2', name: 'In progress', group: 'started', order: 2 },
  ],
  labels: ['bug'],
  metadata: { repo: 'nakomis/home', bauEnabled: true },
  archived: false,
  version: 1,
};

const epic = {
  id: 'e1',
  ref: 'EPIC-7',
  name: 'Cutover',
  description: 'Move',
  state: 'open',
  projectIds: ['p1'],
  version: 3,
};

describe('config', () => {
  it('fails clearly without PURR_URL and PURR_API_KEY', () => {
    expect(() => loadConfig({})).toThrow(/PURR_URL, PURR_API_KEY/);
    expect(() => loadConfig({ PURR_URL: 'https://x' })).toThrow(/PURR_API_KEY/);
    expect(() => loadConfig({ PURR_API_KEY: 'k' })).toThrow(/PURR_URL/);
  });

  it('trims the URL', () => {
    expect(loadConfig({ PURR_URL: 'https://purr.nakomis.com/', PURR_API_KEY: ' k ' })).toEqual({
      url: 'https://purr.nakomis.com',
      apiKey: 'k',
    });
  });
});

describe('client', () => {
  it('sends the api key and appends /api', async () => {
    const { client, calls } = fake({ 'GET /health': { ok: true } });
    await client.get('/health');
    expect(calls[0]?.url).toBe('https://purr.test/api/health');
    expect(calls[0]?.headers['x-api-key']).toBe('k3y');
  });

  it('throws PurrApiError with code and message', async () => {
    const { client } = fake({});
    await expect(client.get('/nope')).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
    await expect(client.get('/nope')).rejects.toBeInstanceOf(PurrApiError);
  });

  it('copes with non-JSON error bodies and unreachable hosts', async () => {
    const odd = new PurrClient(
      { url: 'https://x', apiKey: 'k' },
      async () => new Response('Bad gateway', { status: 502 }),
    );
    await expect(odd.get('/a')).rejects.toMatchObject({ code: 'HTTP_ERROR', detail: 'Bad gateway' });
    const down = new PurrClient({ url: 'https://x', apiKey: 'k' }, async () => {
      throw new Error('ECONNREFUSED');
    });
    await expect(down.get('/a')).rejects.toThrow(/Could not reach Purr.*ECONNREFUSED/);
  });
});

interface Case {
  tool: string;
  args: Record<string, unknown>;
  routes: Record<string, unknown>;
  /** Expected mutating/fetch calls, in order: [method, path-with-query, body?] */
  expect: [string, string, unknown?][];
  output?: RegExp;
}

const cases: Case[] = [
  {
    tool: 'get_task',
    args: { ref: 'home-42' },
    routes: {
      'GET /tasks/home-42': {
        ...task({
          parent: 'HOME-1',
          links: [{ id: 'l1', url: 'https://github.com/x/pull/1', title: 'PR' }],
          relations: [{ type: 'blocked_by', target: 'HOME-9' }],
        }),
        project: { id: 'p1', prefix: 'HOME', name: 'Home infrastructure' },
        state: { id: 's2', name: 'In progress', group: 'started', order: 2 },
        comments: [{ id: 'c1', body: 'Looking', author: 'claude', createdAt: '2026-11-22' }],
        children: [task({ ref: 'HOME-43', title: 'Child' })],
        epics: [epic],
      },
    },
    expect: [['GET', '/tasks/home-42']],
    output:
      /# HOME-42: Fix the thing[\s\S]*In progress[\s\S]*blocked by HOME-9[\s\S]*HOME-43[\s\S]*EPIC-7[\s\S]*Looking/,
  },
  {
    tool: 'list_tasks',
    args: { project: 'HOME', state: 'In progress', label: 'bug', epic: 'EPIC-7', all: true, limit: 50 },
    routes: {
      'GET /projects/HOME/tasks?state=In+progress&label=bug&epic=EPIC-7&all=true&limit=50': {
        items: [task()],
      },
      'GET /projects/HOME': project,
    },
    expect: [
      ['GET', '/projects/HOME/tasks?state=In+progress&label=bug&epic=EPIC-7&all=true&limit=50'],
      ['GET', '/projects/HOME'],
    ],
    output: /HOME-42 \[In progress\] \(high, 3pt\) Fix the thing #bug/,
  },
  {
    tool: 'create_task',
    args: { project: 'HOME', title: 'New', labels: ['bug'], priority: 'low', points: 2, parent: 'HOME-1' },
    routes: { 'POST /projects/HOME/tasks': task({ ref: 'HOME-50', title: 'New' }) },
    expect: [
      [
        'POST',
        '/projects/HOME/tasks',
        { title: 'New', labels: ['bug'], priority: 'low', points: 2, parent: 'HOME-1' },
      ],
    ],
    output: /Created HOME-50/,
  },
  {
    tool: 'update_task',
    args: { ref: 'HOME-42', title: 'Renamed' },
    routes: { 'GET /tasks/HOME-42': task(), 'PATCH /tasks/HOME-42': task({ title: 'Renamed' }) },
    expect: [
      ['GET', '/tasks/HOME-42'],
      ['PATCH', '/tasks/HOME-42', { version: 7, title: 'Renamed' }],
    ],
    output: /Updated HOME-42/,
  },
  {
    tool: 'update_task',
    args: { ref: 'HOME-42', version: 3, state: 'Done' },
    routes: { 'PATCH /tasks/HOME-42': task() },
    expect: [['PATCH', '/tasks/HOME-42', { version: 3, state: 'Done' }]],
  },
  {
    tool: 'pick_up',
    args: { ref: 'HOME-42' },
    routes: {
      'POST /tasks/HOME-42/pick-up': task(),
      'GET /tasks/HOME-42': {
        ...task(),
        project: { id: 'p1', prefix: 'HOME', name: 'Home' },
        state: { id: 's2', name: 'In progress', group: 'started', order: 2 },
        comments: [],
        children: [],
        epics: [],
      },
    },
    expect: [
      ['POST', '/tasks/HOME-42/pick-up'],
      ['GET', '/tasks/HOME-42'],
    ],
    output: /Picked up HOME-42; it is now In progress/,
  },
  {
    tool: 'set_state',
    args: { ref: 'HOME-42', state: 'Ready for test' },
    routes: { 'POST /tasks/HOME-42/state': task() },
    expect: [['POST', '/tasks/HOME-42/state', { state: 'Ready for test' }]],
  },
  {
    tool: 'add_comment',
    args: { ref: 'HOME-42', body: 'PR open' },
    routes: { 'POST /tasks/HOME-42/comments': { id: 'c9' } },
    expect: [['POST', '/tasks/HOME-42/comments', { body: 'PR open' }]],
    output: /c9/,
  },
  {
    tool: 'set_points',
    args: { ref: 'HOME-42', points: null },
    routes: { 'PUT /tasks/HOME-42/points': task({ points: undefined }) },
    expect: [['PUT', '/tasks/HOME-42/points', { points: null }]],
  },
  {
    tool: 'add_label',
    args: { ref: 'HOME-42', label: 'needs review' },
    routes: { 'PUT /tasks/HOME-42/labels/needs%20review': task() },
    expect: [['PUT', '/tasks/HOME-42/labels/needs%20review']],
  },
  {
    tool: 'remove_label',
    args: { ref: 'HOME-42', label: 'bug' },
    routes: { 'DELETE /tasks/HOME-42/labels/bug': task() },
    expect: [['DELETE', '/tasks/HOME-42/labels/bug']],
  },
  {
    tool: 'add_link',
    args: { ref: 'HOME-42', url: 'https://github.com/x/pull/1', title: 'PR' },
    routes: { 'POST /tasks/HOME-42/links': { id: 'l1' } },
    expect: [['POST', '/tasks/HOME-42/links', { url: 'https://github.com/x/pull/1', title: 'PR' }]],
  },
  {
    tool: 'remove_link',
    args: { ref: 'HOME-42', link_id: 'l1' },
    routes: { 'DELETE /tasks/HOME-42/links/l1': task() },
    expect: [['DELETE', '/tasks/HOME-42/links/l1']],
  },
  {
    tool: 'add_relation',
    args: { ref: 'HOME-42', type: 'blocks', target: 'HOME-9' },
    routes: { 'POST /tasks/HOME-42/relations': undefined },
    expect: [['POST', '/tasks/HOME-42/relations', { type: 'blocks', target: 'HOME-9' }]],
    output: /HOME-42 blocks HOME-9/,
  },
  {
    tool: 'remove_relation',
    args: { ref: 'HOME-42', type: 'blocks', target: 'HOME-9' },
    routes: { 'DELETE /tasks/HOME-42/relations': undefined },
    expect: [['DELETE', '/tasks/HOME-42/relations', { type: 'blocks', target: 'HOME-9' }]],
  },
  {
    tool: 'set_parent',
    args: { ref: 'HOME-42', parent: null },
    routes: { 'PUT /tasks/HOME-42/parent': task() },
    expect: [['PUT', '/tasks/HOME-42/parent', { parent: null }]],
    output: /parent is now none/,
  },
  {
    tool: 'search',
    args: {
      q: 'dns',
      mode: 'fulltext',
      project: 'HOME',
      epic: 'EPIC-7',
      kind: ['task', 'comment'],
      limit: 5,
    },
    routes: {
      'GET /search?q=dns&mode=fulltext&project=HOME&epic=EPIC-7&kind=task%2Ccomment&limit=5': {
        items: [{ kind: 'comment', id: 'c1', taskRef: 'HOME-3', title: 'DNS', snippet: 'a  b', score: 1 }],
      },
    },
    expect: [['GET', '/search?q=dns&mode=fulltext&project=HOME&epic=EPIC-7&kind=task%2Ccomment&limit=5']],
    output: /comment on HOME-3: DNS/,
  },
  {
    tool: 'next',
    args: {},
    routes: { 'GET /next': { next: task(), runnersUp: [task({ ref: 'HOME-43', title: 'Two' })] } },
    expect: [['GET', '/next']],
    output: /Next: HOME-42[\s\S]*Runners-up[\s\S]*HOME-43/,
  },
  {
    tool: 'board',
    args: { all: true },
    routes: {
      'GET /board?all=true': {
        columns: [
          {
            column: 'in_progress',
            points: 3,
            cards: [{ kind: 'project', id: 'p1', key: 'HOME', title: 'Home', points: 3, tasks: [task()] }],
          },
          {
            column: 'up_next',
            points: 0,
            cards: [{ kind: 'epic', id: 'EPIC-7', key: 'EPIC-7', title: 'Cutover', points: 0, tasks: [] }],
          },
          { column: 'backlog', points: 0, cards: [] },
        ],
      },
    },
    expect: [['GET', '/board?all=true']],
    output:
      /## In progress \(3pt\)\n- HOME: Home \(3pt\)\n {4}HOME-42[\s\S]*EPIC-7: Cutover \[epic\][\s\S]*\(empty\)/,
  },
  {
    tool: 'list_projects',
    args: { include_archived: true },
    routes: { 'GET /projects?archived=true': { items: [project] } },
    expect: [['GET', '/projects?archived=true']],
    output: /HOME: Home infrastructure/,
  },
  {
    tool: 'get_project',
    args: { project: 'HOME' },
    routes: { 'GET /projects/HOME': project },
    expect: [['GET', '/projects/HOME']],
    output: /New \(unstarted\), In progress \(started\)[\s\S]*Repo: nakomis\/home/,
  },
  {
    tool: 'list_epics',
    args: { project: 'HOME' },
    routes: { 'GET /projects/HOME/epics': { items: [epic] } },
    expect: [['GET', '/projects/HOME/epics']],
    output: /EPIC-7: Cutover \(open\)/,
  },
  {
    tool: 'list_epics',
    args: {},
    routes: { 'GET /epics': { items: [] } },
    expect: [['GET', '/epics']],
    output: /No epics/,
  },
  {
    tool: 'get_epic',
    args: { epic: 'EPIC-7' },
    routes: {
      'GET /epics/EPIC-7': {
        ...epic,
        projects: [{ id: 'p1', prefix: 'HOME', name: 'Home' }],
        tasks: [{ ...task(), epicRank: 'a', projectPrefix: 'HOME' }],
      },
    },
    expect: [['GET', '/epics/EPIC-7']],
    output: /# EPIC-7: Cutover[\s\S]*Projects: HOME[\s\S]*HOME-42/,
  },
  {
    tool: 'create_epic',
    args: { name: 'Cutover', projects: ['HOME'] },
    routes: { 'POST /epics': epic },
    expect: [['POST', '/epics', { name: 'Cutover', projects: ['HOME'] }]],
    output: /Created EPIC-7/,
  },
  {
    tool: 'update_epic',
    args: { epic: 'EPIC-7', state: 'done' },
    routes: { 'GET /epics/EPIC-7': epic, 'PATCH /epics/EPIC-7': { ...epic, state: 'done' } },
    expect: [
      ['GET', '/epics/EPIC-7'],
      ['PATCH', '/epics/EPIC-7', { version: 3, state: 'done' }],
    ],
  },
  {
    tool: 'add_to_epic',
    args: { epic: 'EPIC-7', task: 'HOME-42', before: 'HOME-9' },
    routes: { 'PUT /epics/EPIC-7/tasks/HOME-42': { epicRef: 'EPIC-7', taskRef: 'HOME-42', rank: 'a' } },
    expect: [['PUT', '/epics/EPIC-7/tasks/HOME-42', { before: 'HOME-9' }]],
  },
  {
    tool: 'add_to_epic',
    args: { epic: 'EPIC-7', task: 'HOME-42' },
    routes: { 'PUT /epics/EPIC-7/tasks/HOME-42': {} },
    expect: [['PUT', '/epics/EPIC-7/tasks/HOME-42', {}]],
  },
  {
    tool: 'remove_from_epic',
    args: { epic: 'EPIC-7', task: 'HOME-42' },
    routes: { 'DELETE /epics/EPIC-7/tasks/HOME-42': undefined },
    expect: [['DELETE', '/epics/EPIC-7/tasks/HOME-42']],
  },
  {
    tool: 'flag_project_on_epic',
    args: { epic: 'EPIC-7', project: 'HOME' },
    routes: { 'PUT /epics/EPIC-7/projects/HOME': epic },
    expect: [['PUT', '/epics/EPIC-7/projects/HOME']],
    output: /flagged/,
  },
  {
    tool: 'flag_project_on_epic',
    args: { epic: 'EPIC-7', project: 'HOME', flag: false },
    routes: { 'DELETE /epics/EPIC-7/projects/HOME': epic },
    expect: [['DELETE', '/epics/EPIC-7/projects/HOME']],
    output: /unflagged/,
  },
];

describe('tools', () => {
  it('has a case for every tool', () => {
    const covered = new Set(cases.map((c) => c.tool));
    expect(TOOLS.map((t) => t.name).filter((n) => !covered.has(n))).toEqual([]);
  });

  it.each(cases.map((c, i) => [`${c.tool} #${i}`, c] as const))(
    '%s sends the right requests',
    async (_n, c) => {
      const { client, calls } = fake(c.routes);
      const r = await runTool(client, c.tool, c.args);
      expect(r.isError, r.text).toBe(false);
      expect(
        calls.map((x) => [
          x.method,
          x.url.replace('https://purr.test/api', ''),
          ...(x.body !== undefined ? [x.body] : []),
        ]),
      ).toEqual(c.expect.map(([m, p, b]) => (b === undefined ? [m, p] : [m, p, b])));
      if (c.output) expect(r.text).toMatch(c.output);
    },
  );

  it.each(cases.map((c, i) => [`${c.tool} #${i}`, c] as const))(
    '%s surfaces API errors as tool errors',
    async (_n, c) => {
      const client = new PurrClient(
        { url: 'https://purr.test', apiKey: 'k' },
        async () =>
          new Response(JSON.stringify({ error: { code: 'VERSION_MISMATCH', message: 'stale' } }), {
            status: 409,
          }),
      );
      const r = await runTool(client, c.tool, c.args);
      expect(r.isError).toBe(true);
      expect(r.text).toBe('Purr API error VERSION_MISMATCH (HTTP 409): stale');
    },
  );

  it('rejects bad arguments and unknown tools without calling the API', async () => {
    const { client, calls } = fake({});
    expect((await runTool(client, 'get_task', {})).isError).toBe(true);
    expect((await runTool(client, 'set_state', { ref: 'HOME-1' })).text).toMatch(
      /Invalid arguments for set_state/,
    );
    expect(await runTool(client, 'nope', {})).toEqual({ text: 'Unknown tool: nope', isError: true });
    expect(calls).toHaveLength(0);
  });

  it('pages list_tasks until the limit', async () => {
    const { client, calls } = fake({
      'GET /projects/HOME/tasks?limit=2': { items: [task(), task({ ref: 'HOME-43' })], cursor: 'c2' },
      'GET /projects/HOME': project,
    });
    const r = await runTool(client, 'list_tasks', { project: 'HOME', limit: 2 });
    expect(r.text).toMatch(/2 task\(s\)[\s\S]*More tasks exist/);
    expect(calls).toHaveLength(2);
  });

  it('reports an empty queue and empty results readably', async () => {
    const { client } = fake({ 'GET /next': { runnersUp: [] }, 'GET /search?q=zzz': { items: [] } });
    expect((await runTool(client, 'next', {})).text).toMatch(/Nothing is queued/);
    expect((await runTool(client, 'search', { q: 'zzz' })).text).toBe('No matches.');
  });
});

describe('server', () => {
  it('registers every tool', () => {
    const { client } = fake({});
    const server = createServer(client) as unknown as { _registeredTools: Record<string, unknown> };
    expect(Object.keys(server._registeredTools).sort()).toEqual(TOOLS.map((t) => t.name).sort());
  });
});
