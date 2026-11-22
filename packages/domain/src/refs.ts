import { ValidationError } from './errors.js';
import type { EpicRef, TaskRef } from './types.js';

export const EPIC_PREFIX = 'EPIC';
const PREFIX = /^[A-Z][A-Z0-9]{1,11}$/;
const TASK_REF = /^([A-Z][A-Z0-9]{1,11})-([1-9][0-9]*)$/;

export function validatePrefix(prefix: string): string {
  if (!PREFIX.test(prefix) || prefix === EPIC_PREFIX) {
    throw new ValidationError(
      `invalid project prefix ${JSON.stringify(prefix)} (2-12 capitals/digits, not EPIC)`,
    );
  }
  return prefix;
}

export function taskRef(prefix: string, sequence: number): TaskRef {
  return `${prefix}-${sequence}`;
}

export function epicRef(sequence: number): EpicRef {
  return `${EPIC_PREFIX}-${sequence}`;
}

/** Splits "HOME-42" into its prefix and sequence, case-insensitively. */
export function parseTaskRef(ref: string): { prefix: string; sequence: number } {
  const m = TASK_REF.exec(ref.toUpperCase());
  if (!m || m[1] === EPIC_PREFIX) throw new ValidationError(`invalid task ref ${JSON.stringify(ref)}`);
  return { prefix: m[1] as string, sequence: Number(m[2]) };
}

export function normaliseTaskRef(ref: string): TaskRef {
  const { prefix, sequence } = parseTaskRef(ref);
  return taskRef(prefix, sequence);
}

export function normaliseEpicRef(ref: string): EpicRef {
  const m = /^EPIC-([1-9][0-9]*)$/.exec(ref.toUpperCase());
  if (!m) throw new ValidationError(`invalid epic ref ${JSON.stringify(ref)}`);
  return epicRef(Number(m[1]));
}
