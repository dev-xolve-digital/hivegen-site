import { createHash } from 'node:crypto';

/** What Meta wants before hashing an email: no spaces around it, all lower case. */
export const normalizeEmail = (s: string): string => s.trim().toLowerCase();

/** What Meta wants before hashing a phone number: digits only, with the country code. A US number of ten digits gets the 1. */
export function normalizePhone(s: string): string {
  const digits = s.replace(/\D/g, '');
  return digits.length === 10 ? `1${digits}` : digits;
}

/** The SHA-256 of `s`, as lower-case hex. */
export const sha256Hex = (s: string): string => createHash('sha256').update(s).digest('hex');
