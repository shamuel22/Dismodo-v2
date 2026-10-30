// Writes index.html: scene hosts, voice lines, effects and the ducked music bed. Edit the tables, then rerun.
import { readFileSync, writeFileSync } from 'node:fs';

const DURATION = 157.5;
const scenes = [
  ['open', 0, 19.6], ['origin', 19.6, 37], ['reveal', 37, 45.5], ['package', 45.5, 61], ['practice', 61, 91.5],
  ['proof', 91.5, 102.5], ['trace', 102.5, 112.5], ['acme', 112.5, 124.5], ['mcp', 124.5, 135.5], ['end', 135.5, DURATION],
];
const voice = { hook: 0.5, swap: 10.0, origin: 20.2, reveal: 38.8, package: 51.6, mistake: 67.0, wonder: 76.5,
  pushback: 90.4, proof: 97.5, trace: 108.6, acme: 118.8, mcp: 130.5, claim: 141.5 };
// [file, start, volume] — each lands one frame after the picture it belongs to.
const sfx = [
  ['click', 10.33, 1.6], ['whoosh1', 19.35, 0.5], ['riser', 36.13, 0.42], ['whoosh2', 50.75, 0.5],
  ['click', 63.43, 1.2], ['click', 70.1, 1.4], ['click', 91.53, 1.4], ['keys', 92.0, 0.9, 1.7], ['whoosh1', 96.75, 0.45],
  ['whoosh2', 117.75, 0.5], ['keys', 133.3, 0.8, 0.55], ['keys', 134.8, 0.7, 0.6], ['keys', 135.95, 0.7, 0.45], ['whoosh1', 140.75, 0.45],
];
import { execFileSync } from 'node:child_process';
const fileDuration = (f) => +Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString()).toFixed(2);
const SHIFT = (t) => (t > 45 ? +(t - 5.5).toFixed(2) : t);
const timings = JSON.parse(readFileSync('assets/vo/timings.json', 'utf8'));

// Music: 0.45 in the clear, 0.17 under the voice.
const points = [{ t: 0, v: 0.45 }];
for (const id of Object.keys(voice)) voice[id] = SHIFT(voice[id]);
for (const s of sfx) s[1] = SHIFT(s[1]);
for (const [id, start] of Object.entries(voice)) {
  const end = start + timings[id].duration;
  points.push({ t: +(start - 0.4).toFixed(2), v: 0.45 }, { t: start, v: 0.17 }, { t: +(end + 0.2).toFixed(2), v: 0.17 }, { t: +(end + 0.9).toFixed(2), v: 0.45 });
}
const merged = points.sort((a, b) => a.t - b.t).filter((p, i, a) => i === 0 || p.t > a[i - 1].t);
const automation = JSON.stringify({ version: 1, lanes: [{ target: 'volume', points: merged }] }).replace(/"/g, '&quot;');

const hosts = scenes.map(([id, s, e], i) => `      <div id="${id}" data-composition-id="${id}" data-composition-src="compositions/${id}.html" data-start="${s}" data-duration="${+(e - s).toFixed(2)}" data-track-index="${i % 2}" data-track-kind="graphics" data-width="1920" data-height="1080"></div>`).join('\n');
const voices = Object.entries(voice).map(([id, s]) => `      <audio id="vo-${id}" class="clip" src="assets/vo/${id}.mp3" data-start="${s}" data-duration="${timings[id].duration.toFixed(2)}" data-track-index="3" data-volume="1" data-audio-group="voiceover"></audio>`).join('\n');
const effects = sfx.map(([f, s, v, d], i) => `      <audio id="sfx-${i + 1}-${f}" class="clip" src="assets/sfx/${f}.mp3" data-start="${s}"${d ? ` data-duration="${d}" data-fade-out="0.1"` : ` data-duration="${fileDuration(`assets/sfx/${f}.mp3`)}"`} data-track-index="${4 + (i % 2)}" data-volume="${v}" data-audio-group="sfx"></audio>`).join('\n');

writeFileSync('index.html', `<!doctype html>
<html lang="en" data-composition-variables='[
  {"id":"color-ground","type":"color","label":"Background","default":"#141517"},
  {"id":"color-ink","type":"color","label":"Text","default":"#F3F0E9"},
  {"id":"color-accent","type":"color","label":"Accent (pear)","default":"#D7FF7F"},
  {"id":"color-adaptive","type":"color","label":"Adaptive (lavender)","default":"#B39CFF"}
]'>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920, height=1080" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { margin: 0; width: 1920px; height: 1080px; overflow: hidden; background: #141517; }
      #root { position: relative; width: 100%; height: 100%; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${DURATION}" data-width="1920" data-height="1080">
${hosts}
${voices}
${effects}
      <audio id="music" class="clip" src="assets/music/bed.mp3" data-start="0" data-duration="${DURATION}" data-track-index="6" data-volume="1" data-fade-in="0.3" data-fade-out="4" data-audio-group="music" data-automation="${automation}"></audio>
    </div>
    <script>
      window.__timelines["main"] = gsap.timeline({ paused: true });
    </script>
  </body>
</html>
`);
console.log('index.html written,', merged.length, 'music points');
