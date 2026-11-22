import type { IndexedDoc } from '@purr/contracts';
import type { Embedder, SearchHit, SearchIndex, SearchQuery } from '@purr/domain';
import MiniSearch from 'minisearch';
import { cosine, dequantise } from './quantise.js';
import { MINISEARCH_OPTIONS, type Snapshot } from './snapshot.js';

const RRF_K = 60;
const DEFAULT_LIMIT = 20;
/** How deep each ranked list goes before fusion. */
const CANDIDATES = 100;
const SNIPPET_LENGTH = 200;

export interface SearchIndexOptions {
  /** Returns the current snapshot, or undefined when none has been built yet. */
  load: () => Promise<Snapshot | undefined>;
  embedder: Embedder;
  /** How long a warm instance keeps a loaded snapshot. Default 60 s. */
  cacheMs?: number;
}

interface Loaded {
  snapshot: Snapshot;
  ms: MiniSearch;
  vectors: Float32Array[];
}

interface Ranked {
  n: number;
  score: number;
}

export function createSearchIndex(opts: SearchIndexOptions): SearchIndex {
  const cacheMs = opts.cacheMs ?? 60_000;
  let cached: { at: number; loaded: Loaded | undefined } | undefined;
  let inflight: Promise<Loaded | undefined> | undefined;

  const fetchLoaded = async (): Promise<Loaded | undefined> => {
    const snapshot = await opts.load();
    if (!snapshot) return undefined;
    return {
      snapshot,
      ms: MiniSearch.loadJS(snapshot.index as never, MINISEARCH_OPTIONS),
      vectors: snapshot.vectors.map((values, i) => dequantise({ values, scale: snapshot.scales[i] ?? 0 })),
    };
  };

  const current = async (): Promise<Loaded | undefined> => {
    if (cached && Date.now() - cached.at < cacheMs) return cached.loaded;
    // Concurrent queries on a cold instance share one load.
    inflight ??= fetchLoaded()
      .then((loaded) => {
        cached = { at: Date.now(), loaded };
        return loaded;
      })
      .finally(() => {
        inflight = undefined;
      });
    return inflight;
  };

  return {
    async query(q: SearchQuery): Promise<SearchHit[]> {
      const text = q.text.trim();
      if (!text) return [];
      const loaded = await current();
      if (!loaded || loaded.snapshot.docs.length === 0) return [];
      const { snapshot } = loaded;
      const limit = q.limit ?? DEFAULT_LIMIT;
      const allowed = (n: number) => matches(snapshot.docs[n], q);

      const fulltext = (): Ranked[] =>
        loaded.ms
          .search(text, { prefix: true, fuzzy: 0.2, boost: { title: 2 }, filter: (r) => allowed(r.id) })
          .slice(0, CANDIDATES)
          .map((r) => ({ n: r.id as number, score: r.score }));

      const semantic = async (): Promise<Ranked[]> => {
        if (snapshot.dimensions === 0 || snapshot.dimensions !== opts.embedder.dimensions) return [];
        const [qv] = await opts.embedder.embed([text]);
        if (!qv) return [];
        const out: Ranked[] = [];
        for (const [n, v] of loaded.vectors.entries()) {
          if (!allowed(n)) continue;
          const score = cosine(qv, v);
          // Zero or negative similarity is no evidence of relatedness.
          if (score > 0) out.push({ n, score });
        }
        return out.sort((a, b) => b.score - a.score).slice(0, CANDIDATES);
      };

      let ranked: Ranked[];
      if (q.mode === 'fulltext') ranked = fulltext();
      else if (q.mode === 'semantic') ranked = await semantic();
      else ranked = fuse(fulltext(), await semantic());

      return ranked.slice(0, limit).flatMap((r) => {
        const doc = snapshot.docs[r.n];
        return doc ? [toHit(doc, r.score, text)] : [];
      });
    },
  };
}

/** Reciprocal Rank Fusion: each list contributes 1 / (k + rank), rank from 1. */
function fuse(...lists: Ranked[][]): Ranked[] {
  const scores = new Map<number, number>();
  for (const list of lists)
    for (const [i, r] of list.entries()) scores.set(r.n, (scores.get(r.n) ?? 0) + 1 / (RRF_K + i + 1));
  return [...scores].map(([n, score]) => ({ n, score })).sort((a, b) => b.score - a.score || a.n - b.n);
}

function matches(doc: IndexedDoc | undefined, q: SearchQuery): boolean {
  if (!doc) return false;
  if (q.kinds && q.kinds.length > 0 && !q.kinds.includes(doc.kind)) return false;
  if (q.projectId && doc.projectId !== q.projectId && !doc.projectIds?.includes(q.projectId)) return false;
  if (q.epicRef && doc.epicRef !== q.epicRef && !doc.epicRefs?.includes(q.epicRef)) return false;
  return true;
}

function toHit(doc: IndexedDoc, score: number, query: string): SearchHit {
  return {
    kind: doc.kind,
    id: doc.id,
    ...(doc.taskRef ? { taskRef: doc.taskRef } : {}),
    ...(doc.epicRef ? { epicRef: doc.epicRef } : {}),
    ...(doc.projectId ? { projectId: doc.projectId } : {}),
    title: doc.title,
    snippet: snippetFor(doc.text || doc.title, query),
    score,
  };
}

/** The ~200-character window of `text` richest in query terms, else its start. */
export function snippetFor(text: string, query: string, length = SNIPPET_LENGTH): string {
  if (text.length <= length) return text;
  const terms = (query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((t) => t.length > 1);
  const lower = text.toLowerCase();
  let bestStart = 0;
  let bestCount = 0;
  for (const term of terms) {
    for (let at = lower.indexOf(term); at >= 0; at = lower.indexOf(term, at + 1)) {
      const start = Math.max(0, Math.min(at - 40, text.length - length));
      const window = lower.slice(start, start + length);
      const count = terms.filter((t) => window.includes(t)).length;
      if (count > bestCount) {
        bestCount = count;
        bestStart = start;
      }
    }
  }
  const slice = text.slice(bestStart, bestStart + length).trim();
  return `${bestStart > 0 ? '…' : ''}${slice}${bestStart + length < text.length ? '…' : ''}`;
}
