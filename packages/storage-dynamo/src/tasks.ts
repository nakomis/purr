import {
  type Activity,
  type Actor,
  AlreadyExistsError,
  INVERSE_RELATION,
  type NewTask,
  NotFoundError,
  newId,
  nowIso,
  type RelationType,
  rankBetween,
  type Task,
  type TaskListOptions,
  type TaskPatch,
  type TaskRef,
  type TaskRepository,
  taskRef,
  ValidationError,
  VersionMismatchError,
} from '@purr/domain';
import { assertRank, clampLimit, fromItem, type Item, toItem } from './codec.js';
import { cond, type Db, type TxOp, withRetry } from './db.js';
import { keys } from './keys.js';
import { loadProjectById } from './projects.js';

export const taskItem = (t: Task): Item =>
  toItem(t, keys.task(t.ref), keys.taskIndex(t.projectId, t.projectRank, t.sequence));

export async function loadTask(db: Db, ref: TaskRef): Promise<Task> {
  const item = await db.get(keys.task(ref));
  if (!item) throw new NotFoundError(`no task ${ref}`);
  return fromItem<Task>(item);
}

export function activityOp(
  ref: TaskRef,
  actor: Actor,
  action: string,
  changes: Activity['changes'],
  at: string = nowIso(),
): TxOp {
  const id = newId();
  const record: Activity = { id, taskRef: ref, actor, action, changes, at };
  return { put: toItem(record, keys.activity(ref, at, id)) };
}

function diff(before: Task, patch: TaskPatch): Activity['changes'] {
  const changes: Activity['changes'] = {};
  for (const [k, v] of Object.entries(patch)) {
    const from = (before as unknown as Record<string, unknown>)[k];
    if (JSON.stringify(from) !== JSON.stringify(v)) changes[k] = { from, to: v };
  }
  return changes;
}

const childItem = (parent: TaskRef, child: Task): Item =>
  toItem({ parent, childRef: child.ref }, keys.child(parent, child.ref, child.sequence));

const hasRelation = (t: Task, type: RelationType, target: TaskRef) =>
  t.relations.some((r) => r.type === type && r.target === target);

export function taskRepository(db: Db): TaskRepository {
  async function endRank(projectId: string): Promise<string> {
    const last = await db.queryFirst({
      attribute: 'GSI1PK',
      partition: keys.projectTasksPartition(projectId),
      descending: true,
    });
    return rankBetween(last?.projectRank as string | undefined, undefined);
  }

  async function getMany(refs: TaskRef[]): Promise<Task[]> {
    const found = await db.batchGet(refs.map((r) => keys.task(r)));
    const byRef = new Map(found.map((i) => [i.ref as string, fromItem<Task>(i)]));
    return refs.flatMap((r) => {
      const t = byRef.get(r);
      return t ? [t] : [];
    });
  }

  return {
    async create(input: NewTask, actor) {
      const project = await loadProjectById(db, input.projectId);
      const counter = keys.projectCounter(project.id);
      const explicit = input.sequence !== undefined;
      // Raising first means a failure later can only leave a gap, never a clash.
      if (input.sequence !== undefined) await db.raiseCounter(counter, input.sequence);
      const at = input.createdAt ?? nowIso();
      const rank = assertRank(input.projectRank ?? (await endRank(project.id)));
      for (let attempt = 0; ; attempt++) {
        const sequence = input.sequence ?? (await db.nextCounter(counter));
        const ref = taskRef(project.prefix, sequence);
        const task: Task = {
          id: newId(),
          ref,
          projectId: project.id,
          sequence,
          projectRank: rank,
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
        try {
          await db.transact([
            {
              put: taskItem(task),
              condition: cond.notExists(),
              fail: () => new AlreadyExistsError(`task ${ref} exists`),
            },
            ...(task.parent ? [{ put: childItem(task.parent, task) }] : []),
            activityOp(ref, actor, 'created', {}, at),
          ]);
          return task;
        } catch (e) {
          // An allocated number already taken (a counter that lagged an import): take the next.
          if (e instanceof AlreadyExistsError && !explicit && attempt < 5) continue;
          throw e;
        }
      }
    },

    get: (ref) => loadTask(db, ref),

    getMany,

    async listByProject(projectId, opts: TaskListOptions = {}) {
      const page = await db.queryPage({
        attribute: 'GSI1PK',
        partition: keys.projectTasksPartition(projectId),
        limit: clampLimit(opts.limit),
        ...(opts.cursor ? { cursor: opts.cursor } : {}),
        accept: (i) =>
          (!opts.stateIds || opts.stateIds.includes(i.stateId as string)) &&
          (!opts.label || (i.labels as string[]).includes(opts.label)),
      });
      return {
        items: page.items.map((i) => fromItem<Task>(i)),
        ...(page.cursor ? { cursor: page.cursor } : {}),
      };
    },

    async listChildren(parent) {
      const links = await db.queryAll({
        attribute: 'PK',
        partition: keys.task(parent).PK,
        skPrefix: keys.childPrefix,
      });
      return getMany(links.map((l) => l.childRef as TaskRef));
    },

    async update(ref, patch, expectedVersion, actor) {
      const t = await loadTask(db, ref);
      if (t.version !== expectedVersion) throw new VersionMismatchError(`task ${ref} has changed`);
      const changes = diff(t, patch);
      const next: Task = { ...t, ...patch, version: t.version + 1, updatedAt: nowIso(), updatedBy: actor };
      if ('parent' in patch && patch.parent === undefined) delete next.parent;
      if ('points' in patch && patch.points === undefined) delete next.points;
      const ops: TxOp[] = [
        {
          put: taskItem(next),
          condition: cond.versionIs(expectedVersion),
          fail: () => new VersionMismatchError(`task ${ref} has changed`),
        },
      ];
      if (t.parent !== next.parent) {
        if (t.parent) ops.push({ delete: keys.child(t.parent, ref, t.sequence) });
        if (next.parent) ops.push({ put: childItem(next.parent, next) });
      }
      if (Object.keys(changes).length > 0) ops.push(activityOp(ref, actor, 'updated', changes));
      await db.transact(ops);
      return next;
    },

    moveInProject(ref, rank, actor) {
      assertRank(rank);
      return withRetry(async () => {
        const t = await loadTask(db, ref);
        const next: Task = {
          ...t,
          projectRank: rank,
          version: t.version + 1,
          updatedAt: nowIso(),
          updatedBy: actor,
        };
        await db.transact([
          { put: taskItem(next), condition: cond.versionIs(t.version), fail: 'retry' },
          activityOp(ref, actor, 'moved', { projectRank: { from: t.projectRank, to: rank } }),
        ]);
        return next;
      });
    },

    addRelation(ref, type, target, actor) {
      if (ref === target) throw new ValidationError('a task cannot be related to itself');
      const inverse = INVERSE_RELATION[type];
      return withRetry(async () => {
        const a = await loadTask(db, ref);
        const b = await loadTask(db, target);
        const ops: TxOp[] = [];
        if (!hasRelation(a, type, target)) {
          const next: Task = { ...a, relations: [...a.relations, { type, target }], version: a.version + 1 };
          ops.push({ put: taskItem(next), condition: cond.versionIs(a.version), fail: 'retry' });
          ops.push(activityOp(ref, actor, 'related', { relation: { from: null, to: { type, target } } }));
        }
        if (!hasRelation(b, inverse, ref)) {
          const next: Task = {
            ...b,
            relations: [...b.relations, { type: inverse, target: ref }],
            version: b.version + 1,
          };
          ops.push({ put: taskItem(next), condition: cond.versionIs(b.version), fail: 'retry' });
        }
        if (ops.length > 0) await db.transact(ops);
      });
    },

    removeRelation(ref, type, target, actor) {
      const inverse = INVERSE_RELATION[type];
      return withRetry(async () => {
        const [a, b] = await Promise.all([
          db.get(keys.task(ref)).then((i) => (i ? fromItem<Task>(i) : undefined)),
          db.get(keys.task(target)).then((i) => (i ? fromItem<Task>(i) : undefined)),
        ]);
        const ops: TxOp[] = [];
        if (a && hasRelation(a, type, target) && ref !== target) {
          const next: Task = {
            ...a,
            relations: a.relations.filter((r) => !(r.type === type && r.target === target)),
            version: a.version + 1,
          };
          ops.push({ put: taskItem(next), condition: cond.versionIs(a.version), fail: 'retry' });
          ops.push(activityOp(ref, actor, 'unrelated', { relation: { from: { type, target }, to: null } }));
        }
        if (b && hasRelation(b, inverse, ref) && ref !== target) {
          const next: Task = {
            ...b,
            relations: b.relations.filter((r) => !(r.type === inverse && r.target === ref)),
            version: b.version + 1,
          };
          ops.push({ put: taskItem(next), condition: cond.versionIs(b.version), fail: 'retry' });
        }
        if (ops.length > 0) await db.transact(ops);
      });
    },
  };
}
