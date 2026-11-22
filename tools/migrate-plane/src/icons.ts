/** Project icons: icons.json maps a project prefix to a sticker in the laptop-stickers logos folder. */
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { IconMap } from './importer.js';

const run = promisify(execFile);

export async function loadIcons(path: string): Promise<IconMap> {
  return JSON.parse(await readFile(path, 'utf8')) as IconMap;
}

export interface Uploader {
  put(key: string, body: Uint8Array): Promise<void>;
}

/** Resize every mapped icon to 128px (macOS sips) and hand it to the uploader as icons/<PREFIX>.png. */
export async function uploadIcons(icons: IconMap, logosDir: string, uploader: Uploader): Promise<string[]> {
  const dir = await mkdtemp(join(tmpdir(), 'purr-icons-'));
  const uploaded: string[] = [];
  try {
    for (const [prefix, file] of Object.entries(icons).sort()) {
      const out = join(dir, `${prefix}.png`);
      await run('sips', ['-Z', '128', join(logosDir, file), '--out', out]);
      await uploader.put(`icons/${prefix}.png`, await readFile(out));
      uploaded.push(`icons/${prefix}.png`);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  return uploaded;
}
