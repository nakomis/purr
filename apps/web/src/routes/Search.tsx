import { Link, useSearchParams } from 'react-router';
import { search } from '../api/endpoints';
import type { SearchHit, SearchMode } from '../api/types';
import { Async } from '../components/Notice';
import { useAsync } from '../lib/useAsync';

const MODES: { value: SearchMode; label: string }[] = [
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'semantic', label: 'Meaning' },
  { value: 'fulltext', label: 'Exact words' },
];

const isMode = (v: string | null): v is SearchMode => MODES.some((m) => m.value === v);

function hitTarget(hit: SearchHit): { ref: string; to: string } {
  if (hit.kind === 'epic') {
    const ref = hit.epicRef ?? hit.id;
    return { ref, to: `/epics/${ref}` };
  }
  const ref = hit.taskRef ?? hit.id;
  return { ref, to: `/tasks/${ref}` };
}

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const modeParam = params.get('mode');
  const mode: SearchMode = isMode(modeParam) ? modeParam : 'hybrid';
  const state = useAsync(`${mode}:${q}`, () => (q ? search(q, mode) : Promise.resolve([] as SearchHit[])));

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="mb-3 text-2xl font-bold">Search</h1>
      <form
        className="mb-4 flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const text = new FormData(event.currentTarget).get('q');
          setParams({ q: String(text ?? ''), mode });
        }}
      >
        <input
          name="q"
          type="search"
          aria-label="Search text"
          defaultValue={q}
          key={q}
          className="min-w-0 flex-1 rounded-full border border-line bg-surface px-4 py-2"
        />
        <select
          aria-label="Search mode"
          value={mode}
          onChange={(event) => setParams({ q, mode: event.target.value })}
          className="rounded-full border border-line bg-surface px-3 py-2"
        >
          {MODES.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
        <button type="submit" className="rounded-full bg-accent px-5 py-2 font-semibold text-bg">
          Search
        </button>
      </form>
      {q && (
        <Async state={state}>
          {state.data?.length === 0 ? (
            <p className="text-muted">Nothing found.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {state.data?.map((hit) => {
                const { ref, to } = hitTarget(hit);
                return (
                  <li key={`${hit.kind}:${hit.id}`} className="rounded-xl border border-line bg-surface p-3">
                    <p className="flex items-baseline gap-2">
                      <span className="rounded-full bg-accent-soft px-2 text-xs text-accent">{hit.kind}</span>
                      <Link to={to} className="font-mono text-sm font-semibold">
                        {ref}
                      </Link>
                      <span className="font-semibold">{hit.title}</span>
                    </p>
                    {hit.snippet && <p className="mt-1 text-sm text-muted">{hit.snippet}</p>}
                  </li>
                );
              })}
            </ul>
          )}
        </Async>
      )}
    </div>
  );
}
