// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { initSlider } from '../../src/scripts/before-after';
it('arrow keys move the slider by 5 and clamp', () => {
  document.body.innerHTML = '<div role="slider" aria-valuenow="50" tabindex="0"></div>';
  const el = document.querySelector<HTMLElement>('[role=slider]')!;
  initSlider(el);
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
  expect(el.getAttribute('aria-valuenow')).toBe('55');
  expect(el.style.getPropertyValue('--pos')).toBe('55%');
  for (let i = 0; i < 30; i++) el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
  expect(el.getAttribute('aria-valuenow')).toBe('0');
});

/** A slider with two clips, the raw one first, whose playback state the test sets by hand. `writes` counts how often the raw clip was moved. */
function twoClips(state: { raw: number; edited: number; rawSeeking?: boolean; editedSeeking?: boolean; rawReady?: number; editedReady?: number }) {
  document.body.innerHTML = '<div role="slider" aria-valuenow="50" tabindex="0"><video></video><video></video></div>';
  const el = document.querySelector<HTMLElement>('[role=slider]')!;
  const [raw, edited] = [...el.querySelectorAll('video')];
  const writes: number[] = [];
  let rawTime = state.raw;
  Object.defineProperties(raw, {
    currentTime: { get: () => rawTime, set: (t: number) => { rawTime = t; writes.push(t); } },
    seeking: { get: () => state.rawSeeking ?? false },
    readyState: { get: () => state.rawReady ?? 4 },
  });
  Object.defineProperties(edited, {
    currentTime: { get: () => state.edited },
    seeking: { get: () => state.editedSeeking ?? false },
    readyState: { get: () => state.editedReady ?? 4 },
  });
  initSlider(el);
  const tick = () => edited.dispatchEvent(new Event('timeupdate')); // the edited clip leads: it is the one that reports the time
  return { writes, tick };
}

describe('the slider keeps the raw clip in step with the edited one', () => {
  it('moves the raw clip when both are ready and more than half a second apart', () => {
    const c = twoClips({ raw: 10, edited: 10.6 });
    c.tick();
    expect(c.writes).toEqual([10.6]);
    const far = twoClips({ raw: 3, edited: 40 });
    far.tick();
    expect(far.writes).toEqual([40]);
    const behind = twoClips({ raw: 12, edited: 11 });
    behind.tick();
    expect(behind.writes).toEqual([11]);
  });

  it('leaves it alone at 0.3 s, and at exactly 0.5 s', () => {
    for (const edited of [10.3, 10.5, 10, 9.7]) {
      const c = twoClips({ raw: 10, edited });
      c.tick();
      expect(c.writes, `edited at ${edited}`).toEqual([]);
    }
  });

  it.each([
    ['the raw clip is seeking', { rawSeeking: true }],
    ['the edited clip is seeking', { editedSeeking: true }],
    ['the raw clip has no data to play on (readyState 2)', { rawReady: 2 }],
    ['the edited clip has no data to play on (readyState 1)', { editedReady: 1 }],
    ['neither is ready', { rawReady: 0, editedReady: 0 }],
  ])('does not correct while %s: a phone that cannot catch up would only be sent back again and again', (_name, over) => {
    const c = twoClips({ raw: 10, edited: 25, ...over });
    c.tick();
    c.tick();
    expect(c.writes).toEqual([]);
  });

  it('corrects again once both are ready (readyState 3 is enough)', () => {
    const c = twoClips({ raw: 10, edited: 25, rawReady: 3, editedReady: 3 });
    c.tick();
    expect(c.writes).toEqual([25]);
  });
});
