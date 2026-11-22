import type { InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { describe, expect, it, vi } from 'vitest';
import { type BedrockLike, createBedrockEmbedder, MAX_INPUT_CHARS } from './index.js';

const reply = (embedding: number[]) => ({ body: new TextEncoder().encode(JSON.stringify({ embedding })) });
const bodyOf = (c: InvokeModelCommand) => JSON.parse(c.input.body as string);

describe('createBedrockEmbedder', () => {
  it('sends Titan v2 requests and returns vectors in input order', async () => {
    const calls: InvokeModelCommand[] = [];
    const client: BedrockLike = {
      async send(c) {
        calls.push(c);
        const { inputText } = bodyOf(c);
        // Finish out of order, to prove the output order follows the input.
        await new Promise((r) => setTimeout(r, inputText === 'a' ? 10 : 0));
        return reply([inputText.length, 0, 0]);
      },
    };
    const e = createBedrockEmbedder({ client, dimensions: 3 });
    expect(e.model).toBe('amazon.titan-embed-text-v2:0');
    expect(e.dimensions).toBe(3);
    const out = await e.embed(['a', 'bb', 'ccc']);
    expect(out.map((v) => v[0])).toEqual([1, 2, 3]);
    expect(out[0]).toBeInstanceOf(Float32Array);
    expect(calls[0]?.input.modelId).toBe('amazon.titan-embed-text-v2:0');
    expect(bodyOf(calls[0] as InvokeModelCommand)).toEqual({
      inputText: 'a',
      dimensions: 3,
      normalize: true,
    });
  });

  it('defaults to 1,024 dimensions and accepts a transformToString body', async () => {
    const client: BedrockLike = {
      send: async () => ({
        body: { transformToString: () => JSON.stringify({ embedding: new Array(1024).fill(0.5) }) },
      }),
    };
    const [v] = await createBedrockEmbedder({ client }).embed(['x']);
    expect(v?.length).toBe(1024);
  });

  it('truncates long input to about 8,000 characters and tolerates empty text', async () => {
    const seen: string[] = [];
    const client: BedrockLike = {
      async send(c) {
        seen.push(bodyOf(c).inputText);
        return reply([1]);
      },
    };
    await createBedrockEmbedder({ client, dimensions: 1 }).embed(['x'.repeat(20_000), '']);
    expect(seen[0]).toHaveLength(MAX_INPUT_CHARS);
    expect(seen[1]).toBe(' ');
  });

  it('limits concurrency', async () => {
    let active = 0;
    let peak = 0;
    const client: BedrockLike = {
      async send() {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 2));
        active--;
        return reply([1]);
      },
    };
    await createBedrockEmbedder({ client, dimensions: 1, concurrency: 3 }).embed(new Array(20).fill('t'));
    expect(peak).toBe(3);
  });

  it('retries on throttling with back-off, then succeeds', async () => {
    let n = 0;
    const client: BedrockLike = {
      async send() {
        if (++n < 3) throw Object.assign(new Error('slow down'), { name: 'ThrottlingException' });
        return reply([1]);
      },
    };
    const sleep = vi.fn(async () => {});
    const out = await createBedrockEmbedder({ client, dimensions: 1, sleep }).embed(['t']);
    expect(out).toHaveLength(1);
    expect(n).toBe(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('gives up after maxAttempts of throttling', async () => {
    const send = vi.fn(async () => {
      throw Object.assign(new Error('slow down'), { $metadata: { httpStatusCode: 429 } });
    });
    const e = createBedrockEmbedder({
      client: { send },
      dimensions: 1,
      maxAttempts: 3,
      sleep: async () => {},
    });
    await expect(e.embed(['t'])).rejects.toThrow('slow down');
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('does not retry other errors', async () => {
    const send = vi.fn(async () => {
      throw Object.assign(new Error('no access'), { name: 'AccessDeniedException' });
    });
    await expect(
      createBedrockEmbedder({ client: { send }, dimensions: 1, sleep: async () => {} }).embed(['t']),
    ).rejects.toThrow('no access');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('rejects a response of the wrong size', async () => {
    const client: BedrockLike = { send: async () => reply([1, 2]) };
    await expect(createBedrockEmbedder({ client, dimensions: 3 }).embed(['t'])).rejects.toThrow(
      /2 dimensions/,
    );
  });

  it('embeds nothing for an empty list', async () => {
    const send = vi.fn();
    expect(await createBedrockEmbedder({ client: { send }, dimensions: 1 }).embed([])).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });
});
describe('pacing', () => {
  it('starts calls at most maxPerSecond apart', async () => {
    let clock = 0;
    const starts: number[] = [];
    const embedder = createBedrockEmbedder({
      maxPerSecond: 10,
      concurrency: 1,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
      client: {
        send: async () => {
          starts.push(clock);
          return { body: new TextEncoder().encode(JSON.stringify({ embedding: new Array(1024).fill(0.1) })) };
        },
      },
    });
    await embedder.embed(['a', 'b', 'c', 'd', 'e']);
    const gaps = starts.slice(1).map((t, i) => t - (starts[i] as number));
    expect(starts).toHaveLength(5);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(100);
  });
});

describe('pacing across workers', () => {
  it('shares one rate between parallel workers (real timers)', async () => {
    const starts: number[] = [];
    const embedder = createBedrockEmbedder({
      maxPerSecond: 50,
      concurrency: 4,
      client: {
        send: async () => {
          starts.push(Date.now());
          return { body: new TextEncoder().encode(JSON.stringify({ embedding: new Array(1024).fill(0.1) })) };
        },
      },
    });
    const t0 = Date.now();
    await embedder.embed(['a', 'b', 'c', 'd', 'e', 'f']);
    // Six calls at 50/s need at least five 20 ms gaps, whatever the concurrency.
    expect(Date.now() - t0).toBeGreaterThanOrEqual(95);
    expect(starts).toHaveLength(6);
  });
});
