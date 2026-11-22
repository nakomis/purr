import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { type AuthDeps, authenticate } from './auth.js';
import { type ApiRequest, type ApiResponse, errorResponse, HttpError } from './http.js';
import type { Router } from './router.js';

const API_PREFIX = '/api';

function lowerHeaders(h: Record<string, string | undefined> | undefined): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(h ?? {})) out[k.toLowerCase()] = v;
  return out;
}

function parseBody(event: APIGatewayProxyEventV2): unknown {
  if (!event.body) return undefined;
  const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  if (!raw.trim()) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'VALIDATION', 'the body is not valid JSON');
  }
}

function toResult(res: ApiResponse): APIGatewayProxyResultV2 {
  return {
    statusCode: res.status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...res.headers,
    },
    ...(res.body !== undefined ? { body: JSON.stringify(res.body) } : {}),
  };
}

/** One API Gateway HTTP API event in, one response out: route, authenticate, handle, shape errors. */
export async function handleEvent(
  event: APIGatewayProxyEventV2,
  router: Router,
  auth: AuthDeps,
): Promise<APIGatewayProxyResultV2> {
  try {
    const method = event.requestContext.http.method.toUpperCase();
    let path = event.rawPath;
    if (path.startsWith(API_PREFIX)) path = path.slice(API_PREFIX.length) || '/';
    const route = router.match(method, path);
    const headers = lowerHeaders(event.headers);
    const actor = route.public ? 'system' : await authenticate(headers, auth);
    const query: Record<string, string | undefined> = { ...(event.queryStringParameters ?? {}) };
    const raw = new URLSearchParams(event.rawQueryString ?? '');
    const req: ApiRequest = {
      method,
      path,
      params: route.params,
      query,
      queryAll: (name) =>
        raw
          .getAll(name)
          .flatMap((v) => v.split(','))
          .map((v) => v.trim())
          .filter(Boolean),
      headers,
      body: parseBody(event),
      actor,
    };
    return toResult(await route.handler(req));
  } catch (error) {
    return toResult(errorResponse(error));
  }
}
