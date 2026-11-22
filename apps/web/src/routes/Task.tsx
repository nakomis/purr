import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { getTask } from '../api/endpoints';
import { Markdown } from '../components/Markdown';
import { Async } from '../components/Notice';
import { ProjectIcon } from '../components/ProjectIcon';
import { TaskRow } from '../components/TaskRow';
import { formatDateTime, formatPoints, RELATION_LABELS } from '../lib/format';
import { useAsync } from '../lib/useAsync';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="mb-2 text-lg font-bold">{title}</h2>
      {children}
    </section>
  );
}

export function TaskPage() {
  const { ref = '' } = useParams();
  const state = useAsync(ref, getTask);
  const task = state.data;

  return (
    <Async state={state}>
      {task && (
        <article className="mx-auto max-w-4xl">
          <p className="flex items-center gap-2 font-mono text-sm text-muted">
            <ProjectIcon
              prefix={task.project.prefix}
              {...(task.project.icon ? { icon: task.project.icon } : {})}
              size={24}
            />
            <Link to={`/projects/${task.project.prefix}`}>{task.project.name}</Link> / {task.ref}
          </p>
          <h1 className="mt-1 text-2xl font-bold">{task.title}</h1>
          <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <div>
              <dt className="inline text-muted">State </dt>
              <dd className="inline font-semibold">{task.state.name}</dd>
            </div>
            <div>
              <dt className="inline text-muted">Priority </dt>
              <dd className="inline font-semibold">{task.priority}</dd>
            </div>
            {task.points !== undefined && (
              <div>
                <dt className="inline text-muted">Points </dt>
                <dd className="inline font-semibold">{formatPoints(task.points)}</dd>
              </div>
            )}
            {task.parent && (
              <div>
                <dt className="inline text-muted">Parent </dt>
                <dd className="inline font-semibold">
                  <Link to={`/tasks/${task.parent}`}>{task.parent}</Link>
                </dd>
              </div>
            )}
          </dl>
          {task.labels.length > 0 && (
            <p className="mt-2 flex flex-wrap gap-1">
              {task.labels.map((label) => (
                <span key={label} className="rounded-full bg-accent-soft px-2 text-xs text-accent">
                  {label}
                </span>
              ))}
            </p>
          )}

          {task.description && (
            <Section title="Description">
              <Markdown>{task.description}</Markdown>
            </Section>
          )}

          {task.links.length > 0 && (
            <Section title="Links">
              <ul className="list-disc pl-5">
                {task.links.map((link) => (
                  <li key={link.id}>
                    <a href={link.url} target="_blank" rel="noreferrer noopener">
                      {link.title || link.url}
                    </a>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {task.relations.length > 0 && (
            <Section title="Relations">
              <ul>
                {task.relations.map((relation) => (
                  <li key={`${relation.type}:${relation.target}`}>
                    {RELATION_LABELS[relation.type] ?? relation.type}{' '}
                    <Link to={`/tasks/${relation.target}`} className="font-mono text-sm">
                      {relation.target}
                    </Link>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {task.children.length > 0 && (
            <Section title="Sub-tasks">
              <ul className="divide-y divide-line rounded-xl border border-line bg-surface px-3">
                {task.children.map((child) => (
                  <TaskRow key={child.ref} task={child} />
                ))}
              </ul>
            </Section>
          )}

          {task.epics.length > 0 && (
            <Section title="Epics">
              <ul>
                {task.epics.map((epic) => (
                  <li key={epic.ref}>
                    <Link to={`/epics/${epic.ref}`}>
                      {epic.ref} · {epic.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section title={`Comments (${task.comments.length})`}>
            <ol className="flex flex-col gap-3">
              {task.comments.map((comment) => (
                <li key={comment.id} className="rounded-xl border border-line bg-surface p-3">
                  <p className="mb-1 text-xs text-muted">
                    <span className="font-semibold">{comment.author}</span> ·{' '}
                    {formatDateTime(comment.createdAt)}
                  </p>
                  <Markdown>{comment.body}</Markdown>
                </li>
              ))}
            </ol>
          </Section>
        </article>
      )}
    </Async>
  );
}
