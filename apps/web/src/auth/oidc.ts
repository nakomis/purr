import type { AuthProviderProps } from 'react-oidc-context';
import type { Config } from '../config/config';

/** Authorisation code + PKCE against the Cognito hosted UI (oidc-client-ts does PKCE for `code`). */
export function oidcSettings(config: Config): AuthProviderProps {
  return {
    authority: config.authority,
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    post_logout_redirect_uri: config.logoutUri,
    response_type: 'code',
    scope: 'openid email profile',
    // Drop ?code=&state= from the address bar once the exchange is done.
    onSigninCallback: () => {
      window.history.replaceState({}, document.title, '/');
    },
  };
}

/** Clear the local session, then Cognito's own, which lands back on /logout. */
export function logoutUrl(config: Config): string {
  return (
    `https://${config.cognitoDomain}/logout?client_id=${encodeURIComponent(config.clientId)}` +
    `&logout_uri=${encodeURIComponent(config.logoutUri)}`
  );
}
