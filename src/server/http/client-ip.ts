import { isIP } from 'node:net';

/** What the leads table can hold (client_ip is VARCHAR(64)). */
const MAX_LENGTH = 64;
const validIp = (value: string | undefined | null): string | undefined => {
  const ip = value?.trim();
  return ip && ip.length <= MAX_LENGTH && isIP(ip) !== 0 ? ip : undefined;
};

/**
 * The visitor's address: Cloudflare's `CF-Connecting-IP` header when it holds a real IPv4 or IPv6 address,
 * else the address of the socket (`fallback`) under the same check, else nothing.
 * Anything else a header could carry (a list, text, a very long value) is never stored or used as a rate-limit key.
 */
export function clientIp(request: Request, fallback?: string): string | undefined {
  return validIp(request.headers.get('cf-connecting-ip')) ?? validIp(fallback);
}
