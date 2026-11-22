import { type Comment, type CommentRepository, NotFoundError, newId, nowIso } from '@purr/domain';
import { clampLimit, fromItem, toItem } from './codec.js';
import { cond, type Db } from './db.js';
import { keys } from './keys.js';

export function commentRepository(db: Db): CommentRepository {
  return {
    async add(taskRef, body, author, at) {
      const comment: Comment = { id: newId(), taskRef, body, author, createdAt: at ?? nowIso() };
      await db.transact([
        {
          check: keys.task(taskRef),
          condition: cond.exists(),
          fail: () => new NotFoundError(`no task ${taskRef}`),
        },
        { put: toItem(comment, keys.comment(taskRef, comment.createdAt, comment.id)) },
      ]);
      return comment;
    },

    async list(taskRef, opts = {}) {
      const page = await db.queryPage({
        attribute: 'PK',
        partition: keys.task(taskRef).PK,
        skPrefix: keys.commentPrefix,
        limit: clampLimit(opts.limit),
        ...(opts.cursor ? { cursor: opts.cursor } : {}),
      });
      return {
        items: page.items.map((i) => fromItem<Comment>(i)),
        ...(page.cursor ? { cursor: page.cursor } : {}),
      };
    },
  };
}
