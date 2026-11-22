import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { useAuth } from 'react-oidc-context';
import { configureApiAuth } from '../api/client';
import { Notice } from '../components/Notice';

/**
 * Renders its children only for a signed-in user; otherwise goes to the Cognito hosted UI. Also wires the
 * API client: it sends the ID token, and a 401 (expired session) triggers a fresh sign-in.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const auth = useAuth();

  // Assigned during render so it is in place before any child effect fetches data.
  configureApiAuth({
    getToken: () => auth.user?.id_token,
    onUnauthorised: () => {
      void auth.removeUser().finally(() => auth.signinRedirect());
    },
  });

  const needsSignIn = !auth.isLoading && !auth.isAuthenticated && !auth.error && !auth.activeNavigator;
  useEffect(() => {
    if (needsSignIn) void auth.signinRedirect();
  }, [needsSignIn, auth]);

  if (auth.error) {
    return (
      <Notice tone="error">
        Sign-in failed: {auth.error.message}{' '}
        <button type="button" className="underline" onClick={() => void auth.signinRedirect()}>
          Try again
        </button>
      </Notice>
    );
  }
  if (!auth.isAuthenticated) return <Notice>Signing in…</Notice>;
  return <>{children}</>;
}
