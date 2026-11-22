import type { IndexedDoc } from '@purr/contracts';
import type { Comment, Page, Storage } from '@purr/domain';

/** Every page of a cursor-paginated list. */
async function all<T>(fetch: (cursor?: string) => Promise<Page<T>>): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | undefined;
  do {
    const page = await fetch(cursor);
    items.push(...page.items);
    cursor = page.cursor;
  } while (cursor);
  return items;
}

/** Every task (title and description), comment and epic (name and description). */
export async function documentsFor(storage: Storage): Promise<IndexedDoc[]> {
  const docs: IndexedDoc[] = [];
  const projects = await storage.projects.list({ includeArchived: true });
  for (const project of projects) {
    const tasks = await all((cursor) =>
      storage.tasks.listByProject(project.id, cursor ? { cursor, limit: 200 } : { limit: 200 }),
    );
    for (const task of tasks) {
      docs.push({
        kind: 'task',
        id: task.ref,
        taskRef: task.ref,
        projectId: task.projectId,
        epicRefs: task.epics,
        title: task.title,
        text: task.description,
        updatedAt: task.updatedAt,
      });
      const comments: Comment[] = await all((cursor) =>
        storage.comments.list(task.ref, cursor ? { cursor, limit: 200 } : { limit: 200 }),
      );
      for (const comment of comments) {
        docs.push({
          kind: 'comment',
          id: comment.id,
          taskRef: task.ref,
          projectId: task.projectId,
          epicRefs: task.epics,
          title: task.title,
          text: comment.body,
          updatedAt: comment.createdAt,
        });
      }
    }
  }
  for (const epic of await storage.epics.list({ includeArchived: true })) {
    docs.push({
      kind: 'epic',
      id: epic.ref,
      epicRef: epic.ref,
      projectIds: epic.projectIds,
      title: epic.name,
      text: epic.description,
      updatedAt: epic.updatedAt,
    });
  }
  return docs;
}
