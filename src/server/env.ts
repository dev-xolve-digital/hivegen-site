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
