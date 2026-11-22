import { Route, Routes } from 'react-router';
import { AuthGate } from './auth/AuthGate';
import { Layout } from './components/Layout';
import { Board } from './routes/Board';
import { LoggedIn, LoggedOut } from './routes/Callbacks';
import { EpicPage, Epics } from './routes/Epics';
import { Project } from './routes/Project';
import { Projects } from './routes/Projects';
import { SearchPage } from './routes/Search';
import { TaskPage } from './routes/Task';

/** The signed-in application: header, banner, footer and the read-only pages. */
export function AppRoutes() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Board />} />
        <Route path="projects" element={<Projects />} />
        <Route path="projects/:prefix" element={<Project />} />
        <Route path="epics" element={<Epics />} />
        <Route path="epics/:ref" element={<EpicPage />} />
        <Route path="tasks/:ref" element={<TaskPage />} />
        <Route path="search" element={<SearchPage />} />
        <Route path="*" element={<p className="p-6 text-muted">Nothing here.</p>} />
      </Route>
    </Routes>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/loggedin" element={<LoggedIn />} />
      <Route path="/logout" element={<LoggedOut />} />
      <Route
        path="/*"
        element={
          <AuthGate>
            <AppRoutes />
          </AuthGate>
        }
      />
    </Routes>
  );
}
