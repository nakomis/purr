import { Link, useParams } from 'react-router';
import { getEpic, getEpics, getProjects } from '../api/endpoints';
import { Markdown } from '../components/Markdown';
import { Async } from '../components/Notice';
import { EpicIcon } from '../components/ProjectIcon';
import { TaskRow } from '../components/TaskRow';
import { stateIndex } from '../lib/format';
import { useAsync } from '../lib/useAsync';

export function Epics() {
  const state = useAsync('epics', getEpics);
  return (
    <>
      <h1 className="mb-4 text-2xl font-bold">Epics</h1>
      <Async state={state}>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {state.data?.map((epic) => (
            <li key={epic.ref}>
              <Link
                to={`/epics/${epic.ref}`}
                className="flex items-center gap-3 rounded-xl border border-line bg-surface p-3 text-ink no-underline hover:border-accent"
              >
                <EpicIcon size={36} />
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{epic.name}</span>
                  <span className="font-mono text-xs text-muted">
                    {epic.ref} · {epic.state}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Async>
    </>
  );
}

export function EpicPage() {
  const { ref = '' } = useParams();
  const state = useAsync(ref, async (r) => {
    const [epic, projects] = await Promise.all([getEpic(r), getProjects()]);
    return { epic, index: stateIndex(projects) };
  });
  const { epic, index } = state.data ?? {};

  return (
    <Async state={state}>
      {epic && index && (
        <>
          <h1 className="mb-1 flex items-center gap-3 text-2xl font-bold">
            <EpicIcon size={40} />
            {epic.name}
            <span className="font-mono text-sm font-normal text-muted">{epic.ref}</span>
          </h1>
          {epic.description && <Markdown>{epic.description}</Markdown>}
          <ul className="mt-4 divide-y divide-line rounded-xl border border-line bg-surface px-3">
            {epic.tasks.map((task) => (
              <TaskRow
                key={task.ref}
                task={task}
                state={index.stateOf(task)}
                project={
                  epic.projects.find((p) => p.prefix === task.projectPrefix) ?? { prefix: task.projectPrefix }
                }
              />
            ))}
          </ul>
        </>
      )}
    </Async>
  );
}
