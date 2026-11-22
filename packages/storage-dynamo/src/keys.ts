/**
 * Key builders for the single table. Every key the adapter reads or writes is made
 * here, so the layout in the README has one implementation.
 *
 * Sort keys that embed a rank rely on ranks being alphanumeric (rank.ts), which
 * all sort after '#', so `<rank>#<tiebreak>` orders exactly as the rank does.
 */
import type { EpicRef, Rank, TaskRef } from '@purr/domain';

export interface Key {
  PK: string;
  SK: string;
}

export interface IndexKey {
  GSI1PK: string;
  GSI1SK: string;
}

export const META = 'META';

/** Zero-pads so that numbers sort numerically as strings. */
export function pad(n: number, width = 10): string {
  return String(n).padStart(width, '0');
}

export const keys = {
  // Projects
  project: (id: string): Key => ({ PK: `PROJECT#${id}`, SK: META }),
  prefix: (prefix: string): Key => ({ PK: `PREFIX#${prefix}`, SK: META }),
  projectIndex: (prefix: string): IndexKey => ({ GSI1PK: 'PROJECTS', GSI1SK: prefix }),
  projectCounter: (projectId: string): Key => ({ PK: `COUNTER#${projectId}`, SK: META }),

  // Tasks
  task: (ref: TaskRef): Key => ({ PK: `TASK#${ref}`, SK: META }),
  taskIndex: (projectId: string, rank: Rank, sequence: number): IndexKey => ({
    GSI1PK: `PROJECT#${projectId}#TASKS`,
    GSI1SK: `${rank}#${pad(sequence)}`,
  }),
  projectTasksPartition: (projectId: string): string => `PROJECT#${projectId}#TASKS`,
  child: (parent: TaskRef, child: TaskRef, sequence: number): Key => ({
    PK: `TASK#${parent}`,
    SK: `CHILD#${pad(sequence)}#${child}`,
  }),
  childPrefix: 'CHILD#',

  // Comments and activity
  comment: (ref: TaskRef, createdAt: string, id: string): Key => ({
    PK: `TASK#${ref}`,
    SK: `COMMENT#${createdAt}#${id}`,
  }),
  commentPrefix: 'COMMENT#',
  activityPartition: (ref: TaskRef): string => `TASK#${ref}#ACTIVITY`,
  activity: (ref: TaskRef, at: string, id: string): Key => ({
    PK: `TASK#${ref}#ACTIVITY`,
    SK: `${at}#${id}`,
  }),

  // Epics
  epic: (ref: EpicRef): Key => ({ PK: `EPIC#${ref}`, SK: META }),
  epicIndex: (ref: EpicRef): IndexKey => ({
    GSI1PK: 'EPICS',
    GSI1SK: pad(Number(ref.slice(ref.indexOf('-') + 1))),
  }),
  epicCounter: (): Key => ({ PK: 'COUNTER#EPIC', SK: META }),
  member: (epic: EpicRef, task: TaskRef): Key => ({ PK: `EPIC#${epic}`, SK: `MEMBER#${task}` }),
  memberIndex: (epic: EpicRef, task: TaskRef, rank: Rank): IndexKey => ({
    GSI1PK: `EPIC#${epic}#MEMBERS`,
    GSI1SK: `${rank}#${task}`,
  }),
  memberPartition: (epic: EpicRef): string => `EPIC#${epic}#MEMBERS`,

  // Board and API keys
  board: (kind: string, id: string): Key => ({ PK: 'BOARD', SK: `${kind}#${id}` }),
  apiKey: (hash: string): Key => ({ PK: `APIKEY#${hash}`, SK: META }),
} as const;
