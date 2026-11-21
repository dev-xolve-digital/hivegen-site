/**
 * Checks every service the site uses, with the settings in `.env` (or the environment): `npm run check:services`.
 * Prints a line for each one: ✓ working, ✗ broken (with what to do), – not set up yet (with where to read about it).
 * Exits 1 when a service that has settings does not work, and 0 otherwise, so a computer with no `.env` at all gets 0.
 * Nothing is sent to anyone: it logs in, reads and asks. The only exception is one test event to Meta, and only when
 * META_TEST_EVENT_CODE is set (it shows up under "Test events" in Events Manager and never counts for ads).
 */
import { createTransport } from 'nodemailer';
import { loadFirstStreamVideo, loadMetaPixelId, loadStreamSettings, loadTurnstileSiteKey } from '../src/lib/content/load';
import { checkServices, exitCode, formatReport, type SiteFacts } from '../src/server/check-services';
import { readServerConfig } from '../src/server/config';
import { loadDotEnv } from '../src/server/env';
import { smtpTransportOptions } from '../src/server/mail/mailer';
import { pendingMigrations } from '../src/server/store/migrate';
import { createPool } from '../src/server/store/mysql';

loadDotEnv();
const config = readServerConfig(process.env);

/** The public settings in the content files. A file with a mistake is reported on the lines that need it, not as a crash. */
function readSite(): SiteFacts {
  try {
    const stream = loadStreamSettings();
    return {
      turnstileSiteKey: loadTurnstileSiteKey(),
      metaPixelId: loadMetaPixelId(),
      stream: { customerCode: stream.streamCustomerCode, signedUrls: stream.streamSignedUrls, video: loadFirstStreamVideo() },
    };
  } catch (error) {
    return { problem: error instanceof Error ? error.message : 'unknown error' };
  }
}

const results = await checkServices(config, {
  env: process.env,
  fetchFn: fetch,
  now: () => new Date(),
  site: readSite(),
  async pendingMigrations(url) {
    const pool = createPool(url);
    try {
      return await pendingMigrations(pool);
    } finally {
      await pool.end().catch(() => {});
    }
  },
  async verifySmtp(smtp) {
    const transport = createTransport(smtpTransportOptions(smtp));
    try {
      await transport.verify(); // logs in; sends nothing
    } finally {
      transport.close();
    }
  },
});

console.log(`\nHiveGen service check\n\n${formatReport(results)}\n`);
if (config.mode === 'fakes') {
  console.log('HIVEGEN_FAKES=1 is set: the site would run on test services, not the real ones.');
} else if (config.mode === 'live') {
  console.log(`Booking would start in live mode with these settings.${config.production || config.smtp ? '' : ' On Hostinger (NODE_ENV=production) the five SMTP settings are needed too.'}`);
} else {
  console.log(`Booking is not live yet. Still missing: ${config.missing.join(', ')}.`);
}
console.log('Not tested here: the Google tag (use DebugView, HOW-TO-SETUP.md step 5) and the cron job (HOW-TO-SETUP.md step 8).');
process.exitCode = exitCode(results);
