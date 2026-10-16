// Independent saved-artifact audit. Does not import recorder/association/audio code.
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
const folder = resolve(process.argv[2]);
const live = process.argv.includes('--live');
const s = JSON.parse(await readFile(join(folder, 'manifest.json'), 'utf8'));
assert.equal(s.status, 'complete'); assert.equal(s.captureComplete, true);
assert.ok(s.duration >= 29.5 && s.duration < 33);
assert.ok(s.frames.length >= 5 && s.frames.length <= 7);
assert.equal(s.interval, 5);
if (live) { assert.ok(!s.evidenceType?.includes('SIMULATED')); assert.ok(s.originUptime > 0); }
const duration = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', join(folder, 'audio.wav')], { encoding: 'utf8' }).trim());
assert.ok(Math.abs(duration - s.duration) < .5);
const colors = [], artifacts = [];
for (let i = 0; i < s.frames.length; i++) {
  const f = s.frames[i], end = s.frames[i + 1]?.capturedAt ?? s.duration;
  assert.ok(f.captureStartedAt <= f.capturedAt && f.capturedAt <= f.captureCompletedAt);
  assert.equal(f.displayStart, f.capturedAt); assert.equal(f.displayEnd, end);
  const expected = [];
  s.segments.forEach((t, j) => { if (Math.max(t.start, f.capturedAt) < Math.min(t.end, end)) expected.push(j); });
  assert.deepEqual(f.segmentIds, expected);
  const bytes = await readFile(join(folder, f.file)); assert.equal(bytes.readUInt16BE(), 0xffd8);
  const rgb = execFileSync('ffmpeg', ['-v', 'error', '-i', join(folder, f.file), '-vf', 'scale=1:1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-']);
  colors.push([...rgb]); artifacts.push({ file: f.file, sha256: createHash('sha256').update(bytes).digest('hex') });
}
const phraseIndex = s.segments.findIndex(t => /changing this now/i.test(t.text));
assert.ok(phraseIndex >= 0, 'Spoken phrase missing');
const firstOrange = colors.findIndex(([r, , b]) => r > b + 20);
assert.ok(firstOrange > 0, 'No blue-to-orange visual change');
assert.ok(s.frames.slice(firstOrange).some(f => f.segmentIds.includes(phraseIndex)), 'Phrase does not overlap a screenshot showing AFTER state; repeat acceptance with phrase spoken at color change');
let visualChange;
if (live) {
  visualChange = JSON.parse(await readFile(join(folder, 'visual-change.json'), 'utf8'));
  assert.ok(Math.abs(visualChange.changedAt - 9.75) < .5);
  assert.ok(Math.abs(s.segments[phraseIndex].start - visualChange.changedAt) < 2, 'Speech too far from visual change');
}
const audio = await readFile(join(folder, 'audio.wav'));
artifacts.push({ file: 'audio.wav', sha256: createHash('sha256').update(audio).digest('hex') });
const report = { result: 'PASS', evidenceType: live ? 'LIVE MICROPHONE + CONTROLLED NATIVE WINDOW' : s.evidenceType, liveCaptureProven: live, duration, frames: s.frames.length, phrase: s.segments[phraseIndex], firstOrangeFrame: s.frames[firstOrange].file, visualChange, independentAssociations: 'PASS', meanFrameRGB: colors, artifacts };
await writeFile(join(folder, 'audit.json'), JSON.stringify(report, null, 2) + '\n');
const escape = text => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
const html = `<!doctype html><meta charset="utf-8"><title>Walkthrough evidence</title><style>body{font:17px system-ui;max-width:1000px;margin:40px auto;padding:20px;background:#f5f1eb;color:#222}img{width:100%}section{display:grid;grid-template-columns:1fr 1fr;gap:24px}figure{margin:0}pre{white-space:pre-wrap}audio{width:100%}</style><h1>${escape(report.evidenceType)}</h1><p>Independent saved-artifact audit: PASS. Audio duration ${duration}s. ${s.frames.length} JPEGs. Associations recomputed without recorder code.</p><audio controls src="audio.wav"></audio><pre>${escape(s.segments.map(t => `[${t.start.toFixed(3)}–${t.end.toFixed(3)}] ${t.text}`).join('\n'))}</pre><section>${s.frames.map(f => `<figure><img src="${escape(f.file)}"><figcaption>${escape(f.file)} · [${f.displayStart.toFixed(3)}, ${f.displayEnd.toFixed(3)}) · ${escape(f.segmentIds.map(i => s.segments[i].text).join(' | ') || 'silence')}</figcaption></figure>`).join('')}</section><p><a href="manifest.json">Manifest</a> · <a href="audit.json">Independent audit and hashes</a> · <a href="transcript.md">Transcript</a></p>`;
await writeFile(join(folder, 'review.html'), html);
console.log(JSON.stringify(report, null, 2));
