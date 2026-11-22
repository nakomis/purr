import type { EpicRef, SearchKind, TaskRef } from '@purr/domain';

/**
 * One searchable document: a task, a comment or an epic. Lives here (rather than in
 * @purr/search) so the search contract can describe its inputs without a cycle.
 */
export interface IndexedDoc {
  kind: SearchKind;
  /** Task ref, comment id or epic ref. */
  id: string;
  taskRef?: TaskRef;
  /** For an epic, its own ref. */
  epicRef?: EpicRef;
  projectId?: string;
  /** For an epic, the projects it covers (so the project filter finds epics too). */
  projectIds?: string[];
  /** For a task or comment, the epics its task belongs to, so the epic filter works. */
  epicRefs?: EpicRef[];
  title: string;
  text: string;
  updatedAt: string;
}
