import fs from 'node:fs';
import path from 'node:path';

/**
 * Tests must not depend on the settings that are filled in when the site goes live (the real tracking ids, the Turnstile site key,
 * the backup appointment page, signed video links): filling them in must never turn a test red, nor make a browser test contact
 * Meta, Google or Cloudflare. So every test works on a copy of `content/` in which these are set back to "nothing yet".
 */
const LIVE_SETTINGS: Array<[RegExp, string]> = [
  [/^(  (?:metaPixelId|googleTagId|googleAdsId|googleAdsScheduleLabel|turnstileSiteKey|backupUrl): )(?:"[^"\n]*"|'[^'\n]*'|[^\s#"'][^\s#]*)/gm, '$1""'],
  [/^(  streamSignedUrls: )(?:true|false)\b/gm, '$1false'],
];

/** The text of `site.yaml` with the go-live settings set back to "off": the same lines, comments and all, with only these values changed. */
export function neutralSiteYaml(text: string): string {
  return LIVE_SETTINGS.reduce((result, [pattern, replacement]) => result.replace(pattern, replacement), text);
}

/** Copies the content folder `from` to a new (or emptied) folder `to`, with `site.yaml` neutral (see above). */
export function copyNeutralContent(from: string, to: string): void {
  fs.rmSync(to, { recursive: true, force: true });
  fs.cpSync(from, to, { recursive: true });
  const siteFile = path.join(to, 'site.yaml');
  fs.writeFileSync(siteFile, neutralSiteYaml(fs.readFileSync(siteFile, 'utf8')));
}
