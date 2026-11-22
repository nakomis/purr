import { NotFoundError, ValidationError } from '../errors.js';
import { rankBefore } from '../rank.js';
import { normaliseEpicRef } from '../refs.js';
import type { BoardCard, Column, Epic, Project, Task, TaskRef } from '../types.js';
import { COLUMNS, isOpenGroup } from '../types.js';
import type { ServiceDeps } from './common.js';

export interface BoardCardView {
  kind: BoardCard['kind'];
  /** Project id or epic ref. */
  id: string;
  /** Project prefix, or epic ref. */
  key: string;
  title: string;
  icon?: string;
  rank: string;
  tasks: Task[];
  /** Sum of the card's tasks' points (a task counts on every card it appears on). */
  points: number;
}

export interface BoardColumnView {
  column: Column;
  cards: BoardCardView[];
  /** Sum of points across the column, counting each task once. */
  points: number;
}

export interface BoardView {
  columns: BoardColumnView[];
}

export interface NextView {
  next?: Task;
  runnersUp: Task[];
}

/** Columns "what's next" walks, in order (design section 4). */
const WORK_ORDER: Column[] = ['in_progress', 'up_next'];

export class BoardService {
  constructor(private readonly deps: ServiceDeps) {}

  private get storage() {
    return this.deps.storage;
  }

  /** The board with each card's tasks: open ones only, unless `all`. */
  async getBoard(opts: { all?: boolean } = {}): Promise<BoardView> {
    const cards = await this.storage.board.list();
    const projects = await this.storage.projects.list({ includeArchived: true });
    const projectById = new Map(projects.map((p) => [p.id, p]));
    const openStates = this.openStateIds(projects);

    const views = await Promise.all(
      cards.map(async (card) => {
        const view = await this.cardView(card, projectById);
        if (!view) return undefined;
        const tasks = opts.all ? view.tasks : view.tasks.filter((t) => openStates.has(t.stateId));
        return { ...view, tasks, points: sumPoints(tasks) };
      }),
    );

    return {
      columns: COLUMNS.map((column) => {
        const inColumn = views
          .filter((v): v is BoardCardView & { column: Column } => v !== undefined && v.column === column)
          .sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0));
        const unique = new Map<TaskRef, Task>();
        for (const card of inColumn) for (const t of card.tasks) unique.set(t.ref, t);
        return {
          column,
          cards: inColumn.map(({ column: _c, ...card }) => card),
          points: sumPoints([...unique.values()]),
        };
      }),
    };
  }

  /** Move (or place) a card: into `column`, before the card `beforeId`, or at the end. */
  async move(kind: BoardCard['kind'], id: string, column: Column, beforeId?: string): Promise<BoardCard> {
    if (!COLUMNS.includes(column)) throw new ValidationError(`invalid column ${column}`);
    const cardId = await this.resolveCardId(kind, id);
    const cards = (await this.storage.board.list())
      .filter((c) => c.column === column && !(c.kind === kind && c.id === cardId))
      .sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0));
    let beforeRank: string | undefined;
    if (beforeId) {
      const before = cards.find((c) => c.id === beforeId || c.id === normaliseMaybeEpic(beforeId));
      if (!before) throw new ValidationError(`no card ${beforeId} in ${column}`);
      beforeRank = before.rank;
    }
    const card: BoardCard = {
      kind,
      id: cardId,
      column,
      rank: rankBefore(
        cards.map((c) => c.rank),
        beforeRank,
      ),
    };
    await this.storage.board.put(card);
    return card;
  }

  async remove(kind: BoardCard['kind'], id: string): Promise<void> {
    await this.storage.board.remove(kind, await this.resolveCardId(kind, id));
  }

  /** The next task to work on, with up to two runners-up. */
  async next(): Promise<NextView> {
    const [first, ...rest] = await this.openTasksInWorkOrder(WORK_ORDER);
    return { ...(first ? { next: first } : {}), runnersUp: rest.slice(0, 2) };
  }

  /** Every open task's ref, in board order (all three columns), each once. */
  async priority(): Promise<TaskRef[]> {
    return (await this.openTasksInWorkOrder(['in_progress', 'up_next', 'backlog'])).map((t) => t.ref);
  }

  private async openTasksInWorkOrder(columns: Column[]): Promise<Task[]> {
    const board = await this.getBoard();
    const seen = new Set<TaskRef>();
    const out: Task[] = [];
    for (const column of columns) {
      const col = board.columns.find((c) => c.column === column);
      for (const card of col?.cards ?? []) {
        for (const task of card.tasks) {
          if (seen.has(task.ref)) continue;
          seen.add(task.ref);
          out.push(task);
        }
      }
    }
    return out;
  }

  private openStateIds(projects: Project[]): Set<string> {
    const ids = new Set<string>();
    for (const p of projects) for (const s of p.states) if (isOpenGroup(s.group)) ids.add(s.id);
    return ids;
  }

  private async cardView(
    card: BoardCard,
    projectById: Map<string, Project>,
  ): Promise<(BoardCardView & { column: Column }) | undefined> {
    if (card.kind === 'project') {
      const project = projectById.get(card.id);
      if (!project) return undefined;
      const tasks: Task[] = [];
      let cursor: string | undefined;
      do {
        const page = await this.storage.tasks.listByProject(project.id, {
          limit: 500,
          ...(cursor ? { cursor } : {}),
        });
        tasks.push(...page.items);
        cursor = page.cursor;
      } while (cursor);
      return {
        kind: 'project',
        id: project.id,
        key: project.prefix,
        title: project.name,
        ...(project.icon ? { icon: project.icon } : {}),
        rank: card.rank,
        column: card.column,
        tasks,
        points: 0,
      };
    }
    let epic: Epic;
    try {
      epic = await this.storage.epics.get(card.id);
    } catch (error) {
      if (error instanceof NotFoundError) return undefined;
      throw error;
    }
    const members = await this.storage.epics.listTasks(epic.ref);
    const tasks = await this.storage.tasks.getMany(members.map((m) => m.taskRef));
    return {
      kind: 'epic',
      id: epic.ref,
      key: epic.ref,
      title: epic.name,
      rank: card.rank,
      column: card.column,
      tasks,
      points: 0,
    };
  }

  /** Cards name projects by prefix or id, and epics by ref, in any case. */
  private async resolveCardId(kind: BoardCard['kind'], id: string): Promise<string> {
    if (kind === 'epic') return (await this.storage.epics.get(normaliseEpicRef(id))).ref;
    try {
      return (await this.storage.projects.get(id.toUpperCase())).id;
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
      return (await this.storage.projects.getById(id)).id;
    }
  }
}

function sumPoints(tasks: Task[]): number {
  return tasks.reduce((n, t) => n + (t.points ?? 0), 0);
}

function normaliseMaybeEpic(id: string): string {
  try {
    return normaliseEpicRef(id);
  } catch {
    return id;
  }
}
