import { loadImages, publicFileExists, type Site, type Video } from './content/load';
import { ContentError } from './content/errors';
import { streamIframeUrl, streamThumbnailUrl } from './stream-urls';

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

/** The settings that say where a video plays from. */
type StreamSettings = Pick<Site['settings'], 'videoSource' | 'streamCustomerCode'>;

/** The account's Stream customer code (in every Stream address). */
export function streamCode(settings: Pick<Site['settings'], 'streamCustomerCode'>): string {
  if (!settings.streamCustomerCode) {
    throw new ContentError('content/site.yaml: streamCustomerCode is missing (field settings.streamCustomerCode)', 'content/site.yaml', 'settings.streamCustomerCode');
  }
  return settings.streamCustomerCode;
}

/** Whether a video plays from Cloudflare Stream: its own `host`, else the site's `videoSource`. */
export const playsFromStream = (video: Video, settings: StreamSettings): boolean => (video.host ?? settings.videoSource) === 'stream';

/**
 * Card image: the video's own file in public/media/posters/ (from Cloudflare Images when uploaded) whenever it exists, which `npm run media`
 * makes for every video (from the original under references/, or for the client videos by downloading Stream's frame at posterTime).
 * Without the file, Stream's own thumbnail at posterTime; but when links are signed that thumbnail would need a token, so the missing
 * file is an error instead. Playback comes from Stream unless the video is hosted locally: for a Stream video `play.src` is the plain
 * address, which no page uses (the pop-up asks the server for the link, signed when signing is on).
 */
export function resolveVideo(video: Video, settings: Site['settings']): ResolvedVideo {
  const kind = playsFromStream(video, settings) ? 'stream' : 'file';
  if (kind === 'stream' || !video.source) {
    if (!video.streamUid) {
      throw new ContentError(`content/videos.yaml: "${video.id}" needs a streamUid to play from Cloudflare Stream (field streamUid)`, 'content/videos.yaml', 'streamUid');
    }
  }
  const play: ResolvedVideo['play'] = kind === 'file'
    ? { kind, src: `/media/videos/${video.id}.mp4` }
    : { kind, src: streamIframeUrl(streamCode(settings), video.streamUid!) };
  const posterFile = `media/posters/${video.id}.jpg`;
  if (video.source || publicFileExists(posterFile)) return { poster: imageUrl(posterFile), play };
  if (settings.streamSignedUrls) {
    throw new ContentError(`content/videos.yaml: no card image for "${video.id}" (public/${posterFile}), and with signed video links Stream's own thumbnail can't take its place; run npm run media (field videos)`, 'content/videos.yaml', 'videos');
  }
  return { poster: streamThumbnailUrl(streamCode(settings), video.streamUid!, video.posterTime), play };
}

/** What a card hands the pop-up (its `data-lightbox`): a Stream video by its id, which the pop-up swaps for a link from the server; a local video by its file. */
export function lightboxJson(video: Video, play: ResolvedVideo['play']): string {
  const { orientation, title } = video;
  return JSON.stringify(play.kind === 'stream' ? { kind: 'stream', videoId: video.id, orientation, title } : { kind: 'file', src: play.src, orientation, title });
}

/** The short silent hero loop is always a file served by the site (Hostinger), never Stream. */
export function heroLoopSrc(): string {
  return '/media/clips/hero-loop.mp4';
}
