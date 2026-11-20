// The addresses of Cloudflare Stream's player and thumbnails. Kept free of imports so the pages, the video route and `npm run media`
// (a plain Node script) all build them the same way. `idOrToken` is the video's ID, or a signed token in its place (see server/stream/sign.ts).

const streamHost = (customerCode: string) => `https://customer-${customerCode}.cloudflarestream.com`;

/** The player the pop-up shows, started at once and in the site's blue. */
export const streamIframeUrl = (customerCode: string, idOrToken: string): string =>
  `${streamHost(customerCode)}/${idOrToken}/iframe?autoplay=true&primaryColor=%231C45F5`;

/** Stream's own frame of the video at `posterTime` seconds, 640 pixels tall. */
export const streamThumbnailUrl = (customerCode: string, idOrToken: string, posterTime: number): string =>
  `${streamHost(customerCode)}/${idOrToken}/thumbnails/thumbnail.jpg?time=${posterTime}s&height=640`;
