import { Link } from 'react-router';
import type { State, Task } from '../api/types';
import { formatPoints } from '../lib/format';
import { ProjectIcon } from './ProjectIcon';

/** A compact task line: ref, title, points and state (and the project's icon where asked for). */
export function TaskRow({
  task,
  state,
  project,
}: {
  task: Pick<Task, 'ref' | 'title' | 'points'> & { assignee?: Task['assignee'] };
  state?: State | undefined;
  project?: { prefix: string; icon?: string | undefined } | undefined;
}) {
  return (
    <li className="flex items-baseline gap-2 py-1 text-sm">
      {project && (
        <span className="self-center">
          <ProjectIcon prefix={project.prefix} {...(project.icon ? { icon: project.icon } : {})} size={20} />
        </span>
      )}
      <Link to={`/tasks/${task.ref}`} className="shrink-0 font-mono text-xs font-semibold">
        {task.ref}
      </Link>
      <span className="min-w-0 flex-1 break-words">{task.title}</span>
      {task.points !== undefined && (
        <span className="shrink-0 text-xs text-muted">{formatPoints(task.points)}</span>
      )}
      {task.assignee && (
        <span className="shrink-0 text-xs text-muted" title={`Assigned to ${task.assignee}`}>
          @{task.assignee}
        </span>
      )}
      {state && (
        <span className="shrink-0 rounded-full bg-accent-soft px-2 text-xs text-accent">{state.name}</span>
      )}
    </li>
  );
}
