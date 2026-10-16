import test from 'node:test';
import assert from 'node:assert/strict';
import { associate, parseWhisper, readable, saveSession, loadSession } from './session.mjs';
import { options, eventsProcess, transcribe } from './record.mjs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('default and configurable interval, duration, CLI rejection', () => {
  assert.equal(options([]).interval, 5);
  assert.equal(options(['--interval', '2.5', '--duration', '30']).interval, 2.5);
  for (const bad of ['0', '-1', 'Infinity', 'NaN', '']) assert.throws(() => options(['--interval', bad]));
  assert.throws(() => options(['--duration', '-1']));
  assert.throws(() => options(['--window', 'bad']));
  assert.throws(() => options(['--window', '4294967296']));
});
test('half-open boundaries preserve silence and all overlapping segments', () => {
  const frames = [{ capturedAt: .1 }, { capturedAt: 5.1 }, { capturedAt: 10.1 }];
  const segments = [{ start: 0, end: .1, text: 'before first frame' }, { start: 5.1, end: 6, text: 'change' }, { start: 5.5, end: 10.1, text: 'overlap' }, { start: 14, end: 15, text: 'tail' }];
  assert.deepEqual(associate(frames, segments, 15).map(f => f.segmentIds), [[], [1, 2], [3]]);
  assert.deepEqual(associate(frames, [], 15).map(f => f.segmentIds), [[], [], []]);
});
test('association uses actual delayed timestamps; no forced stop screenshot', () => {
  const frames = Array.from({ length: 6 }, (_, i) => ({ capturedAt: i * 5 + .02 }));
  const result = associate(frames, [{ start: 14.99, end: 15.04, text: 'boundary' }], 30);
  assert.equal(result.length, 6);
  assert.deepEqual(result.map(f => f.segmentIds), [[], [], [0], [0], [], []]);
  assert.equal(result.at(-1).displayEnd, 30);
});
test('bad clocks, duplicate frames, invalid segments are rejected', () => {
  assert.throws(() => associate([{ capturedAt: 3 }, { capturedAt: 3 }], [], 4));
  assert.throws(() => associate([{ capturedAt: 4 }], [], 4));
  assert.throws(() => associate([], [{ start: 2, end: 1, text: 'bad' }], 4));
  assert.throws(() => associate([], [{ start: 1, end: 6, text: 'bad' }], 4));
  assert.throws(() => associate([], [], NaN));
});
test('Whisper offsets are milliseconds; tail clipped; no timestamps invented for silence', () => {
  assert.deepEqual(parseWhisper({ transcription: [{ offsets: { from: 12500, to: 14500 }, text: ' change ' }, { offsets: { from: 29000, to: 32000 }, text: 'end' }] }, 30), [{ start: 12.5, end: 14.5, text: 'change' }, { start: 29, end: 30, text: 'end' }]);
  assert.deepEqual(parseWhisper({ transcription: [] }, 30), []);
  assert.throws(() => parseWhisper({}, 30));
  assert.throws(() => parseWhisper({ transcription: [{ text: 'bad' }] }, 30));
});
test('capture events serialize in order; stop event follows final frame', async () => {
  const result = [];
  await eventsProcess(process.execPath, ['-e', 'for (const type of ["start","frame","stop"]) console.log(JSON.stringify({type}))'], async e => { await new Promise(r => setTimeout(r, 2)); result.push(e.type); });
  assert.deepEqual(result, ['start', 'frame', 'stop']);
});
test('native errors, crashes, and malformed events fail rather than succeed', async () => {
  await assert.rejects(eventsProcess(process.execPath, ['-e', 'console.log(JSON.stringify({type:"error",message:"window closed"}));process.exit(1)'], () => {}), /window closed/);
  await assert.rejects(eventsProcess(process.execPath, ['-e', 'process.exit(4)'], () => {}), /Capture exited 4/);
  await assert.rejects(eventsProcess(process.execPath, ['-e', 'console.log("not json")'], () => {}), /JSON/);
});
test('transcription failure retains raw audio and manifest supports retry', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'walkthrough-test-'));
  try {
    await writeFile(join(folder, 'audio.wav'), 'retained fixture');
    await saveSession(folder, { status: 'captured', captureComplete: true, duration: 30, frames: [], segments: [] });
    await assert.rejects(transcribe(folder, { whisper: '/missing/whisper', model: '/missing/model' }));
    const session = await loadSession(folder);
    assert.equal(session.status, 'transcription_failed');
    assert.equal(session.captureComplete, true);
    assert.match(readable(session), /Error:/);
    const { readFile } = await import('node:fs/promises');
    assert.equal(await readFile(join(folder, 'audio.wav'), 'utf8'), 'retained fixture');
  } finally { await rm(folder, { recursive: true }); }
});
test('unclean capture cannot silently become completed', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'walkthrough-test-'));
  try { await saveSession(folder, { status: 'capture_failed', frames: [] }); await assert.rejects(transcribe(folder, {}), /did not finish cleanly/); }
  finally { await rm(folder, { recursive: true }); }
});

test('Jot energy gate preserves leading silence, multiple phrases, and flushes tail', async () => {
  const { readPCM, wavPCM, speechRegions } = await import('./audio.mjs');
  const pcm = Buffer.alloc(30 * 32000);
  for (const [start, end] of [[12, 13.5], [29, 30]]) for (let i = start * 16000; i < end * 16000; i++) pcm.writeInt16LE(5000, i * 2);
  const regions = speechRegions(readPCM(wavPCM(pcm)));
  assert.equal(regions.length, 2);
  assert.equal(regions[0].start, 11.67); assert.equal(regions[0].end, 14.4);
  assert.equal(regions[1].start, 28.67); assert.equal(regions[1].end, 30);
  assert.deepEqual(speechRegions(Buffer.alloc(32000)), []);
  assert.throws(() => readPCM(Buffer.from('bad')), /WAV/);
});
test('continuous speech splits at max-phrase boundary and preserves preroll overlap', async () => {
  const { speechRegions } = await import('./audio.mjs');
  const pcm = Buffer.alloc(30 * 32000);
  for (let i = 0; i < pcm.length; i += 2) pcm.writeInt16LE(5000, i);
  const regions = speechRegions(pcm);
  assert.equal(regions.length, 3);
  assert.ok(regions.every(r => r.end > r.start));
  // Adjacent long phrases may share preroll. Timestamp overlap is preserved.
  assert.ok(regions[1].start <= regions[0].end);
});
test('Ctrl-C is forwarded and allows a final native stop event before cleanup', async () => {
  const types = [];
  const script = 'process.on("SIGINT",()=>{console.log(JSON.stringify({type:"stop"}));process.exit(0)});console.log(JSON.stringify({type:"start"}));setInterval(()=>{},1000)';
  await eventsProcess(process.execPath, ['-e', script], e => {
    types.push(e.type);
    if (e.type === 'start') process.emit('SIGINT');
  }, { forwardSignals: true });
  assert.deepEqual(types, ['start', 'stop']);
});
