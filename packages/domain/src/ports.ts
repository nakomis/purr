/**
 * Port interfaces: everything the domain needs from storage and search, shaped by
 * use rather than as generic CRUD (design section 6). Each method is one thing the
 * app needs, so each maps cleanly onto one DynamoDB operation or one SQL statement.
 *
 * Contracts every adapter must honour (proven by @purr/contracts):
 * - Methods that write several records do so atomically.
 * - Cursors are opaque strings; callers never parse them.
 * - Failures surface as the domain errors in errors.ts, never adapter exceptions.
 * - get/getById/getMany and the board are read-after-write; lists and search may lag.
 */
import type {
  Activity,
  Actor,
  Assignee,
  BoardCard,
  Comment,
  Epic,
  EpicMember,
  EpicRef,
  Page,
  Priority,
  Project,
  ProjectMetadata,
  Rank,
  RelationType,
  State,
  Task,
  TaskRef,
} from './types.js';

export interface NewProject {
  prefix: string;
  name: string;
  description?: string;
  states?: State[];
  labels?: string[];
  metadata?: Partial<ProjectMetadata>;
  icon?: string;
  archived?: boolean;
  createdAt?: string;
}

export type ProjectPatch = Partial<
  Pick<Project, 'name' | 'description' | 'states' | 'labels' | 'metadata' | 'icon' | 'archived'>
>;

export interface ProjectRepository {
  /** Throws AlreadyExists if the prefix is taken. */
  create(input: NewProject): Promise<Project>;
  /** Throws NotFound. */
  get(prefix: string): Promise<Project>;
  getById(id: string): Promise<Project>;
  list(opts?: { includeArchived?: boolean }): Promise<Project[]>;
  /** Throws VersionMismatch if expectedVersion is stale. */
  update(prefix: string, patch: ProjectPatch, expectedVersion: number): Promise<Project>;
}

export interface NewTask {
  projectId: string;
  title: string;
  description?: string;
  stateId?: string;
  labels?: string[];
  parent?: TaskRef;
  priority?: Priority;
  points?: number;
  assignee?: Assignee;
  projectRank?: Rank;
  /** Migration only: keep Plane's numbering and timestamps. */
  sequence?: number;
  createdAt?: string;
  updatedAt?: string;
}

export type TaskPatch = Partial<
  Pick<
    Task,
    'title' | 'description' | 'stateId' | 'labels' | 'parent' | 'priority' | 'points' | 'assignee' | 'links'
  >
>;

export interface TaskListOptions {
  stateIds?: string[];
  label?: string;
  /** Only tasks assigned to this actor, or with 'none', only unassigned ones. */
  assignee?: Assignee | 'none';
  limit?: number;
  cursor?: string;
}

export interface TaskRepository {
  /**
   * Allocates the project's next sequence atomically, or uses input.sequence and
   * raises the counter to at least it (AlreadyExists if that ref is taken). The
   * rank defaults to the end of the project. Writes a 'created' activity record.
   */
  create(input: NewTask, actor: Actor): Promise<Task>;
  get(ref: TaskRef): Promise<Task>;
  /** Missing refs are omitted; order follows the input. */
  getMany(refs: TaskRef[]): Promise<Task[]>;
  /** In projectRank order. */
  listByProject(projectId: string, opts?: TaskListOptions): Promise<Page<Task>>;
  listChildren(parent: TaskRef): Promise<Task[]>;
  /** Throws VersionMismatch if stale. Writes an activity record of the changed fields. */
  update(ref: TaskRef, patch: TaskPatch, expectedVersion: number, actor: Actor): Promise<Task>;
  moveInProject(ref: TaskRef, rank: Rank, actor: Actor): Promise<Task>;
  /** Writes the inverse relation on the target in the same atomic write; idempotent. */
  addRelation(ref: TaskRef, type: RelationType, target: TaskRef, actor: Actor): Promise<void>;
  removeRelation(ref: TaskRef, type: RelationType, target: TaskRef, actor: Actor): Promise<void>;
}

export interface CommentRepository {
  add(taskRef: TaskRef, body: string, author: Actor, at?: string): Promise<Comment>;
  /** Oldest first. */
  list(taskRef: TaskRef, opts?: { limit?: number; cursor?: string }): Promise<Page<Comment>>;
}

export interface NewEpic {
  name: string;
  description?: string;
  state?: Epic['state'];
  createdAt?: string;
}

export type EpicPatch = Partial<Pick<Epic, 'name' | 'description' | 'state'>>;

export interface EpicRepository {
  /** Allocates EPIC-n from a single counter. */
  create(input: NewEpic, actor: Actor): Promise<Epic>;
  get(ref: EpicRef): Promise<Epic>;
  list(opts?: { includeArchived?: boolean }): Promise<Epic[]>;
  update(ref: EpicRef, patch: EpicPatch, expectedVersion: number): Promise<Epic>;
  /**
   * Atomically: the membership, the task's epics list and the epic's project flag.
   * Idempotent: an existing membership is returned unchanged. Rank defaults to the end.
   */
  addTask(epicRef: EpicRef, taskRef: TaskRef, rank?: Rank): Promise<EpicMember>;
  /** The project flag is kept. NotFound if the task isn't a member. */
  removeTask(epicRef: EpicRef, taskRef: TaskRef): Promise<void>;
  moveTask(epicRef: EpicRef, taskRef: TaskRef, rank: Rank): Promise<EpicMember>;
  /** In rank order. */
  listTasks(epicRef: EpicRef): Promise<EpicMember[]>;
  /** Idempotent. */
  flagProject(epicRef: EpicRef, projectId: string): Promise<Epic>;
  /** Throws Conflict if the epic still holds tasks from that project. */
  unflagProject(epicRef: EpicRef, projectId: string): Promise<Epic>;
  listByProject(projectId: string): Promise<Epic[]>;
}

export interface BoardRepository {
  list(): Promise<BoardCard[]>;
  /** Insert or replace the card with this kind and id. */
  put(card: BoardCard): Promise<void>;
  remove(kind: BoardCard['kind'], id: string): Promise<void>;
}

export interface ActivityRepository {
  /** Oldest first. */
  list(taskRef: TaskRef): Promise<Activity[]>;
}

export interface ApiKeyRecord {
  id: string;
  actor: Actor;
  /** SHA-256 of the key, hex. The key itself is never stored. */
  hash: string;
  createdAt: string;
}

export interface ApiKeyRepository {
  findByHash(hash: string): Promise<ApiKeyRecord | undefined>;
  put(record: ApiKeyRecord): Promise<void>;
}

export interface Storage {
  projects: ProjectRepository;
  tasks: TaskRepository;
  comments: CommentRepository;
  epics: EpicRepository;
  board: BoardRepository;
  activity: ActivityRepository;
  apiKeys: ApiKeyRepository;
}

// ── Search ────────────────────────────────────────────────────────────────────

export type SearchKind = 'task' | 'comment' | 'epic';
export type SearchMode = 'hybrid' | 'semantic' | 'fulltext';

export interface SearchQuery {
  text: string;
  mode: SearchMode;
  projectId?: string;
  epicRef?: EpicRef;
  kinds?: SearchKind[];
  limit?: number;
}

export interface SearchHit {
  kind: SearchKind;
  /** Task ref, comment id or epic ref. */
  id: string;
  taskRef?: TaskRef;
  epicRef?: EpicRef;
  projectId?: string;
  title: string;
  snippet: string;
  score: number;
}

export interface SearchIndex {
  /** An empty result, never an error, when no index has been built yet. */
  query(q: SearchQuery): Promise<SearchHit[]>;
}

export interface Embedder {
  readonly model: string;
  readonly dimensions: number;
  /** One normalised vector per input text, in order. */
  embed(texts: string[]): Promise<Float32Array[]>;
}
