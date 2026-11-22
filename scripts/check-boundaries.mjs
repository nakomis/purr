#!/usr/bin/env node
/**
 * The storage boundary, enforced (design section 6), so a relational adapter stays
 * a rewrite of the data side alone:
 *   - only packages/storage-dynamo may import the DynamoDB SDK;
 *   - only packages/embedder-bedrock may import the Bedrock runtime SDK;
 *   - packages/domain imports no AWS SDK and no other @purr package
 *     (its tests may use @purr/storage-memory).
 * dependency-cruiser does the same job but refuses to run on odd-numbered Node
 * releases, and Purr builds on Node 25, so this scans import specifiers itself.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SCAN = ['packages', 'apps', 'tools', 'infra'];
const SKIP = new Set(['node_modules', 'dist', 'coverage', 'cdk.out', '.claude']);
const IMPORT =
  /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)/g;

const RULES = [
  {
    name: 'dynamodb-only-in-storage-dynamo',
    forbids: (spec) => /^@aws-sdk\/(client-dynamodb|lib-dynamodb)/.test(spec),
    allowed: (file) =>
      file.startsWith('packages/storage-dynamo/') || file.startsWith('infra/') || file.startsWith('tools/'),
  },
  {
    name: 'bedrock-only-in-embedder-bedrock',
    forbids: (spec) => spec.startsWith('@aws-sdk/client-bedrock-runtime'),
    allowed: (file) => file.startsWith('packages/embedder-bedrock/'),
  },
  {
    name: 'domain-depends-on-nothing',
    forbids: (spec, file) =>
      file.startsWith('packages/domain/') &&
      (spec.startsWith('@aws-sdk/') ||
        (spec.startsWith('@purr/') && !(file.endsWith('.test.ts') && spec === '@purr/storage-memory'))),
    allowed: () => false,
  },
];

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (/\.(ts|tsx|mjs|js)$/.test(name)) yield path;
  }
}

const violations = [];
for (const top of SCAN) {
  let files;
  try {
    files = [...walk(join(ROOT, top))];
  } catch {
    continue;
  }
  for (const path of files) {
    const file = relative(ROOT, path);
    const src = readFileSync(path, 'utf8');
    for (const m of src.matchAll(IMPORT)) {
      const spec = m[1] ?? m[2] ?? m[3];
      for (const rule of RULES) {
        if (rule.forbids(spec, file) && !rule.allowed(file))
          violations.push(`${rule.name}: ${file} imports ${spec}`);
      }
    }
  }
}

if (violations.length > 0) {
  console.error(`Storage boundary violated:\n  ${violations.join('\n  ')}`);
  process.exit(1);
}
console.log('Storage boundary intact.');
