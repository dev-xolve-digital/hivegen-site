// Renders the phone still images of the 3D objects from the built site.
// Usage: npm run build && npm run stills
// Writes public/media/3d/<slot>.webp (transparent background) for the four phone slots.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { chromium } from '@playwright/test';

const SLOTS = ['hero-play', 'hero-camera', 'hero-pause', 'booking-pause'];
const PORT = 4324;
const OUT = path.join(process.cwd(), 'public', 'media', '3d');
const TMP = path.join(process.cwd(), '.astro', 'stills');

function fail(message) {
  console.error(`\nrender-3d-stills: ${message}\n`);
  process.exit(1);
}

if (!fs.existsSync(path.join(process.cwd(), 'dist', 'index.html'))) fail('no build found. Run `npm run build` first.');
if (spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status !== 0) fail('ffmpeg was not found on your PATH.');

const preview = spawn('npx', ['astro', 'preview', '--port', String(PORT)], { shell: true, stdio: 'ignore' });
const stopPreview = () => {
  spawnSync('npx', ['astro', 'preview', 'stop'], { shell: true, stdio: 'ignore' });
  preview.kill();
};

async function waitForServer(url, ms = 30_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try { if ((await fetch(url)).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`preview server did not start on ${url}`);
}

try {
  await waitForServer(`http://localhost:${PORT}/`);
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(TMP, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
  for (const slot of SLOTS) {
    const canvas = page.locator(`canvas[data-slot="${slot}"]`);
    await canvas.scrollIntoViewIfNeeded();
    await page.waitForFunction((s) => document.querySelector(`canvas[data-slot="${s}"]`)?.dataset.ready === 'true', slot);
  }
  await page.addStyleTag({ content: `
    html, body, .page { background: transparent !important; }
    .page::before, .blob { display: none !important; }
    body * { visibility: hidden !important; }
    canvas.c3d { visibility: visible !important; filter: none !important; }` });
  for (const slot of SLOTS) {
    const png = path.join(TMP, `${slot}.png`);
    await page.locator(`canvas[data-slot="${slot}"]`).screenshot({ path: png, omitBackground: true });
    const webp = path.join(OUT, `${slot}.webp`);
    const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', png, '-c:v', 'libwebp', '-q:v', '80', '-pix_fmt', 'yuva420p', webp], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`ffmpeg failed on ${slot}: ${r.stderr}`);
    console.log(`made public/media/3d/${slot}.webp`);
  }
  await browser.close();
} catch (e) {
  stopPreview();
  fail(e.message);
}
stopPreview();
console.log(`\nstills: ${SLOTS.length}`);
