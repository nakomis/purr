import { ConflictError, NotFoundError, ValidationError } from '../errors.js';
import { newId } from '../ids.js';
import type { NewTask, TaskPatch } from '../ports.js';
import { rankBefore } from '../rank.js';
import { normaliseTaskRef } from '../refs.js';
import type {
  Actor,
  Comment,
  Link,
  Priority,
  Project,
  RelationType,
  State,
  Task,
  TaskRef,
} from '../types.js';
import { PRIORITIES, RELATION_TYPES } from '../types.js';
import { publish, type ServiceDeps, withRetry } from './common.js';

export interface CreateTaskInput {
  title: string;
  description?: string;
  state?: string; // state id or name
  labels?: string[];
  parent?: TaskRef;
  priority?: Priority;
  points?: number;
}

/** Find a state by id, or by name case-insensitively. */
export function findState(project: Project, idOrName: string): State {
  const lower = idOrName.toLowerCase();
  const state =
    project.states.find((s) => s.id === idOrName) ??
    project.states.find((s) => s.name.toLowerCase() === lower);
  if (!state) throw new ValidationError(`project ${project.prefix} has no state ${JSON.stringify(idOrName)}`);
  return state;
}

/** Where a new task starts: the first backlog state, else the first unstarted, else the first state. */
export function defaultState(project: Project): State {
  const byOrder = [...project.states].sort((a, b) => a.order - b.order);
  return (byOrder.find((s) => s.group === 'backlog') ??
    byOrder.find((s) => s.group === 'unstarted') ??
    byOrder[0]) as State;
}

function validatePoints(points: number | undefined): void {
  if (points !== undefined && (!Number.isFinite(points) || points < 0 || points > 1000)) {
    throw new ValidationError('points must be a number from 0 to 1000');
  }
}

function validatePriority(priority: Priority | undefined): void {
  if (priority !== undefined && !PRIORITIES.includes(priority)) {
    throw new ValidationError(`invalid priority ${priority}`);
  }
}

export class TaskService {
  constructor(private readonly deps: ServiceDeps) {}

  private get storage() {
    return this.deps.storage;
  }

  get(ref: string): Promise<Task> {
    return this.storage.tasks.get(normaliseTaskRef(ref));
  }

  async create(prefix: string, input: CreateTaskInput, actor: Actor): Promise<Task> {
    if (!input.title?.trim()) throw new ValidationError('a task needs a title');
    validatePoints(input.points);
    validatePriority(input.priority);
    const project = await this.storage.projects.get(prefix.toUpperCase());
    const state = input.state ? findState(project, input.state) : defaultState(project);
    const labels = await this.ensureLabels(project, input.labels ?? []);
    const parent = input.parent ? normaliseTaskRef(input.parent) : undefined;
    if (parent) await this.storage.tasks.get(parent);
    const newTask: NewTask = {
      projectId: project.id,
      title: input.title.trim(),
      description: input.description ?? '',
      stateId: state.id,
      labels,
      priority: input.priority ?? 'none',
      ...(parent ? { parent } : {}),
      ...(input.points !== undefined ? { points: input.points } : {}),
    };
    const task = await this.storage.tasks.create(newTask, actor);
    await publish(this.deps, [{ type: 'TaskChanged', ref: task.ref }]);
    return task;
  }

  async update(
    ref: string,
    patch: Omit<TaskPatch, 'stateId'> & { state?: string },
    expectedVersion: number,
    actor: Actor,
  ): Promise<Task> {
    const current = await this.get(ref);
    const project = await this.storage.projects.getById(current.projectId);
    const { state, ...rest } = patch;
    const change: TaskPatch = { ...rest };
    if (rest.title !== undefined) {
      if (!rest.title.trim()) throw new ValidationError('a task needs a title');
      change.title = rest.title.trim();
    }
    validatePoints(rest.points);
    validatePriority(rest.priority);
    if (state !== undefined) change.stateId = findState(project, state).id;
    if (rest.labels) change.labels = await this.ensureLabels(project, rest.labels);
    if (rest.parent) {
      change.parent = normaliseTaskRef(rest.parent);
      if (change.parent === current.ref) throw new ValidationError('a task cannot be its own parent');
      await this.storage.tasks.get(change.parent);
    }
    const task = await this.storage.tasks.update(current.ref, change, expectedVersion, actor);
    await publish(this.deps, [{ type: 'TaskChanged', ref: task.ref }]);
    return task;
  }

  /** Move to a state (by id or name) whatever the current version: state changes are absolute. */
  async setState(ref: string, state: string, actor: Actor): Promise<Task> {
    const task = await withRetry(async () => {
      const current = await this.get(ref);
      const project = await this.storage.projects.getById(current.projectId);
      const target = findState(project, state);
      if (current.stateId === target.id) return current;
      return this.storage.tasks.update(current.ref, { stateId: target.id }, current.version, actor);
    });
    await publish(this.deps, [{ type: 'TaskChanged', ref: task.ref }]);
    return task;
  }

  /** Into the project's first 'started' state by order. Conflict if the project has none. */
  async pickUp(ref: string, actor: Actor): Promise<Task> {
    const current = await this.get(ref);
    const project = await this.storage.projects.getById(current.projectId);
    const started = [...project.states].sort((a, b) => a.order - b.order).find((s) => s.group === 'started');
    if (!started) throw new ConflictError(`project ${project.prefix} has no started state`);
    return this.setState(current.ref, started.id, actor);
  }

  async setPoints(ref: string, points: number | undefined, actor: Actor): Promise<Task> {
    validatePoints(points);
    const task = await withRetry(async () => {
      const current = await this.get(ref);
      return this.storage.tasks.update(current.ref, { points }, current.version, actor);
    });
    await publish(this.deps, [{ type: 'TaskChanged', ref: task.ref }]);
    return task;
  }

  async addLabel(ref: string, label: string, actor: Actor): Promise<Task> {
    const name = label.trim();
    if (!name) throw new ValidationError('a label needs a name');
    const task = await withRetry(async () => {
      const current = await this.get(ref);
      if (current.labels.includes(name)) return current;
      const project = await this.storage.projects.getById(current.projectId);
      const [labelName] = await this.ensureLabels(project, [name]);
      return this.storage.tasks.update(
        current.ref,
        { labels: [...current.labels, labelName as string] },
        current.version,
        actor,
      );
    });
    await publish(this.deps, [{ type: 'TaskChanged', ref: task.ref }]);
    return task;
  }

  async removeLabel(ref: string, label: string, actor: Actor): Promise<Task> {
    const task = await withRetry(async () => {
      const current = await this.get(ref);
      if (!current.labels.includes(label)) return current;
      return this.storage.tasks.update(
        current.ref,
        { labels: current.labels.filter((l) => l !== label) },
        current.version,
        actor,
      );
    });
    await publish(this.deps, [{ type: 'TaskChanged', ref: task.ref }]);
    return task;
  }

  async addLink(ref: string, url: string, title: string | undefined, actor: Actor): Promise<Link> {
    try {
      new URL(url);
    } catch {
      throw new ValidationError(`invalid URL ${JSON.stringify(url)}`);
    }
    const link: Link = { id: newId(), url, ...(title ? { title } : {}) };
    const task = await withRetry(async () => {
      const current = await this.get(ref);
      return this.storage.tasks.update(
        current.ref,
        { links: [...current.links, link] },
        current.version,
        actor,
      );
    });
    await publish(this.deps, [{ type: 'TaskChanged', ref: task.ref }]);
    return link;
  }

  async removeLink(ref: string, linkId: string, actor: Actor): Promise<Task> {
    const task = await withRetry(async () => {
      const current = await this.get(ref);
      if (!current.links.some((l) => l.id === linkId))
        throw new NotFoundError(`no link ${linkId} on ${current.ref}`);
      return this.storage.tasks.update(
        current.ref,
        { links: current.links.filter((l) => l.id !== linkId) },
        current.version,
        actor,
      );
    });
    await publish(this.deps, [{ type: 'TaskChanged', ref: task.ref }]);
    return task;
  }

  async setParent(ref: string, parent: string | undefined, actor: Actor): Promise<Task> {
    const parentRef = parent ? normaliseTaskRef(parent) : undefined;
    const task = await withRetry(async () => {
      const current = await this.get(ref);
      if (parentRef === current.ref) throw new ValidationError('a task cannot be its own parent');
      if (parentRef) {
        // Refuse a cycle: walk up from the new parent.
        let walk: TaskRef | undefined = parentRef;
        for (let depth = 0; walk && depth < 50; depth++) {
          if (walk === current.ref) throw new ValidationError('that parent would create a cycle');
          walk = (await this.storage.tasks.get(walk)).parent;
        }
      }
      return this.storage.tasks.update(current.ref, { parent: parentRef }, current.version, actor);
    });
    await publish(this.deps, [{ type: 'TaskChanged', ref: task.ref }]);
    return task;
  }

  children(ref: string): Promise<Task[]> {
    return this.storage.tasks.listChildren(normaliseTaskRef(ref));
  }

  async addRelation(ref: string, type: RelationType, target: string, actor: Actor): Promise<void> {
    if (!RELATION_TYPES.includes(type)) throw new ValidationError(`invalid relation type ${type}`);
    const a = normaliseTaskRef(ref);
    const b = normaliseTaskRef(target);
    if (a === b) throw new ValidationError('a task cannot relate to itself');
    await this.storage.tasks.get(a);
    await this.storage.tasks.get(b);
    await this.storage.tasks.addRelation(a, type, b, actor);
    await publish(this.deps, [
      { type: 'TaskChanged', ref: a },
      { type: 'TaskChanged', ref: b },
    ]);
  }

  async removeRelation(ref: string, type: RelationType, target: string, actor: Actor): Promise<void> {
    const a = normaliseTaskRef(ref);
    const b = normaliseTaskRef(target);
    await this.storage.tasks.removeRelation(a, type, b, actor);
    await publish(this.deps, [
      { type: 'TaskChanged', ref: a },
      { type: 'TaskChanged', ref: b },
    ]);
  }

  /** Move a task within its project's ordering: before `beforeRef`, or to the end. */
  async moveInProject(ref: string, beforeRef: string | undefined, actor: Actor): Promise<Task> {
    const task = await this.get(ref);
    const siblings = (await this.allInProject(task.projectId)).filter((t) => t.ref !== task.ref);
    const ranks = siblings.map((t) => t.projectRank);
    let beforeRank: string | undefined;
    if (beforeRef) {
      const before = siblings.find((t) => t.ref === normaliseTaskRef(beforeRef));
      if (!before) throw new ValidationError(`${beforeRef} is not another task in this project`);
      beforeRank = before.projectRank;
    }
    const moved = await this.storage.tasks.moveInProject(task.ref, rankBefore(ranks, beforeRank), actor);
    await publish(this.deps, [{ type: 'TaskChanged', ref: moved.ref }]);
    return moved;
  }

  async allInProject(projectId: string, stateIds?: string[]): Promise<Task[]> {
    const out: Task[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.storage.tasks.listByProject(projectId, {
        limit: 500,
        ...(cursor ? { cursor } : {}),
        ...(stateIds ? { stateIds } : {}),
      });
      out.push(...page.items);
      cursor = page.cursor;
    } while (cursor);
    return out;
  }

  async addComment(ref: string, body: string, actor: Actor): Promise<Comment> {
    if (!body.trim()) throw new ValidationError('a comment needs a body');
    const task = await this.get(ref);
    const comment = await this.storage.comments.add(task.ref, body, actor);
    await publish(this.deps, [{ type: 'CommentAdded', taskRef: task.ref, commentId: comment.id }]);
    return comment;
  }

  /** Labels are per project; ones a caller names that don't exist yet are added to the project. */
  private async ensureLabels(project: Project, labels: string[]): Promise<string[]> {
    const wanted = [...new Set(labels.map((l) => l.trim()).filter(Boolean))];
    const missing = wanted.filter((l) => !project.labels.includes(l));
    if (missing.length > 0) {
      await withRetry(async () => {
        const fresh = await this.storage.projects.getById(project.id);
        const add = missing.filter((l) => !fresh.labels.includes(l));
        if (add.length === 0) return fresh;
        return this.storage.projects.update(
          fresh.prefix,
          { labels: [...fresh.labels, ...add] },
          fresh.version,
        );
      });
    }
    return wanted;
  }
}
