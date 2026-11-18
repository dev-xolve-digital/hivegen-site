// Makes small self-hosted fonts for the site from the @fontsource-variable packages.
//   Archivo: width fixed at 125%, weights 800–900 (headlines only).
//   Montserrat: weights 400–700 (body text).
// Both keep Latin-1 plus the punctuation the site uses. Run: npm run fonts
import fs from 'node:fs';
import path from 'node:path';
import subsetFont from 'subset-font';

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => String.fromCodePoint(a + i)).join('');
const TEXT = range(0x20, 0x7e) + range(0xa0, 0xff) + range(0x2010, 0x2027) + '\u2030\u2032\u2033\u2039\u203a\u20ac\u2122\u2190\u2192\u2191\u2193\u2212\u00d7';
const OUT = path.join(process.cwd(), 'public', 'fonts');
fs.mkdirSync(OUT, { recursive: true });

const jobs = [
  { src: 'node_modules/@fontsource-variable/archivo/files/archivo-latin-wdth-normal.woff2', out: 'archivo-display.woff2', axes: { wdth: 125, wght: { min: 800, max: 900 } } },
  { src: 'node_modules/@fontsource-variable/montserrat/files/montserrat-latin-wght-normal.woff2', out: 'montserrat-text.woff2', axes: { wght: { min: 400, max: 700 } } },
];
for (const j of jobs) {
  const buf = await subsetFont(fs.readFileSync(j.src), TEXT, { targetFormat: 'woff2', variationAxes: j.axes });
  fs.writeFileSync(path.join(OUT, j.out), buf);
  console.log(`${j.out}: ${(buf.length / 1024).toFixed(1)} KB`);
}
