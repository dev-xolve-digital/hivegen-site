// Prepares the media the site serves itself, from the originals in references/.
//   posters  public/media/posters/<id>.jpg  for every video in content/videos.yaml that has a source;
//            for the videos without one (the client videos) it is Stream's frame at posterTime, downloaded
//   videos   public/media/videos/<id>.mp4   only for videos that play locally (host: local)
//   clips    public/media/clips/hero-loop.mp4 and the section 05 clips (never Cloudflare Stream)
// Usage: npm run media            (skips anything already up to date, and card images already downloaded)
//        npm run media -- --force (rebuilds and downloads everything again; use it after changing a posterTime)
// With STREAM_SIGNING_KEY_ID and STREAM_SIGNING_KEY_JWK in .env the downloads are signed, so they also work once the videos
// need signed links. Without them the plain address is used, which works while the videos are public.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { load } from 'js-yaml';
// Plain Node loads these TypeScript files as they are: they use nothing but erasable types.
import { readServerConfig } from '../src/server/config.ts';
import { loadDotEnv } from '../src/server/env.ts';
import { signStreamToken } from '../src/server/stream/sign.ts';
import { streamThumbnailUrl } from '../src/lib/stream-urls.ts';

const ROOT = process.cwd();
const REFS = path.join(ROOT, 'references');
const OUT = path.join(ROOT, 'public', 'media');
const force = process.argv.includes('--force');

function fail(message) {
  console.error(`\nprepare-media: ${message}\n`);
  process.exit(1);
}

function readYaml(rel) {
  const file = path.join(ROOT, 'content', rel);
  try {
    return { data: load(fs.readFileSync(file, 'utf8')), mtime: fs.statSync(file).mtimeMs };
  } catch (e) {
    fail(`could not read content/${rel}: ${e.message.split('\n')[0]}`);
  }
}

if (spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status !== 0) {
  fail('ffmpeg was not found. Install ffmpeg and make sure it is on your PATH.');
}

const site = readYaml('site.yaml');
const videos = readYaml('videos.yaml');
const ba = readYaml('sections/before-after.yaml');
const videoSource = site.data.settings.videoSource;

const jobs = [];
const downloads = []; // videos with no original here: their card image is downloaded from Stream
const sourceOf = (rel) => {
  const file = path.join(REFS, rel);
  if (!fs.existsSync(file)) fail(`source video not found: references/${rel}`);
  return file;
};

for (const v of videos.data.videos) {
  if (!v.source) { // no original here: the card image is Stream's frame at posterTime, saved as a file
    if (v.streamUid) downloads.push(v);
    continue;
  }
  const src = sourceOf(v.source);
  const vertical = v.orientation === 'vertical';
  const [w, h] = vertical ? [360, 640] : [640, 360];
  jobs.push({
    kind: 'posters', out: `posters/${v.id}.jpg`, deps: [src], depTimes: [videos.mtime],
    args: ['-ss', String(v.posterTime), '-i', src, '-frames:v', '1',
      '-vf', `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`, '-q:v', '4'],
  });
  if ((v.host ?? videoSource) === 'local') {
    const [vw, vh] = vertical ? [720, 1280] : [1280, 720];
    jobs.push({
      kind: 'videos', out: `videos/${v.id}.mp4`, deps: [src], depTimes: [videos.mtime],
      args: ['-i', src, '-vf', `scale=${vw}:${vh}:force_original_aspect_ratio=decrease,pad=${vw}:${vh}:(ow-iw)/2:(oh-ih)/2`,
        '-c:v', 'libx264', '-crf', '28', '-preset', 'medium', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart'],
    });
  }
}

const SHORT = '540:960';
const clipVideo = ['-an', '-c:v', 'libx264', '-crf', '30', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'];
const posterOf = (clip, at = 0) => ['-ss', String(at), '-i', path.join(OUT, clip), '-frames:v', '1', '-q:v', '8'];
function addClip(name, srcRel, start, duration, filters, depTime, posterAt = 0) {
  const src = sourceOf(srcRel);
  jobs.push({
    kind: 'clips', out: `clips/${name}.mp4`, deps: [src], depTimes: [depTime],
    args: ['-ss', String(start), '-t', String(duration), '-i', src,
      '-vf', `${filters ? filters + ',' : ''}scale=${SHORT}:force_original_aspect_ratio=increase,crop=${SHORT}`, ...clipVideo],
  });
  jobs.push({ kind: 'posters', out: `posters/${name}.jpg`, deps: [path.join(OUT, 'clips', `${name}.mp4`)], depTimes: [depTime], args: posterOf(`clips/${name}.mp4`, posterAt) });
}

const loop = site.data.settings.heroLoop;
const loopVideo = videos.data.videos.find((v) => v.id === loop.videoId);
if (!loopVideo) fail(`content/site.yaml: heroLoop.videoId "${loop.videoId}" is not in videos.yaml`);
addClip('hero-loop', loopVideo.source, loop.start, loop.duration, '', site.mtime);

if (ba.data.mode === 'slider') {
  const s = ba.data.slider;
  if (!s) fail('content/sections/before-after.yaml: mode is slider but there is no slider: block');
  // boomerang: play forward then backward, so the loop has no jump. Both clips get the same treatment.
  const both = s.boomerang ? 'split[f][b];[b]reverse[r];[f][r]concat=n=2:v=1:a=0' : '';
  // The still shown before playback (and to visitors with reduced motion) is the clip's middle frame.
  const mid = Math.min(s.before.duration, s.after.duration) / 2;
  addClip('ba-before', s.before.source, s.before.start, s.before.duration, both, ba.mtime, mid);
  addClip('ba-after', s.after.source, s.after.start, s.after.duration, both, ba.mtime, mid);
} else {
  const r = ba.data.reveal;
  if (!r) fail('content/sections/before-after.yaml: mode is reveal but there is no reveal: block');
  addClip('ba-reveal', r.source, r.start, r.duration, `setpts=${r.slowdown}*PTS,fps=30`, ba.mtime);
}

const made = { posters: 0, videos: 0, clips: 0 };
let skipped = 0;

/** Saves Stream's frame at each video's posterTime as public/media/posters/<id>.jpg, unless the file is already there. */
async function downloadCardImages(list) {
  if (!list.length) return;
  loadDotEnv();
  const key = readServerConfig(process.env).stream;
  const settings = site.data.settings;
  for (const v of list) {
    const rel = `posters/${v.id}.jpg`;
    const out = path.join(OUT, rel);
    if (!force && fs.existsSync(out)) {
      console.log(`skipped ${rel}`);
      skipped++;
      continue;
    }
    if (!settings.streamCustomerCode) fail('content/site.yaml: settings.streamCustomerCode is needed to download the client card images');
    if (settings.streamSignedUrls && !key) {
      fail(`"${v.id}" needs its card image from Stream, and video links are signed (settings.streamSignedUrls), so STREAM_SIGNING_KEY_ID and STREAM_SIGNING_KEY_JWK must be in .env`);
    }
    // With a key the address carries a token in place of the ID. The address is never printed.
    const idOrToken = key ? signStreamToken({ uid: v.streamUid, ...key, now: new Date() }) : v.streamUid;
    let res;
    try {
      res = await fetch(streamThumbnailUrl(settings.streamCustomerCode, idOrToken, v.posterTime), { signal: AbortSignal.timeout(30_000) });
    } catch (e) {
      fail(`could not reach Cloudflare Stream for the card image of "${v.id}" (${e.cause?.code ?? e.name})`);
    }
    const bytes = res.ok ? Buffer.from(await res.arrayBuffer()) : null;
    if (!bytes || bytes[0] !== 0xff || bytes[1] !== 0xd8) { // a JPEG starts with FF D8
      const why = res.ok ? 'not a JPEG' : `HTTP ${res.status}`;
      fail(`Cloudflare Stream did not give a card image for "${v.id}" (${why}); check its streamUid and posterTime in content/videos.yaml${key ? ', and that the signing key is the right one' : ''}`);
    }
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(`${out}.part`, bytes);
    fs.renameSync(`${out}.part`, out); // never a half-written card image
    console.log(`downloaded ${rel}`);
    made.posters++;
  }
}
for (const job of jobs) {
  const out = path.join(OUT, job.out);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const newest = Math.max(...job.depTimes, ...job.deps.map((d) => (fs.existsSync(d) ? fs.statSync(d).mtimeMs : Infinity)));
  if (!force && fs.existsSync(out) && fs.statSync(out).mtimeMs > newest) {
    console.log(`skipped ${job.out}`);
    skipped++;
    continue;
  }
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...job.args, out], { encoding: 'utf8' });
  if (r.status !== 0) fail(`ffmpeg failed on ${job.out}:\n${r.stderr}`);
  console.log(`made ${job.out}`);
  made[job.kind]++;
}
await downloadCardImages(downloads);
console.log(`\nposters: ${made.posters}, videos: ${made.videos}, clips: ${made.clips}${skipped ? `, skipped: ${skipped}` : ''}`);
