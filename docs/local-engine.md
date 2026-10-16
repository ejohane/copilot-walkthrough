# Local engine selection evidence

Inspection on 2026-10-16:

- `/Users/erikjohansson/dev/jot` is the older local checkout. The installed Jot contains `/Applications/Jot.app/Contents/MacOS/jot-whisper`.
- The recent Jot dictation implementation is `/Users/erikjohansson/Documents/Codex/2026-10-13/task/jot-dictation`.
- Its `script/build_whisper.sh` pins whisper.cpp tag v1.9.4, revision `927cfce34f31707e17f2bff35c349632fb9e2c3a`.
- Its `Sources/Jot/App/VoiceDictation.swift` selects `ggml-small.en-v1.bin` with SHA-256 `c6138d6d58ecc8322097e0f987c32f1be8bb0a18532a3f88f734d1bbf9c41e5d`.
- The actual cached model at `~/Library/Application Support/Jot/Models/ggml-small.en-v1.bin` hashes to that exact value.
- Its `Native/WhisperWorker/main.cpp` implements an energy gate, but its streaming events contain text without segment timestamps. Reusing the installed helper directly would lose timing. This recorder instead builds the same upstream engine's standard CLI, with JSON segment offsets, and ports the gate.

A synthetic 30-second clip containing the phrase after 12 seconds of silence initially produced Whisper offsets 0–7 seconds. This was a real observed failure. With phrase isolation and session offset translation, local inference yields 11.670–13.670 seconds for “I'm changing this now.” This includes detector preroll and model estimation; no word-level timing is claimed. Blank/silence markers do not become dialogue.

There is no verified evidence for an engine/model called “Whisper Sync.” The evidence-backed selection is whisper.cpp + Whisper small.en. No paid/cloud speech API is used. Model/binary paths and SHA-256 hashes are retained in each session. Source setup requires network; capture/transcription code does not make network requests.
