/**
 * The Embedder port on Amazon Bedrock (Titan Text Embeddings v2). Titan embeds one
 * text per call, so texts go out with modest concurrency and retry on throttling.
 * This is the only package that may import the Bedrock runtime SDK.
 */
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import type { Embedder } from '@purr/domain';

/** The slice of BedrockRuntimeClient the embedder uses. */
export interface BedrockLike {
  send(command: InvokeModelCommand): Promise<{ body?: Uint8Array | { transformToString(): string } }>;
}

export interface BedrockEmbedderOptions {
  client?: BedrockLike;
  region?: string;
  modelId?: string;
  dimensions?: number;
  /** Parallel InvokeModel calls. Default 8. */
  concurrency?: number;
  /** Attempts per text, throttling only. Default 5. */
  maxAttempts?: number;
  /** Base back-off in ms (doubles per attempt, with jitter). Default 250. */
  retryBaseMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /**
   * The most InvokeModel calls to start per second, across all workers. Bedrock's
   * on-demand quota for Titan v2 is per minute (600 in prod), so pacing under it
   * keeps a large rebuild from being throttled into failure. Default: unpaced.
   */
  maxPerSecond?: number;
  now?: () => number;
}

/** Titan v2 accepts 8,192 tokens; ~8,000 characters is safely inside that. */
export const MAX_INPUT_CHARS = 8000;

const THROTTLE_NAMES = new Set([
  'ThrottlingException',
  'TooManyRequestsException',
  'ServiceUnavailableException',
  'ModelNotReadyException',
]);

function isThrottle(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return THROTTLE_NAMES.has(e.name ?? '') || e.$metadata?.httpStatusCode === 429;
}

export function createBedrockEmbedder(opts: BedrockEmbedderOptions = {}): Embedder {
  const modelId = opts.modelId ?? 'amazon.titan-embed-text-v2:0';
  const dimensions = opts.dimensions ?? 1024;
  const concurrency = Math.max(1, opts.concurrency ?? 8);
  const maxAttempts = opts.maxAttempts ?? 5;
  const retryBaseMs = opts.retryBaseMs ?? 250;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;
  const spacingMs = opts.maxPerSecond && opts.maxPerSecond > 0 ? 1000 / opts.maxPerSecond : 0;
  let nextSlot = 0;
  /** Waits for this call's turn: calls start at most maxPerSecond apart, shared by every worker. */
  async function pace(): Promise<void> {
    if (!spacingMs) return;
    const t = now();
    const at = Math.max(t, nextSlot);
    nextSlot = at + spacingMs;
    if (at > t) await sleep(at - t);
  }
  const client: BedrockLike =
    opts.client ??
    (new BedrockRuntimeClient({ region: opts.region ?? 'eu-west-2' }) as unknown as BedrockLike);

  async function embedOne(text: string): Promise<Float32Array> {
    // Titan rejects empty input.
    const inputText = (text.trim() ? text : ' ').slice(0, MAX_INPUT_CHARS);
    const command = new InvokeModelCommand({
      modelId,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({ inputText, dimensions, normalize: true }),
    });
    for (let attempt = 1; ; attempt++) {
      try {
        await pace();
        const res = await client.send(command);
        const raw = res.body;
        const json =
          typeof raw === 'object' && raw && 'transformToString' in raw
            ? raw.transformToString()
            : new TextDecoder().decode(raw);
        const { embedding } = JSON.parse(json) as { embedding?: number[] };
        if (!embedding || embedding.length !== dimensions)
          throw new Error(`Bedrock returned ${embedding?.length ?? 0} dimensions, expected ${dimensions}`);
        return Float32Array.from(embedding);
      } catch (err) {
        if (!isThrottle(err) || attempt >= maxAttempts) throw err;
        await sleep(retryBaseMs * 2 ** (attempt - 1) * (0.5 + Math.random()));
      }
    }
  }

  return {
    model: modelId,
    dimensions,
    async embed(texts) {
      const out = new Array<Float32Array>(texts.length);
      let next = 0;
      const worker = async () => {
        while (next < texts.length) {
          const i = next++;
          out[i] = await embedOne(texts[i] as string);
        }
      };
      await Promise.all(Array.from({ length: Math.min(concurrency, texts.length) }, worker));
      return out;
    },
  };
}
