import { ContentError } from '../../lib/content/errors';
import { emailFile, loadEmail, loadEmailSite } from '../../lib/content/load';
import { splitPlaceholders } from '../../lib/content/placeholders';
import { siteBase } from '../booking/links';
import type { EmailKind } from '../booking/types';

// The site's colours (see src/styles/tokens.css), written out because an email cannot use CSS variables.
const PAGE = '#FFF9EB';
const INK = '#0E1233';
const BLUE = '#1C45F5';
const FONT = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
/** The logo's shown size: its 329 x 160 picture at the height the site's navigation uses, doubled for sharp screens. */
const LOGO_WIDTH = 82;
const LOGO_HEIGHT = 40;

/** How one kind of text treats the wording around the {placeholders} and the values put into them. */
interface Format { text(wording: string): string; value(name: string, value: string): string }

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);

/** Values that are links to open, so the HTML makes them clickable. A name or any other value is never turned into a link. */
const LINK_VALUES = new Set(['meetUrl', 'manageUrl', 'footageUrl']);
const isWebLink = (v: string) => /^https?:\/\/\S+$/i.test(v);
const asLink = (url: string) => `<a href="${escapeHtml(url)}" style="color:${BLUE};text-decoration:underline;word-break:break-all;">${escapeHtml(url)}</a>`;

const plainText: Format = { text: (w) => w, value: (_, v) => v };
/** A subject is one line: line breaks in a value (which could add a header) become spaces. */
const subjectLine: Format = { text: (w) => w, value: (_, v) => v.replace(/[\r\n]+/g, ' ') };
const html: Format = { text: escapeHtml, value: (name, v) => (LINK_VALUES.has(name) && isWebLink(v) ? asLink(v) : escapeHtml(v)) };

/** The wording with each {placeholder} replaced, in one pass so a value is never read as a placeholder. A missing value is a content error. */
function fill(wording: string, vars: Record<string, string>, format: Format, file: string, field: string): string {
  return splitPlaceholders(wording).map((piece) => {
    if ('text' in piece) return format.text(piece.text);
    const value = Object.hasOwn(vars, piece.placeholder) ? vars[piece.placeholder] : undefined;
    if (!value) throw new ContentError(`${file}: {${piece.placeholder}} has no value in this email (field ${field})`, file, field);
    return format.value(piece.placeholder, value);
  }).join('');
}

/** The body's paragraphs: its blocks of lines, apart by one or more blank lines. */
const paragraphs = (body: string) => body.split(/\n\s*\n/).filter((p) => p.trim() !== '');

const textStyle = `margin:0 0 16px;font-family:${FONT};font-size:16px;line-height:1.6;color:${INK};`;

function page(title: string, logoUrl: string, brandName: string, paragraphsHtml: string[], button?: { label: string; url: string }): string {
  const cells = paragraphsHtml.map((p) => `<p style="${textStyle}">${p.replace(/\r?\n/g, '<br>')}</p>`).join('\n');
  const buttonHtml = button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 16px;"><tr><td style="background:${BLUE};border-radius:999px;">`
      + `<a href="${escapeHtml(button.url)}" style="display:inline-block;padding:14px 28px;font-family:${FONT};font-size:16px;font-weight:600;color:${PAGE};text-decoration:none;">${escapeHtml(button.label)}</a>`
      + '</td></tr></table>'
    : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background:${PAGE};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAGE};">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;">
<tr><td style="padding:0 0 24px;"><img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(brandName)}" width="${LOGO_WIDTH}" height="${LOGO_HEIGHT}" style="display:block;border:0;width:${LOGO_WIDTH}px;height:${LOGO_HEIGHT}px;"></td></tr>
<tr><td>
${cells}
${buttonHtml}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>
`;
}

/**
 * One email, ready to send: its subject, a branded HTML version and a plain-text version, made from the wording in
 * content/emails/<kind>.yaml. `vars` holds the value for each {placeholder}; a placeholder with no value is a ContentError
 * naming the file. A button that goes to the Meet link is left out when there is none.
 */
export function renderEmail(kind: EmailKind, vars: Record<string, string>, siteUrl: string): { subject: string; html: string; text: string } {
  const email = loadEmail(kind);
  const site = loadEmailSite();
  const file = emailFile(kind);

  const subject = fill(email.subject, vars, subjectLine, file, 'subject').trim();

  let button: { label: string; url: string } | undefined;
  if (email.button) {
    const label = fill(email.button.label, vars, plainText, file, 'button.label');
    const key = email.button.link === 'meet' ? 'meetUrl' : 'manageUrl';
    const url = vars[key];
    if (url) button = { label, url };
    else if (email.button.link === 'manage') throw new ContentError(`${file}: the button goes to {${key}}, which has no value in this email (field button.link)`, file, 'button.link');
  }

  const text = paragraphs(email.body).map((p) => fill(p, vars, plainText, file, 'body')).join('\n\n')
    + (button ? `\n\n${button.label}: ${button.url}` : '');
  const htmlParagraphs = paragraphs(email.body).map((p) => fill(p, vars, html, file, 'body'));

  return { subject, html: page(subject, `${siteBase(siteUrl)}${site.logo}`, site.brandName, htmlParagraphs, button), text };
}
