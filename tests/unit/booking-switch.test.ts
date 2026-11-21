import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { mainHtml, mount, type Mounted } from './helpers/booking-dom';
import { initSwitch, NUDGE } from '../../src/scripts/booking-switch';

let html = '';
beforeAll(async () => { html = await mainHtml(); }); // rendered before the fake timers start
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

/**
 * An IntersectionObserver the test drives by hand: `see(true)` is "the whole switch scrolled into view" and `see(false)` "it left".
 * `see(0.2)` is a sliver of it: the browser reports it as intersecting, with the share that is on screen as the ratio.
 */
function fakeObserver(m: Mounted) {
  const watchers: Array<{ callback: IntersectionObserverCallback; target?: Element; options?: IntersectionObserverInit; disconnected: boolean }> = [];
  class FakeObserver {
    w: (typeof watchers)[number];
    constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) { this.w = { callback, options, disconnected: false }; watchers.push(this.w); }
    observe(el: Element) { this.w.target = el; }
    unobserve() {}
    disconnect() { this.w.disconnected = true; }
  }
  (m.window as unknown as { IntersectionObserver: unknown }).IntersectionObserver = FakeObserver;
  return {
    watchers,
    see(visible: boolean | number) {
      const ratio = typeof visible === 'number' ? visible : visible ? 1 : 0;
      const entry = { isIntersecting: ratio > 0, intersectionRatio: ratio } as IntersectionObserverEntry;
      for (const w of watchers) if (!w.disconnected) w.callback([entry], w as unknown as IntersectionObserver);
    },
  };
}

/** The card with the switch started and the observer in the test's hands. */
function card(opts: Parameters<typeof initSwitch>[1] = {}) {
  const m = mount(html);
  const io = fakeObserver(m);
  const sw = initSwitch(m.root, opts);
  const details = m.$('[data-view="details"]');
  return { m, io, sw, details, shaking: () => details.classList.contains('shake') };
}

const press = (m: Mounted, view: 'call' | 'details') => m.$(`[data-view="${view}"]`).click();
const key = (m: Mounted, from: 'call' | 'details', k: string) => m.$(`[data-view="${from}"]`).dispatchEvent(new m.window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
const selected = (m: Mounted) => (['call', 'details'] as const).filter((v) => m.$(`[data-view="${v}"]`).getAttribute('aria-selected') === 'true');

describe('the switch', () => {
  it('clicking Send details shows the form and its heading; Book a call brings the call back', () => {
    const onShow = vi.fn();
    const { m } = card({ onShow });
    press(m, 'details');
    expect(selected(m)).toEqual(['details']);
    expect(m.$('[data-inquiry]').hidden).toBe(false);
    expect(m.$('[data-flow]').hidden).toBe(true);
    expect(m.$('[data-heading="details"]').hidden).toBe(false);
    expect(m.$('[data-heading="call"]').hidden).toBe(true);
    expect(m.$('[data-subline="details"]').hidden).toBe(false);
    expect(m.$('[data-subline="call"]').hidden).toBe(true);
    expect(onShow).toHaveBeenLastCalledWith('details');
    press(m, 'call');
    expect(selected(m)).toEqual(['call']);
    expect(m.$('[data-inquiry]').hidden).toBe(true);
    expect(m.$('[data-flow]').hidden).toBe(false);
    expect(m.$('[data-heading="call"]').hidden).toBe(false);
    expect(m.$('[data-heading="details"]').hidden).toBe(true);
    expect(m.$('[data-subline="call"]').hidden).toBe(false);
    expect(m.$('[data-subline="details"]').hidden).toBe(true);
    expect(onShow).toHaveBeenLastCalledWith('call');
    expect(onShow).toHaveBeenCalledTimes(2);
  });

  it('only the selected tab is in the tab order, and show() does what a click does', () => {
    const onShow = vi.fn();
    const { m, sw } = card({ onShow });
    sw.show('details');
    expect(selected(m)).toEqual(['details']);
    expect(m.$('[data-view="details"]').getAttribute('tabindex')).toBe('0');
    expect(m.$('[data-view="call"]').getAttribute('tabindex')).toBe('-1');
    expect(onShow).toHaveBeenCalledWith('details');
    // the view it is already on is not "shown" again
    sw.show('details');
    expect(onShow).toHaveBeenCalledTimes(1);
  });

  it('the call flow keeps its step while the form is open', () => {
    const { m } = card();
    m.$('[data-step="details"]').hidden = true;
    m.$('[data-step="time"]').hidden = false;
    press(m, 'details');
    press(m, 'call');
    expect(m.$('[data-step="time"]').hidden).toBe(false);
    expect(m.$('[data-step="details"]').hidden).toBe(true);
  });

  it('arrow keys move between the two tabs', () => {
    const { m } = card();
    key(m, 'call', 'ArrowRight');
    expect(selected(m)).toEqual(['details']);
    expect(m.document.activeElement).toBe(m.$('[data-view="details"]'));
    expect(m.$('[data-inquiry]').hidden).toBe(false);
    key(m, 'details', 'ArrowRight'); // wraps round
    expect(selected(m)).toEqual(['call']);
    expect(m.document.activeElement).toBe(m.$('[data-view="call"]'));
    key(m, 'call', 'ArrowLeft'); // wraps round the other way
    expect(selected(m)).toEqual(['details']);
    key(m, 'details', 'Home');
    expect(selected(m)).toEqual(['call']);
    key(m, 'call', 'End');
    expect(selected(m)).toEqual(['details']);
    // other keys do nothing, and are left to the browser
    expect(key(m, 'details', 'a')).toBe(true);
    expect(selected(m)).toEqual(['details']);
  });

  it('what was typed carries across: email, name and phone, and the buyer and volume choices', () => {
    const { m } = card();
    const field = (panel: string, name: string) => m.$<HTMLInputElement>(`${panel} input[name="${name}"]`);
    const choose = (panel: string, name: string, value: string) => { m.$<HTMLInputElement>(`${panel} input[name="${name}"][value="${value}"]`).checked = true; };
    const chosen = (panel: string, name: string) => m.root.querySelector<HTMLInputElement>(`${panel} input[name="${name}"]:checked`)?.value;
    field('[data-flow]', 'email').value = 'zoe@example.com';
    field('[data-flow]', 'name').value = 'Zoë O’Brien';
    field('[data-flow]', 'phone').value = '+1 555 0100';
    choose('[data-flow]', 'buyer', 'videographer');
    choose('[data-flow]', 'volume', '6–15');
    press(m, 'details');
    expect(field('[data-inquiry]', 'email').value).toBe('zoe@example.com');
    expect(field('[data-inquiry]', 'name').value).toBe('Zoë O’Brien');
    expect(field('[data-inquiry]', 'phone').value).toBe('+1 555 0100');
    expect(chosen('[data-inquiry]', 'buyer')).toBe('videographer');
    expect(chosen('[data-inquiry]', 'volume')).toBe('6–15');
    // and back, with the changes made on the form
    field('[data-inquiry]', 'email').value = 'zoe@work.example';
    field('[data-inquiry]', 'name').value = '';
    choose('[data-inquiry]', 'buyer', 'other');
    choose('[data-inquiry]', 'volume', '30+');
    press(m, 'call');
    expect(field('[data-flow]', 'email').value).toBe('zoe@work.example');
    expect(field('[data-flow]', 'name').value).toBe('');
    expect(field('[data-flow]', 'phone').value).toBe('+1 555 0100');
    expect(chosen('[data-flow]', 'buyer')).toBe('other');
    expect(chosen('[data-flow]', 'volume')).toBe('30+');
  });

  it('the form-only answers stay where they are', () => {
    const { m } = card();
    m.$<HTMLTextAreaElement>('[data-inquiry] textarea').value = 'Two listings a week.';
    m.$<HTMLInputElement>('[data-inquiry] input[name="needs"]').checked = true;
    m.$<HTMLInputElement>('[data-flow] input[name="footage"]').value = 'https://example.com/call';
    press(m, 'details');
    press(m, 'call');
    press(m, 'details');
    expect(m.$<HTMLTextAreaElement>('[data-inquiry] textarea').value).toBe('Two listings a week.');
    expect(m.$<HTMLInputElement>('[data-inquiry] input[name="needs"]').checked).toBe(true);
    expect(m.$<HTMLInputElement>('[data-inquiry] input[name="footage"]').value).toBe('');
    expect(m.$<HTMLInputElement>('[data-flow] input[name="footage"]').value).toBe('https://example.com/call');
  });

  it('hide() hides the switch for the offline card, with the roles of the two panels', () => {
    const { m, io, sw } = card();
    sw.hide();
    expect(m.$('[data-switch]').hidden).toBe(true);
    expect(m.$('[data-flow]').hasAttribute('role')).toBe(false);
    expect(m.$('[data-inquiry]').hasAttribute('role')).toBe(false);
    expect(m.$('[data-inquiry]').hidden).toBe(true);
    // a hidden switch is not nudged
    io.see(true);
    vi.advanceTimersByTime(NUDGE.firstDelayMs + 1);
    expect(m.$('[data-view="details"]').classList.contains('shake')).toBe(false);
  });
});

describe('the nudge', () => {
  /** Runs the clock in small steps and says at which moments (ms from now) the shake began. */
  function shakeStarts(shaking: () => boolean, forMs: number, step = 50) {
    const starts: number[] = [];
    let was = shaking();
    for (let t = step; t <= forMs; t += step) {
      vi.advanceTimersByTime(step);
      const now = shaking();
      if (now && !was) starts.push(t);
      was = now;
    }
    return starts;
  }

  it('the numbers are the owner-approved ones', () => {
    expect(NUDGE).toEqual({ firstDelayMs: 600, everyMs: 6000, shakeMs: 700, maxShakes: 5 });
  });

  it('shakes only once the card is in view: at +600 ms, and not at +1300 ms', () => {
    const { io, shaking } = card();
    vi.advanceTimersByTime(30_000);
    expect(shaking()).toBe(false); // nothing is seen yet, so nothing happens
    io.see(true);
    vi.advanceTimersByTime(NUDGE.firstDelayMs - 1);
    expect(shaking()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(shaking()).toBe(true);
    vi.advanceTimersByTime(NUDGE.shakeMs - 1);
    expect(shaking()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(shaking()).toBe(false); // +1300 ms
  });

  it('shakes again every 6000 ms, and not more than 5 times in total', () => {
    const { io, shaking } = card();
    io.see(true);
    const starts = shakeStarts(shaking, 120_000);
    expect(starts).toEqual([600, 6600, 12_600, 18_600, 24_600]);
    expect(starts.length).toBeLessThanOrEqual(NUDGE.maxShakes);
    expect(shaking()).toBe(false);
  });

  it('never shakes while out of view, and picks up again when it is seen', () => {
    const { io, shaking } = card();
    io.see(true);
    vi.advanceTimersByTime(NUDGE.firstDelayMs);
    expect(shaking()).toBe(true);
    io.see(false); // scrolled away mid-shake: it stops at once
    expect(shaking()).toBe(false);
    expect(shakeStarts(shaking, 60_000)).toEqual([]);
    io.see(true);
    const again = shakeStarts(shaking, 15_000);
    expect(again.length).toBeGreaterThan(0);
    // the shakes before the scroll count: 5 in all, however often the card comes and goes
    io.see(false);
    io.see(true);
    const rest = shakeStarts(shaking, 120_000);
    expect(1 + again.length + rest.length).toBe(NUDGE.maxShakes);
  });

  it('a sliver of the switch on screen is not "seen": no shake until most of it is, and it stops when most of it has gone', () => {
    const { io, shaking } = card();
    io.see(0.2); // the browser reports any overlap as intersecting
    expect(shakeStarts(shaking, 30_000)).toEqual([]);
    io.see(0.59);
    expect(shakeStarts(shaking, 30_000)).toEqual([]);
    io.see(0.7);
    expect(shakeStarts(shaking, 1000)).toEqual([600]);
    io.see(0.6); // exactly the share the owner asked for counts
    io.see(0.3); // scrolled mostly away, still overlapping: it stops at once
    expect(shaking()).toBe(false);
    expect(shakeStarts(shaking, 30_000)).toEqual([]);
    io.see(0.9);
    expect(shakeStarts(shaking, 7000)).toEqual([6000]); // the next one, 6 s after it was seen again
  });

  it('asks the browser to report when 60% of the switch is on screen', () => {
    expect(card().io.watchers[0].options).toEqual({ threshold: 0.6 });
  });

  const stoppers: Array<[string, (c: ReturnType<typeof card>) => void]> = [
    ['focus on a field in the call form', ({ m }) => m.$('[data-flow] input[name="name"]').dispatchEvent(new m.window.FocusEvent('focusin', { bubbles: true }))],
    ['focus on a field in the form', ({ m }) => m.$('[data-inquiry] textarea').dispatchEvent(new m.window.FocusEvent('focusin', { bubbles: true }))],
    ['picking an option', ({ m }) => m.$('[data-flow] input[name="volume"]').dispatchEvent(new m.window.Event('change', { bubbles: true }))],
    ['choosing Send details', ({ m }) => press(m, 'details')],
    ['pressing Book a call', ({ m }) => press(m, 'call')],
    ['show() from the script', ({ sw }) => sw.show('details')],
  ];
  it.each(stoppers)('stops for good after %s', (_name, act) => {
    const c = card();
    c.io.see(true);
    vi.advanceTimersByTime(NUDGE.firstDelayMs);
    expect(c.shaking()).toBe(true);
    act(c);
    expect(c.shaking()).toBe(false);
    expect(shakeStarts(c.shaking, 60_000)).toEqual([]);
    c.io.see(false);
    c.io.see(true); // seen again: still nothing
    expect(shakeStarts(c.shaking, 60_000)).toEqual([]);
  });

  it('a focus before the first shake means no shake at all', () => {
    const c = card();
    c.m.$('[data-flow] input[name="email"]').dispatchEvent(new c.m.window.FocusEvent('focusin', { bubbles: true }));
    c.io.see(true);
    expect(shakeStarts(c.shaking, 60_000)).toEqual([]);
  });

  it('focus on the switch itself, or on a part of the card that is not a field, does not stop it', () => {
    const c = card();
    c.io.see(true);
    c.m.$('[data-view="details"]').dispatchEvent(new c.m.window.FocusEvent('focusin', { bubbles: true }));
    c.m.$('[data-heading="call"]').dispatchEvent(new c.m.window.FocusEvent('focusin', { bubbles: true }));
    expect(shakeStarts(c.shaking, 1000)).toEqual([600]);
  });

  it('reduced motion: never a shake class', () => {
    const c = card({ reducedMotion: true });
    c.io.see(true);
    expect(shakeStarts(c.shaking, 120_000)).toEqual([]);
    // the switch itself still works
    press(c.m, 'details');
    expect(selected(c.m)).toEqual(['details']);
  });

  it('with no way to tell if the card is in view, it does not shake', () => {
    const m = mount(html);
    (m.window as unknown as { IntersectionObserver?: unknown }).IntersectionObserver = undefined;
    initSwitch(m.root);
    vi.advanceTimersByTime(60_000);
    expect(m.$('[data-view="details"]').classList.contains('shake')).toBe(false);
  });

  it('watches the switch itself', () => {
    const c = card();
    expect(c.io.watchers).toHaveLength(1);
    expect(c.io.watchers[0].target).toBe(c.m.$('[data-switch]'));
  });
});
