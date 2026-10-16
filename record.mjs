#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { readPCM, wavPCM, speechRegions } from './audio.mjs';
import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline';
import { createInterface as promptInterface } from 'node:readline/promises';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { finite, associate, parseWhisper, saveSession, loadSession } from './session.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const helper = join(root, '.build/debug/walkthrough-capture');
export function options(args) {
  const { values: v, positionals } = parseArgs({ args, allowPositionals: true, options: {
    interval: { type: 'string', default: '5' }, duration: { type: 'string', default: '0' },
    window: { type: 'string' }, out: { type: 'string' }, model: { type: 'string' }, whisper: { type: 'string' },
    yes: { type: 'boolean' }, help: { type: 'boolean' }
  } });
  const command = positionals[0] ?? 'record';
  if (positionals.length > 1 || !['record', 'windows', 'permissions', 'transcribe'].includes(command)) throw new Error('Expected record, windows, permissions, or transcribe');
  const interval = finite(v.interval, 'interval', { positive: true });
  const duration = finite(v.duration, 'duration');
  if (v.window && (!/^\d+$/.test(v.window) || Number(v.window) > 4294967295)) throw new Error('window must be an unsigned window ID');
  return { ...v, command, interval, duration };
}
export async function eventsProcess(executable, args, onEvent, { input = false, forwardSignals = false, idleTimeoutMs = 0, shutdownGraceMs = 5000 } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, args, { stdio: [input ? 'inherit' : 'pipe', 'pipe', 'inherit'] });
    let failure; let queue = Promise.resolve(); let idleTimer; let shutdownTimer;
    const stop = () => {
      if (!child.killed) child.kill('SIGINT');
      shutdownTimer ??= setTimeout(() => { failure ??= new Error('Capture did not finish after stop; partial files retained'); child.kill('SIGKILL'); }, shutdownGraceMs);
    };
    const resetWatchdog = () => {
      clearTimeout(idleTimer);
      if (idleTimeoutMs) idleTimer = setTimeout(() => { failure = new Error('Capture stopped responding; partial files retained'); stop(); }, Math.min(idleTimeoutMs, 2147483647));
    };
    resetWatchdog();
    if (forwardSignals) { process.on('SIGINT', stop); process.on('SIGTERM', stop); }
    const lines = createInterface({ input: child.stdout });
    lines.on('line', line => { resetWatchdog(); queue = queue.then(async () => {
      const event = JSON.parse(line);
      if (event.type === 'error') failure = new Error(event.message);
      await onEvent(event);
    }).catch(error => { failure = error; stop(); }); });
    child.on('error', error => { failure = error; });
    child.on('close', async (code, signal) => {
      clearTimeout(idleTimer); clearTimeout(shutdownTimer);
      if (forwardSignals) { process.off('SIGINT', stop); process.off('SIGTERM', stop); }
      await queue;
      if (failure || code !== 0) reject(failure ?? new Error(`Capture exited ${code ?? signal}`));
      else resolvePromise();
    });
  });
}
async function whisperRun(binary, args, log) {
  const { open } = await import('node:fs/promises');
  const handle = await open(log, 'w');
  try {
    await new Promise((res, rej) => {
      const child = spawn(binary, args, { stdio: ['ignore', handle.fd, handle.fd], timeout: 30 * 60 * 1000 });
      child.on('error', rej);
      child.on('close', (code, signal) => code === 0 ? res() : rej(new Error(`Local transcription failed (${code ?? signal}); see ${log}. Audio retained.`)));
    });
  } finally { await handle.close(); }
}
async function digest(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
async function engineConfig(config) {
  const binary = resolve(config.whisper ?? process.env.WHISPER_CLI ?? join(root, '.local/whisper/bin/whisper-cli'));
  const model = resolve(config.model ?? process.env.WHISPER_MODEL ?? join(process.env.HOME, 'Library/Application Support/Jot/Models/ggml-small.en-v1.bin'));
  await access(binary); await access(model);
  const modelSHA256 = await digest(model);
  if (!config.model && !process.env.WHISPER_MODEL && modelSHA256 !== 'c6138d6d58ecc8322097e0f987c32f1be8bb0a18532a3f88f734d1bbf9c41e5d') throw new Error('Jot model integrity check failed');
  return { engine: 'whisper.cpp', binary, binarySHA256: await digest(binary), model, modelSHA256, language: 'en', wordTimestamps: false, networkUpload: false };
}
export async function transcribe(folder, config) {
  const session = await loadSession(folder);
  if (!session.duration || !session.captureComplete) throw new Error('Capture did not finish cleanly. Partial audio and frames retained; inspect manifest before recovery.');
  session.status = 'transcribing'; delete session.error;
  await saveSession(folder, session);
  try {
    session.transcription = await engineConfig(config);
    const { binary, model } = session.transcription;
    const inputPath = join(folder, 'transcription-input.wav');
    await promisify(execFile)('/usr/bin/afconvert', ['-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', join(folder, 'audio.wav'), inputPath]);
    const pcm = readPCM(await readFile(inputPath));
    session.audioFileDuration = pcm.length / 32000;
    if (Math.abs(session.audioFileDuration - session.duration) > .5) throw new Error('Audio duration differs from session clock by more than 500ms; retained for inspection');
    session.speechRegions = speechRegions(pcm);
    session.speechDetection = { method: 'Jot energy gate', thresholdRMS: .010, blockSeconds: .1, prerollSeconds: .33, silenceSeconds: .9, maxPhraseSeconds: 12, minimumVoicedSeconds: .25 };
    session.segments = [];
    await mkdir(join(folder, 'speech'), { recursive: true });
    for (const [i, region] of session.speechRegions.entries()) {
      const stem = join(folder, 'speech', String(i).padStart(4, '0'));
      await writeFile(stem + '.wav', wavPCM(pcm.subarray(Math.round(region.start * 16000) * 2, Math.round(region.end * 16000) * 2)));
      await whisperRun(binary, ['-m', model, '-f', stem + '.wav', '-oj', '-of', stem, '-l', 'en', '-t', '4', '-np', '-ng'], stem + '.log');
      const raw = JSON.parse(await readFile(stem + '.json', 'utf8'));
      for (const segment of parseWhisper(raw, region.end - region.start)) {
        if (/^\s*\[(?:BLANK_AUDIO|SILENCE|MUSIC)\]\s*$/i.test(segment.text)) continue;
        const start = region.start + segment.start, end = Math.min(region.start + segment.end, session.duration);
        if (start < end) session.segments.push({ ...segment, start, end });
      }
    }
    session.frames = associate(session.frames, session.segments, session.duration);
    session.status = 'complete';
    await saveSession(folder, session);
    return session;
  } catch (error) {
    session.status = 'transcription_failed'; session.error = error.message;
    await saveSession(folder, session); throw error;
  }
}
async function ask(question) {
  const rl = promptInterface({ input: process.stdin, output: process.stdout });
  try { return (await rl.question(question)).trim(); } finally { rl.close(); }
}
export async function main(args = process.argv.slice(2)) {
  const c = options(args);
  if (c.help) { console.log('node record.mjs [record|windows|permissions|transcribe] [--window ID] [--interval 5] [--duration 30] [--out FOLDER] [--model FILE] [--whisper FILE] [--yes]\nrecord lists windows, asks for selection and recording confirmation. Enter or Ctrl-C stops. --yes with --window explicitly consents to immediate recording. permissions only requests OS access. transcribe requires --out existing session.'); return; }
  if (c.command === 'transcribe') {
    if (!c.out) throw new Error('transcribe requires --out SESSION_FOLDER');
    await transcribe(resolve(c.out), c); console.log(`Transcribed: ${resolve(c.out)}`); return;
  }
  if (c.command === 'permissions') { await eventsProcess(helper, ['permissions'], e => console.log(JSON.stringify(e))); return; }
  let windows = [];
  await eventsProcess(helper, ['windows'], e => { windows = e.windows; });
  if (c.command === 'windows' || !c.window) for (const w of windows) console.log(`${w.id}\t${w.app}\t${w.title}`);
  if (c.command === 'windows') return;
  if (c.yes && !c.window) throw new Error('--yes requires an explicit --window');
  const id = c.window ?? await ask('Window ID: ');
  const window = windows.find(w => String(w.id) === id);
  if (!window) throw new Error('Choose an available window ID');
  await engineConfig(c);
  if (!c.yes && await ask(`Record microphone and window ${window.app} / ${window.title} now? Type record: `) !== 'record') { console.log('Cancelled.'); return; }
  const folder = resolve(c.out ?? join(root, 'captures', new Date().toISOString().replaceAll(':', '-')));
  await mkdir(dirname(folder), { recursive: true, mode: 0o700 });
  await mkdir(folder, { recursive: false, mode: 0o700 });
  let session = { schemaVersion: 1, status: 'starting', interval: c.interval, audio: 'audio.wav', audioTimeline: 'audio-timeline.json', clock: 'mach absolute seconds; origin is first native microphone sample hostTime', screenshotTime: 'native ScreenCaptureKit displayTime in mach absolute ticks, translated to first microphone sample', boundary: 'half-open [start,end); first frame begins at actual capture; stop has no extra frame', frames: [], segments: [] };
  await saveSession(folder, session);
  console.log(`Recording to ${folder}. Enter or Ctrl-C stops.`);
  try {
    await eventsProcess(helper, ['record', id, String(c.interval), String(c.duration), folder], async e => {
      if (e.type === 'start') { session = { ...session, ...e, status: 'recording' }; delete session.type; }
      if (e.type === 'skippedFrame') { (session.skippedFrames ??= []).push(e); }
      if (e.type === 'frame') { const { type, ...frame } = e; session.frames.push(frame); }
      if (e.type === 'stop') { session.duration = e.duration; session.stopRequestedAt = e.stopRequestedAt; session.audioDuration = e.audioDuration; session.audioTimeline = e.audioTimeline; session.recordingStoppedAt = e.recordingStoppedAt; session.captureComplete = true; session.status = 'captured'; session.excludedFrames = session.frames.filter(f => f.capturedAt >= session.duration); session.frames = associate(session.frames.filter(f => f.capturedAt < session.duration), [], session.duration); }
      await saveSession(folder, session);
    }, { input: true, forwardSignals: true, idleTimeoutMs: Math.min(c.duration > 0 ? c.duration + 15 : Infinity, c.interval + 15) * 1000 });
    if (!session.captureComplete) throw new Error('Capture exited without a stop event');
  } catch (error) { session.status = 'capture_failed'; session.error = error.message; await saveSession(folder, session); throw error; }
  await transcribe(folder, c);
  console.log(`Complete: ${join(folder, 'transcript.md')}`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e => { console.error(e.message); process.exitCode = 1; });
