# Verification status — 2026-10-16

Implementation worktree: `capture-v0.1`, based on upstream main `5a8c351`. The five-test Copilot probe is unchanged. No AGENTS.md was found in the repository or its applicable parent directories. The base checkout was clean and this worktree isolated before edits. No push, merge, release, or publication performed.

## Completed

- Native `walkthrough-capture` and controlled `walkthrough-fixture` built with SwiftPM on this Mac, using ScreenCaptureKit and AVAudioRecorder.
- whisper.cpp built from Jot's pinned upstream revision; cached model checksum verified.
- 17 Node tests pass, including the existing five probe tests.
- Real local inference on a synthesized 30-second audio file: phrase at 11.670–13.670 seconds, six simulated JPEGs, correct changed-state frame association.
- Independent saved-artifact audit passed; WAV length 30.000 seconds, JPEG magic/color inspection, recomputed all frame associations, artifact SHA-256 hashes, readable transcript and review HTML generated.

Local evidence (ignored by Git, retained in this worktree):

- `evidence/synthetic/audio.wav`: original synthesized audio, not microphone input.
- `evidence/synthetic/frame-0000.jpg` … `frame-0005.jpg`: generated blue/orange images, not selected-window captures.
- `evidence/synthetic/manifest.json`, `transcript.md`, `verification.json`, `audit.json`, `review.html`, `speech/`: model output, times, associations, independent checks and review surface.
- `evidence/first-transcription.json`: observed pre-gate incorrect 0–7-second timing, retained to document the corrected issue.

## Pending live acceptance

Screen Recording preflight currently reports: `Screen Recording permission required. Run node record.mjs permissions, approve in System Settings, then restart your terminal if needed.` No permission prompt or real recording was initiated. Microphone authorization has not been tested independently because screen preflight stops first.

The real 30-second microphone/selected-window test remains **pending**, not passed. Smallest user step: with Erik present, run `node record.mjs permissions`, approve both permissions if prompted, then `node scripts/live-check.mjs`. Type `record` to consent to immediate recording. Say “I'm changing this now” at the orange change near ten seconds. Automatic stop occurs at 30 seconds. Run the printed `verify-session.mjs ... --live` command and listen/view `review.html`. All captured screen content is restricted to the controlled native fixture window.

That live test is required to establish actual microphone acquisition, audio-clock scheduling on this hardware, OS capture permissions, selected-window JPEG acquisition, and the real spoken/visible change alignment. Synthetic evidence cannot establish those facts. If permission changes require terminal restart, rerun after restarting. No user denial or automatic approval rejection has occurred for this live step; it has not been attempted.
