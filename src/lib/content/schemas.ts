import { z } from 'zod';

const text = z.string().trim().min(1, 'must not be empty');
const link = z.strictObject({ label: text, href: text });
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'use 24-hour time in quotes, e.g. "19:00"');
const isTimeZone = (tz: string) => {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
};

export const dayEnum = z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
export const bookingSchema = z.strictObject({
  timeZone: z.string().refine(isTimeZone, 'is not a known time zone (e.g. Asia/Karachi)'),
  days: z.array(dayEnum).min(1),
  windowStart: hhmm,
  windowEnd: hhmm,
  slotMinutes: z.number().int().positive(),
  bufferMinutes: z.number().int().min(0),
  minNoticeMinutes: z.number().int().min(0),
  horizonDays: z.number().int().positive(),
});

export const siteSchema = z.strictObject({
  brand: z.strictObject({ name: text, logo: text }),
  contact: z.strictObject({ notificationEmail: z.email(), instagramHandle: text, instagramUrl: z.url() }),
  booking: bookingSchema,
  settings: z.strictObject({
    videoSource: z.enum(['local', 'stream']),
    streamCustomerCode: text.optional(),
    streamSignedUrls: z.boolean().default(false),
    turnstileSiteKey: z.string().trim().optional(),
    live3dOnMobile: z.boolean(),
    showBeforeAfter: z.boolean(),
    heroLoop: z.strictObject({ videoId: text, start: z.number().min(0), duration: z.number().positive() }),
  }).refine((s) => s.videoSource !== 'stream' || !!s.streamCustomerCode, {
    message: 'is needed when videoSource is stream', path: ['streamCustomerCode'],
  }),
});

export const pageSchema = z.strictObject({
  slug: z.enum(['', 'agencies', 'videographers', 'agents']),
  seo: z.strictObject({ title: text, description: text, noindex: z.boolean() }),
  hero: z.strictObject({
    eyebrow: text,
    headline: z.array(text).length(3, 'needs exactly 3 lines'),
    highlight: text,
    subline: text,
    chips: z.array(text).length(3, 'needs exactly 3 chips'),
  }).refine((h) => h.headline[2].includes(h.highlight), { message: 'must be words from the last headline line', path: ['highlight'] }),
  whyUs: text.optional(),
  preselectBuyer: z.enum(['agency', 'videographer', 'agent']).optional(),
  videoOrder: z.strictObject({ vertical: z.array(text), horizontal: z.array(text) }),
  pricingOrder: z.enum(['plans-first', 'single-first']),
  showWhoItsFor: z.boolean(),
});

export const videoSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]+$/, 'use lowercase letters, numbers and dashes'),
  title: text,
  label: text,
  duration: z.string().regex(/^\d+:\d{2}$/, 'use m:ss in quotes, e.g. "1:05"'),
  orientation: z.enum(['vertical', 'horizontal']),
  source: text.optional(),
  posterTime: z.number().min(0),
  streamUid: z.string().regex(/^[a-f0-9]{32}$/, 'is a 32-character Stream video ID').optional(),
  host: z.enum(['stream', 'local']).optional(),
  sample: z.boolean().optional(),
});
export const imagesSchema = z.strictObject({
  deliveryUrl: z.url().refine((u) => !u.endsWith('/'), 'leave off the final /'),
  variant: text,
  images: z.record(
    z.string().regex(/^media\/\S+\.(jpe?g|png|webp|avif)$/, 'use a path inside public/, e.g. media/posters/v-x.jpg'),
    z.string().regex(/^[A-Za-z0-9-]+$/, 'is a Cloudflare image ID'),
  ),
});
export const videosFileSchema = z.strictObject({ videos: z.array(videoSchema).min(1) });

const clip = z.strictObject({ source: text, start: z.number().min(0), duration: z.number().positive() });
export const sectionSchemas = {
  nav: z.strictObject({ links: z.array(link), cta: link }),
  hero: z.strictObject({
    primaryCta: link, instagramCta: z.strictObject({ label: text }), videoLabel: text, videoDuration: text,
    videoAriaLabel: text, floatTitle: text, floatText: text, closeVideoLabel: text,
  }),
  'recent-edits': z.strictObject({ heading: text, subline: text, verticalLabel: text, horizontalLabel: text, prevLabel: text, nextLabel: text }),
  'who-its-for': z.strictObject({
    heading: text,
    cards: z.array(z.strictObject({ title: text, text: text, linkLabel: text, href: text, icon: z.enum(['building', 'camera', 'person']) })),
  }),
  'how-it-works': z.strictObject({ heading: text, steps: z.array(z.strictObject({ number: text, title: text, text: text })) }),
  'before-after': z.strictObject({
    mode: z.enum(['reveal', 'slider']),
    heading: text,
    subline: text,
    labels: z.strictObject({ before: text, after: text }),
    ariaLabel: text,
    reveal: z.strictObject({ source: text, start: z.number().min(0), duration: z.number().positive(), slowdown: z.number().positive(), cutAt: z.number().min(0) }).optional(),
    slider: z.strictObject({ before: clip, after: clip, boomerang: z.boolean().optional(), fullVideoId: text.optional(), fullVideoLabel: text.optional() }).optional(),
    sample: z.boolean(),
    note: text.optional(),
  }).superRefine((s, ctx) => {
    if (s.mode === 'reveal' ? !s.reveal : !s.slider) {
      ctx.addIssue({ code: 'custom', message: `is needed when mode is ${s.mode}`, path: [s.mode] });
    }
  }),
  plans: z.strictObject({
    heading: text,
    subline: text,
    planCtaLabel: text,
    priceSuffix: text,
    termsLine: text,
    plans: z.array(z.strictObject({
      name: text, badge: text.optional(), price: z.number().positive(), minimumPerMonth: z.number().int().positive(),
      revisions: z.number().int().min(0), includesPrevious: text.optional(), features: z.array(text), featured: z.boolean().optional(),
    })).min(1),
    single: z.strictObject({ lead: text, text: text, priceFrom: z.number().positive(), note: text, ctaLabel: text }),
    freeNote: text,
  }),
  booking: z.strictObject({
    heading: text,
    subline: text,
    bullets: z.array(text),
    instagramLine: text,
    steps: z.strictObject({ details: text, time: text }),
    fields: z.strictObject({ name: text, email: text, phone: text, buyer: text, volume: text, footage: text, footageHint: text }),
    buyerOptions: z.array(z.strictObject({ value: z.enum(['agency', 'videographer', 'agent', 'other']), label: text })),
    volumeOptions: z.array(text).min(1),
    nextLabel: text,
    backLabel: text,
    confirmLabel: text,
    consentLine: text,
    timeHeading: text,
    timeNote: text,
    noSlots: text,
    confirmation: z.strictObject({ heading: text, text: text, nextStepsHeading: text, nextSteps: z.array(text), addToCalendar: text, calendarTitle: text, instagramLabel: text }),
    errors: z.strictObject({ name: text, email: text, slotTaken: text, unreachable: text }),
    calendarEvent: z.strictObject({ title: text, description: text }),
    demoNote: text,
  }),
  faq: z.strictObject({ heading: text, items: z.array(z.strictObject({ q: text, a: text })) }),
  'final-cta': z.strictObject({ headingLines: z.array(text).min(1), highlight: text, subline: text, ctaLabel: text, instagramLabel: text }),
  footer: z.strictObject({ copyright: text, tagline: text, links: z.array(link) }),
  'not-found': z.strictObject({ title: text, heading: text, text: text }),
};

export const testimonialsSchema = z.strictObject({
  heading: text,
  subline: text,
  watchLabel: text,
  videos: z.array(z.strictObject({ videoId: text, role: text })),
  inbox: z.strictObject({ heading: text, subline: text, note: text.optional() }),
  screenshots: z.array(z.strictObject({ file: text, alt: text, row: z.enum(['front', 'back']), sample: z.boolean() })),
});

export type Site = z.infer<typeof siteSchema>;
export type BookingRules = z.infer<typeof bookingSchema>;
export type Page = z.infer<typeof pageSchema>;
export type Video = z.infer<typeof videoSchema>;
export type Testimonials = z.infer<typeof testimonialsSchema>;
export type Images = z.infer<typeof imagesSchema>;
export type Sections = { [K in keyof typeof sectionSchemas]: z.infer<(typeof sectionSchemas)[K]> };
