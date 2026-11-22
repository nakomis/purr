import { api } from './client';
import type {
  BoardView,
  Column,
  Epic,
  EpicDetail,
  Project,
  SearchHit,
  SearchMode,
  Task,
  TaskDetailResponse,
} from './types';

const enc = encodeURIComponent;

export const getProjects = async (): Promise<Project[]> =>
  (await api<{ items: Project[] }>('/projects')).items;

export const getProject = (prefix: string) => api<Project>(`/projects/${enc(prefix)}`);

/** Every task of a project, open and closed, in project order (follows the pagination cursor). */
export async function getProjectTasks(prefix: string): Promise<Task[]> {
  const tasks: Task[] = [];
  let cursor: string | undefined;
  do {
    const query = `all=true&limit=200${cursor ? `&cursor=${enc(cursor)}` : ''}`;
    const page = await api<{ items: Task[]; cursor?: string }>(`/projects/${enc(prefix)}/tasks?${query}`);
    tasks.push(...page.items);
    cursor = page.cursor;
  } while (cursor);
  return tasks;
}

export const getEpics = async (): Promise<Epic[]> => (await api<{ items: Epic[] }>('/epics')).items;

export const getEpic = (ref: string) => api<EpicDetail>(`/epics/${enc(ref)}`);

export const getTask = (ref: string) => api<TaskDetailResponse>(`/tasks/${enc(ref)}`);

export const getBoard = () => api<BoardView>('/board');

export interface MoveRequest {
  kind: 'project' | 'epic';
  id: string;
  column: Column;
  before?: string;
}

/** The UI's only write: place a board card in a column, before another card or at the end. */
export const moveCard = (request: MoveRequest) =>
  api<unknown>('/board/move', { method: 'POST', body: request });

export async function search(q: string, mode: SearchMode): Promise<SearchHit[]> {
  const response = await api<{ items: SearchHit[] }>(`/search?q=${enc(q)}&mode=${mode}`);
  return response.items;
}
