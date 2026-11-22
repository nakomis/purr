/**
 * A deterministic stand-in for a real embedding model: a hashed bag of words with
 * a small synonym table, so that related words land near each other without any
 * network call. Vectors are L2-normalised, like Titan's with `normalize: true`.
 */
import type { Embedder } from '@purr/domain';

/** Words in a group share one concept, so "sd card" and "microsd" are close. */
const SYNONYM_GROUPS: string[][] = [
  ['sd', 'microsd', 'card', 'flash', 'storage'],
  ['connected', 'wired', 'cable', 'ethernet', 'plugged', 'connection'],
  ['esp32', 's3', 'esp', 'espressif', 'microcontroller'],
  ['cat', 'cats', 'kitten', 'feline'],
  ['broken', 'faulty', 'failing', 'crashed', 'bug'],
  ['slow', 'sluggish', 'laggy'],
];

const CONCEPT = new Map<string, string>();
for (const [i, group] of SYNONYM_GROUPS.entries())
  for (const word of group) CONCEPT.set(word, `concept-${i}`);

const STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'is',
  'are',
  'to',
  'of',
  'and',
  'in',
  'on',
  'for',
  'with',
  'it',
]);

/** FNV-1a, 32-bit. */
function fnv(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function createFakeEmbedder(dimensions = 64): Embedder {
  const embedOne = (text: string): Float32Array => {
    const v = new Float32Array(dimensions);
    const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
    for (const word of words) {
      if (STOPWORDS.has(word)) continue;
      const token = CONCEPT.get(word) ?? word;
      const h = fnv(token);
      const slot = h % dimensions;
      v[slot] = (v[slot] ?? 0) + (h & 0x80000000 ? -1 : 1);
    }
    let norm = 0;
    for (const x of v) norm += x * x;
    norm = Math.sqrt(norm);
    if (norm > 0) for (let i = 0; i < v.length; i++) v[i] = (v[i] ?? 0) / norm;
    return v;
  };
  return {
    model: `fake-bow-${dimensions}`,
    dimensions,
    async embed(texts) {
      return texts.map(embedOne);
    },
  };
}
