import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { handleEvent } from '../app.js';
import { makeApi, readEnv } from '../composition.js';

// Built once per warm instance.
let api: ReturnType<typeof makeApi> | undefined;

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  api ??= makeApi(readEnv());
  return handleEvent(event, api.router, api.auth);
}
