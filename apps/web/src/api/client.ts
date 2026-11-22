import { getConfig } from '../config/config';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface AuthHooks {
  /** The Cognito ID token (not the access token) to send as the Bearer credential. */
  getToken: () => string | undefined;
  /** Called on a 401: the signed-in session is missing or expired, so sign in again. */
  onUnauthorised: () => void;
}

let hooks: AuthHooks = { getToken: () => undefined, onUnauthorised: () => {} };

export function configureApiAuth(next: AuthHooks): void {
  hooks = next;
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = hooks.getToken();
  const response = await fetch(`${getConfig().apiBase}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      accept: 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });

  if (response.status === 401) {
    hooks.onUnauthorised();
    throw new ApiError(401, 'UNAUTHORISED', 'Signed out');
  }
  if (!response.ok) {
    let code = 'INTERNAL';
    let message = `HTTP ${response.status}`;
    try {
      const body = (await response.json()) as { error?: { code?: string; message?: string } };
      code = body.error?.code ?? code;
      message = body.error?.message ?? message;
    } catch {
      // A non-JSON error body: keep the status line.
    }
    throw new ApiError(response.status, code, message);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
