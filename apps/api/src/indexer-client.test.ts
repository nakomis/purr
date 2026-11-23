import type { InvokeCommand } from '@aws-sdk/client-lambda';
import { describe, expect, it } from 'vitest';
import { indexerRebuilder } from './indexer-client.js';

const payload = (o: unknown) => new TextEncoder().encode(JSON.stringify(o));

describe('indexerRebuilder', () => {
  it('invokes the indexer with upUntil and returns its build time', async () => {
    let sent: InvokeCommand | undefined;
    const rebuild = indexerRebuilder('purr-indexer-prod', {
      send: async (c) => {
        sent = c;
        return { Payload: payload({ builtAt: '2026-11-23T15:00:00.000Z', skipped: false }) };
      },
    });
    expect(await rebuild('2026-11-23T14:00:00.000Z')).toEqual({ builtAt: '2026-11-23T15:00:00.000Z' });
    expect(sent?.input.FunctionName).toBe('purr-indexer-prod');
    expect(JSON.parse(new TextDecoder().decode(sent?.input.Payload as Uint8Array))).toEqual({
      upUntil: '2026-11-23T14:00:00.000Z',
    });
  });

  it("reports 'busy' when the indexer is already running (throttled)", async () => {
    const rebuild = indexerRebuilder('f', {
      send: async () => {
        throw Object.assign(new Error('Rate exceeded'), { name: 'TooManyRequestsException' });
      },
    });
    expect(await rebuild('2026-11-23T14:00:00.000Z')).toBe('busy');
  });

  it('throws when the indexer fails or answers without a build time', async () => {
    const failed = indexerRebuilder('f', {
      send: async () => ({ FunctionError: 'Unhandled', Payload: payload({ errorMessage: 'boom' }) }),
    });
    await expect(failed('x')).rejects.toThrow('indexer failed: boom');
    const empty = indexerRebuilder('f', { send: async () => ({ Payload: payload({}) }) });
    await expect(empty('x')).rejects.toThrow('without a build time');
    const other = indexerRebuilder('f', {
      send: async () => {
        throw new Error('network');
      },
    });
    await expect(other('x')).rejects.toThrow('network');
  });
});
