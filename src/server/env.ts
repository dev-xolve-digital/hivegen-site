import fs from 'node:fs';
import { parseEnv } from 'node:util';

/**
 * Reads a local `.env` file into `env` (default: the process settings).
 * Settings that are already there win, so what the host sets is never overwritten.
 * A missing file is fine: production has no `.env`, the host supplies the settings.
 */
export function loadDotEnv(file = '.env', env: Record<string, string | undefined> = process.env): void {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return;
  }
  for (const [key, value] of Object.entries(parseEnv(text.replace(/^﻿/, '')))) {
    if (env[key] === undefined) env[key] = value;
  }
}

/**
 * Sets `key=value` in the text of a `.env` file: an existing `key=` line gets the new value, otherwise the line is added at the end.
 * Everything else, comments and Windows line endings included, stays as it was.
 */
export function upsertEnvLine(text: string, key: string, value: string): string {
  const line = `${key}=${value}`;
  let found = false;
  const lines = text.split('\n').map((l) => {
    if (!l.startsWith(`${key}=`)) return l;
    found = true;
    return l.endsWith('\r') ? `${line}\r` : line;
  });
  if (found) return lines.join('\n');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  return `${text}${text === '' || text.endsWith('\n') ? '' : eol}${line}${eol}`;
}
