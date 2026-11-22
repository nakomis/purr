import { createMemoryStorage } from '@purr/storage-memory';
import { describe, expect, it } from 'vitest';
import { archiveToMarkdown } from './archive.js';
import { decodeEntities, htmlToMarkdown } from './convert.js';
import { importPlane, mapActor, moduleFooter } from './importer.js';
import type { PlaneData, PlaneIssue } from './source.js';

const PID = '00000000-0000-0000-0000-00000000000a';
const JOBS = '00000000-0000-0000-0000-00000000000b';
const MOD = '11111111-1111-1111-1111-111111111111';

function issue(seq: number, over: Partial<PlaneIssue> = {}): PlaneIssue {
  return {
    id: `issue-${seq}`,
    projectId: PID,
    sequence: seq,
    name: `Task ${seq}`,
    html: `<p>Body ${seq}</p>`,
    priority: 'none',
    sortOrder: seq * 1000,
    parentId: null,
    stateId: 's-new',
    createdAt: `2026-01-0${seq}T10:00:00.000Z`,
    updatedAt: `2026-02-0${seq}T10:00:00.000Z`,
    createdByEmail: 'claude@nakomis.com',
    labelIds: [],
    points: null,
    archived: false,
    links: [],
    ...over,
  };
}

function fixture(): PlaneData {
  return {
    projects: [
      {
        id: PID,
        identifier: 'TEST',
        name: 'Test &amp; Co',
        description: 'A project',
        createdAt: '2026-01-01T00:00:00.000Z',
        archived: false,
        states: [
          { id: 's-done', name: 'Done', group: 'completed', sequence: 20000 },
          { id: 's-new', name: 'New', group: 'backlog', sequence: 10000 },
          { id: 's-tri', name: 'Triage', group: 'triage', sequence: 30000 },
        ],
        labels: [{ id: 'l-bug', name: 'bug' }],
        atc: {
          columnKey: 'backlog',
          rank: 'V',
          repo: 'nakomis/test',
          deploys: true,
          deployAction: 'Run the thing',
          bauEnabled: true,
          hidden: false,
        },
        atcProjectCard: { columnKey: 'backlog', columnRank: 'X', hidden: false },
      },
      {
        id: JOBS,
        identifier: 'JOBS',
        name: 'Jobs',
        description: '',
        createdAt: '2026-01-01T00:00:00.000Z',
        archived: true,
        states: [],
        labels: [],
      },
    ],
    issues: [
      // Plane's order is by sort_order, so TEST-3 comes first even though it is numbered last.
      issue(1, {
        sortOrder: 2000,
        labelIds: ['l-bug'],
        priority: 'urgent',
        points: 5,
        links: [{ id: 'k1', url: 'https://example.com', title: 'Ex' }],
      }),
      issue(2, {
        sortOrder: 3000,
        parentId: 'issue-1',
        createdByEmail: 'plane@nakomis.com',
        stateId: 's-done',
      }),
      issue(3, { sortOrder: 1000, createdByEmail: 'stranger@example.com' }),
      { ...issue(1), id: 'jobs-1', projectId: JOBS },
    ],
    comments: [
      {
        id: 'c1',
        issueId: 'issue-1',
        html: '<p>see <a href="https://a.example">this</a></p>',
        authorEmail: 'bau@nakomis.com',
        createdAt: '2026-03-01T00:00:00.000Z',
      },
    ],
    relations: [
      { issueId: 'issue-1', relatedIssueId: 'issue-2', type: 'relates_to' },
      { issueId: 'issue-2', relatedIssueId: 'issue-1', type: 'relates_to' },
      { issueId: 'issue-1', relatedIssueId: 'issue-3', type: 'start_before' },
    ],
    modules: [
      {
        id: MOD,
        projectId: PID,
        name: 'Epic one',
        description: '<p>About it</p>',
        status: 'in-progress',
        createdAt: '2026-01-05T00:00:00.000Z',
        createdByEmail: 'claude@nakomis.com',
        archived: false,
        issueIds: ['issue-3', 'issue-1'],
        atc: { columnKey: 'next', columnRank: 'W', hidden: false },
      },
    ],
  };
}

describe('htmlToMarkdown', () => {
  it('keeps links', () => {
    const { markdown } = htmlToMarkdown('<p>See <a href="https://example.com/x">the docs</a> now</p>');
    expect(markdown).toBe('See [the docs](https://example.com/x) now');
  });

  it('converts tables, code and lists, and warns about relative images', () => {
    const html =
      '<h2>H</h2><ul><li>one</li></ul><pre><code>x = 1</code></pre><table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2 | 3</td></tr></tbody></table><img src="/api/assets/1">';
    const { markdown, warnings } = htmlToMarkdown(html);
    expect(markdown).toContain('## H');
    expect(markdown).toMatch(/- +one/);
    expect(markdown).toContain('```');
    expect(markdown).toContain('| A | B |');
    expect(markdown).toContain('2 \\| 3');
    expect(warnings.join()).toContain('relative source');
  });

  it('handles empty input and entities', () => {
    expect(htmlToMarkdown(null)).toEqual({ markdown: '', warnings: [] });
    expect(decodeEntities('CI &amp; Quality &lt;3')).toBe('CI & Quality <3');
  });
});

describe('mapActor', () => {
  it('maps Plane user emails to Purr actors', () => {
    expect(mapActor('claude@nakomis.com')).toBe('claude');
    expect(mapActor('bau@nakomis.com')).toBe('bau');
    expect(mapActor('martin@nakomis.com')).toBe('martin');
    expect(mapActor('plane@nakomis.com')).toBe('martin');
    expect(mapActor('bench@nakomis.com')).toBe('system');
    expect(mapActor(null)).toBe('system');
  });
});

describe('importPlane', () => {
  it('imports a project with its states, labels, metadata and icon, and excludes JOBS', async () => {
    const storage = createMemoryStorage();
    const report = await importPlane(storage, fixture(), { icons: { TEST: 'x.png' } });
    const projects = await storage.projects.list({ includeArchived: true });
    expect(projects.map((p) => p.prefix)).toEqual(['TEST']);
    const p = projects[0];
    expect(p?.name).toBe('Test & Co');
    expect(p?.icon).toBe('/icons/TEST.png');
    expect(p?.labels).toEqual(['bug']);
    expect(p?.states.map((s) => [s.name, s.group])).toEqual([
      ['New', 'backlog'],
      ['Done', 'completed'],
      ['Triage', 'backlog'],
    ]);
    expect(p?.metadata).toMatchObject({
      repo: 'nakomis/test',
      bauEnabled: true,
      deployAction: 'Run the thing',
    });
    expect(report.totals.plane.tasks).toBe(3);
    expect(report.projects.every((x) => x.match)).toBe(true);
    expect(report.notes.join()).toContain('Triage');
  });

  it('keeps refs, order, actors, points, parents, links, relations and comments', async () => {
    const storage = createMemoryStorage();
    await importPlane(storage, fixture());
    const t1 = await storage.tasks.get('TEST-1');
    expect(t1).toMatchObject({
      sequence: 1,
      priority: 'urgent',
      points: 5,
      createdBy: 'claude',
      labels: ['bug'],
    });
    expect(t1.createdAt).toBe('2026-01-01T10:00:00.000Z');
    expect(t1.links.map((l) => l.url)).toEqual(['https://example.com']);
    expect((await storage.tasks.get('TEST-2')).parent).toBe('TEST-1');
    expect((await storage.tasks.get('TEST-2')).createdBy).toBe('martin');
    expect((await storage.tasks.get('TEST-3')).createdBy).toBe('system');
    const project = await storage.projects.get('TEST');
    const order = (await storage.tasks.listByProject(project.id)).items.map((t) => t.ref);
    expect(order).toEqual(['TEST-3', 'TEST-1', 'TEST-2']);
    // The inverse pair is one relation; the unsupported type is reported, not imported.
    expect(t1.relations).toEqual([{ type: 'relates_to', target: 'TEST-2' }]);
    const comments = (await storage.comments.list('TEST-1')).items;
    expect(comments.map((c) => [c.body, c.author, c.createdAt])).toEqual([
      ['see [this](https://a.example)', 'bau', '2026-03-01T00:00:00.000Z'],
    ]);
  });

  it('turns a module into an epic flagged on its project with ordered members', async () => {
    const storage = createMemoryStorage();
    const report = await importPlane(storage, fixture());
    const project = await storage.projects.get('TEST');
    const epics = await storage.epics.list();
    expect(epics).toHaveLength(1);
    const epic = epics[0];
    expect(epic?.name).toBe('Epic one');
    expect(epic?.projectIds).toEqual([project.id]);
    expect(epic?.description).toContain(moduleFooter(MOD));
    expect((await storage.epics.listTasks(epic?.ref ?? '')).map((m) => m.taskRef)).toEqual([
      'TEST-3',
      'TEST-1',
    ]);
    expect(report.migrationMap.epics[MOD]).toBe(epic?.ref);
  });

  it('puts project and epic cards on the board in ATC order and columns', async () => {
    const storage = createMemoryStorage();
    await importPlane(storage, fixture());
    const project = await storage.projects.get('TEST');
    const cards = (await storage.board.list()).sort((a, b) => a.column.localeCompare(b.column));
    expect(cards.map((c) => [c.kind, c.column])).toEqual([
      ['project', 'backlog'],
      ['epic', 'up_next'],
    ]);
    expect(cards[0]?.id).toBe(project.id);
  });

  it('creates nothing new when run again', async () => {
    const storage = createMemoryStorage();
    await importPlane(storage, fixture());
    const second = await importPlane(storage, fixture());
    expect(second.totals.created).toEqual({
      tasks: 0,
      comments: 0,
      labels: 0,
      links: 0,
      relations: 0,
      epics: 0,
    });
    expect(second.boardCards.created).toBe(0);
    expect(await storage.epics.list()).toHaveLength(1);
    const project = await storage.projects.get('TEST');
    expect((await storage.tasks.listByProject(project.id)).items).toHaveLength(3);
    expect((await storage.comments.list('TEST-1')).items).toHaveLength(1);
    expect(second.projects.every((p) => p.match)).toBe(true);
    expect(second.spotChecks.mismatches).toEqual([]);
  });

  it('flags missing parents and unknown states without failing', async () => {
    const data = fixture();
    data.issues[2] = issue(3, { parentId: 'gone', stateId: 'nope' });
    const report = await importPlane(createMemoryStorage(), data);
    expect(report.skipped.join('\n')).toContain('parent is deleted');
    expect(report.skipped.join('\n')).toContain('unknown');
  });
});

describe('archiveToMarkdown', () => {
  it('renders issues and pages', () => {
    const md = archiveToMarkdown({
      issues: [
        {
          sequence_id: 7,
          name: 'A job',
          state: 'Done',
          priority: 'low',
          created_at: '2026-01-01T00:00:00Z',
          description_html: '<p>hello</p>',
          labels: ['x'],
          comments: [{ at: '2026-01-02T00:00:00Z', html: '<p>c</p>' }],
          links: [{ title: null, url: 'https://e.com' }],
        },
      ],
      pages: [{ name: 'Page', description_html: '<p>p</p>', created_at: '2026-01-01T00:00:00Z' }],
    });
    expect(md).toContain('## JOBS-7: A job');
    expect(md).toContain('hello');
    expect(md).toContain('## Page');
  });
});
