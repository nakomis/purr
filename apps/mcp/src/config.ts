export interface Config {
  url: string;
  apiKey: string;
}

/** Read PURR_URL and PURR_API_KEY, failing clearly if either is missing. */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const missing = ['PURR_URL', 'PURR_API_KEY'].filter((k) => !env[k]?.trim());
  if (missing.length > 0) {
    throw new Error(
      `Purr MCP: missing required environment variable(s): ${missing.join(', ')}. ` +
        'Set PURR_URL (e.g. https://purr.nakomis.com) and PURR_API_KEY.',
    );
  }
  return {
    url: (env.PURR_URL as string).trim().replace(/\/+$/, ''),
    apiKey: (env.PURR_API_KEY as string).trim(),
  };
}
