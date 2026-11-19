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
