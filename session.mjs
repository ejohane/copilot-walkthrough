import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';

export function finite(value, name, { positive = false } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number) || (positive ? number <= 0 : number < 0)) throw new Error(`${name} must be a finite ${positive ? 'positive' : 'nonnegative'} number`);
  return number;
}
export function associate(frames, segments, duration) {
  finite(duration, 'duration');
  for (const [i, frame] of frames.entries()) {
    finite(frame.capturedAt, 'capture timestamp');
    if (frame.capturedAt >= duration || (i && frame.capturedAt <= frames[i - 1].capturedAt)) throw new Error('Frames must be strictly ordered inside session duration');
  }
  for (const segment of segments) {
    finite(segment.start, 'segment start'); finite(segment.end, 'segment end');
    if (segment.end <= segment.start || segment.end > duration || typeof segment.text !== 'string') throw new Error('Invalid transcript segment');
  }
  return frames.map((frame, i) => {
    const end = frames[i + 1]?.capturedAt ?? duration;
    return { ...frame, displayStart: frame.capturedAt, displayEnd: end,
      segmentIds: segments.flatMap((s, j) => s.start < end && s.end > frame.capturedAt ? [j] : []) };
  });
}
export function parseWhisper(result, duration) {
  if (!Array.isArray(result.transcription)) throw new Error('Missing whisper.cpp transcription array');
  return result.transcription.flatMap(s => {
    const start = finite(s.offsets?.from, 'whisper start') / 1000;
    const end = finite(s.offsets?.to, 'whisper end') / 1000;
    if (end < start || typeof s.text !== 'string') throw new Error('Malformed whisper.cpp segment');
    if (start >= duration || end === start || !s.text.trim()) return [];
    return [{ start, end: Math.min(end, duration), text: s.text.trim() }];
  });
}
export function readable(session) {
  const lines = ['# Walkthrough transcript', '', `Status: ${session.status}`, `Duration: ${session.duration?.toFixed(3) ?? 'unknown'} seconds`, '', 'Times are session-relative seconds. Gaps are silence; segment timing is model-estimated.', ''];
  for (const s of session.segments ?? []) lines.push(`[${s.start.toFixed(3)}–${s.end.toFixed(3)}] ${s.text}`);
  if (!session.segments?.length) lines.push('(No speech segments)');
  lines.push('', '## Screenshots', '');
  for (const f of session.frames) lines.push(`- [${f.file}](${f.file}) [${f.displayStart?.toFixed(3) ?? f.capturedAt.toFixed(3)}, ${f.displayEnd?.toFixed(3) ?? '?'}) — ${(f.segmentIds ?? []).map(i => session.segments[i].text).join(' | ') || '(silence)'}`);
  if (session.error) lines.push('', `Error: ${session.error}`);
  return lines.join('\n') + '\n';
}
export async function saveSession(folder, session) {
  await writeFile(join(folder, 'manifest.json.tmp'), JSON.stringify(session, null, 2) + '\n');
  await rename(join(folder, 'manifest.json.tmp'), join(folder, 'manifest.json'));
  await writeFile(join(folder, 'transcript.md'), readable(session));
}
export const loadSession = async folder => JSON.parse(await readFile(join(folder, 'manifest.json'), 'utf8'));
