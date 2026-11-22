import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider } from 'react-oidc-context';
import { BrowserRouter } from 'react-router';
import { App } from './App';
import { oidcSettings } from './auth/oidc';
import { loadConfig } from './config/config';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');

loadConfig()
  .then((config) => {
    createRoot(root).render(
      <StrictMode>
        <AuthProvider {...oidcSettings(config)}>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </AuthProvider>
      </StrictMode>,
    );
  })
  .catch((error: unknown) => {
    root.textContent = `Purr could not start: ${error instanceof Error ? error.message : String(error)}`;
  });
