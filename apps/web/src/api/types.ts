/** JSON shapes from docs/api.md (mirroring packages/domain; the web bundle does not import the domain). */

export type StateGroup = 'backlog' | 'unstarted' | 'started' | 'completed' | 'cancelled';
export type Column = 'backlog' | 'up_next' | 'in_progress';
export type Priority = 'none' | 'low' | 'medium' | 'high' | 'urgent';
export type RelationType = 'blocks' | 'blocked_by' | 'relates_to' | 'duplicate_of';

export interface State {
  id: string;
  name: string;
  group: StateGroup;
  order: number;
}

export interface Project {
  id: string;
  prefix: string;
  name: string;
  description: string;
  states: State[];
  labels: string[];
  icon?: string;
  archived: boolean;
}

export interface ProjectSummary {
  id: string;
  prefix: string;
  name: string;
  icon?: string;
}

export interface Link {
  id: string;
  url: string;
  title?: string;
}

export interface Relation {
  type: RelationType;
  target: string;
}

export interface Task {
  id: string;
  ref: string;
  projectId: string;
  title: string;
  description: string;
  stateId: string;
  labels: string[];
  parent?: string;
  priority: Priority;
  points?: number;
  assignee?: 'martin' | 'claude' | 'bau' | 'purr3d';
  links: Link[];
  relations: Relation[];
  epics: string[];
  updatedAt: string;
}

export interface Comment {
  id: string;
  taskRef: string;
  body: string;
  author: string;
  createdAt: string;
}

export interface Epic {
  id: string;
  ref: string;
  name: string;
  description: string;
  state: 'open' | 'done' | 'archived';
  projectIds: string[];
}

/** `GET /api/tasks/{ref}`: `epics` here are full Epic objects, not the refs a plain Task carries. */
export type TaskDetailResponse = Omit<Task, 'epics'> & {
  project: ProjectSummary;
  state: State;
  comments: Comment[];
  children: Task[];
  epics: Epic[];
};

export interface EpicDetail extends Epic {
  projects: ProjectSummary[];
  tasks: (Task & { epicRank: string; projectPrefix: string })[];
}

export interface BoardCardView {
  kind: 'project' | 'epic';
  /** Project id or epic ref. */
  id: string;
  /** Project prefix or epic ref. */
  key: string;
  title: string;
  icon?: string;
  rank: string;
  points: number;
  tasks: Task[];
}

export interface BoardColumnView {
  column: Column;
  points: number;
  cards: BoardCardView[];
}

export interface BoardView {
  columns: BoardColumnView[];
}

export type SearchMode = 'hybrid' | 'semantic' | 'fulltext';

export interface SearchHit {
  kind: 'task' | 'comment' | 'epic';
  id: string;
  taskRef?: string;
  epicRef?: string;
  projectId?: string;
  title: string;
  snippet: string;
  score: number;
}
