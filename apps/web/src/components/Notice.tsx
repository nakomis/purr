import type { ReactNode } from 'react';

export function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'error' }) {
  return (
    <p
      role={tone === 'error' ? 'alert' : 'status'}
      className={`m-6 rounded-xl border border-line bg-surface px-4 py-3 ${tone === 'error' ? 'text-red-700 dark:text-red-300' : 'text-muted'}`}
    >
      {children}
    </p>
  );
}

/** Shows loading and error states, then the children once data has arrived. */
export function Async({
  state,
  children,
}: {
  state: { loading: boolean; error?: Error; data?: unknown };
  children: ReactNode;
}) {
  if (state.error) return <Notice tone="error">{state.error.message}</Notice>;
  if (state.loading || state.data === undefined) return <Notice>Loading…</Notice>;
  return <>{children}</>;
}
