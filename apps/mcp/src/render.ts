import type { BoardView, Epic, EpicDetail, Project, SearchHit, State, Task, TaskDetail } from './types.js';

const COLUMN_TITLES: Record<string, string> = {
  backlog: 'Backlog',
  up_next: 'Up next',
  in_progress: 'In progress',
};

function pts(points: number | undefined | null): string {
  return points === undefined || points === null ? '' : `${points}pt`;
}

/** One line: `HOME-42 [In progress] (high, 3pt) Title #label`. */
export function taskLine(t: Task, states?: Map<string, string>): string {
  const bits = [t.priority && t.priority !== 'none' ? t.priority : '', pts(t.points)].filter(Boolean);
  const state = states?.get(t.stateId);
  return [
    t.ref,
    state ? `[${state}]` : '',
    bits.length > 0 ? `(${bits.join(', ')})` : '',
    t.title,
    t.labels.length > 0 ? t.labels.map((l) => `#${l}`).join(' ') : '',
  ]
    .filter(Boolean)
    .join(' ');
}

export function stateMap(states: State[]): Map<string, string> {
  return new Map(states.map((s) => [s.id, s.name]));
}

export function renderTaskList(tasks: Task[], states?: Map<string, string>, empty = 'No tasks.'): string {
  return tasks.length === 0 ? empty : tasks.map((t) => `- ${taskLine(t, states)}`).join('\n');
}

export function renderTaskDetail(t: TaskDetail): string {
  const out: string[] = [`# ${t.ref}: ${t.title}`, ''];
  out.push(`- Project: ${t.project.prefix} (${t.project.name})`);
  out.push(`- State: ${t.state.name} (${t.state.group})`);
  out.push(`- Priority: ${t.priority}`);
  out.push(`- Points: ${t.points ?? 'unestimated'}`);
  out.push(`- Labels: ${t.labels.length > 0 ? t.labels.join(', ') : 'none'}`);
  if (t.parent) out.push(`- Parent: ${t.parent}`);
  out.push(`- Version: ${t.version}`);
  out.push('', '## Description', '', t.description.trim() || '(no description)');

  if (t.links.length > 0) {
    out.push('', '## Links', '');
    for (const l of t.links) out.push(`- ${l.title ? `${l.title}: ` : ''}${l.url} (id ${l.id})`);
  }
  if (t.relations.length > 0) {
    out.push('', '## Relations', '');
    for (const r of t.relations) out.push(`- ${r.type.replace(/_/g, ' ')} ${r.target}`);
  }
  if (t.children.length > 0) {
    out.push('', '## Children', '');
    out.push(renderTaskList(t.children));
  }
  if (t.epics.length > 0) {
    out.push('', '## Epics', '');
    for (const e of t.epics) out.push(`- ${e.ref}: ${e.name} (${e.state})`);
  }
  out.push('', `## Comments (${t.comments.length})`);
  for (const c of t.comments) {
    out.push('', `**${c.author}**, ${c.createdAt}`, '', c.body);
  }
  return out.join('\n');
}

export function renderProject(p: Project): string {
  const m = p.metadata ?? {};
  const out = [`# ${p.prefix}: ${p.name}${p.archived ? ' (archived)' : ''}`, ''];
  if (p.description.trim()) out.push(p.description.trim(), '');
  out.push(
    `- States: ${[...p.states]
      .sort((a, b) => a.order - b.order)
      .map((s) => `${s.name} (${s.group})`)
      .join(', ')}`,
  );
  out.push(`- Labels: ${p.labels.length > 0 ? p.labels.join(', ') : 'none'}`);
  if (m.repo) out.push(`- Repo: ${m.repo}`);
  if (m.deployMethod) out.push(`- Deploy: ${m.deployMethod}${m.deployAction ? ` (${m.deployAction})` : ''}`);
  out.push(`- BAU enabled: ${m.bauEnabled ? 'yes' : 'no'}`);
  return out.join('\n');
}

export function renderProjects(ps: Project[]): string {
  if (ps.length === 0) return 'No projects.';
  return ps.map((p) => `- ${p.prefix}: ${p.name}${p.archived ? ' (archived)' : ''}`).join('\n');
}

export function renderEpics(es: Epic[]): string {
  if (es.length === 0) return 'No epics.';
  return es.map((e) => `- ${e.ref}: ${e.name} (${e.state})`).join('\n');
}

export function renderEpic(e: EpicDetail): string {
  const out = [`# ${e.ref}: ${e.name} (${e.state})`, ''];
  if (e.description.trim()) out.push(e.description.trim(), '');
  out.push(
    `- Projects: ${e.projects.length > 0 ? e.projects.map((p) => p.prefix).join(', ') : 'none flagged'}`,
  );
  out.push(`- Version: ${e.version}`, '', `## Tasks in order (${e.tasks.length})`, '');
  out.push(renderTaskList(e.tasks, undefined, '(no tasks yet)'));
  return out.join('\n');
}

export function renderBoard(b: BoardView): string {
  const out: string[] = [];
  for (const col of b.columns) {
    out.push(`## ${COLUMN_TITLES[col.column] ?? col.column} (${col.points}pt)`);
    if (col.cards.length === 0) out.push('(empty)');
    for (const card of col.cards) {
      const label = card.kind === 'epic' ? `${card.key}: ${card.title} [epic]` : `${card.key}: ${card.title}`;
      out.push(`- ${label} (${card.points}pt)`);
      for (const t of card.tasks) out.push(`    ${taskLine(t)}`);
    }
    out.push('');
  }
  return out.join('\n').trimEnd();
}

export function renderNext(r: { next?: Task; runnersUp: Task[] }): string {
  if (!r.next) return 'Nothing is queued: the In progress and Up next columns have no open tasks.';
  const out = [`Next: ${taskLine(r.next)}`];
  if (r.runnersUp.length > 0) {
    out.push('', 'Runners-up:', renderTaskList(r.runnersUp));
  }
  return out.join('\n');
}

export function renderSearch(hits: SearchHit[]): string {
  if (hits.length === 0) return 'No matches.';
  return hits
    .map((h) => {
      const ref = h.taskRef ?? h.epicRef ?? h.id;
      const where = h.kind === 'comment' ? `comment on ${ref}` : `${h.kind} ${ref}`;
      const snippet = h.snippet?.trim().replace(/\s+/g, ' ');
      return `- ${where}: ${h.title}${snippet ? `\n    ${snippet}` : ''}`;
    })
    .join('\n');
}
