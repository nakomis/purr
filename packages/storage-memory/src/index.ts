/**
 * In-memory implementation of every port: the reference adapter for fast tests of
 * the domain and the API. Every value crosses the boundary as a copy, so callers
 * can never mutate stored state by accident (as with a real database).
 */
import {
  type Activity,
  type ActivityRepository,
  type Actor,
  AlreadyExistsError,
  type ApiKeyRecord,
  type ApiKeyRepository,
  type BoardCard,
  type BoardRepository,
  type Comment,
  type CommentRepository,
  ConflictError,
  type Epic,
  type EpicMember,
  type EpicPatch,
  type EpicRef,
  type EpicRepository,
  epicRef,
  INVERSE_RELATION,
  type NewEpic,
  type NewProject,
  type NewTask,
  NotFoundError,
  newId,
  nowIso,
  type Page,
  type Project,
  type ProjectPatch,
  type ProjectRepository,
  type Rank,
  type RelationType,
  rankBetween,
  type Storage,
  type Task,
  type TaskListOptions,
  type TaskPatch,
  type TaskRef,
  type TaskRepository,
  taskRef,
  ValidationError,
  VersionMismatchError,
} from '@purr/domain';

const copy = <T>(v: T): T => structuredClone(v);
const byRank = <T extends { rank: Rank }>(a: T, b: T) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0);

function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ o: offset })).toString('base64url');
}
function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  try {
    const { o } = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (typeof o === 'number' && o >= 0) return o;
  } catch {}
  throw new ValidationError('invalid cursor');
}
function paginate<T>(items: T[], opts: { limit?: number; cursor?: string } = {}): Page<T> {
  const offset = decodeCursor(opts.cursor);
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 1000);
  const slice = items.slice(offset, offset + limit);
  return {
    items: slice.map(copy),
    ...(offset + limit < items.length ? { cursor: encodeCursor(offset + limit) } : {}),
  };
}

function diff(before: Task, patch: TaskPatch): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const [k, v] of Object.entries(patch)) {
    const from = (before as unknown as Record<string, unknown>)[k];
    if (JSON.stringify(from) !== JSON.stringify(v)) changes[k] = { from, to: v };
  }
  return changes;
}

export function createMemoryStorage(): Storage {
  const projects = new Map<string, Project>(); // by id
  const counters = new Map<string, number>(); // projectId -> last sequence; 'EPIC' -> last epic
  const tasks = new Map<TaskRef, Task>();
  const comments = new Map<TaskRef, Comment[]>();
  const epics = new Map<EpicRef, Epic>();
  const members = new Map<EpicRef, Map<TaskRef, EpicMember>>();
  const board = new Map<string, BoardCard>(); // `${kind}#${id}`
  const activity = new Map<TaskRef, Activity[]>();
  const apiKeys = new Map<string, ApiKeyRecord>(); // by hash

  const record = (
    ref: TaskRef,
    actor: Actor,
    action: string,
    changes: Activity['changes'],
    at = nowIso(),
  ) => {
    const list = activity.get(ref) ?? [];
    list.push({ id: newId(), taskRef: ref, actor, action, changes, at });
    activity.set(ref, list);
  };
  const projectById = (id: string): Project => {
    const p = projects.get(id);
    if (!p) throw new NotFoundError(`no project ${id}`);
    return p;
  };
  const projectByPrefix = (prefix: string): Project => {
    for (const p of projects.values()) if (p.prefix === prefix) return p;
    throw new NotFoundError(`no project ${prefix}`);
  };
  const taskByRef = (ref: TaskRef): Task => {
    const t = tasks.get(ref);
    if (!t) throw new NotFoundError(`no task ${ref}`);
    return t;
  };
  const epicByRef = (ref: EpicRef): Epic => {
    const e = epics.get(ref);
    if (!e) throw new NotFoundError(`no epic ${ref}`);
    return e;
  };

  const projectRepo: ProjectRepository = {
    async create(input: NewProject) {
      for (const p of projects.values()) {
        if (p.prefix === input.prefix) throw new AlreadyExistsError(`project ${input.prefix} exists`);
      }
      const at = input.createdAt ?? nowIso();
      const project: Project = {
        id: newId(),
        prefix: input.prefix,
        name: input.name,
        description: input.description ?? '',
        states: input.states ?? [],
        labels: input.labels ?? [],
        metadata: { bauEnabled: false, ...input.metadata },
        ...(input.icon ? { icon: input.icon } : {}),
        archived: input.archived ?? false,
        createdAt: at,
        updatedAt: at,
        version: 1,
      };
      projects.set(project.id, project);
      return copy(project);
    },
    async get(prefix) {
      return copy(projectByPrefix(prefix));
    },
    async getById(id) {
      return copy(projectById(id));
    },
    async list(opts = {}) {
      return [...projects.values()]
        .filter((p) => opts.includeArchived || !p.archived)
        .sort((a, b) => a.prefix.localeCompare(b.prefix))
        .map(copy);
    },
    async update(prefix, patch: ProjectPatch, expectedVersion) {
      const p = projectByPrefix(prefix);
      if (p.version !== expectedVersion) throw new VersionMismatchError(`project ${prefix} has changed`);
      const next: Project = { ...p, ...copy(patch), version: p.version + 1, updatedAt: nowIso() };
      if (patch.metadata) next.metadata = { ...p.metadata, ...patch.metadata };
      projects.set(p.id, next);
      return copy(next);
    },
  };

  const taskRepo: TaskRepository = {
    async create(input: NewTask, actor) {
      const project = projectById(input.projectId);
      const last = counters.get(project.id) ?? 0;
      let sequence: number;
      if (input.sequence !== undefined) {
        sequence = input.sequence;
        if (tasks.has(taskRef(project.prefix, sequence))) {
          throw new AlreadyExistsError(`task ${taskRef(project.prefix, sequence)} exists`);
        }
        counters.set(project.id, Math.max(last, sequence));
      } else {
        sequence = last + 1;
        counters.set(project.id, sequence);
      }
      const ref = taskRef(project.prefix, sequence);
      const ranks = [...tasks.values()]
        .filter((t) => t.projectId === project.id)
        .map((t) => t.projectRank)
        .sort();
      const at = input.createdAt ?? nowIso();
      const task: Task = {
        id: newId(),
        ref,
        projectId: project.id,
        sequence,
        projectRank: input.projectRank ?? rankBetween(ranks.at(-1), undefined),
        title: input.title,
        description: input.description ?? '',
        stateId: input.stateId ?? project.states[0]?.id ?? '',
        labels: input.labels ?? [],
        ...(input.parent ? { parent: input.parent } : {}),
        priority: input.priority ?? 'none',
        ...(input.points !== undefined ? { points: input.points } : {}),
        links: [],
        relations: [],
        epics: [],
        createdBy: actor,
        createdAt: at,
        updatedBy: actor,
        updatedAt: input.updatedAt ?? at,
        version: 1,
      };
      tasks.set(ref, task);
      record(ref, actor, 'created', {}, at);
      return copy(task);
    },
    async get(ref) {
      return copy(taskByRef(ref));
    },
    async getMany(refs) {
      return refs.flatMap((r) => {
        const t = tasks.get(r);
        return t ? [copy(t)] : [];
      });
    },
    async listByProject(projectId, opts: TaskListOptions = {}) {
      const items = [...tasks.values()]
        .filter((t) => t.projectId === projectId)
        .filter((t) => !opts.stateIds || opts.stateIds.includes(t.stateId))
        .filter((t) => !opts.label || t.labels.includes(opts.label))
        .sort((a, b) => (a.projectRank < b.projectRank ? -1 : a.projectRank > b.projectRank ? 1 : 0));
      return paginate(items, opts);
    },
    async listChildren(parent) {
      return [...tasks.values()]
        .filter((t) => t.parent === parent)
        .sort((a, b) => a.sequence - b.sequence)
        .map(copy);
    },
    async update(ref, patch, expectedVersion, actor) {
      const t = taskByRef(ref);
      if (t.version !== expectedVersion) throw new VersionMismatchError(`task ${ref} has changed`);
      const changes = diff(t, patch);
      const next: Task = {
        ...t,
        ...copy(patch),
        version: t.version + 1,
        updatedAt: nowIso(),
        updatedBy: actor,
      };
      if ('parent' in patch && patch.parent === undefined) delete next.parent;
      if ('points' in patch && patch.points === undefined) delete next.points;
      tasks.set(ref, next);
      if (Object.keys(changes).length > 0) record(ref, actor, 'updated', changes);
      return copy(next);
    },
    async moveInProject(ref, rank, actor) {
      const t = taskByRef(ref);
      const next: Task = {
        ...t,
        projectRank: rank,
        version: t.version + 1,
        updatedAt: nowIso(),
        updatedBy: actor,
      };
      tasks.set(ref, next);
      record(ref, actor, 'moved', { projectRank: { from: t.projectRank, to: rank } });
      return copy(next);
    },
    async addRelation(ref, type: RelationType, target, actor) {
      const a = taskByRef(ref);
      const b = taskByRef(target);
      const inverse = INVERSE_RELATION[type];
      const has = (t: Task, ty: RelationType, r: TaskRef) =>
        t.relations.some((x) => x.type === ty && x.target === r);
      if (!has(a, type, target)) {
        tasks.set(ref, { ...a, relations: [...a.relations, { type, target }], version: a.version + 1 });
        record(ref, actor, 'related', { relation: { from: null, to: { type, target } } });
      }
      const b2 = taskByRef(target);
      if (!has(b2, inverse, ref)) {
        tasks.set(target, {
          ...b2,
          relations: [...b2.relations, { type: inverse, target: ref }],
          version: b.version + 1,
        });
      }
    },
    async removeRelation(ref, type, target, actor) {
      const inverse = INVERSE_RELATION[type];
      const a = tasks.get(ref);
      const b = tasks.get(target);
      if (a) {
        tasks.set(ref, {
          ...a,
          relations: a.relations.filter((x) => !(x.type === type && x.target === target)),
          version: a.version + 1,
        });
        record(ref, actor, 'unrelated', { relation: { from: { type, target }, to: null } });
      }
      if (b) {
        tasks.set(target, {
          ...b,
          relations: b.relations.filter((x) => !(x.type === inverse && x.target === ref)),
          version: b.version + 1,
        });
      }
    },
  };

  const commentRepo: CommentRepository = {
    async add(ref, body, author, at) {
      taskByRef(ref);
      const comment: Comment = { id: newId(), taskRef: ref, body, author, createdAt: at ?? nowIso() };
      const list = comments.get(ref) ?? [];
      list.push(comment);
      list.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
      comments.set(ref, list);
      return copy(comment);
    },
    async list(ref, opts = {}) {
      return paginate(comments.get(ref) ?? [], opts);
    },
  };

  const epicRepo: EpicRepository = {
    async create(input: NewEpic, actor) {
      const n = (counters.get('EPIC') ?? 0) + 1;
      counters.set('EPIC', n);
      const at = input.createdAt ?? nowIso();
      const epic: Epic = {
        id: newId(),
        ref: epicRef(n),
        name: input.name,
        description: input.description ?? '',
        state: input.state ?? 'open',
        projectIds: [],
        createdBy: actor,
        createdAt: at,
        updatedAt: at,
        version: 1,
      };
      epics.set(epic.ref, epic);
      members.set(epic.ref, new Map());
      return copy(epic);
    },
    async get(ref) {
      return copy(epicByRef(ref));
    },
    async list(opts = {}) {
      return [...epics.values()]
        .filter((e) => opts.includeArchived || e.state !== 'archived')
        .sort((a, b) => Number(a.ref.slice(5)) - Number(b.ref.slice(5)))
        .map(copy);
    },
    async update(ref, patch: EpicPatch, expectedVersion) {
      const e = epicByRef(ref);
      if (e.version !== expectedVersion) throw new VersionMismatchError(`epic ${ref} has changed`);
      const next = { ...e, ...copy(patch), version: e.version + 1, updatedAt: nowIso() };
      epics.set(ref, next);
      return copy(next);
    },
    async addTask(ref, tRef, rank) {
      const e = epicByRef(ref);
      const t = taskByRef(tRef);
      const m = members.get(ref) as Map<TaskRef, EpicMember>;
      const existing = m.get(tRef);
      if (existing) return copy(existing);
      const ranks = [...m.values()].map((x) => x.rank).sort();
      const member: EpicMember = {
        epicRef: ref,
        taskRef: tRef,
        rank: rank ?? rankBetween(ranks.at(-1), undefined),
      };
      m.set(tRef, member);
      if (!t.epics.includes(ref)) tasks.set(tRef, { ...t, epics: [...t.epics, ref], version: t.version + 1 });
      if (!e.projectIds.includes(t.projectId)) {
        epics.set(ref, { ...e, projectIds: [...e.projectIds, t.projectId], version: e.version + 1 });
      }
      return copy(member);
    },
    async removeTask(ref, tRef) {
      epicByRef(ref);
      const m = members.get(ref) as Map<TaskRef, EpicMember>;
      if (!m.has(tRef)) throw new NotFoundError(`${tRef} is not in ${ref}`);
      m.delete(tRef);
      const t = tasks.get(tRef);
      if (t) tasks.set(tRef, { ...t, epics: t.epics.filter((x) => x !== ref), version: t.version + 1 });
    },
    async moveTask(ref, tRef, rank) {
      epicByRef(ref);
      const m = members.get(ref) as Map<TaskRef, EpicMember>;
      const existing = m.get(tRef);
      if (!existing) throw new NotFoundError(`${tRef} is not in ${ref}`);
      const next = { ...existing, rank };
      m.set(tRef, next);
      return copy(next);
    },
    async listTasks(ref) {
      epicByRef(ref);
      return [...(members.get(ref) as Map<TaskRef, EpicMember>).values()].sort(byRank).map(copy);
    },
    async flagProject(ref, projectId) {
      const e = epicByRef(ref);
      projectById(projectId);
      if (e.projectIds.includes(projectId)) return copy(e);
      const next = {
        ...e,
        projectIds: [...e.projectIds, projectId],
        version: e.version + 1,
        updatedAt: nowIso(),
      };
      epics.set(ref, next);
      return copy(next);
    },
    async unflagProject(ref, projectId) {
      const e = epicByRef(ref);
      const remaining = [...(members.get(ref) as Map<TaskRef, EpicMember>).keys()].some(
        (r) => tasks.get(r)?.projectId === projectId,
      );
      if (remaining) throw new ConflictError(`${ref} still holds tasks from that project`);
      const next = {
        ...e,
        projectIds: e.projectIds.filter((p) => p !== projectId),
        version: e.version + 1,
        updatedAt: nowIso(),
      };
      epics.set(ref, next);
      return copy(next);
    },
    async listByProject(projectId) {
      return [...epics.values()].filter((e) => e.projectIds.includes(projectId)).map(copy);
    },
  };

  const boardRepo: BoardRepository = {
    async list() {
      return [...board.values()].map(copy);
    },
    async put(card) {
      board.set(`${card.kind}#${card.id}`, copy(card));
    },
    async remove(kind, id) {
      board.delete(`${kind}#${id}`);
    },
  };

  const activityRepo: ActivityRepository = {
    async list(ref) {
      return (activity.get(ref) ?? []).map(copy);
    },
  };

  const apiKeyRepo: ApiKeyRepository = {
    async findByHash(hash) {
      const r = apiKeys.get(hash);
      return r ? copy(r) : undefined;
    },
    async put(rec) {
      apiKeys.set(rec.hash, copy(rec));
    },
  };

  return {
    projects: projectRepo,
    tasks: taskRepo,
    comments: commentRepo,
    epics: epicRepo,
    board: boardRepo,
    activity: activityRepo,
    apiKeys: apiKeyRepo,
  };
}
