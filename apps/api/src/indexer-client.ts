/**
 * Asking the indexer Lambda for a rebuild, synchronously. The indexer has a reserved
 * concurrency of one, so while it is already rebuilding a second invocation is
 * throttled: that is reported as 'busy', and the caller waits for the running build
 * rather than queueing another.
 */
import { InvokeCommand } from '@aws-sdk/client-lambda';

export interface LambdaLike {
  send(command: InvokeCommand): Promise<{ FunctionError?: string; Payload?: Uint8Array }>;
}

export function indexerRebuilder(functionName: string, client: LambdaLike) {
  return async (upUntil: string): Promise<{ builtAt: string } | 'busy'> => {
    let res: { FunctionError?: string; Payload?: Uint8Array };
    try {
      res = await client.send(
        new InvokeCommand({
          FunctionName: functionName,
          Payload: new TextEncoder().encode(JSON.stringify({ upUntil })),
        }),
      );
    } catch (err) {
      const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (e.name === 'TooManyRequestsException' || e.$metadata?.httpStatusCode === 429) return 'busy';
      throw err;
    }
    const body = res.Payload?.length ? JSON.parse(new TextDecoder().decode(res.Payload)) : undefined;
    if (res.FunctionError) throw new Error(`indexer failed: ${body?.errorMessage ?? res.FunctionError}`);
    if (typeof body?.builtAt !== 'string') throw new Error('indexer answered without a build time');
    return { builtAt: body.builtAt };
  };
}
