import { describe, expect, it } from 'vitest';
import { board } from '../test/helpers';
import { applyMove, cardKey, dropTarget } from './board';

const keys = (b: typeof board, column: string) =>
  b.columns.find((c) => c.column === column)?.cards.map(cardKey);

describe('applyMove', () => {
  it('moves a card to the end of another column and recomputes both totals', () => {
    const moved = applyMove(board, 'project:ZZZ', 'in_progress');
    expect(keys(moved, 'backlog')).toEqual([]);
    expect(keys(moved, 'in_progress')).toEqual(['project:HOME', 'project:ZZZ']);
    expect(moved.columns.map((c) => c.points)).toEqual([0, 5, 11]);
  });

  it('places a card before another and ignores unknown cards', () => {
    const moved = applyMove(board, 'epic:EPIC-1', 'in_progress', 'project:HOME');
    expect(keys(moved, 'in_progress')).toEqual(['epic:EPIC-1', 'project:HOME']);
    expect(applyMove(board, 'project:NOPE', 'backlog')).toBe(board);
  });

  it('counts a task once in a column even if two cards carry it', () => {
    const shared = applyMove(board, 'epic:EPIC-1', 'backlog');
    expect(shared.columns[0]?.points).toBe(8);
  });
});

describe('dropTarget', () => {
  const two = applyMove(applyMove(board, 'epic:EPIC-1', 'in_progress'), 'project:ZZZ', 'in_progress');
  // in_progress: HOME, EPIC-1, ZZZ

  it('drops onto a column at its end', () => {
    expect(dropTarget(board, 'project:ZZZ', 'col:up_next')).toEqual({ column: 'up_next' });
  });

  it('drops before the card it is over when coming from another column', () => {
    expect(dropTarget(board, 'project:ZZZ', 'project:HOME')).toEqual({
      column: 'in_progress',
      beforeKey: 'project:HOME',
    });
  });

  it('drops after the card it is over when dragging down within a column', () => {
    expect(dropTarget(two, 'project:HOME', 'epic:EPIC-1')).toEqual({
      column: 'in_progress',
      beforeKey: 'project:ZZZ',
    });
    expect(dropTarget(two, 'project:HOME', 'project:ZZZ')).toEqual({ column: 'in_progress' });
  });

  it('drops before the card it is over when dragging up, and ignores itself or strangers', () => {
    expect(dropTarget(two, 'project:ZZZ', 'project:HOME')).toEqual({
      column: 'in_progress',
      beforeKey: 'project:HOME',
    });
    expect(dropTarget(two, 'project:ZZZ', 'project:ZZZ')).toBeUndefined();
    expect(dropTarget(two, 'project:ZZZ', 'project:NOPE')).toBeUndefined();
  });
});
