import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EpicDetail, TaskDetailResponse } from '../api/types';
import { board, homeProject, mockFetch, plainProject, renderAt, task } from '../test/helpers';

vi.mock('react-oidc-context', () => ({ useAuth: () => ({ removeUser: vi.fn() }) }));

afterEach(() => vi.unstubAllGlobals());

const projects = { items: [homeProject, plainProject] };

describe('board', () => {
  it('renders the three columns left to right with their point totals and tasks', async () => {
    mockFetch({ '/api/board': board, '/api/projects': projects });
    renderAt('/');

    const columns = await screen.findAllByRole('region');
    expect(columns.map((c) => c.getAttribute('aria-label'))).toEqual(['Backlog', 'Up next', 'In progress']);
    expect(screen.getByTestId('points-backlog')).toHaveTextContent('3 pts');
    expect(screen.getByTestId('points-up_next')).toHaveTextContent('5 pts');
    expect(screen.getByTestId('points-in_progress')).toHaveTextContent('8 pts');

    const inProgress = within(columns[2] as HTMLElement);
    expect(inProgress.getByText('Home')).toBeInTheDocument();
    expect(inProgress.getByText('HOME-2')).toBeInTheDocument();
    expect(inProgress.getByText('Doing')).toBeInTheDocument();
    expect(inProgress.getByAltText('HOME icon')).toHaveAttribute('src', '/icons/HOME.png');
    expect(
      within(columns[0] as HTMLElement).getByRole('img', { name: 'ZZZ placeholder icon' }),
    ).toBeInTheDocument();
  });

  it('sends the ID token as a bearer credential', async () => {
    const fetchMock = mockFetch({ '/api/board': board, '/api/projects': projects });
    renderAt('/');
    await screen.findAllByRole('region');
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer id-token');
  });
});

describe('projects', () => {
  it('lists projects with their icons and a lettered placeholder when there is none', async () => {
    mockFetch({ '/api/projects': projects });
    renderAt('/projects');

    expect(await screen.findByAltText('HOME icon')).toHaveAttribute('src', '/icons/HOME.png');
    expect(screen.getByRole('img', { name: 'ZZZ placeholder icon' })).toHaveTextContent('ZZ');
    expect(screen.getByRole('link', { name: /Home/ })).toHaveAttribute('href', '/projects/HOME');
  });

  it('groups a project’s tasks by state group', async () => {
    mockFetch({
      '/api/projects/HOME': homeProject,
      '/api/projects/HOME/tasks': {
        items: [
          task({ ref: 'HOME-1', labels: ['infra'], points: 2 }),
          task({ ref: 'HOME-2', stateId: 's-doing' }),
          task({ ref: 'HOME-3', stateId: 's-done' }),
        ],
      },
    });
    renderAt('/projects/HOME');
    expect(await screen.findByText('HOME-1')).toBeInTheDocument();
    expect(screen.getByText('infra')).toBeInTheDocument();
    expect(screen.getByText(/^In progress/, { selector: 'summary' })).toBeInTheDocument();
    expect(screen.getByText(/^Done/, { selector: 'summary' })).toBeInTheDocument();
  });
});

describe('epics', () => {
  const epic: EpicDetail = {
    id: 'e1',
    ref: 'EPIC-1',
    name: 'Spring clean',
    description: 'Tidy *everything*',
    state: 'open',
    projectIds: ['p-home', 'p-zzz'],
    projects: [
      { id: 'p-home', prefix: 'HOME', name: 'Home', icon: '/icons/HOME.png' },
      { id: 'p-zzz', prefix: 'ZZZ', name: 'Zed' },
    ],
    tasks: [
      { ...task({ ref: 'ZZZ-1', projectId: 'p-zzz' }), epicRank: 'a', projectPrefix: 'ZZZ' },
      { ...task({ ref: 'HOME-1' }), epicRank: 'b', projectPrefix: 'HOME' },
    ],
  };

  it('lists epics and shows tasks across projects in epic order, each with its project icon', async () => {
    mockFetch({
      '/api/epics': { items: [epic] },
      '/api/epics/EPIC-1': epic,
      '/api/projects': projects,
    });
    renderAt('/epics');
    await userEvent.click(await screen.findByRole('link', { name: /Spring clean/ }));

    await screen.findByText('ZZZ-1');
    const refs = screen.getAllByRole('link', { name: /-1$/ }).map((a) => a.textContent);
    expect(refs).toEqual(['ZZZ-1', 'HOME-1']);
    expect(screen.getByAltText('HOME icon')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'ZZZ placeholder icon' })).toBeInTheDocument();
  });
});

describe('task page', () => {
  const detail: TaskDetailResponse = {
    ...task({ ref: 'HOME-42', title: 'Fix the boiler', points: 3, labels: ['plumbing'], parent: 'HOME-40' }),
    description: 'See [the manual](https://example.com/manual) and **be careful**.',
    priority: 'high',
    links: [{ id: 'l1', url: 'https://example.com/quote', title: 'Quote' }],
    relations: [{ type: 'blocked_by', target: 'HOME-7' }],
    project: { id: 'p-home', prefix: 'HOME', name: 'Home', icon: '/icons/HOME.png' },
    state: { id: 's-doing', name: 'Doing', group: 'started', order: 2 },
    children: [task({ ref: 'HOME-43', title: 'Bleed radiators' })],
    epics: [
      { id: 'e1', ref: 'EPIC-1', name: 'Spring clean', description: '', state: 'open', projectIds: [] },
    ],
    comments: [
      {
        id: 'c1',
        taskRef: 'HOME-42',
        body: 'First comment',
        author: 'claude',
        createdAt: '2026-11-01T09:00:00Z',
      },
      {
        id: 'c2',
        taskRef: 'HOME-42',
        body: 'Second comment',
        author: 'martin',
        createdAt: '2026-11-02T09:00:00Z',
      },
    ],
  };

  it('renders Markdown links as anchors opening in a new tab, plus the rest of the detail', async () => {
    mockFetch({ '/api/tasks/HOME-42': detail });
    renderAt('/tasks/HOME-42');

    const link = await screen.findByRole('link', { name: 'the manual' });
    expect(link).toHaveAttribute('href', 'https://example.com/manual');
    expect(link).toHaveAttribute('target', '_blank');
    expect(screen.getByText('be careful').tagName).toBe('STRONG');

    expect(screen.getByRole('heading', { name: 'Fix the boiler' })).toBeInTheDocument();
    expect(screen.getByAltText('HOME icon')).toBeInTheDocument();
    expect(screen.getByText('high')).toBeInTheDocument();
    expect(screen.getByText('plumbing')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Quote' })).toHaveAttribute('target', '_blank');
    expect(screen.getByRole('link', { name: 'HOME-7' })).toHaveAttribute('href', '/tasks/HOME-7');
    expect(screen.getByRole('link', { name: 'HOME-40' })).toBeInTheDocument();
    expect(screen.getByText('Bleed radiators')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Spring clean/ })).toHaveAttribute('href', '/epics/EPIC-1');

    const comments = screen.getAllByText(/comment$/).map((n) => n.textContent);
    expect(comments).toEqual(['First comment', 'Second comment']);
  });

  it('shows an error for a missing task', async () => {
    mockFetch({});
    renderAt('/tasks/NOPE-1');
    expect(await screen.findByRole('alert')).toHaveTextContent('no mock');
  });
});

describe('search', () => {
  it('shows hits with kind, ref, title and snippet, linking to the task or epic', async () => {
    const fetchMock = mockFetch({
      '/api/search': {
        items: [
          {
            kind: 'task',
            id: 'HOME-42',
            taskRef: 'HOME-42',
            title: 'Fix the boiler',
            snippet: 'pressure drops',
            score: 1,
          },
          {
            kind: 'comment',
            id: 'c1',
            taskRef: 'HOME-7',
            title: 'A comment',
            snippet: 'boiler again',
            score: 0.5,
          },
          { kind: 'epic', id: 'EPIC-1', epicRef: 'EPIC-1', title: 'Spring clean', snippet: '', score: 0.2 },
        ],
      },
    });
    renderAt('/search?q=boiler');

    expect(await screen.findByRole('link', { name: 'HOME-42' })).toHaveAttribute('href', '/tasks/HOME-42');
    expect(screen.getByText('pressure drops')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'HOME-7' })).toHaveAttribute('href', '/tasks/HOME-7');
    expect(screen.getByRole('link', { name: 'EPIC-1' })).toHaveAttribute('href', '/epics/EPIC-1');
    expect(screen.getByText('comment')).toBeInTheDocument();
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('/api/search?q=boiler&mode=hybrid');
  });

  it('searches from the header box and with the chosen mode', async () => {
    const fetchMock = mockFetch({ '/api/search': { items: [] } });
    renderAt('/');
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search' }), 'cats{Enter}');
    await screen.findByText('Nothing found.');
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain('q=cats');

    await userEvent.selectOptions(screen.getByLabelText('Search mode'), 'fulltext');
    await waitFor(() => expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain('mode=fulltext'));
  });
});

describe('footer', () => {
  it('shows the deployed version and tolerates its absence', async () => {
    mockFetch({ '/version.json': { version: '1.2.3' }, '/api/projects': projects });
    renderAt('/projects');
    expect(await screen.findByText('Purr v1.2.3')).toBeInTheDocument();
  });
});
