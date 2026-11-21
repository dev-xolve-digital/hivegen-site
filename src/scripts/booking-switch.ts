/**
 * The switch at the top of the booking card's form panel: "Book a call" (selected when the page opens) or "Send details".
 * It swaps the two panels and the heading and subline in the card's left column, carries what the visitor typed across,
 * and gives "Send details" a short shake now and then until the visitor uses the card.
 */

export type View = 'call' | 'details';

/**
 * The attention nudge on "Send details", as the owner approved it. The first shake comes 600 ms after the switch scrolls into view,
 * then one every 6 s, 5 at most. Each lasts 0.7 s (the CSS animation has the same length).
 */
export const NUDGE = { firstDelayMs: 600, everyMs: 6000, shakeMs: 700, maxShakes: 5 };

export interface SwitchOptions {
  /** Visitors who prefer reduced motion get the lime colour and no shake. Left out, the browser's own setting is read. */
  reducedMotion?: boolean;
  /** Called after the view changes (not when the view that is already shown is chosen again). */
  onShow?(view: View): void;
}

export interface Switch {
  show(view: View): void;
  /** For the offline card: the switch goes, and the panels are no longer tab panels. */
  hide(): void;
}

const VIEWS: readonly View[] = ['call', 'details'];
/** The answers both forms ask for, carried across when the visitor switches. */
const TEXT_FIELDS = ['email', 'name', 'phone'];
const CHOICE_FIELDS = ['buyer', 'volume'];
/** Most of the switch has to be on the screen for the nudge to count as seen. */
const SEEN = 0.6;

/** Copies the typed answers and the choices of one panel onto the other. The panel that is left wins, empty answers too. */
function carry(from: HTMLElement, to: HTMLElement): void {
  for (const name of TEXT_FIELDS) {
    const source = from.querySelector<HTMLInputElement>(`input[name="${name}"]`);
    const target = to.querySelector<HTMLInputElement>(`input[name="${name}"]`);
    if (source && target) target.value = source.value;
  }
  for (const name of CHOICE_FIELDS) {
    const picked = from.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`)?.value;
    to.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`).forEach((radio) => { radio.checked = radio.value === picked; });
  }
}

/** Starts the switch on a booking card. The card opens on the call, as its markup says. */
export function initSwitch(root: HTMLElement, opts: SwitchOptions = {}): Switch {
  const win = root.ownerDocument.defaultView!;
  const $ = <T extends HTMLElement = HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const bar = $('[data-switch]');
  const byView = (pick: (view: View) => string) => ({ call: $(pick('call')), details: $(pick('details')) });
  const tab = byView((v) => `[data-view="${v}"]`);
  const panel = { call: $('[data-flow]'), details: $('[data-inquiry]') };
  const heading = byView((v) => `[data-heading="${v}"]`);
  const subline = byView((v) => `[data-subline="${v}"]`);
  let current: View = 'call';

  // The nudge: a shake while the switch is on the screen, and never again once the visitor uses the card.
  const nudge = tab.details;
  const reduced = opts.reducedMotion ?? Boolean(win.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  let stopped = reduced || !win.IntersectionObserver; // a browser that cannot tell what is on screen gets no shake either
  let watcher: IntersectionObserver | undefined;
  let inView = false;
  let shakes = 0;
  let nextShake: ReturnType<typeof setTimeout> | undefined;
  let endShake: ReturnType<typeof setTimeout> | undefined;

  const endNow = () => { clearTimeout(endShake); nudge.classList.remove('shake'); };
  const arm = (ms: number) => { clearTimeout(nextShake); nextShake = setTimeout(shake, ms); };
  function shake() {
    shakes += 1;
    nudge.classList.add('shake');
    endShake = setTimeout(() => nudge.classList.remove('shake'), NUDGE.shakeMs);
    if (shakes < NUDGE.maxShakes) arm(NUDGE.everyMs);
    else stopWatching(); // that was the last one: let it finish
  }
  function stopWatching() {
    stopped = true;
    watcher?.disconnect();
    root.removeEventListener('focusin', onUse);
    root.removeEventListener('change', onUse);
  }
  /** Stops for good: no timer, no watching, no shake in progress. */
  function stopNudge() {
    clearTimeout(nextShake);
    endNow();
    stopWatching();
  }
  /** Focus on a field, or an option picked: the visitor is using the card, so it no longer needs to catch their eye. */
  function onUse(e: Event) {
    if ((e.target as Element).matches?.('input, textarea, select')) stopNudge();
  }

  if (!stopped) {
    root.addEventListener('focusin', onUse);
    root.addEventListener('change', onUse); // some browsers do not focus a radio button that is clicked
    watcher = new win.IntersectionObserver((entries) => {
      const last = entries[entries.length - 1];
      // isIntersecting is true at any overlap, so a sliver counts too: the share on screen has to be there as well.
      const seen = last !== undefined && last.isIntersecting && last.intersectionRatio >= SEEN;
      if (stopped || seen === inView) return;
      inView = seen;
      if (seen) arm(shakes === 0 ? NUDGE.firstDelayMs : NUDGE.everyMs);
      else { clearTimeout(nextShake); endNow(); } // scrolled away: it stops at once, and waits
    }, { threshold: SEEN });
    watcher.observe(bar);
  }

  const show = (view: View) => {
    stopNudge(); // pressing either option counts as using the card
    if (view === current) return;
    carry(panel[current], panel[view]);
    current = view;
    for (const v of VIEWS) {
      const on = v === view;
      tab[v].setAttribute('aria-selected', String(on));
      tab[v].tabIndex = on ? 0 : -1;
      panel[v].hidden = !on;
      heading[v].hidden = !on;
      subline[v].hidden = !on;
    }
    opts.onShow?.(view);
  };

  for (const v of VIEWS) tab[v].addEventListener('click', () => show(v));
  // Arrow keys move between the tabs (and choose the tab they land on); Home and End go to the first and the last.
  bar.addEventListener('keydown', (e) => {
    const at = VIEWS.findIndex((v) => tab[v] === e.target);
    if (at < 0) return;
    const to = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (at + 1) % VIEWS.length
      : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? (at + VIEWS.length - 1) % VIEWS.length
        : e.key === 'Home' ? 0
          : e.key === 'End' ? VIEWS.length - 1
            : -1;
    if (to < 0) return;
    e.preventDefault();
    tab[VIEWS[to]].focus();
    show(VIEWS[to]);
  });

  return {
    show,
    hide() {
      stopNudge();
      bar.hidden = true;
      for (const v of VIEWS) { panel[v].removeAttribute('role'); panel[v].removeAttribute('aria-labelledby'); }
    },
  };
}
