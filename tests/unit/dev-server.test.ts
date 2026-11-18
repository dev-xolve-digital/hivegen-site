import { it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { tempContent, removeTempContent } from '../helpers/temp-content';

const PORT = 4331;
const URL = `http://127.0.0.1:${PORT}/`;

// The child must not inherit the test runner's settings (NODE_ENV=test, VITEST_*), or Astro serves nothing.
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_ENV' && !k.startsWith('VITEST') && k !== 'TEST'));

async function waitForServer(ms = 60_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try { if ((await fetch(URL)).status) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('dev server did not start');
}

// The owner edits a page file, saves and refreshes: the change shows, and a mistake shows an error.
it('the dev server shows page-file edits on refresh and reports page-file mistakes', async () => {
  const dir = tempContent();
  const file = path.join(dir, 'pages', 'main.yaml');
  const edit = (from: string, to: string) => fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(from, to));
  const server = spawn('npx', ['astro', 'dev', '--port', String(PORT), '--host', '127.0.0.1'], {
    shell: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...cleanEnv(), CONTENT_DIR: dir },
  });
  let log = '';
  server.stdout!.on('data', (d) => { log += d; });
  server.stderr!.on('data', (d) => { log += d; });
  const get = async () => { const r = await fetch(URL); return { status: r.status, text: await r.text() }; };
  try {
    await waitForServer();
    expect((await get()).text).toContain('<title>HiveGen · Real estate video editing in 24–48 hours</title>');
    edit('title: HiveGen · Real estate video editing in 24–48 hours', 'title: HiveGen · Edited title');
    expect((await get()).text).toContain('<title>HiveGen · Edited title</title>');
    edit('  subline:', '  sublin:');
    const broken = await get();
    expect(broken.status).toBe(500);
    expect(broken.text).toContain('<title>ContentError</title>'); // the browser shows the error overlay
    await expect.poll(() => log, { timeout: 10_000 }).toMatch(/pages\/main\.yaml: \\?"hero\.subline\\?" is missing/); // and the terminal names the file and field
  } finally {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
    else server.kill();
    removeTempContent();
  }
}, 120_000);
