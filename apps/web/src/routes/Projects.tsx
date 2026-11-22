import { Link } from 'react-router';
import { getProjects } from '../api/endpoints';
import { Async } from '../components/Notice';
import { ProjectIcon } from '../components/ProjectIcon';
import { useAsync } from '../lib/useAsync';

export function Projects() {
  const state = useAsync('projects', getProjects);
  return (
    <>
      <h1 className="mb-4 text-2xl font-bold">Projects</h1>
      <Async state={state}>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {state.data?.map((project) => (
            <li key={project.id}>
              <Link
                to={`/projects/${project.prefix}`}
                className="flex items-center gap-3 rounded-xl border border-line bg-surface p-3 text-ink no-underline hover:border-accent"
              >
                <ProjectIcon
                  prefix={project.prefix}
                  {...(project.icon ? { icon: project.icon } : {})}
                  size={40}
                />
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{project.name}</span>
                  <span className="font-mono text-xs text-muted">{project.prefix}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Async>
    </>
  );
}
