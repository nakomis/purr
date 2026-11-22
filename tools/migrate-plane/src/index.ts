/**
 * migrate-plane: Plane (and ATC) into Purr, through the Storage ports.
 *
 *   pnpm --filter @purr/migrate-plane migrate -- --pg <dsn> --target memory|dynamo \
 *       [--table <name>] [--dry-run] [--report <path>] [--out-dir <dir>]
 *   pnpm --filter @purr/migrate-plane migrate -- --upload-icons --bucket <name> --profile <aws profile>
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import type { Storage } from '@purr/domain';
import { archiveToMarkdown } from './archive.js';
import { loadIcons, uploadIcons } from './icons.js';
import { type Counts, importPlane, type Report } from './importer.js';
import { loadArchive, loadPlane } from './pg/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const ICONS_JSON = resolve(here, '../icons.json');
const LOGOS_DIR = join(homedir(), 'repos/nakomis/scripts/lib/laptop-stickers/logos');

const { values } = parseArgs({
  // pnpm forwards the `--` that separates its own flags from the script's.
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: {
    pg: { type: 'string' },
    target: { type: 'string' },
    table: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    report: { type: 'string' },
    'out-dir': { type: 'string', default: 'migrate-out' },
    'upload-icons': { type: 'boolean', default: false },
    bucket: { type: 'string' },
    profile: { type: 'string' },
    'logos-dir': { type: 'string', default: LOGOS_DIR },
  },
});

function fail(message: string): never {
  console.error(`migrate-plane: ${message}`);
  process.exit(2);
}

async function createStorage(): Promise<Storage> {
  if (values['dry-run'] || values.target === 'memory') {
    const { createMemoryStorage } = await import('@purr/storage-memory');
    return createMemoryStorage();
  }
  if (values.target !== 'dynamo') fail('--target must be memory or dynamo');
  if (!values.table) fail('--target dynamo needs --table <name>');
  // Loaded by variable so this tool type-checks before the adapter has landed.
  const specifier = '@purr/storage-dynamo';
  const mod = (await import(specifier)) as {
    createDynamoStorage(opts: { tableName: string }): Storage;
  };
  return mod.createDynamoStorage({ tableName: values.table });
}

const row = (label: string, c: Counts) =>
  `${label.padEnd(8)} tasks ${String(c.tasks).padStart(5)}  comments ${String(c.comments).padStart(5)}  labels ${String(c.labels).padStart(3)}  links ${String(c.links).padStart(4)}  relations ${String(c.relations).padStart(3)}  epics ${String(c.epics).padStart(3)}`;

function printReport(r: Report): void {
  console.log('\nVerification report');
  console.log('===================');
  for (const p of r.projects) {
    console.log(`${p.match ? 'ok ' : 'MISMATCH'} ${row(`${p.prefix} plane`, p.plane)}`);
    console.log(`   ${row(`${p.prefix} purr`, p.purr)}   (created this run: ${p.created.tasks} tasks)`);
  }
  console.log(`\n${row('TOTAL plane', r.totals.plane)}\n${row('TOTAL purr', r.totals.purr)}`);
  console.log(`Created this run: ${JSON.stringify(r.totals.created)}`);
  console.log(
    `Board cards: ${r.boardCards.purr} in Purr (${r.boardCards.plane} read from ATC, ${r.boardCards.created} new)`,
  );
  console.log(
    `Spot checks: ${r.spotChecks.checked} refs (${r.spotChecks.refs.slice(0, 8).join(', ')}, ...), ${r.spotChecks.mismatches.length} mismatches`,
  );
  for (const m of r.spotChecks.mismatches) console.log(`  ! ${m}`);
  console.log(`Conversion warnings: ${r.conversionWarnings.length}`);
  for (const w of r.conversionWarnings.slice(0, 20))
    console.log(`  ${w.ref} (${w.where}): ${w.warnings.join('; ')}`);
  console.log(`Skipped / adjusted: ${r.skipped.length + r.boardCards.skipped.length}`);
  for (const s of [...r.skipped, ...r.boardCards.skipped].slice(0, 30)) console.log(`  ${s}`);
  for (const n of r.notes) console.log(`Note: ${n}`);
}

async function main(): Promise<void> {
  const icons = await loadIcons(ICONS_JSON);

  if (values['upload-icons']) {
    if (!values.bucket) fail('--upload-icons needs --bucket <name>');
    if (values.profile) process.env.AWS_PROFILE = values.profile;
    const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
    const s3 = new S3Client({ region: process.env.AWS_REGION ?? 'eu-west-2' });
    const bucket = values.bucket;
    const done = await uploadIcons(icons, values['logos-dir'] as string, {
      async put(key, body) {
        await s3.send(
          new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: 'image/png' }),
        );
      },
    });
    console.log(`Uploaded ${done.length} icons to s3://${bucket}/icons/`);
    return;
  }

  const dsn = values.pg ?? process.env.PLANE_PG_DSN;
  if (!dsn) fail('--pg <dsn> (or PLANE_PG_DSN) is required');
  const storage = await createStorage();
  const outDir = resolve(values['out-dir'] as string);
  await mkdir(outDir, { recursive: true });

  console.log(`Target: ${values['dry-run'] ? 'memory (dry run)' : values.target}`);
  console.log('Archiving JOBS...');
  const archive = await loadArchive(dsn);
  await writeFile(join(outDir, 'jobs-archive.json'), JSON.stringify(archive, null, 2));
  await writeFile(join(outDir, 'jobs-archive.md'), archiveToMarkdown(archive));

  console.log('Reading Plane and ATC...');
  const data = await loadPlane(dsn);
  console.log(
    `  ${data.projects.length} projects, ${data.issues.length} work items, ${data.comments.length} comments, ${data.modules.length} modules`,
  );
  const report = await importPlane(storage, data, { icons, log: (l) => console.log(`  ${l}`) });

  const reportPath = resolve(values.report ?? join(outDir, 'report.json'));
  await mkdir(dirname(reportPath), { recursive: true });
  const { migrationMap, originalHtml, ...summary } = report;
  await writeFile(reportPath, JSON.stringify(summary, null, 2));
  await writeFile(join(dirname(reportPath), 'migration-map.json'), JSON.stringify(migrationMap, null, 2));
  await writeFile(join(dirname(reportPath), 'original-html.json'), JSON.stringify(originalHtml));
  printReport(report);
  console.log(`\nReport: ${reportPath}`);
  if (report.spotChecks.mismatches.length > 0 || report.projects.some((p) => !p.match)) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
