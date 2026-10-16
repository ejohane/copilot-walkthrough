# Walkthrough recorder — v0.1

A standalone macOS CLI that records microphone narration and one selected window, then transcribes locally. Each session retains `audio.wav`, JPEG screenshots, `transcript.md`, and `manifest.json` in one folder. Nothing uploads recordings. Copilot/Codex integration is outside this MVP; the existing [Copilot connection probe](docs/copilot-probe.md) remains available and unchanged.

Requires macOS 14+, Node.js 22+, Xcode command-line tools, and CMake for the local transcription build. The recorder itself has no npm runtime dependencies. `npm ci` is only necessary for the separate Copilot probe.

## Build and local model

```sh
npm run build:capture
bash scripts/setup-whisper.sh
```

The second command downloads open-source source code and builds whisper.cpp at `927cfce34f31707e17f2bff35c349632fb9e2c3a` (Jot's pinned v1.9.4 revision). Recordings never enter either setup command. Transcription uses the installed Jot model by default:

```text
~/Library/Application Support/Jot/Models/ggml-small.en-v1.bin
SHA-256 c6138d6d58ecc8322097e0f987c32f1be8bb0a18532a3f88f734d1bbf9c41e5d
```

Its integrity is checked before recording and transcription. Another local whisper.cpp binary/model can be selected with `--whisper FILE --model FILE` or `WHISPER_CLI` / `WHISPER_MODEL`; their hashes are recorded. Models are never automatically downloaded during a recording. The verified engine is **whisper.cpp with Whisper small.en**, not a model called “Whisper Sync.” See [engine evidence](docs/local-engine.md).

## Record

Explicitly request OS permissions, approve Screen Recording and Microphone for the requesting terminal/tool in System Settings, and restart the terminal if macOS asks:

```sh
node record.mjs permissions
```

That command prompts for access only; it does not record. Other commands check existing authorization without requesting it.

```sh
node record.mjs
# Select a window ID, then type record to begin immediately.
# Enter or Ctrl-C stops and starts local transcription.
```

Configure timing at start, optionally choose a window in advance:

```sh
node record.mjs windows
node record.mjs --window WINDOW_ID --interval 5 --duration 30
```

`--duration 0` (default) records until stopped. `--interval` accepts any finite positive seconds. Default output is `captures/<timestamp>/`. `--out FOLDER` must name a new folder. `--yes` with an explicit `--window` is immediate recording consent for scripted use. Without it the confirmation remains required. EOF on stdin stops, so scripted callers must keep stdin open for the requested duration.

Audio stays in `audio.wav`, including on failure. A stopped capture is saved before transcription starts. Retry a failed transcription without rerecording:

```sh
node record.mjs transcribe --out captures/SESSION
```

Capture failure saves partial files and `capture_failed`; it cannot silently become a completed session. Transcription failure saves `transcription_failed` and the error. Incomplete captures require inspection before recovery. The transcriber invokes only the local binary, with CPU inference, and retains phrase WAVs, raw segment JSON and inference logs in `speech/` for audit.

## Timing contract

- Microphone audio is scheduled 250ms ahead on `AVAudioRecorder.deviceCurrentTime`, mapped to monotonic system uptime. Session zero is that scheduled start; mapping uncertainty is saved. Wall clock is metadata only.
- The first screenshot is requested at session start, then at interval ticks. Each JPEG has measured request-start and completion times; `capturedAt` is their midpoint, with acquisition uncertainty of half that bracket. Times are measured, never fabricated from frame index. Frames describe sampled states, not the exact instant of an intervening visual edit.
- A screenshot represents `[capturedAt, next capturedAt)`. The last ends at the measured audio stop. Speech before the first frame remains in the transcript without being attached to a nonexistent frame. Stop does not add a final screenshot. Missed ticks are skipped.
- Dialogue segments use `[start,end)`. Every positive overlap with a frame's display interval is associated. Touching boundaries alone do not overlap; silent frames have empty `segmentIds`; multiple simultaneous segments are preserved. Original segment order is retained.
- Whisper's segment times are approximate. Direct inference on silence-padded audio proved unreliable in the synthetic test. Jot's energy gate isolates phrases first (100ms blocks, RMS 0.010, 330ms preroll, 900ms silence, minimum 250ms voiced, maximum 12s). Segment offsets are translated into the original session clock. Quiet speech below that fixed gate may be missed; the retained original allows review. Long phrases may overlap in their preroll, and their associations remain explicit.
- WAV duration must agree with the session clock within 500ms, otherwise transcription fails for inspection. This is an integrity guard, not a claim of 500ms timestamp accuracy.

## Verify

```sh
npm test
npm run build:capture
```

The tests cover the preserved probe, timestamps, silence, overlaps, configurable interval, event ordering, capture errors, transcription failure, retained audio, and incomplete-session recovery rejection.

Synthetic check (macOS `say` and FFmpeg required; these generate files without recording or playing audio):

```sh
mkdir -p evidence/synthetic
say -o evidence/phrase.aiff "I'm changing this now"
ffmpeg -v error -y -i evidence/phrase.aiff -af 'adelay=12000,apad=whole_dur=30' -ar 16000 -ac 1 -c:a pcm_s16le evidence/synthetic/audio.wav
ffmpeg -v error -y -f lavfi -i color=c=0x23395B:s=960x600 -frames:v 1 -update 1 evidence/before.jpg
ffmpeg -v error -y -f lavfi -i color=c=0xC8553D:s=960x600 -frames:v 1 -update 1 evidence/after.jpg
node scripts/synthetic-check.mjs
node scripts/verify-session.mjs evidence/synthetic
```

This is **simulated capture with real local inference**. It proves neither microphone nor selected-window capture. The independent auditor uses saved files and recomputes overlaps without importing recorder code, checks WAV duration/JPEG bytes/colors, and creates `audit.json` and a local `review.html` with audio and frame gallery.

For the actual live acceptance test, with the user present and permissions granted:

```sh
node scripts/live-check.mjs
```

The runner opens only a controlled native window and selects that window. Type `record` at the prompt to authorize the immediate 30-second microphone/window capture. At about ten seconds it changes blue to orange: say **“I'm changing this now.”** It stops automatically, transcribes, and prints the exact audit command:

```sh
node scripts/verify-session.mjs captures/ACCEPTANCE_SESSION --live
```

The live audit additionally checks the fixture's actual monotonic change marker and speech timing, and requires the phrase to overlap an orange screenshot. Inspect/listen to `review.html` before accepting. A successful simulated audit cannot pass for live evidence. See [current verification results](docs/verification.md).

[Vision and approach](docs/vision-and-approach.md) remains the longer-term concept; this v0.1 capture-only scope supersedes its initial Copilot integration plan.
