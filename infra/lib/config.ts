/** Accounts, zones and names for each environment (sandbox and prod), stated once. */
export type DeployEnv = 'sandbox' | 'prod';

export const ACCOUNTS: Record<DeployEnv, string> = { sandbox: '975050268859', prod: '637423226886' };
export const REGION = 'eu-west-2';

export const HOSTED_ZONES: Record<DeployEnv, { hostedZoneId: string; zoneName: string }> = {
  sandbox: { hostedZoneId: 'Z03586633NXU18LFL0JTL', zoneName: 'sandbox.nakomis.com' },
  prod: { hostedZoneId: 'Z019437529YGFB53BDUGR', zoneName: 'nakomis.com' },
};

export const appDomain = (env: DeployEnv): string => `purr.${HOSTED_ZONES[env].zoneName}`;

/**
 * Who may sign in to the web UI through the shared Cognito pool, by verified email.
 * The two pools hold different identities for the same person (the sandbox pool has
 * no martin@), so this is per environment.
 */
export const ALLOWED_EMAILS: Record<DeployEnv, string[]> = {
  sandbox: ['sandboxuser@nakomis.com'],
  // Martin's prod Cognito user is 'nakomis', whose email is infra@nakomis.com.
  prod: ['martin@nakomis.com', 'infra@nakomis.com'],
};

/** The GitHub repository CI deploys from: name and immutable ids (OIDC subjects carry both). */
export const GITHUB = { owner: 'nakomis', ownerId: '1488244', repo: 'purr', repoId: '1467651029' };

/** SSM parameter names Purr publishes (and the web deploy reads). */
export const ssmName = (env: DeployEnv, name: string): string => `/purr/${env}/${name}`;
