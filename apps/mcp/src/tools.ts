import { z } from 'zod';
import { PurrApiError, type PurrClient } from './client.js';
import {
  renderBoard,
  renderEpic,
  renderEpics,
  renderNext,
  renderProject,
  renderProjects,
  renderSearch,
  renderTaskDetail,
  renderTaskList,
  stateMap,
  taskLine,
} from './render.js';
import type { BoardView, Comment, Epic, EpicDetail, Project, SearchHit, Task, TaskDetail } from './types.js';

export interface ToolDef {
  name: string;
  description: string;
  shape: z.ZodRawShape;
  run: (client: PurrClient, args: never) => Promise<string>;
}

function tool<S extends z.ZodRawShape>(
  name: string,
  description: string,
  shape: S,
  run: (client: PurrClient, args: z.infer<z.ZodObject<S>>) => Promise<string>,
): ToolDef {
  return { name, description, shape, run: run as ToolDef['run'] };
}

const seg = encodeURIComponent;
const ref = z.string().min(1).describe('Task ref, e.g. HOME-42 (case-insensitive)');
const epicRef = z.string().min(1).describe('Epic ref, e.g. EPIC-7');
const project = z.string().min(1).describe('Project prefix, e.g. HOME');
const priority = z.enum(['none', 'low', 'medium', 'high', 'urgent']);
const assignee = z.enum(['martin', 'claude', 'bau', 'purr3d']).describe('Who is working on it');
const relationType = z.enum(['blocks', 'blocked_by', 'relates_to', 'duplicate_of']);

const versionNote = 'Version conflicts are reported; re-run the tool to retry against the latest version.';

/** Fetch a task's current version for an optimistic-concurrency PATCH. */
async function currentVersion(client: PurrClient, path: string): Promise<number> {
  const current = await client.get<{ version: number }>(path);
  return current.version;
}

async function stateNames(client: PurrClient, prefix: string): Promise<Map<string, string>> {
  const p = await client.get<Project>(`/projects/${seg(prefix)}`);
  return stateMap(p.states);
}

export const TOOLS: ToolDef[] = [
  tool(
    'get_task',
    'Fetch one task by ref and render it as Markdown: title, project, state, priority, points, labels, description, links, relations, parent and children, epics and every comment. Use this to read a task in full before working on it.',
    { ref },
    async (c, a) => renderTaskDetail(await c.get<TaskDetail>(`/tasks/${seg(a.ref)}`)),
  ),

  tool(
    'list_tasks',
    "List a project's tasks in project order, one line each with ref, state, priority, points and labels. Open tasks only by default; pass `all` to include completed and cancelled ones, or `state` (a state name) to select specific states. Optionally filter by label, epic or assignee (`none` for unassigned).",
    {
      project,
      state: z.string().optional().describe('State name (or id); comma-separate several'),
      label: z.string().optional(),
      assignee: z.string().optional().describe('martin, claude, bau or purr3d; none for unassigned tasks'),
      epic: z.string().optional().describe("Epic ref, to list only that epic's members in this project"),
      all: z.boolean().optional().describe('Include completed and cancelled tasks'),
      limit: z
        .number()
        .int()
        .positive()
        .max(500)
        .optional()
        .describe('Maximum tasks to return (default 100)'),
    },
    async (c, a) => {
      const limit = a.limit ?? 100;
      const items: Task[] = [];
      let cursor: string | undefined;
      do {
        const page: { items: Task[]; cursor?: string } = await c.get(`/projects/${seg(a.project)}/tasks`, {
          state: a.state,
          label: a.label,
          assignee: a.assignee,
          epic: a.epic,
          all: a.all ? true : undefined,
          limit: Math.min(limit - items.length, 100),
          cursor,
        });
        items.push(...page.items);
        cursor = page.cursor;
      } while (cursor && items.length < limit);
      const states = await stateNames(c, a.project);
      const more = cursor ? '\n\n(More tasks exist; raise `limit` or narrow the filter.)' : '';
      return `${items.length} task(s) in ${a.project.toUpperCase()}:\n\n${renderTaskList(items, states)}${more}`;
    },
  ),

  tool(
    'create_task',
    "Create a task in a project. Returns the new ref. Use `parent` to make it a sub-task. State defaults to the project's first state; labels must be ones the project defines.",
    {
      project,
      title: z.string().min(1),
      description: z.string().optional().describe('Markdown'),
      state: z.string().optional().describe('State name'),
      labels: z.array(z.string()).optional(),
      parent: z.string().optional().describe('Parent task ref'),
      priority: priority.optional(),
      points: z.number().int().nonnegative().optional().describe('Story points'),
      assignee: assignee.optional(),
    },
    async (c, a) => {
      const { project: p, ...body } = a;
      const t = await c.post<Task>(`/projects/${seg(p)}/tasks`, body);
      return `Created ${taskLine(t)}`;
    },
  ),

  tool(
    'update_task',
    `Change a task's title, description, state, labels (replaces the whole set; use add_label/remove_label to adjust), parent, priority or points. Fetches the current version itself unless you pass \`version\`. ${versionNote}`,
    {
      ref,
      version: z.number().int().optional().describe('Expected version; omit to use the current one'),
      title: z.string().optional(),
      description: z.string().optional().describe('Markdown; replaces the existing description'),
      state: z.string().optional().describe('State name'),
      labels: z.array(z.string()).optional(),
      parent: z.string().optional().describe('Parent task ref (use set_parent to clear)'),
      priority: priority.optional(),
      points: z.number().int().nonnegative().optional(),
    },
    async (c, a) => {
      const { ref: r, version, ...fields } = a;
      const v = version ?? (await currentVersion(c, `/tasks/${seg(r)}`));
      const t = await c.patch<Task>(`/tasks/${seg(r)}`, { version: v, ...fields });
      return `Updated ${taskLine(t)}`;
    },
  ),

  tool(
    'pick_up',
    'Start work on a task: moves it to the first "started" state (In progress) and returns the full task as Markdown, so one call gives you everything you need. Use this at the start of a session on a ref.',
    { ref },
    async (c, a) => {
      await c.post<Task>(`/tasks/${seg(a.ref)}/pick-up`);
      const detail = await c.get<TaskDetail>(`/tasks/${seg(a.ref)}`);
      return `Picked up ${detail.ref}; it is now ${detail.state.name}.\n\n${renderTaskDetail(detail)}`;
    },
  ),

  tool(
    'set_state',
    'Move a task to a named state in its project, e.g. "Ready for test" when the PR is open or "Done" once merged and deployed. get_project lists a project\'s states.',
    { ref, state: z.string().min(1).describe('State name or id') },
    async (c, a) => {
      const t = await c.post<Task>(`/tasks/${seg(a.ref)}/state`, { state: a.state });
      return `Moved ${taskLine(t)} to ${a.state}`;
    },
  ),

  tool(
    'add_comment',
    'Add a comment (Markdown) to a task, as the Claude actor. Use it to record progress, decisions and PR links.',
    { ref, body: z.string().min(1).describe('Markdown') },
    async (c, a) => {
      const cm = await c.post<Comment>(`/tasks/${seg(a.ref)}/comments`, { body: a.body });
      return `Comment added to ${a.ref.toUpperCase()} (id ${cm.id}).`;
    },
  ),

  tool(
    'set_assignee',
    'Assign a task to martin, claude, bau or purr3d, or pass null to unassign it. Works whatever the current version.',
    { ref, assignee: assignee.nullable() },
    async (c, a) => {
      const t = await c.put<Task>(`/tasks/${seg(a.ref)}/assignee`, { assignee: a.assignee });
      return `Updated ${taskLine(t)}`;
    },
  ),

  tool(
    'set_points',
    "Set a task's story points, or pass null to clear the estimate.",
    { ref, points: z.number().int().nonnegative().nullable() },
    async (c, a) => {
      const t = await c.put<Task>(`/tasks/${seg(a.ref)}/points`, { points: a.points });
      return `Updated ${taskLine(t)}`;
    },
  ),

  tool(
    'add_label',
    'Add one label to a task, leaving its other labels alone.',
    { ref, label: z.string().min(1) },
    async (c, a) => {
      const t = await c.put<Task>(`/tasks/${seg(a.ref)}/labels/${seg(a.label)}`);
      return `Updated ${taskLine(t)}`;
    },
  ),

  tool('remove_label', 'Remove one label from a task.', { ref, label: z.string().min(1) }, async (c, a) => {
    const t = await c.delete<Task>(`/tasks/${seg(a.ref)}/labels/${seg(a.label)}`);
    return `Updated ${taskLine(t)}`;
  }),

  tool(
    'add_link',
    "Attach a URL to a task, typically the pull request. Replaces Plane's link_work_items.",
    { ref, url: z.string().url(), title: z.string().optional() },
    async (c, a) => {
      const { ref: r, ...body } = a;
      const l = await c.post<{ id: string }>(`/tasks/${seg(r)}/links`, body);
      return `Linked ${a.url} to ${r.toUpperCase()} (link id ${l.id}).`;
    },
  ),

  tool(
    'remove_link',
    'Remove a link from a task by its link id (shown by get_task).',
    { ref, link_id: z.string().min(1) },
    async (c, a) => {
      const t = await c.delete<Task>(`/tasks/${seg(a.ref)}/links/${seg(a.link_id)}`);
      return `Updated ${taskLine(t)}`;
    },
  ),

  tool(
    'add_relation',
    'Relate two tasks. The inverse is written on the target automatically (blocks <-> blocked_by). Types: blocks, blocked_by, relates_to, duplicate_of.',
    { ref, type: relationType, target: z.string().min(1).describe("The other task's ref") },
    async (c, a) => {
      await c.post(`/tasks/${seg(a.ref)}/relations`, { type: a.type, target: a.target });
      return `${a.ref.toUpperCase()} ${a.type.replace(/_/g, ' ')} ${a.target.toUpperCase()}.`;
    },
  ),

  tool(
    'remove_relation',
    'Remove a relation between two tasks (and its inverse).',
    { ref, type: relationType, target: z.string().min(1) },
    async (c, a) => {
      await c.delete(`/tasks/${seg(a.ref)}/relations`, { type: a.type, target: a.target });
      return `Removed: ${a.ref.toUpperCase()} ${a.type.replace(/_/g, ' ')} ${a.target.toUpperCase()}.`;
    },
  ),

  tool(
    'set_parent',
    'Make a task a child of another task, or pass null to detach it.',
    { ref, parent: z.string().nullable().describe('Parent task ref, or null') },
    async (c, a) => {
      const t = await c.put<Task>(`/tasks/${seg(a.ref)}/parent`, { parent: a.parent });
      return `${t.ref} parent is now ${t.parent ?? 'none'}.`;
    },
  ),

  tool(
    'search',
    'Search tasks, comments and epics. `hybrid` (default) blends meaning and keywords; `semantic` for vague recollections; `fulltext` for exact words. Narrow by project prefix, epic ref, or kind.\n\nFreshness: by default the index covers everything up to midnight (London) at the start of today, and answers instantly. That suits anything from before today ("a while ago we discussed…"). Pass `up_until: "now"` only when the user means something from today ("I told you just before you auto-compacted"): if anything has changed since the last build, it rebuilds first, which can take ~20 s. When unsure, search with the default first and retry with "now" if nothing fits.',
    {
      q: z.string().min(1),
      mode: z.enum(['hybrid', 'semantic', 'fulltext']).optional(),
      project: z.string().optional().describe('Project prefix'),
      epic: z.string().optional().describe('Epic ref'),
      kind: z.array(z.enum(['task', 'comment', 'epic'])).optional(),
      limit: z.number().int().positive().max(100).optional(),
      up_until: z
        .string()
        .optional()
        .describe(
          'How recent the index must be: "now", or an ISO date-time. Default: midnight at the start of today',
        ),
    },
    async (c, a) => {
      const r = await c.get<{ items: SearchHit[]; indexedUntil?: string; fresh?: boolean }>('/search', {
        q: a.q,
        mode: a.mode,
        project: a.project,
        epic: a.epic,
        kind: a.kind?.join(','),
        limit: a.limit,
        upUntil: a.up_until,
      });
      const out = renderSearch(r.items);
      return r.fresh === false
        ? `${out}\n\n(The index only covers up to ${r.indexedUntil ?? 'an unknown time'}; a rebuild is still running, so search again shortly for anything newer.)`
        : out;
    },
  ),

  tool(
    'next',
    "What to work on next: the top task from the priorities board (In progress first, then Up next), with runners-up. Replaces Plane's whats_next.",
    {},
    async (c) => renderNext(await c.get('/next')),
  ),

  tool(
    'board',
    "The priorities board as compact text: three columns (Backlog, Up next, In progress) of project and epic cards, with points per card and column and each card's open tasks. Pass `all` to include closed tasks.",
    { all: z.boolean().optional() },
    async (c, a) => renderBoard(await c.get<BoardView>('/board', { all: a.all ? true : undefined })),
  ),

  tool(
    'list_projects',
    'List projects with their prefixes. Archived ones are hidden unless asked for.',
    { include_archived: z.boolean().optional() },
    async (c, a) =>
      renderProjects(
        (await c.get<{ items: Project[] }>('/projects', { archived: a.include_archived ? true : undefined }))
          .items,
      ),
  ),

  tool(
    'get_project',
    'One project: description, workflow states (names and groups), labels and metadata (repo, deploy method, BAU).',
    { project },
    async (c, a) => renderProject(await c.get<Project>(`/projects/${seg(a.project)}`)),
  ),

  tool(
    'list_epics',
    'List epics (cross-project groupings of tasks). With `project`, only epics flagged on that project. Archived ones are hidden unless asked for.',
    { project: z.string().optional().describe('Project prefix'), include_archived: z.boolean().optional() },
    async (c, a) => {
      const r = a.project
        ? await c.get<{ items: Epic[] }>(`/projects/${seg(a.project)}/epics`)
        : await c.get<{ items: Epic[] }>('/epics', { archived: a.include_archived ? true : undefined });
      return renderEpics(r.items);
    },
  ),

  tool(
    'get_epic',
    'One epic: description, flagged projects, and its tasks in epic order.',
    { epic: epicRef },
    async (c, a) => renderEpic(await c.get<EpicDetail>(`/epics/${seg(a.epic)}`)),
  ),

  tool(
    'create_epic',
    'Create an epic. `projects` is a list of project prefixes to flag it on.',
    { name: z.string().min(1), description: z.string().optional(), projects: z.array(z.string()).optional() },
    async (c, a) => {
      const e = await c.post<Epic>('/epics', a);
      return `Created ${e.ref}: ${e.name}`;
    },
  ),

  tool(
    'update_epic',
    `Rename an epic, change its description, or set its state (open, done, archived). Fetches the current version itself unless you pass \`version\`. ${versionNote}`,
    {
      epic: epicRef,
      version: z.number().int().optional(),
      name: z.string().optional(),
      description: z.string().optional(),
      state: z.enum(['open', 'done', 'archived']).optional(),
    },
    async (c, a) => {
      const { epic, version, ...fields } = a;
      const v = version ?? (await currentVersion(c, `/epics/${seg(epic)}`));
      const e = await c.patch<Epic>(`/epics/${seg(epic)}`, { version: v, ...fields });
      return `Updated ${e.ref}: ${e.name} (${e.state})`;
    },
  ),

  tool(
    'add_to_epic',
    'Add a task to an epic, or move it within the epic if already a member. `before` is the task ref to place it ahead of; omit to put it at the end.',
    { epic: epicRef, task: ref, before: z.string().optional().describe('Task ref to insert before') },
    async (c, a) => {
      await c.put(`/epics/${seg(a.epic)}/tasks/${seg(a.task)}`, a.before ? { before: a.before } : {});
      return `${a.task.toUpperCase()} is in ${a.epic.toUpperCase()}${a.before ? `, before ${a.before.toUpperCase()}` : ''}.`;
    },
  ),

  tool('remove_from_epic', 'Remove a task from an epic.', { epic: epicRef, task: ref }, async (c, a) => {
    await c.delete(`/epics/${seg(a.epic)}/tasks/${seg(a.task)}`);
    return `${a.task.toUpperCase()} removed from ${a.epic.toUpperCase()}.`;
  }),

  tool(
    'flag_project_on_epic',
    "Flag a project on an epic so the epic appears among that project's epics (pass `flag: false` to unflag; refused while that project still has tasks in the epic).",
    { epic: epicRef, project, flag: z.boolean().optional().describe('Default true') },
    async (c, a) => {
      const path = `/epics/${seg(a.epic)}/projects/${seg(a.project)}`;
      const flag = a.flag ?? true;
      const e = flag ? await c.put<Epic>(path) : await c.delete<Epic>(path);
      return `${e.ref}: ${a.project.toUpperCase()} ${flag ? 'flagged' : 'unflagged'}.`;
    },
  ),
];

export interface ToolResult {
  text: string;
  isError: boolean;
}

/** Validate args and run one tool; API and network failures come back as error results, never throws. */
export async function runTool(client: PurrClient, name: string, rawArgs: unknown): Promise<ToolResult> {
  const def = TOOLS.find((t) => t.name === name);
  if (!def) return { text: `Unknown tool: ${name}`, isError: true };
  const parsed = z.object(def.shape).safeParse(rawArgs ?? {});
  if (!parsed.success) {
    return {
      text: `Invalid arguments for ${name}: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
      isError: true,
    };
  }
  try {
    return { text: await def.run(client, parsed.data as never), isError: false };
  } catch (err) {
    if (err instanceof PurrApiError)
      return { text: `Purr API error ${err.code} (HTTP ${err.status}): ${err.detail}`, isError: true };
    return { text: (err as Error).message, isError: true };
  }
}
