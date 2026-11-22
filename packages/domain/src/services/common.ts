import { VersionMismatchError } from '../errors.js';
import type { DomainEvent, EventPublisher } from '../events.js';
import type { Storage } from '../ports.js';

export interface ServiceDeps {
  storage: Storage;
  events: EventPublisher;
  /** Where publish failures are reported; defaults to console.warn. */
  warn?: (message: string, error: unknown) => void;
}

/**
 * Best-effort: a failure to publish is logged and swallowed. Search freshness may
 * lag, but a write never fails because the indexer's queue did (anti-goal 4).
 */
export async function publish(deps: ServiceDeps, events: DomainEvent[]): Promise<void> {
  if (events.length === 0) return;
  try {
    await deps.events.publish(events);
  } catch (error) {
    (deps.warn ?? ((m, e) => console.warn(m, e)))('publishing domain events failed', error);
  }
}

/**
 * Read-modify-write with optimistic concurrency, retried a few times on a
 * VersionMismatch. Only for changes that are safe to re-apply to a fresher copy
 * (adding a label, a link); a caller-supplied version is never retried.
 */
export async function withRetry<T>(attempt: () => Promise<T>, tries = 4): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await attempt();
    } catch (error) {
      if (!(error instanceof VersionMismatchError) || i >= tries) throw error;
    }
  }
}
