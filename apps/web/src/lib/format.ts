import type { Project, State, StateGroup, Task } from '../api/types';

export const GROUP_TITLES: Record<StateGroup, string> = {
  backlog: 'Backlog',
  unstarted: 'To do',
  started: 'In progress',
  completed: 'Done',
  cancelled: 'Cancelled',
};

export const GROUP_ORDER: StateGroup[] = ['started', 'unstarted', 'backlog', 'completed', 'cancelled'];

export const formatPoints = (points?: number) =>
  points === undefined ? '' : `${points} pt${points === 1 ? '' : 's'}`;

export const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

export const RELATION_LABELS: Record<string, string> = {
  blocks: 'Blocks',
  blocked_by: 'Blocked by',
  relates_to: 'Relates to',
  duplicate_of: 'Duplicate of',
};

/** Resolves a task's state from its project, as board and epic payloads carry only a state id. */
export function stateIndex(projects: Project[]) {
  const byProject = new Map<string, Map<string, State>>();
  for (const project of projects) byProject.set(project.id, new Map(project.states.map((s) => [s.id, s])));
  return {
    stateOf: (task: Pick<Task, 'projectId' | 'stateId'>): State | undefined =>
      byProject.get(task.projectId)?.get(task.stateId),
    projectById: new Map(projects.map((p) => [p.id, p])),
    projectByPrefix: new Map(projects.map((p) => [p.prefix, p])),
  };
}

export type StateIndex = ReturnType<typeof stateIndex>;
