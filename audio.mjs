// Same energy threshold, 100ms blocks, 330ms preroll, 900ms silence,
// and 12s maximum phrase used by Jot's local dictation worker.
export function readPCM(wav) {
  if (wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Expected PCM WAV');
  let format, pcm;
  for (let at = 12; at + 8 <= wav.length;) {
    const size = wav.readUInt32LE(at + 4), start = at + 8;
    if (start + size > wav.length) throw new Error('Truncated WAV');
    if (wav.toString('ascii', at, at + 4) === 'fmt ') {
      if (size < 16) throw new Error('Invalid WAV format');
      format = { code: wav.readUInt16LE(start), channels: wav.readUInt16LE(start + 2), rate: wav.readUInt32LE(start + 4), bits: wav.readUInt16LE(start + 14) };
    }
    if (wav.toString('ascii', at, at + 4) === 'data') pcm = wav.subarray(start, start + size);
    at = start + size + size % 2;
  }
  if (!format || format.code !== 1 || format.channels !== 1 || format.rate !== 16000 || format.bits !== 16 || !pcm || pcm.length % 2) throw new Error('Requires 16kHz mono PCM16 WAV');
  return pcm;
}
export function wavPCM(pcm) {
  const h = Buffer.alloc(44); h.write('RIFF'); h.writeUInt32LE(pcm.length + 36, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(16000, 24); h.writeUInt32LE(32000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
export function speechRegions(pcm) {
  const regions = [], samples = pcm.length / 2, block = 1600;
  let start = null, lastVoice = 0, voicedSamples = 0;
  function finish(end) {
    if (start !== null && voicedSamples >= 4000) regions.push({ start: start / 16000, end: end / 16000 });
    start = null; voicedSamples = 0;
  }
  for (let i = 0; i < samples; i += block) {
    const end = Math.min(i + block, samples); let energy = 0;
    for (let j = i; j < end; j++) energy += (pcm.readInt16LE(j * 2) / 32768) ** 2;
    const voiced = Math.sqrt(energy / (end - i)) > .010;
    if (voiced) {
      if (start === null) start = Math.max(0, i - 5280);
      lastVoice = end; voicedSamples += end - i;
    }
    if (start !== null && (end - lastVoice >= 14400 || end - start >= 192000)) finish(end);
  }
  if (start !== null) finish(samples);
  return regions;
}
