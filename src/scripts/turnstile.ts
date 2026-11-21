import { TURNSTILE_ACTION, type TurnstileAction } from '../lib/booking/api-client';

const SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
/** How long a submit waits for the bot check before giving up. */
const WAIT_MS = 10_000;

/** The part of Cloudflare's Turnstile script the form uses. */
interface TurnstileApi {
  render(container: HTMLElement, options: Record<string, unknown>): string;
  reset(widgetId?: string): void;
}
type TurnstileWindow = Window & { turnstile?: TurnstileApi };

/** What a widget does once Cloudflare's script has loaded, or has failed to. */
interface ScriptWaiter { loaded(): void; failed(): void }
/** The widgets waiting for the script of a document, for as long as it is on its way. Every widget of a page shares the one script. */
const loadingScripts = new WeakMap<Document, Set<ScriptWaiter>>();

/**
 * Calls `waiter.loaded()` once Cloudflare's script is on the page (at once when it already is), or `waiter.failed()` when it cannot load.
 * The script is added once per document, however many widgets ask while it loads. A script that fails (blocked, offline, a blip), or that
 * loads without defining `window.turnstile`, is taken out again, so the next ask adds a fresh one. The answers come in the script's own
 * load and error events, so a widget renders right then. Each waiter is called on its own: one that throws does not stop the others.
 */
function whenScriptReady(doc: Document, waiter: ScriptWaiter): void {
  if ((doc.defaultView as TurnstileWindow).turnstile) { waiter.loaded(); return; }
  const waiters = loadingScripts.get(doc);
  if (waiters) { waiters.add(waiter); return; }
  const joined = new Set([waiter]);
  loadingScripts.set(doc, joined);
  const script = doc.createElement('script');
  script.src = SRC;
  script.async = true;
  script.defer = true;
  const settle = (ok: boolean) => {
    loadingScripts.delete(doc);
    if (!ok) script.remove();
    for (const w of joined) {
      try { if (ok) w.loaded(); else w.failed(); } catch { /* the other widgets still get their answer */ }
    }
  };
  script.addEventListener('load', () => settle(Boolean((doc.defaultView as TurnstileWindow).turnstile)));
  script.addEventListener('error', () => settle(false));
  doc.head.append(script);
}

/**
 * Loads Cloudflare's Turnstile script (once for the page, however many widgets there are) and shows its widget in `container`, made for
 * `action` (the server accepts a token only for the action of the form it was made for). The widget stays invisible unless Cloudflare needs
 * the visitor to do something. `getToken()` gives a token (waiting for one for at most 10 seconds, then rejecting; at once when the script
 * cannot load, and the next call tries the script again); a token is good for one send, so each one handed out starts the next.
 */
export function loadTurnstile(siteKey: string, container: HTMLElement, action: TurnstileAction = TURNSTILE_ACTION): { getToken(): Promise<string> } {
  const doc = container.ownerDocument;
  const win = doc.defaultView as TurnstileWindow;
  let token: string | null = null;
  let widget: string | undefined;
  let rendered = false;
  /** True from the moment this widget asked for the script until it has loaded or failed. */
  let asking = false;
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
    // `rendered` is set only once Cloudflare has made the widget: a render that throws leaves it unset, so the next getToken tries again.
    widget = win.turnstile!.render(container, {
      sitekey: siteKey,
      action,
      appearance: 'interaction-only',
      callback: onToken,
      'expired-callback': () => { token = null; },
      'error-callback': () => { token = null; },
    });
    rendered = true;
  };

  /** Nobody should wait for a token that cannot come: every getToken that waits is told at once. */
  const failWaiting = () => {
    for (const w of waiting) { clearTimeout(w.timer); w.reject(new Error('turnstile_unavailable')); }
    waiting.clear();
  };

  /** Asks for the script, to render once it is there. Does nothing while an ask is on its way or the widget is up. */
  const start = () => {
    if (asking || rendered) return;
    asking = true;
    whenScriptReady(doc, {
      loaded: () => {
        asking = false;
        try { render(); } catch { failWaiting(); } // a widget that cannot be made is a failure too, never a throw into the page
      },
      failed: () => { asking = false; failWaiting(); },
    });
  };

  start();

  return {
    getToken() {
      const ready = take();
      if (ready !== null) return Promise.resolve(ready);
      const answer = new Promise<string>((resolve, reject) => {
        const w = {
          resolve, reject,
          timer: setTimeout(() => { waiting.delete(w); reject(new Error('turnstile_timeout')); }, WAIT_MS),
        };
        waiting.add(w);
      });
      start(); // the first try failed (no script, or no widget): try again. After the wait is set up, so a failure that comes at once rejects it
      return answer;
    },
  };
}
