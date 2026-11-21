import { JSDOM } from 'jsdom';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import Booking from '../../../src/components/Booking.astro';
import { loadPage, loadSection, loadSite, type PageSlug } from '../../../src/lib/content/load';

/** The unit tests of the booking form render the real Booking section, then run the real script on it in jsdom. */

export const b = loadSection('booking');
export const site = loadSite();
export const SITE_URL = 'https://hivegen.test/';

/** The section's HTML for a page version. */
export async function renderBooking(slug: PageSlug = ''): Promise<string> {
  return (await AstroContainer.create()).renderToString(Booking, { props: { page: loadPage(slug) } });
}

export interface Mounted { window: Window & typeof globalThis; document: Document; root: HTMLElement; $: <T extends HTMLElement = HTMLElement>(sel: string) => T }

/** Puts the section's HTML in a fresh jsdom page (with working localStorage and cookies). */
export function mount(html: string, url = SITE_URL): Mounted {
  const { window } = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, { url });
  const root = window.document.querySelector<HTMLElement>('[data-booking]')!;
  return { window, document: window.document, root, $: <T extends HTMLElement = HTMLElement>(sel: string) => root.querySelector<T>(sel)! };
}

let cached: Promise<string> | undefined;
/** The main page's section, rendered once for the whole file. */
export const mainHtml = () => (cached ??= renderBooking(''));
