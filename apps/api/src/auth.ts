import { createHash } from 'node:crypto';
import type { Actor, ApiKeyRepository } from '@purr/domain';
import { HttpError } from './http.js';

/** Verifies a Cognito ID token and returns its claims; throws on anything invalid. */
export type IdTokenVerifier = (token: string) => Promise<{ email?: unknown; [k: string]: unknown }>;

export interface AuthDeps {
  apiKeys: ApiKeyRepository;
  verifyIdToken?: IdTokenVerifier;
  /** Cognito users allowed in, by verified email (the shared pool holds others too). They act as martin. */
  allowedEmails: string[];
}

export const hashApiKey = (key: string): string => createHash('sha256').update(key, 'utf8').digest('hex');

const unauthorised = (message: string) => new HttpError(401, 'UNAUTHORISED', message);

/**
 * Who is calling: an agent by its API key (`x-api-key`), or Martin by a Cognito ID
 * token (`Authorization: Bearer`). Every failure is a 401, never a 500.
 */
export async function authenticate(
  headers: Record<string, string | undefined>,
  deps: AuthDeps,
): Promise<Actor> {
  const apiKey = headers['x-api-key'];
  if (apiKey !== undefined) {
    if (!/^[A-Za-z0-9_-]{20,200}$/.test(apiKey)) throw unauthorised('malformed API key');
    const record = await deps.apiKeys.findByHash(hashApiKey(apiKey));
    if (!record) throw unauthorised('unknown API key');
    return record.actor;
  }
  const authz = headers.authorization;
  if (authz !== undefined) {
    const m = /^Bearer\s+(\S+)$/i.exec(authz);
    if (!m) throw unauthorised('malformed Authorization header');
    if (!deps.verifyIdToken) throw unauthorised('sign-in is not configured');
    let claims: Awaited<ReturnType<IdTokenVerifier>>;
    try {
      claims = await deps.verifyIdToken(m[1] as string);
    } catch {
      throw unauthorised('invalid or expired token');
    }
    const email = typeof claims.email === 'string' ? claims.email.toLowerCase() : '';
    if (!deps.allowedEmails.map((e) => e.toLowerCase()).includes(email)) {
      throw new HttpError(403, 'FORBIDDEN', 'this account may not use Purr');
    }
    return 'martin';
  }
  throw unauthorised('sign in, or send an API key');
}
