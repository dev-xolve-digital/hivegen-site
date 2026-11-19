import { it, expect } from 'vitest';
import fs from 'node:fs';

// The browser tests get their `page` from tests/e2e/fixtures.ts, which answers Cloudflare's Turnstile script with a stub and fails
// any test that reaches Cloudflare in another way. A spec that imports `test` straight from Playwright would skip that.
it('every browser spec takes its `test` from tests/e2e/fixtures.ts, so none can reach Cloudflare', () => {
  const specs = fs.readdirSync('tests/e2e').filter((f) => f.endsWith('.spec.ts'));
  expect(specs.length).toBeGreaterThan(5);
  const direct = specs.filter((f) => /import\s*\{[^}]*\btest\b[^}]*\}\s*from\s*'@playwright\/test'/.test(fs.readFileSync(`tests/e2e/${f}`, 'utf8')));
  expect(direct, 'import { test, expect } from "./fixtures" instead').toEqual([]);
});
