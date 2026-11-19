import { RateLimitedError, SlotTakenError, TooLateError, type ManageApi } from '../lib/booking/api-client';
import { formatSlotLong } from '../lib/booking/format';
import type { Slot } from '../lib/booking/slots';
import { fillPlaceholders } from '../lib/text';
import { renderSlotPicker } from './slot-picker';

/** The wording the page hands the script (from manage-booking.yaml and booking.yaml, as JSON in the page). */
export interface ManageCopy {
  cancelledText: string; rescheduledText: string; tooLateText: string; errorText: string;
  /** From booking.yaml: a time taken meanwhile, too many tries, and no times to offer. */
  slotTaken: string; rateLimited: string; noSlots: string;
}

/**
 * Makes the manage page work: Reschedule opens the times of the booking's own zone and moves the call, Cancel asks first and then cancels.
 * One request is in flight at a time: every button is disabled meanwhile, and enabled again when it ends in an error.
 * `root` is the page's `[data-manage]` element; the page renders the call time and whichever actions are allowed.
 */
export function initManage(root: HTMLElement, api: ManageApi): void {
  const $ = <T extends HTMLElement = HTMLElement>(sel: string) => root.querySelector<T>(sel);
  const actions = $('[data-actions]');
  if (!actions) return; // nothing can be done with this booking: the page only says so

  const doc = root.ownerDocument;
  const copy = JSON.parse($('[data-manage-copy]')!.textContent!) as ManageCopy;
  const tz = root.dataset.tz!;
  const notice = $('[data-notice]')!;
  const details = $('[data-details]')!;
  const when = $<HTMLTimeElement>('[data-when]')!;
  const rescheduleOpen = $<HTMLButtonElement>('[data-reschedule-open]');
  const cancelOpen = $<HTMLButtonElement>('[data-cancel-open]');

  let current: Slot = { start: when.dateTime, end: when.dataset.end! };
  let chosen: Slot | null = null;
  let busy = false;

  const messageFor = (e: unknown) => (e instanceof RateLimitedError ? copy.rateLimited : copy.errorText);
  const show = (el: HTMLElement, text: string) => { el.textContent = text; el.hidden = false; };

  /** Enables or disables every button. A request in flight disables them all; Confirm reschedule also waits for a picked time. */
  const refreshButtons = () => {
    root.querySelectorAll<HTMLButtonElement>('[data-reschedule-open], [data-cancel-open], [data-cancel-confirm], [data-cancel-keep]')
      .forEach((b) => { b.disabled = busy; });
    const confirm = $<HTMLButtonElement>('[data-reschedule-confirm]');
    if (confirm) confirm.disabled = busy || !chosen;
  };
  /**
   * Runs one request with the buttons disabled; `work` handles its own errors. A button that had focus and is still there afterwards
   * gets it back (a disabled button can lose it), so a keyboard user who hit an error is where they were.
   */
  async function whileBusy(work: () => Promise<void>) {
    const focused = doc.activeElement as HTMLElement | null;
    busy = true;
    refreshButtons();
    try { await work(); } finally {
      busy = false;
      refreshButtons();
      if (focused && doc.activeElement === doc.body && !focused.closest('[hidden]')) focused.focus();
    }
  }
  /** Puts a sentence under the heading and moves focus to it, so a screen reader reads it. */
  const say = (text: string) => { show(notice, text); notice.focus(); };

  if (rescheduleOpen) {
    const panel = $('[data-reschedule-panel]')!;
    const days = $('[data-days]')!;
    const slotsBox = $('[data-slots]')!;
    const error = $('[data-reschedule-error]')!;

    const loadSlots = async () => {
      const { slots } = await api.getSlots();
      renderSlotPicker(days, slotsBox, slots, tz, (s) => { chosen = s; refreshButtons(); }, copy.noSlots);
    };
    const close = () => { panel.hidden = true; rescheduleOpen.setAttribute('aria-expanded', 'false'); };

    rescheduleOpen.addEventListener('click', async () => {
      if (busy) return;
      if (!panel.hidden) { close(); return; }
      panel.hidden = false;
      rescheduleOpen.setAttribute('aria-expanded', 'true');
      error.hidden = true;
      notice.hidden = true; // "Done. Your call is now on..." is about the last move, not the one about to be picked
      await whileBusy(async () => {
        try {
          await loadSlots(); // the times are asked for each time the picker opens, so they are never old
          $('[data-reschedule-heading]')!.focus();
        } catch (e) {
          show(error, messageFor(e));
        }
      });
    });

    $('[data-reschedule-confirm]')!.addEventListener('click', async () => {
      const slot = chosen;
      if (busy || !slot) return;
      error.hidden = true;
      notice.hidden = true;
      await whileBusy(async () => {
        try {
          const moved = await api.reschedule(slot);
          current = { start: moved.start, end: moved.end };
          when.dateTime = moved.start;
          when.dataset.end = moved.end;
          when.textContent = formatSlotLong(current, tz);
          chosen = null;
          close();
          say(fillPlaceholders(copy.rescheduledText, { when: when.textContent }));
        } catch (e) {
          if (e instanceof TooLateError) {
            rescheduleOpen.hidden = true;
            panel.hidden = true;
            say(copy.tooLateText);
          } else if (e instanceof SlotTakenError) {
            chosen = null;
            try { await loadSlots(); } catch { /* the message below still tells them to pick another time */ }
            show(error, copy.slotTaken);
          } else {
            show(error, messageFor(e));
          }
        }
      });
    });
  }

  if (cancelOpen) {
    const panel = $('[data-cancel-panel]')!;
    const error = $('[data-cancel-error]')!;
    const setOpen = (open: boolean) => { panel.hidden = !open; cancelOpen.setAttribute('aria-expanded', String(open)); };

    cancelOpen.addEventListener('click', () => {
      if (busy) return;
      error.hidden = true;
      setOpen(Boolean(panel.hidden)); // a hidden panel opens, an open one closes
    });
    $('[data-cancel-keep]')!.addEventListener('click', () => {
      if (busy) return;
      setOpen(false);
      cancelOpen.focus();
    });
    $('[data-cancel-confirm]')!.addEventListener('click', async () => {
      if (busy) return;
      error.hidden = true;
      await whileBusy(async () => {
        try {
          await api.cancel();
          actions.hidden = true;
          details.hidden = true;
          say(fillPlaceholders(copy.cancelledText, { when: formatSlotLong(current, tz) }));
        } catch (e) {
          if (e instanceof TooLateError) {
            actions.hidden = true; // rescheduling closes before cancelling does: nothing is left to do here
            say(copy.tooLateText);
          } else {
            show(error, messageFor(e));
          }
        }
      });
    });
  }
}
