import type { BoardColumnView, BoardView, Column, Task } from '../api/types';

export const COLUMN_TITLES: Record<Column, string> = {
  backlog: 'Backlog',
  up_next: 'Up next',
  in_progress: 'In progress',
};

/** Card identity on the board: a project prefix and an epic ref never collide. */
export const cardKey = (card: { kind: string; key: string }) => `${card.kind}:${card.key}`;

function columnPoints(cards: BoardColumnView['cards']): number {
  const unique = new Map<string, Task>();
  for (const card of cards) for (const task of card.tasks) unique.set(task.ref, task);
  let total = 0;
  for (const task of unique.values()) total += task.points ?? 0;
  return total;
}

/**
 * The board after dragging `activeKey` into `column`, in front of the card `beforeKey` (or at the end).
 * Mirrors what the server does so the UI can update before the response arrives.
 */
export function applyMove(
  board: BoardView,
  activeKey: string,
  column: Column,
  beforeKey?: string,
): BoardView {
  const moving = board.columns.flatMap((c) => c.cards).find((card) => cardKey(card) === activeKey);
  if (!moving) return board;
  return {
    columns: board.columns.map((col) => {
      const cards = col.cards.filter((card) => cardKey(card) !== activeKey);
      if (col.column === column) {
        const at = beforeKey ? cards.findIndex((card) => cardKey(card) === beforeKey) : -1;
        cards.splice(at === -1 ? cards.length : at, 0, moving);
      }
      return { ...col, cards, points: columnPoints(cards) };
    }),
  };
}

/** Where a dragged card lands: `over` is another card's key or `col:<column>`. */
export function dropTarget(
  board: BoardView,
  activeKey: string,
  overKey: string,
): { column: Column; beforeKey?: string } | undefined {
  if (overKey.startsWith('col:')) return { column: overKey.slice(4) as Column };
  for (const col of board.columns) {
    const keys = col.cards.map(cardKey);
    const overIndex = keys.indexOf(overKey);
    if (overIndex === -1) continue;
    if (overKey === activeKey) return undefined;
    const activeIndex = keys.indexOf(activeKey);
    // Dragging down within a column puts the card after the one it is over; otherwise just before it.
    const rest = keys.filter((k) => k !== activeKey);
    const beforeKey =
      activeIndex !== -1 && activeIndex < overIndex ? rest[rest.indexOf(overKey) + 1] : overKey;
    return { column: col.column, ...(beforeKey ? { beforeKey } : {}) };
  }
  return undefined;
}
