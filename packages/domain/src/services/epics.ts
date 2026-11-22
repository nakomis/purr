import { ValidationError } from '../errors.js';
import type { EpicPatch, NewEpic } from '../ports.js';
import { rankBefore } from '../rank.js';
import { normaliseEpicRef, normaliseTaskRef } from '../refs.js';
import type { Actor, Epic, EpicMember, Task } from '../types.js';
import { publish, type ServiceDeps } from './common.js';

export interface EpicWithTasks {
  epic: Epic;
  tasks: (Task & { epicRank: string })[];
}

export class EpicService {
  constructor(private readonly deps: ServiceDeps) {}

  private get storage() {
    return this.deps.storage;
  }

  async create(input: NewEpic, actor: Actor): Promise<Epic> {
    if (!input.name?.trim()) throw new ValidationError('an epic needs a name');
    const epic = await this.storage.epics.create({ ...input, name: input.name.trim() }, actor);
    await publish(this.deps, [{ type: 'EpicChanged', ref: epic.ref }]);
    return epic;
  }

  get(ref: string): Promise<Epic> {
    return this.storage.epics.get(normaliseEpicRef(ref));
  }

  list(includeArchived = false): Promise<Epic[]> {
    return this.storage.epics.list({ includeArchived });
  }

  async update(ref: string, patch: EpicPatch, expectedVersion: number): Promise<Epic> {
    if (patch.name !== undefined && !patch.name.trim()) throw new ValidationError('an epic needs a name');
    const epic = await this.storage.epics.update(normaliseEpicRef(ref), patch, expectedVersion);
    await publish(this.deps, [{ type: 'EpicChanged', ref: epic.ref }]);
    return epic;
  }

  /** Members in epic order, whatever their projects. */
  async tasks(ref: string): Promise<EpicWithTasks> {
    const epic = await this.get(ref);
    const members = await this.storage.epics.listTasks(epic.ref);
    const tasks = await this.storage.tasks.getMany(members.map((m) => m.taskRef));
    const byRef = new Map(tasks.map((t) => [t.ref, t]));
    return {
      epic,
      tasks: members.flatMap((m) => {
        const t = byRef.get(m.taskRef);
        return t ? [{ ...t, epicRank: m.rank }] : [];
      }),
    };
  }

  /** Add a task, before `beforeRef` or at the end; flags the task's project on the epic. */
  async addTask(ref: string, taskRef: string, beforeRef?: string): Promise<EpicMember> {
    const epic = await this.get(ref);
    const task = await this.storage.tasks.get(normaliseTaskRef(taskRef));
    const members = (await this.storage.epics.listTasks(epic.ref)).filter((m) => m.taskRef !== task.ref);
    const existing = (await this.storage.epics.listTasks(epic.ref)).find((m) => m.taskRef === task.ref);
    if (existing && !beforeRef) return existing;
    const rank = rankBefore(
      members.map((m) => m.rank),
      this.beforeRank(members, beforeRef),
    );
    const member = existing
      ? await this.storage.epics.moveTask(epic.ref, task.ref, rank)
      : await this.storage.epics.addTask(epic.ref, task.ref, rank);
    await publish(this.deps, [
      { type: 'EpicChanged', ref: epic.ref },
      { type: 'TaskChanged', ref: task.ref },
    ]);
    return member;
  }

  async removeTask(ref: string, taskRef: string): Promise<void> {
    const epicRef = normaliseEpicRef(ref);
    const tRef = normaliseTaskRef(taskRef);
    await this.storage.epics.removeTask(epicRef, tRef);
    await publish(this.deps, [
      { type: 'EpicChanged', ref: epicRef },
      { type: 'TaskChanged', ref: tRef },
    ]);
  }

  async moveTask(ref: string, taskRef: string, beforeRef?: string): Promise<EpicMember> {
    const epicRef = normaliseEpicRef(ref);
    const tRef = normaliseTaskRef(taskRef);
    const all = await this.storage.epics.listTasks(epicRef);
    if (!all.some((m) => m.taskRef === tRef)) throw new ValidationError(`${tRef} is not in ${epicRef}`);
    const others = all.filter((m) => m.taskRef !== tRef);
    const rank = rankBefore(
      others.map((m) => m.rank),
      this.beforeRank(others, beforeRef),
    );
    const member = await this.storage.epics.moveTask(epicRef, tRef, rank);
    await publish(this.deps, [{ type: 'EpicChanged', ref: epicRef }]);
    return member;
  }

  async flagProject(ref: string, prefix: string): Promise<Epic> {
    const project = await this.storage.projects.get(prefix.toUpperCase());
    const epic = await this.storage.epics.flagProject(normaliseEpicRef(ref), project.id);
    await publish(this.deps, [{ type: 'EpicChanged', ref: epic.ref }]);
    return epic;
  }

  async unflagProject(ref: string, prefix: string): Promise<Epic> {
    const project = await this.storage.projects.get(prefix.toUpperCase());
    const epic = await this.storage.epics.unflagProject(normaliseEpicRef(ref), project.id);
    await publish(this.deps, [{ type: 'EpicChanged', ref: epic.ref }]);
    return epic;
  }

  async forProject(prefix: string): Promise<Epic[]> {
    const project = await this.storage.projects.get(prefix.toUpperCase());
    return this.storage.epics.listByProject(project.id);
  }

  async forTask(taskRef: string): Promise<Epic[]> {
    const task = await this.storage.tasks.get(normaliseTaskRef(taskRef));
    const epics = await Promise.all(task.epics.map((r) => this.storage.epics.get(r).catch(() => undefined)));
    return epics.filter((e): e is Epic => e !== undefined);
  }

  private beforeRank(members: EpicMember[], beforeRef: string | undefined): string | undefined {
    if (!beforeRef) return undefined;
    const ref = normaliseTaskRef(beforeRef);
    const before = members.find((m) => m.taskRef === ref);
    if (!before) throw new ValidationError(`${ref} is not another task in this epic`);
    return before.rank;
  }
}
