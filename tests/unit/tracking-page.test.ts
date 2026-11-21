import { afterEach, describe, expect, it, vi } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import NotFound from '../../src/pages/404.astro';
import ManagePage from '../../src/pages/booking/[token].astro';
import { getContext } from '../../src/server/context';
import type { ServerContext } from '../../src/server/context';
import { removeTempContent, tempContent } from '../helpers/temp-content';

// The page's side of tracking: the ids are put in the page's source only when there are some, and never on a private page.
vi.mock('../../src/server/context', () => ({ getContext: vi.fn() }));

afterEach(() => { delete process.env.CONTENT_DIR; removeTempContent(); vi.mocked(getContext).mockReset(); });

const withIds = (lines: Record<string, string>) => {
  process.env.CONTENT_DIR = tempContent({
    'site.yaml': (t) => Object.entries(lines).reduce((text, [key, value]) => text.replace(new RegExp(`^  ${key}: ""`, 'm'), `  ${key}: "${value}"`), t),
  });
};
const render = async (page: Parameters<AstroContainer['renderToString']>[0] = NotFound, path = '/404') =>
  (await AstroContainer.create()).renderToString(page, { request: new Request(`https://hivegen.test${path}`) });
const tracking = (html: string) => /<script type="application\/json" data-tracking>(.*?)<\/script>/s.exec(html)?.[1];
const THIRD_PARTY = /facebook|fbevents|googletagmanager|gtag\/js|google-analytics|doubleclick/i;

describe('the tracking ids in a page', () => {
  it('with no ids in site.yaml, the page has no tracking element and names no third-party script', async () => {
    withIds({}); // content with every id empty, not the real file: it gets the real ids when the site goes live
    const html = await render();
    expect(tracking(html)).toBeUndefined();
    expect(html).not.toContain('data-tracking');
    expect(html).not.toMatch(THIRD_PARTY);
  });

  it('with ids set: one JSON element holding only the ids that are set, and still no third-party address in the page', async () => {
    withIds({ metaPixelId: '123456789012345', googleAdsId: 'AW-987654321', googleAdsScheduleLabel: 'AbC-D_efG-h' });
    const html = await render();
    expect(JSON.parse(tracking(html)!)).toEqual({ metaPixelId: '123456789012345', googleAdsId: 'AW-987654321', googleAdsScheduleLabel: 'AbC-D_efG-h' });
    expect(html.match(/data-tracking/g)).toHaveLength(1);
    expect(html.replace(/<script type="application\/json" data-tracking>.*?<\/script>/s, '')).not.toMatch(/facebook|fbevents|googletagmanager|gtag\/js/i); // scripts add those after load
  });

  it('only a Google tag id set: the Meta fields are not in the JSON at all', async () => {
    withIds({ googleTagId: 'G-ABC123XYZ4' });
    expect(JSON.parse(tracking(await render())!)).toEqual({ googleTagId: 'G-ABC123XYZ4' });
  });

  it('a label with no id to go with it is still only an id in the page: the element is there, and the script does nothing with it', async () => {
    withIds({ googleAdsScheduleLabel: 'AbC-D_efG-h' });
    expect(JSON.parse(tracking(await render())!)).toEqual({ googleAdsScheduleLabel: 'AbC-D_efG-h' });
  });

  it('the manage page never has it: its address holds a secret link that no tracker may see', async () => {
    withIds({ metaPixelId: '123456789012345', googleTagId: 'G-ABC123XYZ4' });
    vi.mocked(getContext).mockResolvedValue({ service: null } as unknown as ServerContext);
    const html = await render(ManagePage, `/booking/${'T'.repeat(43)}`);
    expect(html).toContain('noindex');
    expect(html).not.toContain('data-tracking');
    expect(html).not.toContain('123456789012345');
    // ...while an ordinary page of the same site does:
    expect(tracking(await render())).toBeDefined();
  });

  it('a page with no tracking keeps its address to itself: its links carry no referrer, so no tracker on the next page can see it', async () => {
    vi.mocked(getContext).mockResolvedValue({ service: null } as unknown as ServerContext);
    const html = await render(ManagePage, `/booking/${'T'.repeat(43)}`);
    expect(html).toContain('<meta name="referrer" content="no-referrer">');
    // An ordinary page says nothing: the browser's default policy applies, and the page keeps its marketing referrer.
    expect(await render()).not.toContain('name="referrer"');
    withIds({ metaPixelId: '123456789012345' });
    expect(await render()).not.toContain('name="referrer"');
  });
});
