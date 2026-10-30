// Generates each voiceover line with ElevenLabs (with character timings). Key read from ../.env, never printed.
// Usage: node tts.mjs <voice_id> <model_id> [line ids…]
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const key = readFileSync(new URL('../.env', import.meta.url), 'utf8')
  .split('\n').find((l) => l.startsWith('ELEVEN_LABS_API='))?.slice(16).trim().replace(/^["']|["']$/g, '');
const [voice, model, ...only] = process.argv.slice(2);
const lines = JSON.parse(readFileSync('vo.json', 'utf8')).filter((l) => !only.length || only.includes(l.id));
const timings = {};
try { Object.assign(timings, JSON.parse(readFileSync('assets/vo/timings.json', 'utf8'))); } catch {}
for (const [i, line] of lines.entries()) {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}/with-timestamps?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'content-type': 'application/json' },
    body: JSON.stringify({
      text: line.text,
      model_id: model,
      voice_settings: { stability: 0.5, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true, speed: 0.97 },
    }),
  });
  if (!res.ok) { console.log(line.id, res.status, (await res.text()).slice(0, 300)); process.exit(1); }
  const j = await res.json();
  const file = `assets/vo/raw/${line.id}.mp3`;
  writeFileSync(file, Buffer.from(j.audio_base64, 'base64'));
  const a = j.alignment;
  // Word timings from character timings.
  const words = [];
  let cur = null;
  a.characters.forEach((ch, k) => {
    if (/\s/.test(ch)) { if (cur) words.push(cur); cur = null; return; }
    if (!cur) cur = { w: '', s: a.character_start_times_seconds[k] };
    cur.w += ch; cur.e = a.character_end_times_seconds[k];
  });
  if (cur) words.push(cur);
  const dur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString());
  timings[line.id] = { duration: dur, words };
  console.log(line.id, dur.toFixed(2) + 's');
}
writeFileSync('assets/vo/timings.json', JSON.stringify(timings, null, 1));
