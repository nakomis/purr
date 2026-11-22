import type { Config } from './config.js';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** An error body from the API, `{ error: { code, message } }`, as a thrown value. */
export class PurrApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly detail: string,
  ) {
    super(`${code} (HTTP ${status}): ${detail}`);
    this.name = 'PurrApiError';
  }
}

export type Query = Record<string, string | number | boolean | undefined>;

export interface RequestOptions {
  query?: Query;
  body?: unknown;
}

/** A small typed client over fetch. Pass `fetchImpl` in tests. */
export class PurrClient {
  constructor(
    private readonly config: Config,
    private readonly fetchImpl: FetchLike = (input, init) => fetch(input, init),
  ) {}

  async request<T = unknown>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined) qs.set(k, String(v));
    }
    const url = `${this.config.url}/api${path}${qs.size > 0 ? `?${qs}` : ''}`;
    const headers: Record<string, string> = { 'x-api-key': this.config.apiKey, accept: 'application/json' };
    const init: RequestInit = { method, headers };
    if (opts.body !== undefined) {
      headers['content-type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }

    let res: Response;
    try {
      res = await this.fetchImpl(url, init);
    } catch (err) {
      throw new Error(`Could not reach Purr at ${this.config.url}: ${(err as Error).message}`);
    }

    const text = await res.text();
    let json: unknown;
    if (text.length > 0) {
      try {
        json = JSON.parse(text);
      } catch {
        json = undefined;
      }
    }
    if (!res.ok) {
      const e = (json as { error?: { code?: string; message?: string } } | undefined)?.error;
      throw new PurrApiError(
        res.status,
        e?.code ?? 'HTTP_ERROR',
        e?.message ?? (text.slice(0, 200) || res.statusText),
      );
    }
    return json as T;
  }

  get<T = unknown>(path: string, query?: Query): Promise<T> {
    return this.request<T>('GET', path, { query });
  }
  post<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, { body });
  }
  put<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PUT', path, { body });
  }
  patch<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PATCH', path, { body });
  }
  delete<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('DELETE', path, { body });
  }
}
