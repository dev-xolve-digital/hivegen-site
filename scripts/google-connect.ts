/**
 * One-time Google sign-in: `npm run google:connect`.
 * Reads GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET from `.env`, opens Google's consent page, waits on http://127.0.0.1:53682/callback
 * for the answer, and saves the refresh token as GOOGLE_REFRESH_TOKEN in `.env` (made if missing). Add the same line in hPanel.
 * Make the Google OAuth client a "Desktop app" (or add the callback address above as an authorised redirect URI),
 * and sign in with the Google account whose calendar should receive the bookings.
 */
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { CONNECT_REDIRECT_URI, consentUrl, exchangeAuthCode } from '../src/server/calendar/google';
import { loadDotEnv, upsertEnvLine } from '../src/server/env';

loadDotEnv();
const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
if (!clientId || !clientSecret) {
  console.error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are not set. Put them in .env (see .env.example) and run this again.');
  process.exit(1);
}

const state = randomBytes(16).toString('hex');
const callback = new URL(CONNECT_REDIRECT_URI);

/** Tries to open the address in the default browser. The address is printed anyway, so any failure is ignored. */
function openBrowser(url: string): void {
  try {
    const child = process.platform === 'win32'
      // The address is quoted by hand: it has & in it, which cmd would otherwise read as the end of the command.
      ? spawn('cmd', ['/c', 'start', '""', `"${url}"`], { stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true })
      : spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
  } catch { /* nothing to do: the address is on screen */ }
}

function reply(res: http.ServerResponse, status: number, message: string): void {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', connection: 'close' });
  res.end(`<!doctype html><meta charset="utf-8"><title>HiveGen</title><p style="font:16px sans-serif">${message}</p>`);
}

/** Listens for the one visit to /callback that carries our state and resolves with Google's code. `ready` runs once the port is open. */
function waitForCode(ready: () => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', callback);
      if (url.pathname !== callback.pathname) return reply(res, 404, 'Not found.');
      if (url.searchParams.get('state') !== state) return reply(res, 400, 'This is not the sign-in this script started. Run it again.');
      const code = url.searchParams.get('code');
      server.close();
      if (!code) {
        const reason = url.searchParams.get('error');
        reply(res, 400, 'Sign-in was not completed. You can close this tab.');
        return reject(new Error(`Google sign-in was not completed${reason && /^[a-z_]{1,40}$/.test(reason) ? ` (${reason})` : ''}. Run it again.`));
      }
      reply(res, 200, 'You can close this tab and go back to the terminal.');
      resolve(code);
    });
    server.once('error', (error: NodeJS.ErrnoException) => {
      reject(new Error(error.code === 'EADDRINUSE' ? `Port ${callback.port} is already in use. Close what uses it and run this again.` : `Could not listen on ${callback.host}: ${error.message}`));
    });
    server.listen(Number(callback.port), callback.hostname, ready);
  });
}

try {
  const url = consentUrl(clientId, state);
  const code = await waitForCode(() => { // the browser opens only once the port is listening, so Google's redirect always finds it
    console.log('Allow HiveGen to use your Google Calendar. Open this address in your browser (it should open by itself):\n');
    console.log(`${url}\n`);
    openBrowser(url);
    console.log('Waiting for you to finish in the browser. Press Ctrl+C to stop.');
  });

  const refreshToken = await exchangeAuthCode({ clientId, clientSecret }, code);

  const file = path.resolve('.env');
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch { /* no .env yet: it is created below */ }
  fs.writeFileSync(file, upsertEnvLine(text, 'GOOGLE_REFRESH_TOKEN', refreshToken));

  console.log(`\nConnected. Saved GOOGLE_REFRESH_TOKEN to ${file}.`);
  console.log('On Hostinger, add this setting in hPanel (it is a secret, share it with no one):\n');
  console.log(`GOOGLE_REFRESH_TOKEN=${refreshToken}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error)); // the message only: never the client secret
  process.exitCode = 1;
}
