import fs from 'node:fs';
import path from 'node:path';
import { load as parseYaml, YAMLException } from 'js-yaml';
import type { z } from 'zod';
import { ContentError } from './errors';
import {
  siteSchema, pageSchema, videosFileSchema, sectionSchemas, testimonialsSchema,
  type Site, type Page, type Video, type Sections, type Testimonials,
} from './schemas';

export type { Site, Page, Video, Sections, Testimonials, BookingRules } from './schemas';
export type PageSlug = '' | 'agencies' | 'videographers' | 'agents';

const PAGE_FILES: Record<PageSlug, string> = { '': 'main', agencies: 'agencies', videographers: 'videographers', agents: 'agents' };

const contentDir = () => process.env.CONTENT_DIR ?? 'content';
/** The name shown in error messages, always with forward slashes, e.g. "content/pages/main.yaml". */
const shown = (rel: string) => `${contentDir().replace(/\\/g, '/').replace(/\/$/, '')}/${rel}`;

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
  });
  return videos;
}

export function getVideo(id: string): Video {
  const v = loadVideos().find((x) => x.id === id);
  if (!v) throw new ContentError(`${shown('videos.yaml')}: no video with id "${id}"`, shown('videos.yaml'), 'videos');
  return v;
}

export function loadSite(): Site {
  const site = parse(siteSchema, 'site.yaml');
  checkVideoIds('site.yaml', [{ id: site.settings.heroLoop.videoId, field: 'settings.heroLoop.videoId' }]);
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
  }
  return data;
}

export function loadTestimonials(): Testimonials {
  const t = parse(testimonialsSchema, 'testimonials.yaml');
  checkVideoIds('testimonials.yaml', t.videos.map((v, i) => ({ id: v.videoId, field: `videos.${i}.videoId` })));
  return t;
}

export function loadLegal(name: 'privacy' | 'terms'): { title: string; markdown: string } {
  const rel = `legal/${name}.md`;
  const raw = readText(rel).replace(/^\uFEFF/, '');
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  const title = m?.[1].match(/^title:\s*(.+)$/m)?.[1].trim();
  if (!m || !title) throw new ContentError(`${shown(rel)}: start the file with a "title:" block between --- lines (line 1)`, shown(rel), 'title', 1);
  return { title, markdown: m[2].trim() };
}
