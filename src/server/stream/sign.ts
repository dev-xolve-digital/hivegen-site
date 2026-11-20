// Cloudflare Stream's signed links: a token (an RS256 JWT) goes in the address in place of the video's ID.
// It is signed here with the signing key from the environment, so no call to Cloudflare is made per view.
// Plain Node and nothing else, so `npm run media` (a Node script) signs its thumbnail downloads the same way.
import { createPrivateKey, sign, type KeyObject } from 'node:crypto';

/** Stream lets a token start a minute before it was made, so a clock a little behind Cloudflare's still works. */
const NOT_BEFORE_LEEWAY_SECONDS = 60;
const DEFAULT_TTL_SECONDS = 3600;

const base64url = (data: string | Uint8Array) => Buffer.from(data).toString('base64url'); // no padding

/** The signing key. A key that cannot be read is an error that says so and never quotes the key (a parser's own message may). */
function privateKeyOf(jwkBase64: string): KeyObject {
  try {
    return createPrivateKey({ key: JSON.parse(Buffer.from(jwkBase64, 'base64').toString('utf8')), format: 'jwk' });
  } catch {
    throw new Error('the Stream signing key is not a private key in JWK form (base64)');
  }
}

/**
 * A token that lets one video be played (or its thumbnail fetched) for `ttlSeconds` (an hour unless told otherwise).
 * `jwkBase64` is the signing key as Stream hands it out: the private key as a JWK, in base64. Throws when it is not one.
 */
export function signStreamToken(o: { uid: string; keyId: string; jwkBase64: string; now: Date; ttlSeconds?: number }): string {
  const issued = Math.floor(o.now.getTime() / 1000);
  const header = { alg: 'RS256', kid: o.keyId };
  const claims = { sub: o.uid, kid: o.keyId, exp: issued + (o.ttlSeconds ?? DEFAULT_TTL_SECONDS), nbf: issued - NOT_BEFORE_LEEWAY_SECONDS };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const key = privateKeyOf(o.jwkBase64);
  return `${unsigned}.${base64url(sign('RSA-SHA256', Buffer.from(unsigned), key))}`;
}
