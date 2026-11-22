/**
 * Issue an API key for an agent (claude or bau).
 *
 *   AWS_PROFILE=nakom.is-sandbox pnpm --filter @purr/migrate-plane seed-key -- --env sandbox --actor claude
 *
 * The key is stored as a SecureString at /purr/{env}/api-keys/{actor}, where the
 * agent's configuration reads it from; Purr's table holds only its SHA-256 hash
 * (the same hash apps/api/src/auth.ts computes), written through the storage port.
 * Issuing a new key for an actor leaves older ones valid until their records are
 * deleted, so a rotation never locks an agent out mid-run.
 */
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { ACTORS, type Actor, newId, nowIso } from '@purr/domain';
import { createDynamoStorage } from '@purr/storage-dynamo';

export const hashApiKey = (key: string): string => createHash('sha256').update(key, 'utf8').digest('hex');

/** 43 URL-safe characters (256 bits), which auth.ts's format check accepts. */
export const newApiKey = (): string => randomBytes(32).toString('base64url');

async function main(): Promise<void> {
  const { values } = parseArgs({
    // pnpm passes a literal "--" through to the script.
    args: process.argv.slice(2).filter((a) => a !== '--'),
    options: {
      env: { type: 'string' },
      actor: { type: 'string' },
      table: { type: 'string' },
      region: { type: 'string', default: 'eu-west-2' },
    },
  });
  const env = values.env;
  if (env !== 'sandbox' && env !== 'prod') throw new Error('--env must be sandbox or prod');
  const actor = values.actor as Actor;
  if (!ACTORS.includes(actor) || actor === 'martin' || actor === 'system') {
    throw new Error('--actor must be an agent: claude or bau');
  }
  const tableName = values.table ?? `purr-${env}`;
  const key = newApiKey();
  const name = `/purr/${env}/api-keys/${actor}`;

  // The value goes to the CLI in a 0600 file, never on the command line.
  const dir = mkdtempSync(join(tmpdir(), 'purr-key-'));
  const input = join(dir, 'input.json');
  try {
    writeFileSync(
      input,
      JSON.stringify({
        Name: name,
        Value: key,
        Type: 'SecureString',
        Overwrite: true,
        Description: `Purr API key for ${actor}`,
      }),
      { mode: 0o600 },
    );
    execFileSync(
      'aws',
      ['ssm', 'put-parameter', '--region', values.region, '--cli-input-json', `file://${input}`],
      {
        stdio: ['ignore', 'ignore', 'inherit'],
      },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  const storage = createDynamoStorage({ tableName });
  await storage.apiKeys.put({ id: newId(), actor, hash: hashApiKey(key), createdAt: nowIso() });
  console.log(`Issued an API key for ${actor} in ${env}: stored at ${name}; its hash is in ${tableName}.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
