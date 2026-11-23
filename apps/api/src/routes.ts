/**
 * Every route in docs/api.md, over the domain services. Handlers parse and validate
 * the request, call one service, and shape the response; the rules live in the domain.
 */
import {
  ASSIGNEES,
  type Assignee,
  type BoardCard,
  COLUMNS,
  type Column,
  type Epic,
  isOpenGroup,
  normaliseEpicRef,
  normaliseTaskRef,
  PRIORITIES,
  type Priority,
  type Project,
  type ProjectMetadata,
  RELATION_TYPES,
  type RelationType,
  type SearchIndex,
  type SearchKind,
  type SearchMode,
  type Services,
  type State,
  type Storage,
  type Task,
} from '@purr/domain';
import {
  bodyObject,
  bool,
  created,
  HttpError,
  limitParam,
  noContent,
  num,
  ok,
  str,
  strArray,
} from './http.js';
import { Router } from './router.js';

export interface RouteDeps {
  services: Services;
  storage: Storage;
  search?: SearchIndex;
  version: string;
}

type ProjectSummary = Pick<Project, 'id' | 'prefix' | 'name' | 'icon'>;
const summary = (p: Project): ProjectSummary => ({
  id: p.id,
  prefix: p.prefix,
  name: p.name,
  ...(p.icon ? { icon: p.icon } : {}),
});

function priority(v: string | undefined): Priority | undefined {
  if (v === undefined) return undefined;
  if (!PRIORITIES.includes(v as Priority)) throw new HttpError(400, 'VALIDATION', `invalid priority ${v}`);
  return v as Priority;
}

function relationType(v: string): RelationType {
  if (!RELATION_TYPES.includes(v as RelationType))
    throw new HttpError(400, 'VALIDATION', `invalid relation ${v}`);
  return v as RelationType;
}

function column(v: string): Column {
  if (!COLUMNS.includes(v as Column)) throw new HttpError(400, 'VALIDATION', `invalid column ${v}`);
  return v as Column;
}

function cardKind(v: string): BoardCard['kind'] {
  if (v !== 'project' && v !== 'epic') throw new HttpError(400, 'VALIDATION', `invalid card kind ${v}`);
  return v;
}

function metadata(v: unknown): Partial<ProjectMetadata> | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'object' || Array.isArray(v))
    throw new HttpError(400, 'VALIDATION', 'metadata must be an object');
  const m = v as Record<string, unknown>;
  const out: Partial<ProjectMetadata> = {};
  for (const k of ['repo', 'deployMethod', 'deployAction'] as const) {
    if (m[k] !== undefined) out[k] = str(m, k);
  }
  if (m.bauEnabled !== undefined) {
    if (typeof m.bauEnabled !== 'boolean')
      throw new HttpError(400, 'VALIDATION', 'bauEnabled must be a boolean');
    out.bauEnabled = m.bauEnabled;
  }
  return out;
}

function states(v: unknown): State[] | undefined {
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v)) throw new HttpError(400, 'VALIDATION', 'states must be an array');
  return v as State[];
}

export function buildRouter(deps: RouteDeps): Router {
  const { services: svc, storage } = deps;
  const r = new Router();

  r.add('GET', '/health', async () => ok({ ok: true, version: deps.version }), { public: true });
  r.add('GET', '/me', async (req) => ok({ actor: req.actor }));

  // ── Projects ──────────────────────────────────────────────────────────────
  r.add('GET', '/projects', async (req) => ok({ items: await svc.projects.list(bool(req.query.archived)) }));

  r.add('POST', '/projects', async (req) => {
    const b = bodyObject(req);
    const description = str(b, 'description');
    const icon = str(b, 'icon');
    const labels = strArray(b, 'labels');
    const st = states(b.states);
    const md = metadata(b.metadata);
    const project = await svc.projects.create({
      prefix: str(b, 'prefix', true),
      name: str(b, 'name', true),
      ...(description !== undefined ? { description } : {}),
      ...(icon !== undefined ? { icon } : {}),
      ...(labels ? { labels } : {}),
      ...(st ? { states: st } : {}),
      ...(md ? { metadata: md } : {}),
    });
    return created(project);
  });

  r.add('GET', '/projects/{prefix}', async (req) => ok(await svc.projects.get(req.params.prefix as string)));

  r.add('PATCH', '/projects/{prefix}', async (req) => {
    const b = bodyObject(req);
    const patch: Record<string, unknown> = {};
    for (const k of ['name', 'description', 'icon'] as const) if (b[k] !== undefined) patch[k] = str(b, k);
    if (b.labels !== undefined) patch.labels = strArray(b, 'labels');
    if (b.states !== undefined) patch.states = states(b.states);
    if (b.metadata !== undefined) patch.metadata = metadata(b.metadata);
    if (b.archived !== undefined) {
      if (typeof b.archived !== 'boolean')
        throw new HttpError(400, 'VALIDATION', 'archived must be a boolean');
      patch.archived = b.archived;
    }
    return ok(await svc.projects.update(req.params.prefix as string, patch, num(b, 'version', true)));
  });

  r.add('GET', '/projects/{prefix}/tasks', async (req) => {
    const project = await svc.projects.get(req.params.prefix as string);
    const wanted = req.queryAll('state');
    const stateIds = wanted.length
      ? wanted.map((w) => {
          const lower = w.toLowerCase();
          const s = project.states.find((x) => x.id === w || x.name.toLowerCase() === lower);
          if (!s) throw new HttpError(400, 'VALIDATION', `project ${project.prefix} has no state ${w}`);
          return s.id;
        })
      : bool(req.query.all)
        ? undefined
        : project.states.filter((s) => isOpenGroup(s.group)).map((s) => s.id);
    const limit = limitParam(req.query.limit);
    const page = await storage.tasks.listByProject(project.id, {
      ...(stateIds ? { stateIds } : {}),
      ...(req.query.label ? { label: req.query.label } : {}),
      ...(req.query.assignee ? { assignee: assigneeFilter(req.query.assignee) } : {}),
      ...(limit ? { limit } : {}),
      ...(req.query.cursor ? { cursor: req.query.cursor } : {}),
    });
    if (req.query.epic) {
      const epic = normaliseEpicRef(req.query.epic);
      page.items = page.items.filter((t) => t.epics.includes(epic));
    }
    return ok(page);
  });

  r.add('POST', '/projects/{prefix}/tasks', async (req) => {
    const b = bodyObject(req);
    const description = str(b, 'description');
    const state = str(b, 'state');
    const labels = strArray(b, 'labels');
    const parent = str(b, 'parent');
    const prio = priority(str(b, 'priority'));
    const points = num(b, 'points');
    const assignee = str(b, 'assignee') as Assignee | undefined;
    const task = await svc.tasks.create(
      req.params.prefix as string,
      {
        title: str(b, 'title', true),
        ...(description !== undefined ? { description } : {}),
        ...(state !== undefined ? { state } : {}),
        ...(labels ? { labels } : {}),
        ...(parent !== undefined ? { parent } : {}),
        ...(prio ? { priority: prio } : {}),
        ...(points !== undefined ? { points } : {}),
        ...(assignee !== undefined ? { assignee } : {}),
      },
      req.actor,
    );
    return created(task);
  });

  r.add('POST', '/projects/{prefix}/tasks/reorder', async (req) => {
    const b = bodyObject(req);
    const ref = str(b, 'ref', true);
    const project = await svc.projects.get(req.params.prefix as string);
    const task = await svc.tasks.get(ref);
    if (task.projectId !== project.id)
      throw new HttpError(400, 'VALIDATION', `${task.ref} is not in ${project.prefix}`);
    return ok(await svc.tasks.moveInProject(ref, str(b, 'before'), req.actor));
  });

  r.add('GET', '/projects/{prefix}/epics', async (req) =>
    ok({ items: await svc.epics.forProject(req.params.prefix as string) }),
  );

  // ── Tasks ─────────────────────────────────────────────────────────────────
  r.add('GET', '/tasks/{ref}', async (req) => {
    const task = await svc.tasks.get(req.params.ref as string);
    const [project, children, epics] = await Promise.all([
      storage.projects.getById(task.projectId),
      svc.tasks.children(task.ref),
      svc.epics.forTask(task.ref),
    ]);
    const comments = [];
    let cursor: string | undefined;
    do {
      const page = await storage.comments.list(task.ref, { limit: 500, ...(cursor ? { cursor } : {}) });
      comments.push(...page.items);
      cursor = page.cursor;
    } while (cursor);
    const state = project.states.find((s) => s.id === task.stateId);
    return ok({ ...task, project: summary(project), state, comments, children, epics });
  });

  r.add('PATCH', '/tasks/{ref}', async (req) => {
    const b = bodyObject(req);
    const patch: Parameters<Services['tasks']['update']>[1] = {};
    const title = str(b, 'title');
    if (title !== undefined) patch.title = title;
    const description = str(b, 'description');
    if (description !== undefined) patch.description = description;
    const state = str(b, 'state');
    if (state !== undefined) patch.state = state;
    const labels = strArray(b, 'labels');
    if (labels) patch.labels = labels;
    if ('parent' in b) patch.parent = str(b, 'parent');
    const prio = priority(str(b, 'priority'));
    if (prio) patch.priority = prio;
    if ('points' in b) patch.points = num(b, 'points');
    if ('assignee' in b) patch.assignee = str(b, 'assignee') as Assignee | undefined;
    return ok(await svc.tasks.update(req.params.ref as string, patch, num(b, 'version', true), req.actor));
  });

  r.add('POST', '/tasks/{ref}/pick-up', async (req) =>
    ok(await svc.tasks.pickUp(req.params.ref as string, req.actor)),
  );

  r.add('POST', '/tasks/{ref}/state', async (req) =>
    ok(await svc.tasks.setState(req.params.ref as string, str(bodyObject(req), 'state', true), req.actor)),
  );

  r.add('PUT', '/tasks/{ref}/assignee', async (req) => {
    const b = bodyObject(req);
    if (!('assignee' in b))
      throw new HttpError(400, 'VALIDATION', 'assignee is required (an actor, or null to unassign)');
    const assignee = str(b, 'assignee') as Assignee | undefined;
    return ok(await svc.tasks.assign(req.params.ref as string, assignee, req.actor));
  });

  r.add('PUT', '/tasks/{ref}/points', async (req) => {
    const b = bodyObject(req);
    if (!('points' in b))
      throw new HttpError(400, 'VALIDATION', 'points is required (a number, or null to clear)');
    return ok(await svc.tasks.setPoints(req.params.ref as string, num(b, 'points'), req.actor));
  });

  r.add('PUT', '/tasks/{ref}/labels/{name}', async (req) =>
    ok(await svc.tasks.addLabel(req.params.ref as string, req.params.name as string, req.actor)),
  );
  r.add('DELETE', '/tasks/{ref}/labels/{name}', async (req) =>
    ok(await svc.tasks.removeLabel(req.params.ref as string, req.params.name as string, req.actor)),
  );

  r.add('POST', '/tasks/{ref}/links', async (req) => {
    const b = bodyObject(req);
    return created(
      await svc.tasks.addLink(req.params.ref as string, str(b, 'url', true), str(b, 'title'), req.actor),
    );
  });
  r.add('DELETE', '/tasks/{ref}/links/{linkId}', async (req) =>
    ok(await svc.tasks.removeLink(req.params.ref as string, req.params.linkId as string, req.actor)),
  );

  r.add('POST', '/tasks/{ref}/relations', async (req) => {
    const b = bodyObject(req);
    await svc.tasks.addRelation(
      req.params.ref as string,
      relationType(str(b, 'type', true)),
      str(b, 'target', true),
      req.actor,
    );
    return noContent();
  });
  r.add('DELETE', '/tasks/{ref}/relations', async (req) => {
    const b = bodyObject(req);
    await svc.tasks.removeRelation(
      req.params.ref as string,
      relationType(str(b, 'type', true)),
      str(b, 'target', true),
      req.actor,
    );
    return noContent();
  });

  r.add('PUT', '/tasks/{ref}/parent', async (req) =>
    ok(await svc.tasks.setParent(req.params.ref as string, str(bodyObject(req), 'parent'), req.actor)),
  );
  r.add('GET', '/tasks/{ref}/children', async (req) =>
    ok({ items: await svc.tasks.children(req.params.ref as string) }),
  );

  r.add('GET', '/tasks/{ref}/comments', async (req) => {
    const ref = normaliseTaskRef(req.params.ref as string);
    await storage.tasks.get(ref);
    const limit = limitParam(req.query.limit);
    return ok(
      await storage.comments.list(ref, {
        ...(limit ? { limit } : {}),
        ...(req.query.cursor ? { cursor: req.query.cursor } : {}),
      }),
    );
  });
  r.add('POST', '/tasks/{ref}/comments', async (req) =>
    created(
      await svc.tasks.addComment(req.params.ref as string, str(bodyObject(req), 'body', true), req.actor),
    ),
  );

  r.add('GET', '/tasks/{ref}/epics', async (req) =>
    ok({ items: await svc.epics.forTask(req.params.ref as string) }),
  );
  r.add('GET', '/tasks/{ref}/activity', async (req) => {
    const ref = normaliseTaskRef(req.params.ref as string);
    await storage.tasks.get(ref);
    return ok({ items: await storage.activity.list(ref) });
  });

  // ── Epics ─────────────────────────────────────────────────────────────────
  r.add('GET', '/epics', async (req) => ok({ items: await svc.epics.list(bool(req.query.archived)) }));

  r.add('POST', '/epics', async (req) => {
    const b = bodyObject(req);
    const description = str(b, 'description');
    let epic: Epic = await svc.epics.create(
      { name: str(b, 'name', true), ...(description !== undefined ? { description } : {}) },
      req.actor,
    );
    for (const prefix of strArray(b, 'projects') ?? []) epic = await svc.epics.flagProject(epic.ref, prefix);
    return created(epic);
  });

  r.add('GET', '/epics/{ref}', async (req) => {
    const { epic, tasks } = await svc.epics.tasks(req.params.ref as string);
    const projects = await storage.projects.list({ includeArchived: true });
    const byId = new Map(projects.map((p) => [p.id, p]));
    return ok({
      ...epic,
      projects: epic.projectIds.flatMap((id) => {
        const p = byId.get(id);
        return p ? [summary(p)] : [];
      }),
      tasks: tasks.map((t) => ({ ...t, projectPrefix: byId.get(t.projectId)?.prefix })),
    });
  });

  r.add('PATCH', '/epics/{ref}', async (req) => {
    const b = bodyObject(req);
    const patch: Parameters<Services['epics']['update']>[1] = {};
    const name = str(b, 'name');
    if (name !== undefined) patch.name = name;
    const description = str(b, 'description');
    if (description !== undefined) patch.description = description;
    const state = str(b, 'state');
    if (state !== undefined) {
      if (!['open', 'done', 'archived'].includes(state))
        throw new HttpError(400, 'VALIDATION', `invalid state ${state}`);
      patch.state = state as Epic['state'];
    }
    return ok(await svc.epics.update(req.params.ref as string, patch, num(b, 'version', true)));
  });

  r.add('GET', '/epics/{ref}/tasks', async (req) =>
    ok({ items: (await svc.epics.tasks(req.params.ref as string)).tasks }),
  );

  r.add('PUT', '/epics/{ref}/tasks/{taskRef}', async (req) =>
    ok(
      await svc.epics.addTask(
        req.params.ref as string,
        req.params.taskRef as string,
        str(bodyObject(req), 'before'),
      ),
    ),
  );
  r.add('DELETE', '/epics/{ref}/tasks/{taskRef}', async (req) => {
    await svc.epics.removeTask(req.params.ref as string, req.params.taskRef as string);
    return noContent();
  });
  r.add('POST', '/epics/{ref}/tasks/reorder', async (req) => {
    const b = bodyObject(req);
    return ok(await svc.epics.moveTask(req.params.ref as string, str(b, 'ref', true), str(b, 'before')));
  });

  r.add('PUT', '/epics/{ref}/projects/{prefix}', async (req) =>
    ok(await svc.epics.flagProject(req.params.ref as string, req.params.prefix as string)),
  );
  r.add('DELETE', '/epics/{ref}/projects/{prefix}', async (req) =>
    ok(await svc.epics.unflagProject(req.params.ref as string, req.params.prefix as string)),
  );

  // ── Priorities ────────────────────────────────────────────────────────────
  r.add('GET', '/board', async (req) => ok(await svc.board.getBoard({ all: bool(req.query.all) })));
  r.add('POST', '/board/move', async (req) => {
    const b = bodyObject(req);
    return ok(
      await svc.board.move(
        cardKind(str(b, 'kind', true)),
        str(b, 'id', true),
        column(str(b, 'column', true)),
        str(b, 'before'),
      ),
    );
  });
  r.add('DELETE', '/board/{kind}/{id}', async (req) => {
    await svc.board.remove(cardKind(req.params.kind as string), req.params.id as string);
    return noContent();
  });
  r.add('GET', '/next', async () => ok(await svc.board.next()));
  r.add('GET', '/priority', async () => ok({ items: await svc.board.priority() }));

  // ── Search ────────────────────────────────────────────────────────────────
  r.add('GET', '/search', async (req) => {
    const text = (req.query.q ?? '').trim();
    if (!text) throw new HttpError(400, 'VALIDATION', 'q is required');
    const mode = (req.query.mode ?? 'hybrid') as SearchMode;
    if (!['hybrid', 'semantic', 'fulltext'].includes(mode))
      throw new HttpError(400, 'VALIDATION', `invalid mode ${mode}`);
    const kinds = req.queryAll('kind') as SearchKind[];
    if (kinds.some((k) => !['task', 'comment', 'epic'].includes(k))) {
      throw new HttpError(400, 'VALIDATION', 'kind must be task, comment or epic');
    }
    const projectId = req.query.project ? (await svc.projects.get(req.query.project)).id : undefined;
    const epicRef = req.query.epic ? normaliseEpicRef(req.query.epic) : undefined;
    const limit = limitParam(req.query.limit);
    if (!deps.search) return ok({ items: [] });
    const items = await deps.search.query({
      text,
      mode,
      ...(projectId ? { projectId } : {}),
      ...(epicRef ? { epicRef } : {}),
      ...(kinds.length ? { kinds } : {}),
      ...(limit ? { limit } : {}),
    });
    return ok({ items });
  });

  return r;
}

/** Exported for the web UI's types and tests. */
export type { Task };

/** `?assignee=` takes an actor that can be assigned, or `none` for unassigned tasks. */
function assigneeFilter(value: string): Assignee | 'none' {
  const v = value.toLowerCase();
  if (v === 'none' || (ASSIGNEES as readonly string[]).includes(v)) return v as Assignee | 'none';
  throw new HttpError(400, 'VALIDATION', `assignee must be none or one of ${ASSIGNEES.join(', ')}`);
}
