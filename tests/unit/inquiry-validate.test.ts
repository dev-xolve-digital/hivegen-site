import { describe, it, expect } from 'vitest';
import { inquiryInputSchema, parseInput } from '../../src/server/booking/validate';

const schema = inquiryInputSchema(['1–5', '6–15', '16–30', '30+'], ['Listing videos', 'Reels for social', '3D & AI hooks', 'Not sure yet']);
const minimal = { email: 'a@b.co', pageVersion: 'main', turnstileToken: 't', requestId: '3f1c2b9a-0d4e-4f6a-9b1c-2d3e4f5a6b7c' };

/** The minimal valid input with `over` laid on top (a key set to undefined is left out). */
const parse = (over: Record<string, unknown> = {}) => parseInput(schema, { ...minimal, ...over });
const fieldsOf = (over: Record<string, unknown> = {}) => {
  const r = parse(over);
  if (r.ok) throw new Error(`expected a refusal, got ${JSON.stringify(r.value)}`);
  return r.fields;
};
const valueOf = (over: Record<string, unknown> = {}) => {
  const r = parse(over);
  if (!r.ok) throw new Error(`expected it to pass, got ${JSON.stringify(r.fields)}`);
  return r.value;
};

describe('inquiryInputSchema', () => {
  it('only the email is required', () => {
    const v = valueOf();
    expect(v).toMatchObject({ email: 'a@b.co', pageVersion: 'main', turnstileToken: 't', requestId: minimal.requestId });
    for (const key of ['name', 'phone', 'buyerType', 'volume', 'footageUrl', 'message', 'needs', 'leadId'] as const) expect(v[key]).toBeUndefined();
    expect(v.attribution).toEqual({});
  });

  it('a missing or bad email is named', () => {
    expect(parseInput(schema, {})).toMatchObject({ ok: false, fields: { email: 'required' } });
    expect(fieldsOf({ email: undefined }).email).toBe('required');
    expect(fieldsOf({ email: 'nope' }).email).toBe('invalid');
    expect(fieldsOf({ email: `${'a'.repeat(250)}@example.com` }).email).toBe('too_long');
  });

  it('blank optional fields count as not given', () => {
    const v = valueOf({ name: '  ', phone: '', buyerType: '', volume: ' ', footageUrl: '', message: '\n', needs: undefined, leadId: '' });
    for (const key of ['name', 'phone', 'buyerType', 'volume', 'footageUrl', 'message', 'leadId'] as const) expect(v[key]).toBeUndefined();
  });

  it('optional fields keep the booking form\'s rules', () => {
    expect(fieldsOf({ phone: 'abc' }).phone).toBe('invalid');
    expect(fieldsOf({ footageUrl: 'ftp://x' }).footageUrl).toBe('invalid');
    expect(fieldsOf({ name: 'Zo\në' }).name).toBe('invalid');
    expect(fieldsOf({ name: 'n'.repeat(101) }).name).toBe('too_long');
    expect(fieldsOf({ volume: '50' }).volume).toBe('invalid');
    expect(fieldsOf({ buyerType: 'robot' }).buyerType).toBe('invalid');
    // And when they are fine, they come through (the name and the footage link trimmed).
    expect(valueOf({ name: ' Zoë ', phone: '+1 (555) 010-2000', footageUrl: ' https://drive.google.com/x ', volume: '6–15', buyerType: 'agent' }))
      .toMatchObject({ name: 'Zoë', phone: '+1 (555) 010-2000', footageUrl: 'https://drive.google.com/x', volume: '6–15', buyerType: 'agent' });
  });

  it('needs: known options only, no repeats', () => {
    expect(valueOf({ needs: ['Listing videos', 'Not sure yet'] }).needs).toEqual(['Listing videos', 'Not sure yet']);
    expect(fieldsOf({ needs: ['Other'] }).needs).toBe('invalid');
    expect(fieldsOf({ needs: ['Listing videos', 'Listing videos'] }).needs).toBe('invalid');
    expect(fieldsOf({ needs: 'Listing videos' }).needs).toBe('invalid');
    expect(fieldsOf({ needs: [1] }).needs).toBe('invalid');
    expect(fieldsOf({ needs: null }).needs).toBe('invalid');
  });

  it('the message keeps line breaks and refuses other control characters and over 2000 characters', () => {
    expect(valueOf({ message: 'Hi\nthere\r\n\tok' }).message).toBe('Hi\nthere\r\n\tok');
    expect(fieldsOf({ message: 'a\u0007b' }).message).toBe('invalid');
    expect(fieldsOf({ message: 'a\u007fb' }).message).toBe('invalid');
    expect(valueOf({ message: 'x'.repeat(2000) }).message).toHaveLength(2000);
    expect(fieldsOf({ message: 'x'.repeat(2001) }).message).toBe('too_long');
  });

  it('requestId is required and short', () => {
    expect(fieldsOf({ requestId: undefined }).requestId).toBe('required');
    expect(fieldsOf({ requestId: '' }).requestId).toBe('required');
    expect(fieldsOf({ requestId: 'x' }).requestId).toBe('invalid');
    expect(fieldsOf({ requestId: 'a'.repeat(65) }).requestId).toBe('invalid');
    expect(fieldsOf({ requestId: 'has a space!' }).requestId).toBe('invalid');
    expect(valueOf({ requestId: 'a'.repeat(64) }).requestId).toHaveLength(64);
  });

  it('leadId, when given, is a 22-character public id', () => {
    expect(valueOf({ leadId: 'L'.repeat(22) }).leadId).toBe('L'.repeat(22));
    expect(fieldsOf({ leadId: 'short' }).leadId).toBe('invalid');
  });

  it('the page version, bot-check token, tracking fields and attribution follow the booking form', () => {
    expect(fieldsOf({ pageVersion: undefined, turnstileToken: undefined })).toEqual({ pageVersion: 'required', turnstileToken: 'required' });
    expect(fieldsOf({ pageVersion: 'other-page', turnstileToken: 't'.repeat(2049), fbp: 'x'.repeat(201), fbc: 'x'.repeat(201), attribution: { utm_campaign: 'c'.repeat(201) } }))
      .toEqual({ pageVersion: 'invalid', turnstileToken: 'too_long', fbp: 'too_long', fbc: 'too_long', attribution: 'too_long' });
    expect(valueOf({ attribution: { utm_source: 'facebook', fbclid: 'abc', unknown: 'dropped' }, website: '' }))
      .toMatchObject({ attribution: { utm_source: 'facebook', fbclid: 'abc' }, website: '' });
  });

  it('a body that is not an object names every required field', () => {
    expect(parseInput(schema, null)).toEqual({ ok: false, fields: { email: 'required', pageVersion: 'required', turnstileToken: 'required', requestId: 'required' } });
  });
});
