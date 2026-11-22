import { useEffect, useState } from 'react';
import { useAuth } from 'react-oidc-context';
import { Link, NavLink, Outlet, useNavigate } from 'react-router';
import { logoutUrl } from '../auth/oidc';
import { getConfig } from '../config/config';

const navClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-full px-3 py-1 text-sm font-medium no-underline ${isActive ? 'bg-accent text-bg' : 'text-ink hover:bg-accent-soft'}`;

function SearchBox() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  return (
    <search className="flex-1 sm:max-w-xs">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (q.trim()) void navigate(`/search?q=${encodeURIComponent(q.trim())}`);
        }}
      >
        <input
          type="search"
          aria-label="Search"
          placeholder="Search…"
          value={q}
          onChange={(event) => setQ(event.target.value)}
          className="w-full rounded-full border border-line bg-surface px-4 py-1.5 text-sm outline-accent"
        />
      </form>
    </search>
  );
}

function SignOut() {
  const auth = useAuth();
  return (
    <button
      type="button"
      className="text-sm text-muted underline"
      onClick={() => {
        void auth.removeUser();
        window.location.href = logoutUrl(getConfig());
      }}
    >
      Sign out
    </button>
  );
}

function Footer() {
  const [version, setVersion] = useState<string>();
  useEffect(() => {
    // Written at deploy time; absent in local development, which is fine.
    fetch('/version.json')
      .then((r) => (r.ok ? r.json() : undefined))
      .then((v: { version?: string } | undefined) => setVersion(v?.version))
      .catch(() => undefined);
  }, []);
  return (
    <footer className="border-t border-line px-4 py-3 text-center text-xs text-muted">
      Purr{version ? ` v${version}` : ''}
    </footer>
  );
}

export function Layout() {
  return (
    <div className="flex min-h-screen flex-col">
      <img
        src="/banner.png"
        alt="Four cats peeking over a ledge"
        className="h-20 w-full object-cover sm:h-32"
        style={{ objectPosition: 'center 35%' }}
      />
      <header className="sticky top-0 z-10 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-bg/95 px-4 py-2 backdrop-blur">
        <Link to="/" className="flex items-center gap-2 text-lg font-bold text-ink no-underline">
          <img src="/logo.png" alt="" width={32} height={32} className="rounded-md" />
          Purr
        </Link>
        <nav className="flex gap-1" aria-label="Main">
          <NavLink to="/" end className={navClass}>
            Board
          </NavLink>
          <NavLink to="/projects" className={navClass}>
            Projects
          </NavLink>
          <NavLink to="/epics" className={navClass}>
            Epics
          </NavLink>
        </nav>
        <SearchBox />
        <SignOut />
      </header>
      <main className="mx-auto w-full max-w-[110rem] flex-1 px-3 py-4 sm:px-6">
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}
