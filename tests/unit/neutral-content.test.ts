import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadSite } from '../../src/lib/content/load';
import { copyNeutralContent, neutralSiteYaml } from '../helpers/neutral-content';

// The content the tests run on has the go-live settings of site.yaml switched off, whatever the real file holds.

const GO_LIVE = `booking:
  horizonDays: 14
  backupUrl: "https://calendar.example/hassan"   # Hassan's page
settings:
  streamSignedUrls: true     # true = signed
  turnstileSiteKey: '0x4AAAAAAAxyz'   # the key
  live3dOnMobile: false
tracking:
  metaPixelId: "123456789012345"   # pixel
  googleTagId: G-ABC123XYZ4
  googleAdsId: "AW-987654321"
  googleAdsScheduleLabel: "AbC-D_efG-h"
`;

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

describe('neutral content', () => {
  it('switches the go-live settings off and changes nothing else, comments included', () => {
    expect(neutralSiteYaml(GO_LIVE)).toBe(`booking:
  horizonDays: 14
  backupUrl: ""   # Hassan's page
settings:
  streamSignedUrls: false     # true = signed
  turnstileSiteKey: ""   # the key
  live3dOnMobile: false
tracking:
  metaPixelId: ""   # pixel
  googleTagId: ""
  googleAdsId: ""
  googleAdsScheduleLabel: ""
`);
  });

  it('leaves a file that is already off exactly as it is', () => {
    const off = neutralSiteYaml(GO_LIVE);
    expect(neutralSiteYaml(off)).toBe(off);
  });

  it('the browser tests build and run the site from the folder scripts/e2e-content.ts writes, so real go-live settings never reach them', () => {
    const config = fs.readFileSync('playwright.config.ts', 'utf8');
    const script = fs.readFileSync('scripts/e2e-content.ts', 'utf8');
    const folder = /const dir = '([^']+)'/.exec(script)![1];
    expect(folder).toBe('.astro/e2e-content'); // inside .astro/, which git ignores
    expect(fs.readFileSync('.gitignore', 'utf8')).toMatch(/^\.astro\/$/m);
    expect(config).toContain('tsx scripts/e2e-content.ts && ');
    expect(config).toContain(`cross-env CONTENT_DIR=${folder} npm run build`); // the pages are built from it
    expect(config).toContain(`cross-env CONTENT_DIR=${folder} HOST=`); // and the server reads it
  });

  it('the real site.yaml, with every go-live setting filled in, comes out with them all off and still loads', () => {
    const real = fs.readFileSync('content/site.yaml', 'utf8');
    const filled = real
      .replace(/^(  (?:metaPixelId|googleTagId|googleAdsId|googleAdsScheduleLabel|turnstileSiteKey|backupUrl): )"[^"\n]*"/gm, (_m, key: string) => `${key}"filled-in-${key.trim().replace(':', '')}"`)
      .replace(/^(  streamSignedUrls: )false/m, '$1true');
    expect(filled).not.toBe(real);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hg-neutral-'));
    dirs.push(dir);
    const from = path.join(dir, 'from');
    fs.cpSync('content', from, { recursive: true });
    fs.writeFileSync(path.join(from, 'site.yaml'), filled);

    const to = path.join(dir, 'to');
    copyNeutralContent(from, to);
    expect(fs.readFileSync(path.join(to, 'site.yaml'), 'utf8')).toBe(neutralSiteYaml(real));
    expect(fs.existsSync(path.join(to, 'emails', 'booking-confirmed.yaml'))).toBe(true);

    process.env.CONTENT_DIR = to;
    try {
      const site = loadSite();
      expect(Object.values(site.tracking ?? {}).filter(Boolean)).toEqual([]);
      expect(site.settings.turnstileSiteKey).toBeFalsy();
      expect(site.settings.streamSignedUrls).toBe(false);
    } finally {
      delete process.env.CONTENT_DIR;
    }
  });
});
