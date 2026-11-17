// main.ts — token radar entrypoint.
//
// The program reads the sealed snapshot from /input/snapshot.json (or
// --input <file|dir>), scores every rankable pre-token protocol with the
// radar-2 model in lib/model.ts, writes the ranked board to
// /output/board.json, and copies this repository's dashboard/ and
// screenshots/ to /output. Last, it writes /output/dossier.json, the summary
// the judge reads, with the vendored make.fun library.
//
// The dashboard is a static page, no framework and no network:
// dashboard/index.html, dashboard/app.css and dashboard/app.js read
// /output/data.js, which this program writes from the same board.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps (reference/gate.json): the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && i + 1 < process.argv.length) return process.argv[i + 1];
  const inline = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (inline !== undefined) return inline.slice(name.length + 3);
  return fallback;
}

let inputFile = arg('input', '/input/snapshot.json');
if (existsSync(inputFile) && statSync(inputFile).isDirectory()) {
  inputFile = join(inputFile, 'snapshot.json');
}
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  mkdirSync(to, { recursive: true });
  const names = readdirSync(from)
    .filter((name) => !name.startsWith('.'))
    .filter((name) => statSync(join(from, name)).isFile())
    .sort();
  for (const name of names) copyFileSync(join(from, name), join(to, name));
  return names;
}

const dashboardFiles = copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const screenshotFiles = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));

/** The gate's screenshot row, checked here so a bad image fails locally, not on the server. */
if (screenshotFiles.length < 3 || screenshotFiles.length > SCREENSHOT_CAPS.max) {
  process.stderr.write(`token radar: ${screenshotFiles.length} screenshots, the gate wants 3-4\n`);
  process.exit(1);
}
for (const name of screenshotFiles) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: screenshot name ${JSON.stringify(name)} is not dossier-legal\n`);
    process.exit(1);
  }
  const path = join(out, 'screenshots', name);
  const bytes = readFileSync(path);
  if (bytes.length > SCREENSHOT_CAPS.max_bytes) {
    process.stderr.write(`token radar: screenshot ${name} is ${bytes.length} bytes, the cap is ${SCREENSHOT_CAPS.max_bytes}\n`);
    process.exit(1);
  }
  const png = bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const jpeg = bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (!png && !jpeg) {
    process.stderr.write(`token radar: screenshot ${name} is neither PNG nor JPEG\n`);
    process.exit(1);
  }
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));

const watchlistRows = radar.rows.filter((r) => r.watchlist).length;
const earlyRows = radar.rows.length - watchlistRows;
const topValue = radar.rows[0]?.implied_value_usd ?? 0;
process.stderr.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ` +
    `${radar.rows.length} rows scored (${earlyRows} early, ${watchlistRows} watchlist), top implied value $${topValue.toLocaleString('en-US')}\n`,
);
process.stderr.write(
  `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (${dashboardFiles.length} files), ` +
    `${join(out, 'screenshots')} (${screenshotFiles.length} images) and ${join(out, 'dossier.json')}\n`,
);
