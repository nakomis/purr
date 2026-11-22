import { useParams } from 'react-router';
import { getProject, getProjectTasks } from '../api/endpoints';
import type { StateGroup, Task } from '../api/types';
import { Async } from '../components/Notice';
import { ProjectIcon } from '../components/ProjectIcon';
import { TaskRow } from '../components/TaskRow';
import { GROUP_ORDER, GROUP_TITLES } from '../lib/format';
import { useAsync } from '../lib/useAsync';

export function Project() {
  const { prefix = '' } = useParams();
  const state = useAsync(prefix, async (p) => {
    const [project, tasks] = await Promise.all([getProject(p), getProjectTasks(p)]);
    return { project, tasks };
  });
  const { project, tasks } = state.data ?? {};

  return (
    <Async state={state}>
      {project && tasks && (
        <>
          <h1 className="mb-1 flex items-center gap-3 text-2xl font-bold">
            <ProjectIcon
              prefix={project.prefix}
              {...(project.icon ? { icon: project.icon } : {})}
              size={44}
            />
            {project.name}
            <span className="font-mono text-sm font-normal text-muted">{project.prefix}</span>
          </h1>
          {project.description && <p className="mb-4 text-muted">{project.description}</p>}
          {GROUP_ORDER.map((group: StateGroup) => {
            const states = new Map(project.states.map((s) => [s.id, s]));
            const inGroup = tasks.filter((t: Task) => states.get(t.stateId)?.group === group);
            if (inGroup.length === 0) return null;
            const closed = group === 'completed' || group === 'cancelled';
            return (
              <details
                key={group}
                open={!closed}
                className="mb-4 rounded-xl border border-line bg-surface p-3"
              >
                <summary className="cursor-pointer text-lg font-bold">
                  {GROUP_TITLES[group]}{' '}
                  <span className="text-sm font-normal text-muted">({inGroup.length})</span>
                </summary>
                <ul className="mt-2 divide-y divide-line">
                  {inGroup.map((task) => (
                    <li key={task.ref} className="py-1">
                      <ul>
                        <TaskRow task={task} state={states.get(task.stateId)} />
                      </ul>
                      {task.labels.length > 0 && (
                        <p className="flex flex-wrap gap-1 pb-1 pl-1">
                          {task.labels.map((label) => (
                            <span
                              key={label}
                              className="rounded-full border border-line px-2 text-xs text-muted"
                            >
                              {label}
                            </span>
                          ))}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </details>
            );
          })}
        </>
      )}
    </Async>
  );
}
