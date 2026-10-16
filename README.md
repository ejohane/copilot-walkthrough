# Copilot walkthrough: first integration experiment

Start with [Vision and approach](docs/vision-and-approach.md) for product context, implementation phases, and the next Codex session's handoff instructions.

This is a connection probe, not yet a screen recorder. It tests the riskiest assumption: whether an external process can send context to the runtime owning your existing Copilot conversation and whether that conversation displays the result.

## Run locally

Requires Node 22 or newer and access to the running Copilot runtime endpoint. The SDK is pinned to 1.0.22; install with `npm ci`.

```sh
npm ci
npm test
node probe.mjs list --url localhost:4321
node probe.mjs send --url localhost:4321 --session YOUR_SESSION_ID --message "Reply with WALKTHROUGH_OK. Do not use tools."
```

The endpoint above is illustrative. You must supply the endpoint for the runtime that actually owns the open conversation. A normal app window is not automatically an SDK server. Do not assume starting a separate server connects it to the app. If required by that runtime, set COPILOT_CONNECTION_TOKEN in your environment; do not put credentials in the command arguments.

First use a disposable conversation. Select the exact ID from the list output. The probe refuses an unlisted ID and never creates a session. It uses enqueue delivery, denies permission requests, and disconnects on completion. Resuming may register handlers on the selected session; concurrent-client compatibility remains part of the experiment. The probe times out after 30 seconds waiting for the reply. A timeout does not mean the message was cancelled: check the app before retrying.

## Success criteria

1. The runtime lists the conversation already open in the app.
2. The probe receives a response from the selected session.
3. The original app conversation shows both the probe message and its response.
4. A follow-up in that same app conversation remembers the probe.

An SDK response alone does not prove live UI synchronization. This environment has no signed-in Copilot app session, so these live criteria have not been tested.

## Next increments

After connection validation, add agent-triggered launching and pass the endpoint and session identity explicitly. Then capture screen and microphone on a shared timeline, create timestamped transcript segments and frame references, and deliver a completed walkthrough. Incremental segment delivery follows after that. Keep segments portable even though only the Copilot adapter is in scope now.

## Validation performed

Four automated tests check explicit targeting, dry-run isolation, rejection of unknown sessions, and cleanup on failed delivery. SDK imports and API names were checked against the installed pinned package. Recording, transcription, app visibility, and concurrent attachment are not implemented or verified.

SDK reference: https://github.com/github/copilot-sdk/blob/main/nodejs/README.md
