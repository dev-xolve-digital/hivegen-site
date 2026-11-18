import type { Site, Video } from './content/load';
import { ContentError } from './content/errors';

export interface ResolvedVideo { poster: string; play: { kind: 'file' | 'stream'; src: string } }

/** Posters are always served by the site; playback comes from Stream unless the video is hosted locally. */
export function resolveVideo(video: Video, settings: Site['settings']): ResolvedVideo {
  const poster = `/media/posters/${video.id}.jpg`;
  const host = video.host ?? settings.videoSource;
  if (host === 'local') return { poster, play: { kind: 'file', src: `/media/videos/${video.id}.mp4` } };
  if (!video.streamUid) {
    throw new ContentError(`content/videos.yaml: "${video.id}" needs a streamUid to play from Cloudflare Stream (field streamUid)`, 'content/videos.yaml', 'streamUid');
  }
  if (!settings.streamCustomerCode) {
    throw new ContentError('content/site.yaml: streamCustomerCode is missing (field settings.streamCustomerCode)', 'content/site.yaml', 'settings.streamCustomerCode');
  }
  const src = `https://customer-${settings.streamCustomerCode}.cloudflarestream.com/${video.streamUid}/iframe?autoplay=true&primaryColor=%231C45F5`;
  return { poster, play: { kind: 'stream', src } };
}

/** The short silent hero loop is always a file served by the site (Hostinger), never Stream. */
export function heroLoopSrc(): string {
  return '/media/clips/hero-loop.mp4';
}
