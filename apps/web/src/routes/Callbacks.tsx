import { useEffect } from 'react';
import { useAuth } from 'react-oidc-context';
import { useNavigate } from 'react-router';
import { Notice } from '../components/Notice';

/** OIDC redirect target: react-oidc-context completes the code exchange, then we go home. */
export function LoggedIn() {
  const auth = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (!auth.isLoading && (auth.isAuthenticated || auth.error)) void navigate('/', { replace: true });
  }, [auth.isLoading, auth.isAuthenticated, auth.error, navigate]);
  return <Notice>Signing in…</Notice>;
}

/** Where Cognito's logout lands. Deliberately does not sign straight back in. */
export function LoggedOut() {
  const auth = useAuth();
  return (
    <Notice>
      You have been signed out.{' '}
      <button type="button" className="underline" onClick={() => void auth.signinRedirect()}>
        Sign in again
      </button>
    </Notice>
  );
}
