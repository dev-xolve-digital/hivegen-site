import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createTransport } from 'nodemailer';
import type { ServerConfig } from '../config';

export interface MailMessage { to: string; subject: string; html: string; text: string; replyTo?: string; tag?: string }
/** Sends one email. It throws when the email did not go out, so the caller can try again later. */
export interface Mailer { send(m: MailMessage): Promise<void> }

type SmtpSettings = NonNullable<ServerConfig['smtp']>;
/** The part of a nodemailer transport the mailer uses, so a test can stand in for it. */
interface Transport { sendMail(message: { from: string; to: string; subject: string; html: string; text: string; replyTo?: string; headers?: Record<string, string> }): Promise<unknown> }

/** Port 465 starts with TLS; the other ports (587) upgrade to it. A server that stops answering fails the send instead of holding the booking for minutes. */
export function smtpTransportOptions(smtp: SmtpSettings) {
  return {
    host: smtp.host, port: smtp.port, secure: smtp.port === 465, auth: { user: smtp.user, pass: smtp.pass },
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000,
  };
}

/** Sends through an SMTP mailbox. The kind of email travels in the `X-HiveGen-Kind` header. `transport` is for tests. */
export function createSmtpMailer(smtp: SmtpSettings, transport: Transport = createTransport(smtpTransportOptions(smtp))): Mailer {
  return {
    async send(m) {
      await transport.sendMail({
        from: smtp.from, to: m.to, subject: m.subject, html: m.html, text: m.text,
        ...(m.replyTo && { replyTo: m.replyTo }),
        ...(m.tag && { headers: { 'X-HiveGen-Kind': m.tag } }),
      });
    },
  };
}

/** A tag becomes part of a file name, so only letters, digits and dashes stay. */
const fileSafe = (tag: string) => tag.replace(/[^A-Za-z0-9-]/g, '-').slice(0, 60);

/**
 * For development and tests: writes each email to `dir` as `<time>-<kind>.html` plus `.txt` instead of sending it,
 * and keeps a record of what was "sent". The folder is made when it is missing.
 */
export function createOutboxMailer(dir = '.outbox'): Mailer & { sent: Array<{ to: string; subject: string; text: string; tag?: string }> } {
  const sent: Array<{ to: string; subject: string; text: string; tag?: string }> = [];
  return {
    sent,
    async send(m) {
      await mkdir(dir, { recursive: true });
      // A colon is not allowed in a Windows file name, so the time uses dashes.
      const base = `${new Date().toISOString().replace(/:/g, '-')}-${fileSafe(m.tag ?? 'email')}`;
      // Two emails of one kind in the same millisecond must not overwrite each other: the first to create the .html owns the name.
      for (let n = 1; ; n += 1) {
        const name = n === 1 ? base : `${base}-${n}`;
        try {
          await writeFile(path.join(dir, `${name}.html`), m.html, { flag: 'wx' });
          await writeFile(path.join(dir, `${name}.txt`), m.text);
          break;
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
        }
      }
      sent.push({ to: m.to, subject: m.subject, text: m.text, ...(m.tag && { tag: m.tag }) });
    },
  };
}
