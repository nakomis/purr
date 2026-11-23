/** The slice of the API's JSON shapes the MCP server reads (see docs/api.md). */

export interface State {
  id: string;
  name: string;
  group: string;
  order: number;
}

export interface Link {
  id: string;
  url: string;
  title?: string;
}

export interface Relation {
  type: string;
  target: string;
}

export interface Task {
  id: string;
  ref: string;
  title: string;
  description: string;
  stateId: string;
  labels: string[];
  parent?: string;
  priority: string;
  points?: number;
  assignee?: string;
  links: Link[];
  relations: Relation[];
  epics: string[];
  version: number;
}

export interface Comment {
  id: string;
  body: string;
  author: string;
  createdAt: string;
}

export interface ProjectRef {
  id: string;
  prefix: string;
  name: string;
  icon?: string;
}

export interface Epic {
  id: string;
  ref: string;
  name: string;
  description: string;
  state: string;
  projectIds: string[];
  version: number;
}

export interface TaskDetail extends Omit<Task, 'epics'> {
  project: ProjectRef;
  state: State;
  comments: Comment[];
  children: Task[];
  epics: Epic[];
}

export interface Project extends ProjectRef {
  description: string;
  states: State[];
  labels: string[];
  metadata: { repo?: string; deployMethod?: string; deployAction?: string; bauEnabled?: boolean };
  archived: boolean;
  version: number;
}

export interface EpicDetail extends Omit<Epic, 'projectIds'> {
  projects: ProjectRef[];
  tasks: (Task & { epicRank: string; projectPrefix: string })[];
}

export interface BoardCardView {
  kind: 'project' | 'epic';
  id: string;
  key: string;
  title: string;
  points: number;
  tasks: Task[];
}

export interface BoardView {
  columns: { column: string; points: number; cards: BoardCardView[] }[];
}

export interface SearchHit {
  kind: string;
  id: string;
  taskRef?: string;
  epicRef?: string;
  title: string;
  snippet: string;
  score: number;
}
