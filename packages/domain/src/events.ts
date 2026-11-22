import type { EpicRef, TaskRef } from './types.js';

/** What happened, for anything that reacts asynchronously (the search indexer). */
export type DomainEvent =
  | { type: 'TaskChanged'; ref: TaskRef }
  | { type: 'CommentAdded'; taskRef: TaskRef; commentId: string }
  | { type: 'EpicChanged'; ref: EpicRef };

export interface EventPublisher {
  publish(events: DomainEvent[]): Promise<void>;
}

/** Discards events: for tools and tests that don't index. */
export const nullPublisher: EventPublisher = { publish: async () => {} };

/** Collects events in memory: for tests. */
export class RecordingPublisher implements EventPublisher {
  readonly events: DomainEvent[] = [];
  async publish(events: DomainEvent[]): Promise<void> {
    this.events.push(...events);
  }
}
