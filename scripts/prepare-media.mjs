// Prepares the media the site serves itself, from the originals in references/.
//   posters  public/media/posters/<id>.jpg  for every video in content/videos.yaml
//   videos   public/media/videos/<id>.mp4   only for videos that play locally (host: local)
//   clips    public/media/clips/hero-loop.mp4 and the section 05 clips (never Cloudflare Stream)
// Usage: npm run media            (skips anything already up to date)
//        npm run media -- --force (rebuilds everything)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { load } from 'js-yaml';

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
const sourceOf = (rel) => {
  const file = path.join(REFS, rel);
  if (!fs.existsSync(file)) fail(`source video not found: references/${rel}`);
  return file;
};

for (const v of videos.data.videos) {
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
const posterOf = (clip) => ['-i', path.join(OUT, clip), '-frames:v', '1', '-q:v', '8'];
function addClip(name, srcRel, start, duration, filters, depTime) {
  const src = sourceOf(srcRel);
  jobs.push({
    kind: 'clips', out: `clips/${name}.mp4`, deps: [src], depTimes: [depTime],
    args: ['-ss', String(start), '-t', String(duration), '-i', src,
      '-vf', `${filters ? filters + ',' : ''}scale=${SHORT}:force_original_aspect_ratio=increase,crop=${SHORT}`, ...clipVideo],
  });
  jobs.push({ kind: 'posters', out: `posters/${name}.jpg`, deps: [path.join(OUT, 'clips', `${name}.mp4`)], depTimes: [depTime], args: posterOf(`clips/${name}.mp4`) });
}

const loop = site.data.settings.heroLoop;
const loopVideo = videos.data.videos.find((v) => v.id === loop.videoId);
if (!loopVideo) fail(`content/site.yaml: heroLoop.videoId "${loop.videoId}" is not in videos.yaml`);
addClip('hero-loop', loopVideo.source, loop.start, loop.duration, '', site.mtime);

if (ba.data.mode === 'slider') {
  const s = ba.data.slider;
  if (!s) fail('content/sections/before-after.yaml: mode is slider but there is no slider: block');
  addClip('ba-before', s.before.source, s.before.start, s.before.duration, '', ba.mtime);
  addClip('ba-after', s.after.source, s.after.start, s.after.duration, '', ba.mtime);
} else {
  const r = ba.data.reveal;
  if (!r) fail('content/sections/before-after.yaml: mode is reveal but there is no reveal: block');
  addClip('ba-reveal', r.source, r.start, r.duration, `setpts=${r.slowdown}*PTS,fps=30`, ba.mtime);
}

const made = { posters: 0, videos: 0, clips: 0 };
let skipped = 0;
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
console.log(`\nposters: ${made.posters}, videos: ${made.videos}, clips: ${made.clips}${skipped ? `, skipped: ${skipped}` : ''}`);
