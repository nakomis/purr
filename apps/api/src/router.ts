import { type ApiRequest, type ApiResponse, HttpError } from './http.js';

export type Handler = (req: ApiRequest) => Promise<ApiResponse>;

interface Route {
  method: string;
  pattern: string;
  regex: RegExp;
  names: string[];
  handler: Handler;
  public: boolean;
}

/** A small path router: patterns like "/tasks/{ref}/labels/{name}". */
export class Router {
  private readonly routes: Route[] = [];

  add(method: string, pattern: string, handler: Handler, opts: { public?: boolean } = {}): this {
    const names: string[] = [];
    const regex = new RegExp(
      `^${pattern.replace(/\{(\w+)\}/g, (_m, name: string) => {
        names.push(name);
        return '([^/]+)';
      })}/?$`,
    );
    this.routes.push({ method, pattern, regex, names, handler, public: opts.public ?? false });
    return this;
  }

  /** The matching route, with its decoded path parameters. */
  match(method: string, path: string): { handler: Handler; params: Record<string, string>; public: boolean } {
    let pathMatched = false;
    for (const route of this.routes) {
      const m = route.regex.exec(path);
      if (!m) continue;
      pathMatched = true;
      if (route.method !== method) continue;
      const params: Record<string, string> = {};
      route.names.forEach((name, i) => {
        params[name] = decodeURIComponent(m[i + 1] as string);
      });
      return { handler: route.handler, params, public: route.public };
    }
    if (pathMatched) throw new HttpError(405, 'METHOD_NOT_ALLOWED', `${method} is not allowed on ${path}`);
    throw new HttpError(404, 'ROUTE_NOT_FOUND', `no route for ${method} ${path}`);
  }

  list(): { method: string; pattern: string }[] {
    return this.routes.map(({ method, pattern }) => ({ method, pattern }));
  }
}
