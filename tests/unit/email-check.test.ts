import { afterEach, describe, expect, it } from 'vitest';
import { ContentError } from '../../src/lib/content/errors';
import { loadEmail } from '../../src/lib/content/load';
import { assertEmailTemplatesRender } from '../../src/server/mail/check';
import { removeTempContent, tempContent } from '../helpers/temp-content';

afterEach(() => {
  delete process.env.CONTENT_DIR;
  removeTempContent();
});

/** Adds a line to the start of the body of the named email files in a temp copy of the content, and points the loader at it. */
function withBodyLine(lines: Record<string, string>) {
  process.env.CONTENT_DIR = tempContent(Object.fromEntries(Object.entries(lines).map(([kind, line]) => [
    `emails/${kind}.yaml`, (text: string) => text.replace(/^body: \|\r?\n/m, (head) => `${head}  ${line}\n`),
  ])));
}

describe('assertEmailTemplatesRender', () => {
  it('passes for the real email files', async () => {
    await expect(assertEmailTemplatesRender()).resolves.toBeUndefined();
  });

  it('a placeholder the email may use but has no value for stops it, naming the file', async () => {
    // {previousWhen} is allowed in every visitor email, but only a rescheduled booking has a previous time.
    withBodyLine({ 'booking-confirmed': 'Moved from {previousWhen}.' });
    const error = await assertEmailTemplatesRender().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ContentError);
    expect((error as ContentError).message).toContain('emails/booking-confirmed.yaml');
    expect((error as ContentError).message).toContain('{previousWhen}');
    expect((error as ContentError).file).toContain('booking-confirmed.yaml');
  });

  it('a Meet link in the wording of an email that is sent before Google has one stops it', async () => {
    withBodyLine({ 'reminder-1h': 'Join here: {meetUrl}' });
    await expect(assertEmailTemplatesRender()).rejects.toThrow(/emails\/reminder-1h\.yaml.*\{meetUrl\}/);
  });

  it('a Meet link in the wording of the "requested" email stops it (a requested booking has no event)', async () => {
    withBodyLine({ 'booking-requested': 'Join here: {meetUrl}' });
    await expect(assertEmailTemplatesRender()).rejects.toThrow(/emails\/booking-requested\.yaml/);
  });

  it('a previous time in an email that is not about a move stops it, in Hassan\'s emails too', async () => {
    withBodyLine({ 'hassan-new-booking': 'It used to be {previousWhen}.' });
    await expect(assertEmailTemplatesRender()).rejects.toThrow(/emails\/hassan-new-booking\.yaml/);
  });

  it('wording that does use what its email has passes: the previous time in the rescheduled email, the change in Hassan\'s changed email', async () => {
    withBodyLine({ 'booking-rescheduled': 'It was {previousWhen}.', 'hassan-booking-changed': 'It was {change}.' });
    await expect(assertEmailTemplatesRender()).resolves.toBeUndefined();
  });

  it('a previous time in Hassan\'s "changed" email stops it: a cancelled booking has none', async () => {
    withBodyLine({ 'hassan-booking-changed': 'It was {previousWhen}.' });
    await expect(assertEmailTemplatesRender()).rejects.toThrow(/emails\/hassan-booking-changed\.yaml.*\{previousWhen\}/);
  });

  it('a placeholder an email may not use at all is still stopped by the loader, naming the file', async () => {
    withBodyLine({ 'reminder-24h': 'Their phone: {phone}' });
    await expect(assertEmailTemplatesRender()).rejects.toThrow(/emails\/reminder-24h\.yaml/);
  });
});

describe('the inquiry emails', () => {
  it('inquiry-received may use no placeholders', () => {
    withBodyLine({ 'inquiry-received': 'Hi {name},' });
    const error = (() => { try { loadEmail('inquiry-received'); } catch (e) { return e; } })();
    expect(error).toBeInstanceOf(ContentError);
    // With nothing it may use, the message says so, not "use only " followed by an empty list.
    expect((error as ContentError).message).toMatch(/emails\/inquiry-received\.yaml: \{name\} can't be used in this email; it takes no \{placeholders\} at all \(field body\)/);
    expect((error as ContentError).file).toMatch(/emails\/inquiry-received\.yaml$/);
  });

  it('the build stops on a placeholder in inquiry-received, even one every other visitor email may use', async () => {
    withBodyLine({ 'inquiry-received': 'Your call is {when}.' });
    await expect(assertEmailTemplatesRender()).rejects.toThrow(/emails\/inquiry-received\.yaml: \{when\} can't be used/);
  });

  it('hassan-new-inquiry may use {needs} and {message}', async () => {
    withBodyLine({ 'hassan-new-inquiry': 'Needs: {needs}. Message: {message}.' });
    expect(() => loadEmail('hassan-new-inquiry')).not.toThrow();
    await expect(assertEmailTemplatesRender()).resolves.toBeUndefined();
  });

  it('no other email may use {needs} or {message}', () => {
    for (const kind of ['hassan-new-lead', 'hassan-new-booking', 'booking-confirmed'] as const) {
      for (const placeholder of ['needs', 'message']) {
        withBodyLine({ [kind]: `Extra {${placeholder}}` });
        expect(() => loadEmail(kind), `${kind} {${placeholder}}`).toThrow(new RegExp(`emails/${kind}\\.yaml: \\{${placeholder}\\} can't be used`));
      }
    }
  });

  it('assertEmailTemplatesRender still passes with the two new kinds in CASES, and checks them', async () => {
    await expect(assertEmailTemplatesRender()).resolves.toBeUndefined();
    // An inquiry has no call time: wording that needs one is found only if the inquiry emails are really rendered.
    withBodyLine({ 'hassan-new-inquiry': 'Call at {whenPakistan}.' });
    await expect(assertEmailTemplatesRender()).rejects.toThrow(/emails\/hassan-new-inquiry\.yaml: \{whenPakistan\} has no value/);
  });
});
