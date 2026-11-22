import { ValidationError } from '../errors.js';
import { newId } from '../ids.js';
import type { NewProject, ProjectPatch } from '../ports.js';
import { validatePrefix } from '../refs.js';
import type { Project, State } from '../types.js';
import { STATE_GROUPS } from '../types.js';
import type { ServiceDeps } from './common.js';

/** The states a new project gets when none are given (Plane's defaults). */
export function defaultStates(): State[] {
  return [
    { id: newId(), name: 'Backlog', group: 'backlog', order: 1 },
    { id: newId(), name: 'Todo', group: 'unstarted', order: 2 },
    { id: newId(), name: 'In progress', group: 'started', order: 3 },
    { id: newId(), name: 'Done', group: 'completed', order: 4 },
    { id: newId(), name: 'Cancelled', group: 'cancelled', order: 5 },
  ];
}

function validateStates(states: State[]): void {
  if (states.length === 0) throw new ValidationError('a project needs at least one state');
  for (const s of states) {
    if (!STATE_GROUPS.includes(s.group)) throw new ValidationError(`invalid state group ${s.group}`);
    if (!s.name.trim()) throw new ValidationError('a state needs a name');
  }
}

export class ProjectService {
  constructor(private readonly deps: ServiceDeps) {}

  async create(input: NewProject): Promise<Project> {
    validatePrefix(input.prefix);
    if (!input.name.trim()) throw new ValidationError('a project needs a name');
    const states = input.states ?? defaultStates();
    validateStates(states);
    return this.deps.storage.projects.create({ ...input, states });
  }

  list(includeArchived = false): Promise<Project[]> {
    return this.deps.storage.projects.list({ includeArchived });
  }

  get(prefix: string): Promise<Project> {
    return this.deps.storage.projects.get(prefix.toUpperCase());
  }

  async update(prefix: string, patch: ProjectPatch, expectedVersion: number): Promise<Project> {
    if (patch.states) validateStates(patch.states);
    if (patch.name !== undefined && !patch.name.trim()) throw new ValidationError('a project needs a name');
    return this.deps.storage.projects.update(prefix.toUpperCase(), patch, expectedVersion);
  }
}
