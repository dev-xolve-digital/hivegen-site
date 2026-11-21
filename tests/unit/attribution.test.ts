import { describe, it, expect } from 'vitest';
import { browserStorage, captureAttribution, readAttribution } from '../../src/scripts/attribution';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 10, 1);
const landing = (query: string, path = '/') => new URL(`https://hivegen.co${path}${query}`);

/** A Storage that lives in memory. */
function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => { m.set(k, v); },
    removeItem: (k) => { m.delete(k); },
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  };
}

/** A Storage that fails on every call, like a browser with site data blocked. */
const brokenStorage = (): Storage => new Proxy({} as Storage, { get: () => () => { throw new Error('blocked'); } });

describe('attribution', () => {
  it('first touch wins for 30 days, then a new landing replaces it', () => {
    const s = memoryStorage();
    captureAttribution(landing('?utm_source=facebook&utm_campaign=spring&fbclid=x1'), s, T0);
    // A later landing from another ad does not replace the first one...
    captureAttribution(landing('?utm_source=google&gclid=g1', '/agents'), s, T0 + 5 * DAY);
    expect(readAttribution(s, T0 + 5 * DAY)).toEqual({ utm_source: 'facebook', utm_campaign: 'spring', fbclid: 'x1' });
    // ...and a visit with no tags changes nothing.
    captureAttribution(landing(''), s, T0 + 6 * DAY);
    expect(readAttribution(s, T0 + 29 * DAY)).toEqual({ utm_source: 'facebook', utm_campaign: 'spring', fbclid: 'x1' });
    // After 30 days the first touch is gone, so the next tagged landing is the new first touch.
    expect(readAttribution(s, T0 + 31 * DAY)).toEqual({});
    captureAttribution(landing('?utm_source=google&gclid=g1'), s, T0 + 31 * DAY);
    expect(readAttribution(s, T0 + 31 * DAY)).toEqual({ utm_source: 'google', gclid: 'g1' });
  });

  it('keeps only the known tags, and cuts each value to the 200 characters the server accepts', () => {
    const s = memoryStorage();
    captureAttribution(landing(`?utm_source=${'a'.repeat(300)}&utm_medium=&ref=friend&utm_term=shoes+and+boots`), s, T0);
    expect(readAttribution(s, T0)).toEqual({ utm_source: 'a'.repeat(200), utm_term: 'shoes and boots' });
  });

  it('a page with no tags stores nothing', () => {
    const s = memoryStorage();
    captureAttribution(landing('?ref=friend'), s, T0);
    expect(s.length).toBe(0);
    expect(readAttribution(s, T0)).toEqual({});
  });

  it('storage that throws is ignored', () => {
    const s = brokenStorage();
    expect(() => captureAttribution(landing('?utm_source=facebook'), s, T0)).not.toThrow();
    expect(readAttribution(s, T0)).toEqual({});
    expect(() => captureAttribution(landing('?utm_source=facebook'), null, T0)).not.toThrow();
    expect(readAttribution(null, T0)).toEqual({});
  });

  it('something other than our record in storage reads as no attribution', () => {
    const s = memoryStorage();
    for (const junk of ['not json', 'null', '[]', '{"at":"yesterday","values":{}}', `{"at":${T0},"values":{"utm_source":5,"evil":"x"}}`]) {
      s.setItem('hg_attribution', junk);
      expect(readAttribution(s, T0), junk).toEqual({});
    }
  });

  it('browserStorage gives null instead of throwing when the browser refuses storage', () => {
    const refusing = { get localStorage(): Storage { throw new Error('SecurityError'); } } as unknown as Window;
    expect(browserStorage(refusing)).toBeNull();
  });
});
