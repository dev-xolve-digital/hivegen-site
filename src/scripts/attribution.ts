import type { Attribution } from '../lib/booking/api-client';

/** The visitor's first ad tags are kept in the browser for 30 days, so a lead made days after the ad click still says where it came from. */
const KEY = 'hg_attribution';
const KEEP_MS = 30 * 86_400_000;
const TAGS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid'] as const;
/** The server refuses a tag longer than this, and with it the whole lead. */
const MAX_LENGTH = 200;

type Stored = { at: number; values: Attribution };

/** localStorage, or null when the browser refuses it (blocked site data throws on access). */
export function browserStorage(win: Window): Storage | null {
  try { return win.localStorage; } catch { return null; }
}

/** The known tags with a usable value, cut to the length the server accepts. */
function tagsOf(get: (tag: string) => unknown): Attribution {
  const values: Attribution = {};
  for (const tag of TAGS) {
    const value = get(tag);
    if (typeof value === 'string' && value !== '') values[tag] = value.slice(0, MAX_LENGTH);
  }
  return values;
}

function stored(storage: Storage | null, now: number): Stored | null {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return null;
    const record = JSON.parse(raw) as { at?: unknown; values?: unknown } | null;
    if (typeof record?.at !== 'number' || typeof record.values !== 'object' || record.values === null) return null;
    if (now - record.at >= KEEP_MS) return null; // the first touch has run out
    return { at: record.at, values: tagsOf((tag) => (record.values as Record<string, unknown>)[tag]) };
  } catch {
    return null; // storage that throws, or something else's data under our key
  }
}

/** On landing: keeps this page's ad tags unless an earlier landing's are still being kept. A page with no tags changes nothing. */
export function captureAttribution(url: URL, storage: Storage | null, now: number): void {
  const values = tagsOf((tag) => url.searchParams.get(tag));
  if (Object.keys(values).length === 0 || stored(storage, now)) return;
  try { storage?.setItem(KEY, JSON.stringify({ at: now, values } satisfies Stored)); } catch { /* storage is full or blocked: the lead just carries no tags */ }
}

/** The ad tags kept for this visitor (none when there are none, or when they are older than 30 days). */
export function readAttribution(storage: Storage | null, now: number): Attribution {
  return stored(storage, now)?.values ?? {};
}
