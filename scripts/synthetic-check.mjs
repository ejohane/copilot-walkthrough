// Synthetic frames and file-based synthesized speech; NEVER proof of live capture.
import { readFile, writeFile, copyFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
import { saveSession } from '../session.mjs';
import { transcribe } from '../record.mjs';
const folder = resolve(process.argv[2] ?? 'evidence/synthetic');
await mkdir(folder, { recursive: true });
const frames = [];
for (let i = 0; i < 6; i++) {
  const file = `frame-${String(i).padStart(4, '0')}.jpg`;
  await copyFile(resolve(`evidence/${i < 2 ? 'before' : 'after'}.jpg`), join(folder, file));
  frames.push({ file, capturedAt: i * 5 + .02, captureStartedAt: i * 5, captureCompletedAt: i * 5 + .04 });
}
await saveSession(folder, { schemaVersion: 1, status: 'captured', evidenceType: 'SIMULATED CAPTURE; real local inference', captureComplete: true, interval: 5, duration: 30, audio: 'audio.wav', frames, segments: [], groundTruth: { visualChangeSeconds: 10, speechInsertedSeconds: 12, phrase: "I'm changing this now" } });
await transcribe(folder, {});
// Independent oracle: read saved bytes, no association helper reuse.
const s = JSON.parse(await readFile(join(folder, 'manifest.json'), 'utf8'));
assert.equal(s.frames.length, 6);
assert.equal(s.status, 'complete');
assert.ok(s.segments.some(t => /changing this now/i.test(t.text)));
assert.ok(s.segments.every(t => t.start > 11 && t.end < 16), 'Leading silence was lost');
for (let i = 0; i < s.frames.length; i++) {
  const f = s.frames[i], end = s.frames[i + 1]?.capturedAt ?? 30;
  const expected = [];
  s.segments.forEach((t, j) => { if (Math.max(t.start, f.capturedAt) < Math.min(t.end, end)) expected.push(j); });
  assert.deepEqual(f.segmentIds, expected);
  const bytes = await readFile(join(folder, f.file)); assert.equal(bytes.readUInt16BE(), 0xffd8);
}
assert.ok(s.frames[2].segmentIds.length > 0);
assert.ok(s.frames[0].segmentIds.length === 0 && s.frames[1].segmentIds.length === 0);
const before = await readFile(join(folder, s.frames[1].file)), after = await readFile(join(folder, s.frames[2].file));
assert.notDeepEqual(before, after);
const report = { result: 'PASS', evidenceType: s.evidenceType, audioFileDuration: s.audioFileDuration, segments: s.segments, frameCount: s.frames.length, dialogueFrame: s.frames[2].file, independentAssociationCheck: 'PASS', liveCaptureProven: false };
await writeFile(join(folder, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
