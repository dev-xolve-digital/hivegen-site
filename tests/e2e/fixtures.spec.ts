import { test } from './fixtures';

// Changes no server state, so it can run on both devices.
test('the guard: a test that asks Cloudflare for more than the stubbed Turnstile script is failed by its page fixture', async ({ page }) => {
  test.fail(); // expected to fail: that is the guard working (the fixture fails the test when it ends)
  await page.goto('/privacy');
  await page.evaluate(() => fetch('https://challenges.cloudflare.com/cdn-cgi/challenge-platform/anything', { mode: 'no-cors' }).catch(() => undefined));
});

test('the Turnstile script is answered by the stub, so the page gets a working window.turnstile with no call to Cloudflare', async ({ page }) => {
  await page.goto('/privacy');
  const token = await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('the stub did not answer'));
      document.head.append(script);
    });
    return new Promise<string>((resolve) => {
      const turnstile = (window as unknown as { turnstile: { render(el: HTMLElement, o: { callback(t: string): void }): string } }).turnstile;
      turnstile.render(document.body, { callback: resolve });
    });
  });
  if (token !== 'test-token') throw new Error(`unexpected token ${token}`);
});

test('the guard: a test that asks Meta or Google for anything it did not stub is failed by its page fixture', async ({ page }) => {
  test.fail();
  await page.goto('/privacy');
  await page.evaluate(() => Promise.all([
    fetch('https://connect.facebook.net/en_US/fbevents.js', { mode: 'no-cors' }).catch(() => undefined),
    fetch('https://www.googletagmanager.com/gtag/js?id=G-ABC123XYZ4', { mode: 'no-cors' }).catch(() => undefined),
  ]));
});

test('a test that answers the tracker scripts itself is not failed, and the page gets only the answer', async ({ page }) => {
  await page.route('https://connect.facebook.net/**', (route) => route.fulfill({ contentType: 'application/javascript', body: 'window.__stubbed = "facebook";' }));
  await page.goto('/privacy');
  const answer = await page.evaluate(() => new Promise<string>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://connect.facebook.net/en_US/fbevents.js';
    script.onload = () => resolve((window as unknown as { __stubbed: string }).__stubbed);
    script.onerror = () => reject(new Error('the stub did not answer'));
    document.head.append(script);
  }));
  if (answer !== 'facebook') throw new Error(`unexpected answer ${answer}`);
});
