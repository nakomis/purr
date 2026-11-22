export * from './errors.js';
export * from './events.js';
export * from './ids.js';
export * from './ports.js';
export * from './rank.js';
export * from './refs.js';
export * from './services/board.js';
export * from './services/common.js';
export * from './services/epics.js';
export * from './services/projects.js';
export * from './services/tasks.js';
export * from './types.js';

import type { EventPublisher } from './events.js';
import type { Storage } from './ports.js';
import { BoardService } from './services/board.js';
import { EpicService } from './services/epics.js';
import { ProjectService } from './services/projects.js';
import { TaskService } from './services/tasks.js';

export interface Services {
  projects: ProjectService;
  tasks: TaskService;
  epics: EpicService;
  board: BoardService;
}

/** Wire every service over one storage and one event publisher. */
export function createServices(storage: Storage, events: EventPublisher): Services {
  const deps = { storage, events };
  return {
    projects: new ProjectService(deps),
    tasks: new TaskService(deps),
    epics: new EpicService(deps),
    board: new BoardService(deps),
  };
}
