/**
 * Plane + ATC -> Purr, written only through the Storage ports.
 *
 * Idempotency, without any side file the importer depends on:
 *  - projects are found by prefix;
 *  - tasks by ref (prefix + Plane's sequence_id, so refs are preserved);
 *  - comments by (createdAt, body) on the task;
 *  - links by URL, relations by (type, target);
 *  - epics by a footer in their description: `<!-- plane-module:<uuid> -->`
 *    (invisible when the Markdown is rendered), so any machine can re-run it;
 *  - board cards are replaced in place (put is an upsert).
 * `migration-map.json` (Plane ids -> Purr refs) is written alongside the report for
 * people, not read back.
 */
import {
  type Actor,
  type BoardCard,
  type Column,
  type EpicRef,
  type Priority,
  type Project,
  type Rank,
  type RelationType,
  rankBetween,
  type State,
  type StateGroup,
  type Storage,
  type Task,
  type TaskRef,
} from '@purr/domain';
import { decodeEntities, htmlToMarkdown } from './convert.js';
import type { PlaneData, PlaneIssue, PlaneModule, PlaneProject } from './source.js';

export const EXCLUDED_PROJECTS = new Set(['JOBS']);

export type IconMap = Record<string, string>;

export function mapActor(email: string | null | undefined): Actor {
  switch ((email ?? '').toLowerCase()) {
    case 'claude@nakomis.com':
      return 'claude';
    case 'bau@nakomis.com':
      return 'bau';
    case 'martin@nakomis.com':
    case 'plane@nakomis.com':
      return 'martin';
    default:
      return 'system';
  }
}

const PRIORITIES: readonly string[] = ['none', 'low', 'medium', 'high', 'urgent'];
const GROUPS: readonly string[] = ['backlog', 'unstarted', 'started', 'completed', 'cancelled'];
const COLUMN_KEYS: Record<string, Column> = {
  backlog: 'backlog',
  next: 'up_next',
  in_progress: 'in_progress',
};

/** Plane relation rows read "issue <type> related_issue". */
const RELATION_TYPES: Record<string, RelationType> = {
  blocking: 'blocks',
  blocked_by: 'blocked_by',
  duplicate: 'duplicate_of',
  relates_to: 'relates_to',
};
const INVERSE: Record<RelationType, RelationType> = {
  blocks: 'blocked_by',
  blocked_by: 'blocks',
  relates_to: 'relates_to',
  duplicate_of: 'duplicate_of',
};

const relationKey = (ref: string, type: RelationType, target: string) => `${ref}|${type}|${target}`;

export const moduleFooter = (id: string): string => `<!-- plane-module:${id} -->`;
const FOOTER = /<!-- plane-module:([0-9a-f-]{36}) -->/;

export interface Counts {
  tasks: number;
  comments: number;
  labels: number;
  links: number;
  relations: number;
  epics: number;
}
export interface ProjectReport {
  prefix: string;
  plane: Counts;
  purr: Counts;
  created: Counts;
  match: boolean;
}
export interface Report {
  startedAt: string;
  projects: ProjectReport[];
  totals: { plane: Counts; purr: Counts; created: Counts };
  boardCards: { plane: number; purr: number; created: number; skipped: string[] };
  spotChecks: { checked: number; mismatches: string[]; refs: string[] };
  conversionWarnings: { ref: string; where: string; warnings: string[] }[];
  skipped: string[];
  notes: string[];
  migrationMap: {
    projects: Record<string, string>;
    tasks: Record<string, string>;
    epics: Record<string, string>;
  };
  /** Original HTML, kept off the Purr task so nothing is lost: ref -> html. */
  originalHtml: Record<string, { description: string; comments: string[] }>;
}

const zero = (): Counts => ({ tasks: 0, comments: 0, labels: 0, links: 0, relations: 0, epics: 0 });
const add = (a: Counts, b: Counts) => {
  for (const k of Object.keys(a) as (keyof Counts)[]) a[k] += b[k];
};

async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++] as T);
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
}

async function allTasks(storage: Storage, projectId: string): Promise<Task[]> {
  const out: Task[] = [];
  let cursor: string | undefined;
  do {
    const page = await storage.tasks.listByProject(projectId, { limit: 1000, ...(cursor ? { cursor } : {}) });
    out.push(...page.items);
    cursor = page.cursor;
  } while (cursor);
  return out;
}

async function allComments(storage: Storage, ref: TaskRef) {
  const out = [];
  let cursor: string | undefined;
  do {
    const page = await storage.comments.list(ref, { limit: 1000, ...(cursor ? { cursor } : {}) });
    out.push(...page.items);
    cursor = page.cursor;
  } while (cursor);
  return out;
}

export interface ImportOptions {
  icons?: IconMap;
  log?: (line: string) => void;
}

export async function importPlane(
  storage: Storage,
  rawData: PlaneData,
  opts: ImportOptions = {},
): Promise<Report> {
  const log = opts.log ?? (() => {});
  const icons = opts.icons ?? {};
  const report: Report = {
    startedAt: new Date().toISOString(),
    projects: [],
    totals: { plane: zero(), purr: zero(), created: zero() },
    boardCards: { plane: 0, purr: 0, created: 0, skipped: [] },
    spotChecks: { checked: 0, mismatches: [], refs: [] },
    conversionWarnings: [],
    skipped: [],
    notes: [],
    migrationMap: { projects: {}, tasks: {}, epics: {} },
    originalHtml: {},
  };

  // JOBS is archived separately, never imported.
  const data: PlaneData = {
    ...rawData,
    projects: rawData.projects.filter((p) => !EXCLUDED_PROJECTS.has(p.identifier)),
  };
  const projectIds = new Set(data.projects.map((p) => p.id));
  const issues = rawData.issues.filter((i) => projectIds.has(i.projectId));
  const issueById = new Map(issues.map((i) => [i.id, i]));
  const projectById = new Map(data.projects.map((p) => [p.id, p]));
  const refOf = (i: PlaneIssue) =>
    `${(projectById.get(i.projectId) as PlaneProject).identifier}-${i.sequence}`;

  // ---------- projects ----------
  const existingProjects = new Map(
    (await storage.projects.list({ includeArchived: true })).map((p) => [p.prefix, p]),
  );
  const purrProjects = new Map<string, Project>(); // by Plane project id
  const planeCounts = new Map<string, Counts>();
  const created = new Map<string, Counts>();
  for (const p of data.projects) {
    planeCounts.set(p.identifier, zero());
    created.set(p.identifier, zero());
  }

  const oddGroups = new Set<string>();
  for (const p of data.projects) {
    const states: State[] = [...p.states]
      .sort((a, b) => a.sequence - b.sequence)
      .map((s) => {
        const group = GROUPS.includes(s.group) ? (s.group as StateGroup) : 'backlog';
        if (group !== s.group) {
          report.notes.push(
            `${p.identifier}: state "${s.name}" has Plane group "${s.group}", imported as backlog`,
          );
        }
        return { id: s.id, name: s.name, group, order: s.sequence };
      });
    const labels = [...new Set(p.labels.map((l) => decodeEntities(l.name)))];
    const metadata = p.atc
      ? {
          bauEnabled: p.atc.bauEnabled,
          ...(p.atc.repo ? { repo: p.atc.repo } : {}),
          ...(p.atc.deploys ? { deployMethod: 'deploys' } : {}),
          ...(p.atc.deployAction ? { deployAction: p.atc.deployAction } : {}),
        }
      : { bauEnabled: false };
    const icon = icons[p.identifier] ? `/icons/${p.identifier}.png` : undefined;
    let project = existingProjects.get(p.identifier);
    if (!project) {
      project = await storage.projects.create({
        prefix: p.identifier,
        name: decodeEntities(p.name),
        description: p.description,
        states,
        labels,
        metadata,
        ...(icon ? { icon } : {}),
        archived: p.archived,
        createdAt: p.createdAt,
      });
    } else if (icon && project.icon !== icon) {
      project = await storage.projects.update(p.identifier, { icon }, project.version);
    }
    purrProjects.set(p.id, project);
    report.migrationMap.projects[p.id] = p.identifier;
    (planeCounts.get(p.identifier) as Counts).labels = labels.length;
    (created.get(p.identifier) as Counts).labels = existingProjects.has(p.identifier) ? 0 : labels.length;
    log(`project ${p.identifier} ${existingProjects.has(p.identifier) ? 'exists' : 'created'}`);
  }

  if (oddGroups.size > 0) {
    report.notes.push(
      `states with a group Purr lacks were imported as backlog: ${[...oddGroups].join(', ')}`,
    );
  }

  // ---------- tasks ----------
  const labelNames = new Map<string, string>();
  for (const p of data.projects) for (const l of p.labels) labelNames.set(l.id, decodeEntities(l.name));
  for (const p of data.projects) {
    const project = purrProjects.get(p.id) as Project;
    const mine = issues
      .filter((i) => i.projectId === p.id)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.sequence - b.sequence);
    const have = new Set((await allTasks(storage, project.id)).map((t) => t.ref));
    const stateIds = new Set(project.states.map((s) => s.id));
    const c = created.get(p.identifier) as Counts;
    (planeCounts.get(p.identifier) as Counts).tasks = mine.length;
    let rank: Rank | undefined;
    for (const issue of mine) {
      rank = rankBetween(rank, undefined);
      const ref = refOf(issue);
      report.migrationMap.tasks[issue.id] = ref;
      if (have.has(ref)) continue;
      const desc = htmlToMarkdown(issue.html);
      if (desc.warnings.length > 0) {
        report.conversionWarnings.push({ ref, where: 'description', warnings: desc.warnings });
      }
      report.originalHtml[ref] = { description: issue.html, comments: [] };
      let stateId = issue.stateId && stateIds.has(issue.stateId) ? issue.stateId : undefined;
      if (!stateId) {
        stateId = project.states[0]?.id;
        report.skipped.push(`${ref}: state ${issue.stateId ?? '(none)'} unknown, used the first state`);
      }
      const parent = issue.parentId ? issueById.get(issue.parentId) : undefined;
      if (issue.parentId && !parent)
        report.skipped.push(`${ref}: parent is deleted or outside the import, dropped`);
      const priority: Priority = PRIORITIES.includes(issue.priority) ? (issue.priority as Priority) : 'none';
      await storage.tasks.create(
        {
          projectId: project.id,
          title: decodeEntities(issue.name),
          description: desc.markdown,
          ...(stateId ? { stateId } : {}),
          labels: [...new Set(issue.labelIds.flatMap((id) => labelNames.get(id) ?? []))],
          ...(parent ? { parent: refOf(parent) } : {}),
          priority,
          ...(issue.points != null ? { points: issue.points } : {}),
          projectRank: rank,
          sequence: issue.sequence,
          createdAt: issue.createdAt,
          updatedAt: issue.updatedAt,
        },
        mapActor(issue.createdByEmail),
      );
      c.tasks++;
    }
    log(`tasks ${p.identifier}: ${c.tasks} new of ${mine.length}`);
  }

  // ---------- links ----------
  for (const issue of issues.filter((i) => i.links.length > 0)) {
    const ref = refOf(issue);
    const c = created.get((projectById.get(issue.projectId) as PlaneProject).identifier) as Counts;
    (planeCounts.get((projectById.get(issue.projectId) as PlaneProject).identifier) as Counts).links +=
      issue.links.length;
    const task = await storage.tasks.get(ref);
    const have = new Set(task.links.map((l) => l.url));
    const missing = issue.links.filter((l) => !have.has(l.url));
    if (missing.length === 0) continue;
    await storage.tasks.update(
      ref,
      {
        links: [
          ...task.links,
          ...missing.map((l) => ({ id: l.id, url: l.url, ...(l.title ? { title: l.title } : {}) })),
        ],
      },
      task.version,
      mapActor(issue.createdByEmail),
    );
    c.links += missing.length;
  }
  if (created.size > 0 && [...created.values()].some((c) => c.links > 0)) {
    report.notes.push(
      'tasks that have links had updatedAt reset to the import time: TaskPatch cannot carry a timestamp and NewTask has no links field',
    );
  }

  // ---------- relations ----------
  const seenPairs = new Set<string>();
  for (const r of data.relations) {
    const a = issueById.get(r.issueId);
    const b = issueById.get(r.relatedIssueId);
    const type = RELATION_TYPES[r.type];
    if (!a || !b) continue;
    if (!type) {
      report.skipped.push(`relation ${refOf(a)} ${r.type} ${refOf(b)}: type has no Purr equivalent`);
      continue;
    }
    const forward = relationKey(refOf(a), type, refOf(b));
    const inverse = relationKey(refOf(b), INVERSE[type], refOf(a));
    if (seenPairs.has(forward) || seenPairs.has(inverse)) continue;
    seenPairs.add(forward);
    // A pair is counted once, under the project of its canonical side.
    const owner = forward <= inverse ? a : b;
    const prefix = (projectById.get(owner.projectId) as PlaneProject).identifier;
    (planeCounts.get(prefix) as Counts).relations++;
    const task = await storage.tasks.get(refOf(a));
    if (task.relations.some((x) => x.type === type && x.target === refOf(b))) continue;
    await storage.tasks.addRelation(refOf(a), type, refOf(b), mapActor(a.createdByEmail));
    (created.get(prefix) as Counts).relations++;
  }

  // ---------- comments ----------
  const commentsByIssue = new Map<string, typeof data.comments>();
  for (const c of data.comments) {
    if (!issueById.has(c.issueId)) continue;
    const list = commentsByIssue.get(c.issueId) ?? [];
    list.push(c);
    commentsByIssue.set(c.issueId, list);
  }
  await pool([...commentsByIssue.entries()], 8, async ([issueId, list]) => {
    const issue = issueById.get(issueId) as PlaneIssue;
    const ref = refOf(issue);
    const prefix = (projectById.get(issue.projectId) as PlaneProject).identifier;
    (planeCounts.get(prefix) as Counts).comments += list.length;
    const existing = new Set((await allComments(storage, ref)).map((x) => `${x.createdAt}|${x.body}`));
    for (const c of list) {
      const body = htmlToMarkdown(c.html);
      if (body.warnings.length > 0)
        report.conversionWarnings.push({ ref, where: 'comment', warnings: body.warnings });
      report.originalHtml[ref] ??= { description: issue.html, comments: [] };
      (report.originalHtml[ref] as { comments: string[] }).comments.push(c.html);
      if (existing.has(`${c.createdAt}|${body.markdown}`)) continue;
      await storage.comments.add(ref, body.markdown, mapActor(c.authorEmail), c.createdAt);
      (created.get(prefix) as Counts).comments++;
    }
  });

  // ---------- modules -> epics ----------
  const epicByModule = new Map<string, EpicRef>();
  for (const e of await storage.epics.list({ includeArchived: true })) {
    const m = FOOTER.exec(e.description);
    if (m) epicByModule.set(m[1] as string, e.ref);
  }
  const modules = data.modules.filter((m) => projectIds.has(m.projectId));
  for (const m of modules) {
    const p = projectById.get(m.projectId) as PlaneProject;
    const project = purrProjects.get(m.projectId) as Project;
    (planeCounts.get(p.identifier) as Counts).epics++;
    let ref = epicByModule.get(m.id);
    if (!ref) {
      const body = htmlToMarkdown(m.description);
      if (body.warnings.length > 0)
        report.conversionWarnings.push({ ref: `module ${m.id}`, where: 'module', warnings: body.warnings });
      const epic = await storage.epics.create(
        {
          name: decodeEntities(m.name),
          description: `${body.markdown ? `${body.markdown}\n\n` : ''}${moduleFooter(m.id)}`,
          state: epicState(m),
          createdAt: m.createdAt,
        },
        mapActor(m.createdByEmail),
      );
      ref = epic.ref;
      epicByModule.set(m.id, ref);
      (created.get(p.identifier) as Counts).epics++;
    }
    report.migrationMap.epics[m.id] = ref;
    await storage.epics.flagProject(ref, project.id);
    let rank: Rank | undefined;
    for (const issueId of m.issueIds) {
      const issue = issueById.get(issueId);
      if (!issue) continue;
      rank = rankBetween(rank, undefined);
      await storage.epics.addTask(ref, refOf(issue), rank);
    }
  }

  // ---------- board ----------
  report.boardCards = await importBoard(storage, data, purrProjects, epicByModule, report);

  // ---------- verification ----------
  await verify(storage, data, issues, issueById, purrProjects, planeCounts, created, report, refOf);
  return report;
}

function epicState(m: PlaneModule): 'open' | 'done' | 'archived' {
  if (m.archived || m.status === 'cancelled') return 'archived';
  if (m.status === 'completed') return 'done';
  return 'open';
}

async function importBoard(
  storage: Storage,
  data: PlaneData,
  purrProjects: Map<string, Project>,
  epicByModule: Map<string, EpicRef>,
  report: Report,
): Promise<Report['boardCards']> {
  type Pending = { kind: BoardCard['kind']; id: string; column: Column; rank: string; label: string };
  const pending: Pending[] = [];
  const skipped: string[] = [];
  const column = (key: string, label: string): Column => {
    const c = COLUMN_KEYS[key];
    if (!c) {
      skipped.push(`${label}: unknown ATC column "${key}", placed in backlog`);
      return 'backlog';
    }
    return c;
  };
  for (const p of data.projects) {
    if (!p.atc) continue;
    // ATC's project card is its "unsorted" pseudo-module, which sits after the project's modules.
    const card = p.atcProjectCard ?? {
      columnKey: p.atc.columnKey,
      columnRank: p.atc.rank,
      hidden: p.atc.hidden,
    };
    if (card.hidden || p.atc.hidden) {
      skipped.push(`${p.identifier}: hidden in ATC, no board card`);
      continue;
    }
    pending.push({
      kind: 'project',
      id: (purrProjects.get(p.id) as Project).id,
      column: column(card.columnKey, p.identifier),
      rank: card.columnRank,
      label: p.identifier,
    });
  }
  for (const m of data.modules) {
    const ref = epicByModule.get(m.id);
    if (!m.atc || !ref) continue;
    if (m.atc.hidden) {
      skipped.push(`${ref} (${m.name}): hidden in ATC, no board card`);
      continue;
    }
    pending.push({
      kind: 'epic',
      id: ref,
      column: column(m.atc.columnKey, ref),
      rank: m.atc.columnRank,
      label: ref,
    });
  }
  // Plane and ATC ranks are ASCII strings: compare by code unit, never by locale.
  const byRank = (a: Pending, b: Pending) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0);
  const existing = new Set((await storage.board.list()).map((c) => `${c.kind}#${c.id}`));
  let createdCards = 0;
  for (const col of ['backlog', 'up_next', 'in_progress'] as Column[]) {
    let rank: Rank | undefined;
    for (const c of pending.filter((x) => x.column === col).sort(byRank)) {
      rank = rankBetween(rank, undefined);
      await storage.board.put({ kind: c.kind, id: c.id, column: col, rank });
      if (!existing.has(`${c.kind}#${c.id}`)) createdCards++;
    }
  }
  report.notes.push(
    "board: a project card takes the place of ATC's \"unsorted\" card (after the project's modules); ATC keeps no task order inside a card, so epic members follow Plane's sort_order",
  );
  return { plane: pending.length, purr: (await storage.board.list()).length, created: createdCards, skipped };
}

async function verify(
  storage: Storage,
  data: PlaneData,
  issues: PlaneIssue[],
  issueById: Map<string, PlaneIssue>,
  purrProjects: Map<string, Project>,
  planeCounts: Map<string, Counts>,
  created: Map<string, Counts>,
  report: Report,
  refOf: (i: PlaneIssue) => string,
): Promise<void> {
  const epicsByProject = new Map<string, number>();
  for (const e of await storage.epics.list({ includeArchived: true })) {
    for (const id of e.projectIds) epicsByProject.set(id, (epicsByProject.get(id) ?? 0) + 1);
  }
  for (const p of data.projects) {
    const project = purrProjects.get(p.id) as Project;
    const tasks = await allTasks(storage, project.id);
    const purr = zero();
    purr.tasks = tasks.length;
    purr.labels = project.labels.length;
    purr.links = tasks.reduce((n, t) => n + t.links.length, 0);
    for (const t of tasks) {
      for (const r of t.relations) {
        if (relationKey(t.ref, r.type, r.target) <= relationKey(r.target, INVERSE[r.type], t.ref))
          purr.relations++;
      }
    }
    for (const t of tasks) purr.comments += (await allComments(storage, t.ref)).length;
    purr.epics = epicsByProject.get(project.id) ?? 0;
    const plane = planeCounts.get(p.identifier) as Counts;
    const c = created.get(p.identifier) as Counts;
    const match =
      plane.tasks === purr.tasks &&
      plane.comments === purr.comments &&
      plane.labels === purr.labels &&
      plane.links === purr.links &&
      plane.relations === purr.relations &&
      plane.epics === purr.epics;
    report.projects.push({ prefix: p.identifier, plane: { ...plane }, purr, created: { ...c }, match });
    add(report.totals.plane, plane);
    add(report.totals.purr, purr);
    add(report.totals.created, c);
  }
  // Spot checks: a fixed sample (first, last and every 97th task) compared field by field.
  const sample = issues.filter((_, i) => i === 0 || i === issues.length - 1 || i % 97 === 0);
  for (const issue of sample) {
    const ref = refOf(issue);
    report.spotChecks.refs.push(ref);
    report.spotChecks.checked++;
    try {
      const t = await storage.tasks.get(ref);
      const bad: string[] = [];
      if (t.title !== decodeEntities(issue.name)) bad.push('title');
      if (t.sequence !== issue.sequence) bad.push('sequence');
      if (t.createdAt !== issue.createdAt) bad.push('createdAt');
      if ((t.points ?? null) !== issue.points) bad.push('points');
      if (
        (t.parent ?? null) !==
        (issue.parentId && issueById.get(issue.parentId)
          ? refOf(issueById.get(issue.parentId) as PlaneIssue)
          : null)
      )
        bad.push('parent');
      if (t.labels.length !== new Set(issue.labelIds).size && issue.labelIds.length > 0) bad.push('labels');
      if (bad.length > 0) report.spotChecks.mismatches.push(`${ref}: ${bad.join(', ')}`);
    } catch {
      report.spotChecks.mismatches.push(`${ref}: missing from Purr`);
    }
  }
}
