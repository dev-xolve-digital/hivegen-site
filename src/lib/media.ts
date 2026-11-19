import { loadImages, type Site, type Video } from './content/load';
import { ContentError } from './content/errors';

export interface ResolvedVideo { poster: string; play: { kind: 'file' | 'stream'; src: string } }

/**
 * The address of an image the site shows. Images listed in content/images.yaml come from
 * Cloudflare Images; any other file is served by the site from public/.
 */
export function imageUrl(sitePath: string): string {
  const key = sitePath.replace(/^\//, '');
  const { deliveryUrl, variant, images } = loadImages();
  const id = images[key];
  return id ? `${deliveryUrl}/${id}/${variant}` : `/${key}`;
}

function streamCode(settings: Site['settings']): string {
  if (!settings.streamCustomerCode) {
    throw new ContentError('content/site.yaml: streamCustomerCode is missing (field settings.streamCustomerCode)', 'content/site.yaml', 'settings.streamCustomerCode');
  }
  return settings.streamCustomerCode;
}

/**
 * Card image: the prepared poster when the video has an original under references/ (from Cloudflare
 * Images when uploaded), otherwise Stream's own thumbnail at posterTime. Playback comes from Stream
 * unless the video is hosted locally.
 */
export function resolveVideo(video: Video, settings: Site['settings']): ResolvedVideo {
  const host = video.host ?? settings.videoSource;
  const play: ResolvedVideo['play'] = host === 'local'
    ? { kind: 'file', src: `/media/videos/${video.id}.mp4` }
    : { kind: 'stream', src: '' };
  if (play.kind === 'stream' || !video.source) {
    if (!video.streamUid) {
      throw new ContentError(`content/videos.yaml: "${video.id}" needs a streamUid to play from Cloudflare Stream (field streamUid)`, 'content/videos.yaml', 'streamUid');
    }
  }
  const base = video.streamUid ? `https://customer-${streamCode(settings)}.cloudflarestream.com/${video.streamUid}` : '';
  if (play.kind === 'stream') play.src = `${base}/iframe?autoplay=true&primaryColor=%231C45F5`;
  const poster = video.source
    ? imageUrl(`media/posters/${video.id}.jpg`)
    : `${base}/thumbnails/thumbnail.jpg?time=${video.posterTime}s&height=640`;
  return { poster, play };
}

/** The short silent hero loop is always a file served by the site (Hostinger), never Stream. */
export function heroLoopSrc(): string {
  return '/media/clips/hero-loop.mp4';
}
