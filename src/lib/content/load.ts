import fs from 'node:fs';
import path from 'node:path';
import { load as parseYaml, YAMLException } from 'js-yaml';
import { imageSize } from 'image-size';
import type { z } from 'zod';
import { ContentError } from './errors';
import {
  siteSchema, pageSchema, videosFileSchema, sectionSchemas, testimonialsSchema, imagesSchema,
  type Site, type Page, type Video, type Sections, type Testimonials, type Images,
} from './schemas';

export type { Site, Page, Video, Sections, Testimonials, BookingRules, Images } from './schemas';
export type PageSlug = '' | 'agencies' | 'videographers' | 'agents';
/** A message screenshot plus its image size, so the page can reserve its space before it loads. */
export type Screenshot = Testimonials['screenshots'][number] & { width: number; height: number };

const PAGE_FILES: Record<PageSlug, string> = { '': 'main', agencies: 'agencies', videographers: 'videographers', agents: 'agents' };

const contentDir = () => process.env.CONTENT_DIR ?? 'content';
/** The name shown in error messages, always with forward slashes, e.g. "content/pages/main.yaml". */
const shown = (rel: string) => `${contentDir().replace(/\\/g, '/').replace(/\/$/, '')}/${rel}`;

const publicDir = () => process.env.PUBLIC_DIR ?? 'public';
/** Where a site path such as "/brand/logo.png" or "media/clips/x.mp4" lives on disk. */
const inPublic = (sitePath: string) => path.join(publicDir(), sitePath.replace(/^\//, ''));

/** Stops the build when a file the page needs is not in public/, naming the content file and field. */
function requirePublic(sitePath: string, rel: string, field: string, message: string): void {
  if (!fs.existsSync(inPublic(sitePath))) throw new ContentError(`${shown(rel)}: ${message} (field ${field})`, shown(rel), field);
}
const runMedia = (sitePath: string) => `public/${sitePath.replace(/^\//, '')} is missing; run npm run media`;

function readText(rel: string): string {
  try {
    return fs.readFileSync(path.join(contentDir(), rel), 'utf8');
  } catch {
    throw new ContentError(`${shown(rel)}: file not found`, shown(rel));
  }
}

function readYaml(rel: string): unknown {
  const text = readText(rel);
  try {
    return parseYaml(text, { filename: shown(rel) });
  } catch (e) {
    if (e instanceof YAMLException) {
      const line = (e.mark?.line ?? 0) + 1;
      throw new ContentError(`${shown(rel)}: ${e.reason} (line ${line})`, shown(rel), undefined, line);
    }
    throw e;
  }
}

function friendly(issue: z.core.$ZodIssue): string {
  if (issue.code === 'invalid_type' && /received undefined/.test(issue.message)) return 'is missing';
  return issue.message;
}

function parse<S extends z.ZodType>(schema: S, rel: string): z.infer<S> {
  const result = schema.safeParse(readYaml(rel));
  if (result.success) return result.data;
  const lines = result.error.issues.map((i) => {
    const field = i.path.join('.');
    return `${shown(rel)}: ${field ? `"${field}" ` : ''}${friendly(i)} (field ${field || '(top)'})`;
  });
  const first = result.error.issues[0];
  throw new ContentError(lines.join('\n'), shown(rel), first?.path.join('.'));
}

function checkVideoIds(rel: string, entries: Array<{ id: string; field: string; orientation?: Video['orientation'] }>) {
  const byId = new Map(loadVideos().map((v) => [v.id, v]));
  for (const e of entries) {
    const v = byId.get(e.id);
    if (!v) throw new ContentError(`${shown(rel)}: unknown video id "${e.id}"; add it to videos.yaml or fix the spelling (field ${e.field})`, shown(rel), e.field);
    if (e.orientation && v.orientation !== e.orientation) {
      throw new ContentError(`${shown(rel)}: "${e.id}" is a ${v.orientation} video but is listed under ${e.orientation} (field ${e.field})`, shown(rel), e.field);
    }
  }
}

export function loadVideos(): Video[] {
  const { videos } = parse(videosFileSchema, 'videos.yaml');
  const seen = new Set<string>();
  videos.forEach((v, i) => {
    if (seen.has(v.id)) throw new ContentError(`${shown('videos.yaml')}: the id "${v.id}" is used twice (field videos.${i}.id)`, shown('videos.yaml'), `videos.${i}.id`);
    seen.add(v.id);
    if (!v.source && !v.streamUid) {
      throw new ContentError(`${shown('videos.yaml')}: "${v.id}" needs a source file (to make its card image) or a streamUid (to use Stream's) (field videos.${i})`, shown('videos.yaml'), `videos.${i}`);
    }
    // Videos with an original under references/ get a card image from `npm run media`; the others use Stream's.
    if (v.source) {
      requirePublic(`media/posters/${v.id}.jpg`, 'videos.yaml', `videos.${i}.id`,
        `no card image for "${v.id}" (public/media/posters/${v.id}.jpg); run npm run media`);
    }
  });
  return videos;
}

/** Which files are served from Cloudflare Images, by their path inside public/. */
export function loadImages(): Images {
  return parse(imagesSchema, 'images.yaml');
}

export function getVideo(id: string): Video {
  const v = loadVideos().find((x) => x.id === id);
  if (!v) throw new ContentError(`${shown('videos.yaml')}: no video with id "${id}"`, shown('videos.yaml'), 'videos');
  return v;
}

export function loadSite(): Site {
  const site = parse(siteSchema, 'site.yaml');
  checkVideoIds('site.yaml', [{ id: site.settings.heroLoop.videoId, field: 'settings.heroLoop.videoId' }]);
  requirePublic(site.brand.logo, 'site.yaml', 'brand.logo', `"${site.brand.logo}" was not found in public/; check the spelling or add the image`);
  for (const f of ['media/clips/hero-loop.mp4', 'media/posters/hero-loop.jpg']) requirePublic(f, 'site.yaml', 'settings.heroLoop', runMedia(f));
  return site;
}

export function loadPage(slug: PageSlug): Page {
  const rel = `pages/${PAGE_FILES[slug]}.yaml`;
  const page = parse(pageSchema, rel);
  if (page.slug !== slug) throw new ContentError(`${shown(rel)}: slug must be "${slug}" (field slug)`, shown(rel), 'slug');
  checkVideoIds(rel, [
    ...page.videoOrder.vertical.map((id, i) => ({ id, field: `videoOrder.vertical.${i}`, orientation: 'vertical' as const })),
    ...page.videoOrder.horizontal.map((id, i) => ({ id, field: `videoOrder.horizontal.${i}`, orientation: 'horizontal' as const })),
  ]);
  return page;
}

export function listPages(): Page[] {
  return (Object.keys(PAGE_FILES) as PageSlug[]).map(loadPage);
}

export function loadSection<K extends keyof Sections>(name: K): Sections[K] {
  const rel = `sections/${name}.yaml`;
  const data = parse(sectionSchemas[name], rel) as Sections[K];
  if (name === 'before-after') {
    const ba = data as Sections['before-after'];
    if (ba.slider?.fullVideoId) checkVideoIds(rel, [{ id: ba.slider.fullVideoId, field: 'slider.fullVideoId' }]);
    const clips = ba.mode === 'slider' ? [['ba-before', 'slider.before'], ['ba-after', 'slider.after']] : [['ba-reveal', 'reveal']];
    for (const [name, field] of clips) {
      for (const f of [`media/clips/${name}.mp4`, `media/posters/${name}.jpg`]) requirePublic(f, rel, field, runMedia(f));
    }
  }
  return data;
}

export function loadTestimonials(): Omit<Testimonials, 'screenshots'> & { screenshots: Screenshot[] } {
  const t = parse(testimonialsSchema, 'testimonials.yaml');
  checkVideoIds('testimonials.yaml', t.videos.map((v, i) => ({ id: v.videoId, field: `videos.${i}.videoId` })));
  const screenshots = t.screenshots.map((s, i) => {
    const sitePath = `media/screenshots/${s.file}`;
    const field = `screenshots.${i}.file`;
    requirePublic(sitePath, 'testimonials.yaml', field, `"${s.file}" was not found in public/media/screenshots/; check the spelling or add the image`);
    let size: { width?: number; height?: number } = {};
    try { size = imageSize(fs.readFileSync(inPublic(sitePath))); } catch { /* reported below */ }
    if (!size.width || !size.height) {
      throw new ContentError(`${shown('testimonials.yaml')}: "${s.file}" is not an image the site can read; use JPG, PNG or WebP (field ${field})`, shown('testimonials.yaml'), field);
    }
    return { ...s, width: size.width, height: size.height };
  });
  return { ...t, screenshots };
}

export function loadLegal(name: 'privacy' | 'terms'): { title: string; markdown: string } {
  const rel = `legal/${name}.md`;
  const raw = readText(rel).replace(/^\uFEFF/, '');
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  const title = m?.[1].match(/^title:\s*(.+)$/m)?.[1].trim();
  if (!m || !title) throw new ContentError(`${shown(rel)}: start the file with a "title:" block between --- lines (line 1)`, shown(rel), 'title', 1);
  return { title, markdown: m[2].trim() };
}
