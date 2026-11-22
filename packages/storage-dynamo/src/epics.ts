import {
  ConflictError,
  type Epic,
  type EpicMember,
  type EpicPatch,
  type EpicRef,
  type EpicRepository,
  epicRef,
  type NewEpic,
  NotFoundError,
  newId,
  nowIso,
  rankBetween,
  type Task,
  type TaskRef,
  VersionMismatchError,
} from '@purr/domain';
import { assertRank, fromItem, type Item, toItem } from './codec.js';
import { cond, type Db, isConditionalFailure, RetryError, type TxOp, withRetry } from './db.js';
import { keys } from './keys.js';
import { loadProjectById } from './projects.js';
import { loadTask, taskItem } from './tasks.js';

const epicItem = (e: Epic): Item => toItem(e, keys.epic(e.ref), keys.epicIndex(e.ref));
const memberItem = (m: EpicMember): Item =>
  toItem(m, keys.member(m.epicRef, m.taskRef), keys.memberIndex(m.epicRef, m.taskRef, m.rank));

async function loadEpic(db: Db, ref: EpicRef): Promise<Epic> {
  const item = await db.get(keys.epic(ref));
  if (!item) throw new NotFoundError(`no epic ${ref}`);
  return fromItem<Epic>(item);
}

async function loadMember(db: Db, epic: EpicRef, task: TaskRef): Promise<EpicMember | undefined> {
  const item = await db.get(keys.member(epic, task));
  return item ? fromItem<EpicMember>(item) : undefined;
}

/** Writes a new epic version, or loses a race and asks to be run again. */
async function putEpicOrRetry(db: Db, next: Epic, readVersion: number): Promise<void> {
  try {
    await db.put(epicItem(next), cond.versionIs(readVersion));
  } catch (e) {
    if (isConditionalFailure(e)) throw new RetryError();
    throw e;
  }
}

export function epicRepository(db: Db): EpicRepository {
  const listAll = async (includeArchived: boolean): Promise<Epic[]> => {
    const items = await db.queryAll({
      attribute: 'GSI1PK',
      partition: keys.epicIndex(epicRef(1)).GSI1PK,
      accept: (i) => includeArchived || i.state !== 'archived',
    });
    return items.map((i) => fromItem<Epic>(i));
  };

  return {
    async create(input: NewEpic, actor) {
      const n = await db.nextCounter(keys.epicCounter());
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
      await db.put(epicItem(epic), cond.notExists());
      return epic;
    },

    get: (ref) => loadEpic(db, ref),

    list: (opts = {}) => listAll(opts.includeArchived === true),

    async update(ref, patch: EpicPatch, expectedVersion) {
      const e = await loadEpic(db, ref);
      if (e.version !== expectedVersion) throw new VersionMismatchError(`epic ${ref} has changed`);
      const next: Epic = { ...e, ...patch, version: e.version + 1, updatedAt: nowIso() };
      try {
        await db.put(epicItem(next), cond.versionIs(expectedVersion));
      } catch (err) {
        if (isConditionalFailure(err)) throw new VersionMismatchError(`epic ${ref} has changed`);
        throw err;
      }
      return next;
    },

    addTask(ref, tRef, rank) {
      return withRetry(async () => {
        const e = await loadEpic(db, ref);
        const t = await loadTask(db, tRef);
        const existing = await loadMember(db, ref, tRef);
        if (existing) return existing;
        const last = await db.queryFirst({
          attribute: 'GSI1PK',
          partition: keys.memberPartition(ref),
          descending: true,
        });
        const member: EpicMember = {
          epicRef: ref,
          taskRef: tRef,
          rank: assertRank(rank ?? rankBetween(last?.rank as string | undefined, undefined)),
        };
        const nextTask: Task = { ...t, epics: [...t.epics, ref], version: t.version + 1 };
        const ops: TxOp[] = [
          { put: memberItem(member), condition: cond.notExists(), fail: 'retry' },
          { put: taskItem(nextTask), condition: cond.versionIs(t.version), fail: 'retry' },
        ];
        if (e.projectIds.includes(t.projectId)) {
          ops.push({ check: keys.epic(ref), condition: cond.versionIs(e.version), fail: 'retry' });
        } else {
          const nextEpic: Epic = {
            ...e,
            projectIds: [...e.projectIds, t.projectId],
            version: e.version + 1,
            updatedAt: nowIso(),
          };
          ops.push({ put: epicItem(nextEpic), condition: cond.versionIs(e.version), fail: 'retry' });
        }
        await db.transact(ops);
        return member;
      });
    },

    removeTask(ref, tRef) {
      return withRetry(async () => {
        await loadEpic(db, ref);
        if (!(await loadMember(db, ref, tRef))) throw new NotFoundError(`${tRef} is not in ${ref}`);
        const ops: TxOp[] = [
          {
            delete: keys.member(ref, tRef),
            condition: cond.exists(),
            fail: () => new NotFoundError(`${tRef} is not in ${ref}`),
          },
        ];
        const t = await db.get(keys.task(tRef));
        if (t) {
          const task = fromItem<Task>(t);
          const next: Task = {
            ...task,
            epics: task.epics.filter((x) => x !== ref),
            version: task.version + 1,
          };
          ops.push({ put: taskItem(next), condition: cond.versionIs(task.version), fail: 'retry' });
        }
        await db.transact(ops);
      });
    },

    async moveTask(ref, tRef, rank) {
      assertRank(rank);
      await loadEpic(db, ref);
      const existing = await loadMember(db, ref, tRef);
      if (!existing) throw new NotFoundError(`${tRef} is not in ${ref}`);
      const next: EpicMember = { ...existing, rank };
      try {
        await db.put(memberItem(next), cond.exists());
      } catch (e) {
        if (isConditionalFailure(e)) throw new NotFoundError(`${tRef} is not in ${ref}`);
        throw e;
      }
      return next;
    },

    async listTasks(ref) {
      await loadEpic(db, ref);
      const items = await db.queryAll({ attribute: 'GSI1PK', partition: keys.memberPartition(ref) });
      return items.map((i) => fromItem<EpicMember>(i));
    },

    flagProject(ref, projectId) {
      return withRetry(async () => {
        const e = await loadEpic(db, ref);
        await loadProjectById(db, projectId);
        if (e.projectIds.includes(projectId)) return e;
        const next: Epic = {
          ...e,
          projectIds: [...e.projectIds, projectId],
          version: e.version + 1,
          updatedAt: nowIso(),
        };
        await putEpicOrRetry(db, next, e.version);
        return next;
      });
    },

    unflagProject(ref, projectId) {
      return withRetry(async () => {
        const e = await loadEpic(db, ref);
        // The table's own sort-key range is read consistently, unlike the index.
        const members = await db.queryAll({
          attribute: 'PK',
          partition: keys.epic(ref).PK,
          skPrefix: 'MEMBER#',
        });
        const tasks = await db.batchGet(members.map((m) => keys.task(m.taskRef as TaskRef)));
        if (tasks.some((t) => t.projectId === projectId)) {
          throw new ConflictError(`${ref} still holds tasks from that project`);
        }
        const next: Epic = {
          ...e,
          projectIds: e.projectIds.filter((p) => p !== projectId),
          version: e.version + 1,
          updatedAt: nowIso(),
        };
        await putEpicOrRetry(db, next, e.version);
        return next;
      });
    },

    // The epic set is small, so this reads all of it from the index and filters,
    // rather than keeping a project -> epics index that would need its own upkeep.
    async listByProject(projectId) {
      return (await listAll(true)).filter((e) => e.projectIds.includes(projectId));
    },
  };
}
