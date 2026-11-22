export interface Config {
  /** Base path of the API, normally `/api` (same CloudFront distribution). */
  apiBase: string;
  /** OIDC issuer: the Cognito user pool, `https://cognito-idp.<region>.amazonaws.com/<pool id>`. */
  authority: string;
  clientId: string;
  redirectUri: string;
  logoutUri: string;
  /** Cognito hosted-UI domain (host only), used for the sign-out endpoint. */
  cognitoDomain: string;
}

const defaults: Config = {
  apiBase: '/api',
  authority: '',
  clientId: '',
  redirectUri: '',
  logoutUri: '',
  cognitoDomain: '',
};

let current: Config = defaults;

export function getConfig(): Config {
  return current;
}

export function setConfig(config: Partial<Config>): Config {
  current = { ...defaults, ...config };
  return current;
}

/** Fetches `/config.json`, written at deploy time by `scripts/set-config.sh`. */
export async function loadConfig(): Promise<Config> {
  const response = await fetch('/config.json', { cache: 'no-store' });
  if (!response.ok) throw new Error(`config.json: HTTP ${response.status}`);
  return setConfig((await response.json()) as Partial<Config>);
}
