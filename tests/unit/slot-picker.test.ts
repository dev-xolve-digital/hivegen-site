import { it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { renderSlotPicker } from '../../src/scripts/slot-picker';

const slots = [0, 1, 2].map((day) => {
  const start = Date.UTC(2026, 11, 8 + day, 14, 0);
  return { start: new Date(start).toISOString(), end: new Date(start + 15 * 60_000).toISOString() };
});

// A day button shows "Tue" over "Dec 8" and is named "Tue, Dec 8". The name must hold the words that are shown (WCAG 2.5.3; axe's
// label-content-name-mismatch), so the two parts are separated by a space and a voice-control user can say what they see.
it('the name of a day button holds its visible text, with the weekday and the date apart', () => {
  const { window } = new JSDOM('<div id="days"></div><div id="slots"></div>');
  const doc = window.document;
  renderSlotPicker(doc.getElementById('days')!, doc.getElementById('slots')!, slots, 'America/New_York', () => {}, 'none');
  const buttons = [...doc.querySelectorAll('#days button')];
  expect(buttons).toHaveLength(3);
  const words = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  for (const b of buttons) {
    expect(words(b.getAttribute('aria-label')!)).toContain(words(b.textContent!));
    expect(words(b.textContent!)).toMatch(/^[a-z]+ [a-z]+ \d+$/); // "tue dec 8", not "tuedec 8"
  }
});
