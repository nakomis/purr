/** Storage-neutral domain types (design section 4). */

export type TaskRef = string; // "HOME-42": `${prefix}-${sequence}`
export type EpicRef = string; // "EPIC-7"
export type Rank = string; // lexicographic; see rank.ts
export type Actor = 'martin' | 'claude' | 'bau' | 'system';
export type StateGroup = 'backlog' | 'unstarted' | 'started' | 'completed' | 'cancelled';
export type Column = 'backlog' | 'up_next' | 'in_progress';
export type Priority = 'none' | 'low' | 'medium' | 'high' | 'urgent';
export type RelationType = 'blocks' | 'blocked_by' | 'relates_to' | 'duplicate_of';

export const ACTORS: readonly Actor[] = ['martin', 'claude', 'bau', 'system'];
export const STATE_GROUPS: readonly StateGroup[] = [
  'backlog',
  'unstarted',
  'started',
  'completed',
  'cancelled',
];
export const COLUMNS: readonly Column[] = ['backlog', 'up_next', 'in_progress'];
export const PRIORITIES: readonly Priority[] = ['none', 'low', 'medium', 'high', 'urgent'];
export const RELATION_TYPES: readonly RelationType[] = ['blocks', 'blocked_by', 'relates_to', 'duplicate_of'];

/** The relation written on the other task when one is added. */
export const INVERSE_RELATION: Record<RelationType, RelationType> = {
  blocks: 'blocked_by',
  blocked_by: 'blocks',
  relates_to: 'relates_to',
  duplicate_of: 'duplicate_of',
};

export interface State {
  id: string;
  name: string;
  group: StateGroup;
  order: number;
}

export interface ProjectMetadata {
  repo?: string;
  deployMethod?: string;
  deployAction?: string;
  bauEnabled: boolean;
}

export interface Project {
  id: string;
  prefix: string;
  name: string;
  description: string;
  states: State[];
  labels: string[];
  metadata: ProjectMetadata;
  icon?: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface Link {
  id: string;
  url: string;
  title?: string;
}

export interface Relation {
  type: RelationType;
  target: TaskRef;
}

export interface Task {
  id: string;
  ref: TaskRef;
  projectId: string;
  sequence: number;
  projectRank: Rank;
  title: string;
  description: string;
  stateId: string;
  labels: string[];
  parent?: TaskRef;
  priority: Priority;
  points?: number;
  links: Link[];
  relations: Relation[];
  epics: EpicRef[];
  createdBy: Actor;
  createdAt: string;
  updatedBy: Actor;
  updatedAt: string;
  version: number;
}

export interface Comment {
  id: string;
  taskRef: TaskRef;
  body: string;
  author: Actor;
  createdAt: string;
}

export type EpicState = 'open' | 'done' | 'archived';

export interface Epic {
  id: string;
  ref: EpicRef;
  name: string;
  description: string;
  state: EpicState;
  /** The projects this epic covers (design: flagged projects). */
  projectIds: string[];
  createdBy: Actor;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface EpicMember {
  epicRef: EpicRef;
  taskRef: TaskRef;
  rank: Rank;
}

export interface BoardCard {
  kind: 'project' | 'epic';
  /** A project id, or an epic ref. */
  id: string;
  column: Column;
  rank: Rank;
}

export interface Activity {
  id: string;
  taskRef: TaskRef;
  actor: Actor;
  action: string;
  changes: Record<string, { from: unknown; to: unknown }>;
  at: string;
}

export interface Page<T> {
  items: T[];
  cursor?: string;
}

/** Completed and cancelled tasks are closed; everything else is open. */
export function isOpenGroup(group: StateGroup): boolean {
  return group !== 'completed' && group !== 'cancelled';
}
