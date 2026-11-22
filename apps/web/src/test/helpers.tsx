import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';
import { AppRoutes } from '../App';
import { configureApiAuth } from '../api/client';
import type { BoardView, Project, Task } from '../api/types';

type Handler = unknown | ((url: URL, init?: RequestInit) => unknown);

/** Stubs fetch: routes are matched by path (without query) or `METHOD path`; unknown paths are 404s. */
export function mockFetch(routes: Record<string, Handler>) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const method = init?.method ?? 'GET';
    const key = [`${method} ${url.pathname}`, url.pathname].find((k) => k in routes);
    if (key === undefined) {
      return new Response(
        JSON.stringify({ error: { code: 'NOT_FOUND', message: `no mock for ${url.pathname}` } }),
        {
          status: 404,
        },
      );
    }
    const handler = routes[key];
    const body = typeof handler === 'function' ? handler(url, init) : handler;
    if (body instanceof Response) return body;
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

export function renderAt(path: string) {
  configureApiAuth({ getToken: () => 'id-token', onUnauthorised: () => {} });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>,
  );
}

export const task = (over: Partial<Task> & Pick<Task, 'ref'>): Task => ({
  id: over.ref,
  projectId: 'p-home',
  title: `Task ${over.ref}`,
  description: '',
  stateId: 's-todo',
  labels: [],
  priority: 'none',
  links: [],
  relations: [],
  epics: [],
  updatedAt: '2026-11-20T10:00:00Z',
  ...over,
});

export const project = (over: Partial<Project> & Pick<Project, 'prefix'>): Project => ({
  id: `p-${over.prefix.toLowerCase()}`,
  name: over.prefix,
  description: '',
  labels: [],
  archived: false,
  states: [
    { id: 's-todo', name: 'Todo', group: 'unstarted', order: 1 },
    { id: 's-doing', name: 'Doing', group: 'started', order: 2 },
    { id: 's-done', name: 'Done', group: 'completed', order: 3 },
  ],
  ...over,
});

export const homeProject = project({ prefix: 'HOME', id: 'p-home', name: 'Home', icon: '/icons/HOME.png' });
export const plainProject = project({ prefix: 'ZZZ', id: 'p-zzz', name: 'Zed' });

export const board: BoardView = {
  columns: [
    {
      column: 'backlog',
      points: 3,
      cards: [
        {
          kind: 'project',
          id: 'p-zzz',
          key: 'ZZZ',
          title: 'Zed',
          rank: 'a',
          points: 3,
          tasks: [task({ ref: 'ZZZ-1', projectId: 'p-zzz', points: 3 })],
        },
      ],
    },
    {
      column: 'up_next',
      points: 5,
      cards: [
        {
          kind: 'epic',
          id: 'EPIC-1',
          key: 'EPIC-1',
          title: 'Spring clean',
          rank: 'a',
          points: 5,
          tasks: [task({ ref: 'HOME-1', points: 5 })],
        },
      ],
    },
    {
      column: 'in_progress',
      points: 8,
      cards: [
        {
          kind: 'project',
          id: 'p-home',
          key: 'HOME',
          title: 'Home',
          icon: '/icons/HOME.png',
          rank: 'a',
          points: 8,
          tasks: [task({ ref: 'HOME-2', points: 8, stateId: 's-doing' })],
        },
      ],
    },
  ],
};
