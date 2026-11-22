import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, configureApiAuth } from '../api/client';
import { setConfig } from '../config/config';
import { AuthGate } from './AuthGate';
import { logoutUrl, oidcSettings } from './oidc';

const auth = {
  isLoading: false,
  isAuthenticated: true,
  error: undefined as Error | undefined,
  activeNavigator: undefined,
  user: { id_token: 'the-id-token', access_token: 'the-access-token' },
  signinRedirect: vi.fn(async () => {}),
  removeUser: vi.fn(async () => {}),
};
vi.mock('react-oidc-context', () => ({ useAuth: () => auth }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  auth.isAuthenticated = true;
  auth.error = undefined;
});

describe('the API client', () => {
  it('triggers sign-in on a 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 401 })),
    );
    render(
      <AuthGate>
        <p>secret</p>
      </AuthGate>,
    );
    await expect(api('/board')).rejects.toBeInstanceOf(ApiError);
    await waitFor(() => expect(auth.signinRedirect).toHaveBeenCalled());
    expect(auth.removeUser).toHaveBeenCalled();
  });

  it('sends the ID token, not the access token', async () => {
    const fetchMock = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    render(
      <AuthGate>
        <p>secret</p>
      </AuthGate>,
    );
    await api('/me');
    const init = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init[1].headers as Record<string, string>).authorization).toBe('Bearer the-id-token');
  });

  it('turns an error body into an ApiError and handles 204 and POST bodies', async () => {
    configureApiAuth({ getToken: () => undefined, onUnauthorised: () => {} });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { code: 'VALIDATION', message: 'bad column' } }), {
          status: 400,
        }),
      )
      .mockResolvedValueOnce(new Response('oops', { status: 500 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(api('/board/move', { method: 'POST', body: { a: 1 } })).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION',
      message: 'bad column',
    });
    await expect(api('/x')).rejects.toMatchObject({ status: 500, code: 'INTERNAL' });
    await expect(api('/y')).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'POST', body: '{"a":1}' });
  });
});

describe('AuthGate', () => {
  it('shows the app when signed in', () => {
    render(
      <AuthGate>
        <p>secret</p>
      </AuthGate>,
    );
    expect(screen.getByText('secret')).toBeInTheDocument();
  });

  it('redirects to the hosted UI when signed out', async () => {
    auth.isAuthenticated = false;
    render(
      <AuthGate>
        <p>secret</p>
      </AuthGate>,
    );
    expect(screen.queryByText('secret')).not.toBeInTheDocument();
    await waitFor(() => expect(auth.signinRedirect).toHaveBeenCalledTimes(1));
  });

  it('shows an error rather than looping when sign-in fails', () => {
    auth.isAuthenticated = false;
    auth.error = new Error('bad code');
    render(
      <AuthGate>
        <p>secret</p>
      </AuthGate>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('bad code');
    expect(auth.signinRedirect).not.toHaveBeenCalled();
  });
});

describe('oidc settings', () => {
  const config = setConfig({
    authority: 'https://cognito-idp.eu-west-2.amazonaws.com/pool',
    clientId: 'cid',
    redirectUri: 'https://purr.example/loggedin',
    logoutUri: 'https://purr.example/logout',
    cognitoDomain: 'login.example',
  });

  it('uses the authorisation code flow', () => {
    expect(oidcSettings(config)).toMatchObject({ response_type: 'code', client_id: 'cid' });
  });

  it('builds the Cognito logout URL', () => {
    expect(logoutUrl(config)).toBe(
      'https://login.example/logout?client_id=cid&logout_uri=https%3A%2F%2Fpurr.example%2Flogout',
    );
  });
});
