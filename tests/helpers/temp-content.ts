import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { copyNeutralContent } from './neutral-content';

const made: string[] = [];

/** Deletes every temp content folder made so far (they hold a copy of the real content files). */
export function removeTempContent(): void {
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
}

/**
 * Copies content/ to a fresh temp folder, applies text edits to the named files, and returns the folder.
 * The copy has the go-live settings of site.yaml (tracking ids, Turnstile site key, backup link, signed video links) set back to "off" first,
 * so a test never depends on what the real site.yaml holds today, and an edit like `t.replace('metaPixelId: ""', ...)` always finds its line.
 */
export function tempContent(edits: Record<string, (text: string) => string> = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hg-content-'));
  made.push(dir);
  copyNeutralContent('content', dir);
  for (const [rel, edit] of Object.entries(edits)) {
    const file = path.join(dir, rel);
    fs.writeFileSync(file, edit(fs.readFileSync(file, 'utf8')));
  }
  return dir;
}
