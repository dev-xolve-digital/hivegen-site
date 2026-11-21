// jsdom ships no types; the tests only need the window it makes.
declare module 'jsdom' {
  export class JSDOM {
    constructor(html?: string, options?: { url?: string; pretendToBeVisual?: boolean });
    window: Window & typeof globalThis;
  }
}
