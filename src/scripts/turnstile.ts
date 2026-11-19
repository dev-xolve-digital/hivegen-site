const SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
/** How long a submit waits for the bot check before giving up. */
const WAIT_MS = 10_000;

/** The part of Cloudflare's Turnstile script the form uses. */
interface TurnstileApi {
  render(container: HTMLElement, options: Record<string, unknown>): string;
  reset(widgetId?: string): void;
}
type TurnstileWindow = Window & { turnstile?: TurnstileApi };

/**
 * Loads Cloudflare's Turnstile script and shows its widget in `container`. The widget stays invisible unless Cloudflare needs the
 * visitor to do something. `getToken()` gives a token (waiting for one for at most 10 seconds, then rejecting; at once when the script
 * cannot load, and the next call tries the script again); a token is good for one lead, so each one handed out starts the next.
 */
export function loadTurnstile(siteKey: string, container: HTMLElement): { getToken(): Promise<string> } {
  const doc = container.ownerDocument;
  const win = doc.defaultView as TurnstileWindow;
  let token: string | null = null;
  let widget: string | undefined;
  /** True from the moment Cloudflare's script is added until it has loaded or failed. */
  let loading = false;
  const waiting = new Set<{ resolve(t: string): void; reject(e: Error): void; timer: ReturnType<typeof setTimeout> }>();

  /** Hands out the token and starts the next one. */
  const take = (): string | null => {
    const t = token;
    if (t === null) return null;
    token = null;
    win.turnstile?.reset(widget);
    return t;
  };

  const onToken = (t: string) => {
    token = t;
    const next = waiting.values().next().value;
    if (!next) return;
    waiting.delete(next);
    clearTimeout(next.timer);
    next.resolve(take()!);
  };

  const render = () => {
    widget = win.turnstile!.render(container, {
      sitekey: siteKey,
      appearance: 'interaction-only',
      callback: onToken,
      'expired-callback': () => { token = null; },
      'error-callback': () => { token = null; },
    });
  };

  /** Adds Cloudflare's script. A script that fails (blocked, offline, a blip) is taken out again, so the next getToken can add a fresh one. */
  const loadScript = () => {
    loading = true;
    const script = doc.createElement('script');
    script.src = SRC;
    script.async = true;
    script.defer = true;
    script.addEventListener('load', () => { loading = false; render(); });
    script.addEventListener('error', () => {
      loading = false;
      script.remove();
      for (const w of waiting) { clearTimeout(w.timer); w.reject(new Error('turnstile_unavailable')); }
      waiting.clear(); // nobody should wait for a token that cannot come
    });
    doc.head.append(script);
  };

  if (win.turnstile) render();
  else loadScript();

  return {
    getToken() {
      const ready = take();
      if (ready !== null) return Promise.resolve(ready);
      if (!win.turnstile && !loading) loadScript(); // the first try failed: try the script again
      return new Promise<string>((resolve, reject) => {
        const w = {
          resolve, reject,
          timer: setTimeout(() => { waiting.delete(w); reject(new Error('turnstile_timeout')); }, WAIT_MS),
        };
        waiting.add(w);
      });
    },
  };
}
