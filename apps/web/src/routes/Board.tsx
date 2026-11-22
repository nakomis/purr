import {
  closestCorners,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { getBoard, getProjects, moveCard } from '../api/endpoints';
import type { BoardCardView, BoardColumnView, BoardView } from '../api/types';
import { Notice } from '../components/Notice';
import { EpicIcon, ProjectIcon } from '../components/ProjectIcon';
import { TaskRow } from '../components/TaskRow';
import { applyMove, COLUMN_TITLES, cardKey, dropTarget } from '../lib/board';
import { formatPoints, type StateIndex, stateIndex } from '../lib/format';

function Card({ card, index }: { card: BoardCardView; index: StateIndex }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: cardKey(card),
  });
  const link = card.kind === 'project' ? `/projects/${card.key}` : `/epics/${card.key}`;
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}
      className="touch-manipulation rounded-xl border border-line bg-surface p-3 shadow-sm"
      {...attributes}
      {...listeners}
    >
      <div className="flex items-center gap-2">
        {card.kind === 'project' ? (
          <ProjectIcon prefix={card.key} {...(card.icon ? { icon: card.icon } : {})} />
        ) : (
          <EpicIcon />
        )}
        <Link to={link} className="min-w-0 flex-1 truncate font-semibold text-ink no-underline">
          {card.title}
        </Link>
        <span className="shrink-0 rounded-full bg-accent-soft px-2 text-xs font-semibold text-accent">
          {card.points} pts
        </span>
      </div>
      {card.tasks.length > 0 && (
        <ul className="mt-2 divide-y divide-line border-t border-line">
          {card.tasks.map((task) => (
            <TaskRow key={task.ref} task={task} state={index.stateOf(task)} />
          ))}
        </ul>
      )}
    </li>
  );
}

function Column({ column, index }: { column: BoardColumnView; index: StateIndex }) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${column.column}` });
  return (
    <section
      ref={setNodeRef}
      aria-label={COLUMN_TITLES[column.column]}
      className={`min-h-40 rounded-2xl border p-3 ${isOver ? 'border-accent' : 'border-line'} bg-bg`}
    >
      <h2 className="mb-3 flex items-baseline justify-between text-lg font-bold">
        {COLUMN_TITLES[column.column]}
        <span className="text-sm font-medium text-muted" data-testid={`points-${column.column}`}>
          {formatPoints(column.points) || '0 pts'}
        </span>
      </h2>
      <SortableContext items={column.cards.map(cardKey)} strategy={verticalListSortingStrategy}>
        <ul className="flex flex-col gap-3">
          {column.cards.map((card) => (
            <Card key={cardKey(card)} card={card} index={index} />
          ))}
        </ul>
      </SortableContext>
    </section>
  );
}

export function Board() {
  const [board, setBoard] = useState<BoardView>();
  const [index, setIndex] = useState<StateIndex>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let live = true;
    Promise.all([getBoard(), getProjects()])
      .then(([b, projects]) => {
        if (!live) return;
        setBoard(b);
        setIndex(stateIndex(projects));
      })
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    // A short press-and-hold on touch screens, so a swipe still scrolls the page.
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  async function onDragEnd({ active, over }: DragEndEvent) {
    if (!board || !over) return;
    const activeKey = String(active.id);
    const target = dropTarget(board, activeKey, String(over.id));
    if (!target) return;
    const card = board.columns.flatMap((c) => c.cards).find((c) => cardKey(c) === activeKey);
    if (!card) return;
    const before = board.columns.flatMap((c) => c.cards).find((c) => cardKey(c) === target.beforeKey);

    const previous = board;
    setBoard(applyMove(board, activeKey, target.column, target.beforeKey));
    setError(undefined);
    try {
      await moveCard({
        kind: card.kind,
        id: card.key,
        column: target.column,
        ...(before ? { before: before.key } : {}),
      });
    } catch (e) {
      setBoard(previous);
      setError(`Could not move ${card.title}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (error && !board) return <Notice tone="error">{error}</Notice>;
  if (!board || !index) return <Notice>Loading…</Notice>;

  return (
    <>
      {error && <Notice tone="error">{error}</Notice>}
      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={(e) => void onDragEnd(e)}>
        <div className="grid items-start gap-4 md:grid-cols-3">
          {board.columns.map((column) => (
            <Column key={column.column} column={column} index={index} />
          ))}
        </div>
      </DndContext>
    </>
  );
}
