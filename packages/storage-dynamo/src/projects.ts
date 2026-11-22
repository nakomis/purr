import {
  AlreadyExistsError,
  type NewProject,
  NotFoundError,
  newId,
  nowIso,
  type Project,
  type ProjectPatch,
  type ProjectRepository,
  VersionMismatchError,
} from '@purr/domain';
import { fromItem, toItem } from './codec.js';
import { cond, type Db, isConditionalFailure } from './db.js';
import { keys } from './keys.js';

const projectItem = (p: Project) => toItem(p, keys.project(p.id), keys.projectIndex(p.prefix));

export async function loadProjectById(db: Db, id: string): Promise<Project> {
  const item = await db.get(keys.project(id));
  if (!item) throw new NotFoundError(`no project ${id}`);
  return fromItem<Project>(item);
}

async function loadProjectByPrefix(db: Db, prefix: string): Promise<Project> {
  const lookup = await db.get(keys.prefix(prefix));
  if (!lookup) throw new NotFoundError(`no project ${prefix}`);
  return loadProjectById(db, lookup.projectId as string);
}

export function projectRepository(db: Db): ProjectRepository {
  return {
    async create(input: NewProject) {
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
      await db.transact([
        {
          put: toItem({ prefix: input.prefix, projectId: project.id }, keys.prefix(input.prefix)),
          condition: cond.notExists(),
          fail: () => new AlreadyExistsError(`project ${input.prefix} exists`),
        },
        { put: projectItem(project), condition: cond.notExists() },
      ]);
      return project;
    },

    get: (prefix) => loadProjectByPrefix(db, prefix),
    getById: (id) => loadProjectById(db, id),

    async list(opts = {}) {
      const items = await db.queryAll({
        attribute: 'GSI1PK',
        partition: keys.projectIndex('').GSI1PK,
        accept: (i) => opts.includeArchived === true || i.archived !== true,
      });
      return items.map((i) => fromItem<Project>(i));
    },

    async update(prefix, patch: ProjectPatch, expectedVersion) {
      const p = await loadProjectByPrefix(db, prefix);
      if (p.version !== expectedVersion) throw new VersionMismatchError(`project ${prefix} has changed`);
      const next: Project = { ...p, ...patch, version: p.version + 1, updatedAt: nowIso() };
      if (patch.metadata) next.metadata = { ...p.metadata, ...patch.metadata };
      try {
        await db.put(projectItem(next), cond.versionIs(expectedVersion));
      } catch (e) {
        if (isConditionalFailure(e)) throw new VersionMismatchError(`project ${prefix} has changed`);
        throw e;
      }
      return next;
    },
  };
}
