import type { BoardCard, BoardRepository } from '@purr/domain';
import { fromItem, toItem } from './codec.js';
import type { Db } from './db.js';
import { keys } from './keys.js';

export function boardRepository(db: Db): BoardRepository {
  return {
    async list() {
      const items = await db.queryAll({ attribute: 'PK', partition: keys.board('', '').PK });
      return items.map((i) => fromItem<BoardCard>(i));
    },
    async put(card) {
      await db.put(toItem(card, keys.board(card.kind, card.id)));
    },
    async remove(kind, id) {
      await db.delete(keys.board(kind, id));
    },
  };
}
