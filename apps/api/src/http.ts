import type { Actor } from '@purr/domain';
import { PurrError } from '@purr/domain';

/** A request after parsing, independent of API Gateway's event shape. */
export interface ApiRequest {
  method: string;
  /** The path below /api, e.g. "/tasks/HOME-42". */
  path: string;
  params: Record<string, string>;
  query: Record<string, string | undefined>;
  /** Repeated or comma-separated query values, split. */
  queryAll: (name: string) => string[];
  headers: Record<string, string | undefined>;
  body: unknown;
  actor: Actor;
}

export interface ApiResponse {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const ok = (body: unknown): ApiResponse => ({ status: 200, body });
export const created = (body: unknown): ApiResponse => ({ status: 201, body });
export const noContent = (): ApiResponse => ({ status: 204 });

const STATUS_BY_CODE: Record<string, number> = {
  VALIDATION: 400,
  NOT_FOUND: 404,
  ALREADY_EXISTS: 409,
  CONFLICT: 409,
  VERSION_MISMATCH: 409,
};

/** Domain and HTTP errors to the API's error body; anything else is a 500 with no detail leaked. */
export function errorResponse(error: unknown, log: (e: unknown) => void = console.error): ApiResponse {
  if (error instanceof HttpError) {
    return { status: error.status, body: { error: { code: error.code, message: error.message } } };
  }
  if (error instanceof PurrError) {
    return {
      status: STATUS_BY_CODE[error.code] ?? 400,
      body: { error: { code: error.code, message: error.message } },
    };
  }
  log(error);
  return { status: 500, body: { error: { code: 'INTERNAL', message: 'Something went wrong' } } };
}

// ── Body helpers: small, explicit validation (no schema library) ─────────────

export function bodyObject(req: ApiRequest): Record<string, unknown> {
  const b = req.body;
  if (b === undefined || b === null) return {};
  if (typeof b !== 'object' || Array.isArray(b))
    throw new HttpError(400, 'VALIDATION', 'the body must be a JSON object');
  return b as Record<string, unknown>;
}

export function str(o: Record<string, unknown>, key: string, required: true): string;
export function str(o: Record<string, unknown>, key: string, required?: false): string | undefined;
export function str(o: Record<string, unknown>, key: string, required = false): string | undefined {
  const v = o[key];
  if (v === undefined || v === null) {
    if (required) throw new HttpError(400, 'VALIDATION', `${key} is required`);
    return undefined;
  }
  if (typeof v !== 'string') throw new HttpError(400, 'VALIDATION', `${key} must be a string`);
  return v;
}

export function num(o: Record<string, unknown>, key: string, required: true): number;
export function num(o: Record<string, unknown>, key: string, required?: false): number | undefined;
export function num(o: Record<string, unknown>, key: string, required = false): number | undefined {
  const v = o[key];
  if (v === undefined || v === null) {
    if (required) throw new HttpError(400, 'VALIDATION', `${key} is required`);
    return undefined;
  }
  if (typeof v !== 'number' || !Number.isFinite(v))
    throw new HttpError(400, 'VALIDATION', `${key} must be a number`);
  return v;
}

export function strArray(o: Record<string, unknown>, key: string): string[] | undefined {
  const v = o[key];
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) {
    throw new HttpError(400, 'VALIDATION', `${key} must be an array of strings`);
  }
  return v as string[];
}

export function bool(value: string | undefined): boolean {
  return value === 'true' || value === '1';
}

export function limitParam(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 1000)
    throw new HttpError(400, 'VALIDATION', 'limit must be 1 to 1000');
  return n;
}
