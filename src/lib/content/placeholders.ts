/** The {placeholders} in email wording: which ones each email may use, and how a piece of wording is cut around them. */

/** What every email can use: the visitor's values. */
const VISITOR_PLACEHOLDERS = ['name', 'when', 'timezone', 'meetUrl', 'manageUrl', 'previousWhen'] as const;
/** Emails to Hassan add the lead's details, the time in Pakistan and what changed. */
const HASSAN_PLACEHOLDERS = [...VISITOR_PLACEHOLDERS, 'email', 'phone', 'buyerType', 'volume', 'footageUrl', 'pageVersion', 'source', 'whenPakistan', 'change'] as const;

/** Hassan's email about a "Send details" form adds what the visitor needs and their message. */
const HASSAN_INQUIRY_PLACEHOLDERS = [...HASSAN_PLACEHOLDERS, 'needs', 'message'] as const;

/**
 * The placeholders an email file may use. Emails to Hassan have `hassan-` in front of their name.
 * The visitor's confirmation of a "Send details" form may use none, so it can never repeat what they typed.
 */
export function allowedPlaceholders(kind: string): readonly string[] {
  if (kind === 'inquiry-received') return [];
  if (kind === 'hassan-new-inquiry') return HASSAN_INQUIRY_PLACEHOLDERS;
  return kind.startsWith('hassan-') ? HASSAN_PLACEHOLDERS : VISITOR_PLACEHOLDERS;
}

export type Piece = { text: string } | { placeholder: string };

/** Cuts wording into plain text and {placeholders}, in order. Nothing inside a value is ever looked at again, so a value can hold braces. */
export function splitPlaceholders(wording: string): Piece[] {
  const pieces: Piece[] = [];
  let from = 0;
  for (const m of wording.matchAll(/\{([^{}]*)\}/g)) {
    if (m.index > from) pieces.push({ text: wording.slice(from, m.index) });
    pieces.push({ placeholder: m[1] });
    from = m.index + m[0].length;
  }
  if (from < wording.length) pieces.push({ text: wording.slice(from) });
  return pieces;
}
