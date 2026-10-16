# Copilot walkthrough: message handoff test

First test: supply an existing Copilot session ID and a message. The tool uses the pinned Copilot SDK to resume that session and send the message. You verify the result in the target client. No screen recording or audio capture yet.

## Install and test

Requires Node.js 22+, and Copilot authenticated on the same machine/account used by your target client.

```sh
git clone https://github.com/ejohane/copilot-walkthrough.git
cd copilot-walkthrough
npm ci
npm test
```

Copy a session ID from a disposable conversation in the Copilot app. Wait until that conversation is idle, then run:

```sh
node probe.mjs send --session YOUR_SESSION_ID --message "Message from walkthrough probe: BLUE_OTTER_742. Reply with that phrase. Do not use tools."
```

Or use the npm command:

```sh
npm run probe -- send --session YOUR_SESSION_ID --message "Hello from the walkthrough tool. Do not use tools."
```

Optional: `npm link` installs the `copilot-walkthrough` executable locally, with the same arguments.

Without `--url`, the SDK starts its bundled runtime and attempts to resume the supplied session from local Copilot storage. This is an experiment: CLI session access does not establish that SDK resume can access every app session, especially remote or differently stored sessions. The tool never calls createSession or falls back to a new conversation. It rejects transcript recovery and denies tool permission requests.

## Verify manually

1. Confirm the command prints the target session ID and an assistant reply.
2. Reopen the conversation in your target client. Restart the app if needed; live refresh is not required.
3. Confirm the exact message and reply appear in that conversation.
4. Ask the agent there what phrase it received, to verify continuity.

If the session cannot be found, capture the error. If the command times out after 30 seconds, check the conversation before retrying: the message may already have been sent. Do not run against a session currently doing work; SDK resume may interrupt pending work.

## Optional existing-runtime mode

The original endpoint-based probe remains available:

```sh
node probe.mjs list --url localhost:4321
node probe.mjs send --url localhost:4321 --session YOUR_SESSION_ID --message "Hello. Do not use tools."
```

Use a real runtime endpoint; the port above is illustrative. If needed, set `COPILOT_CONNECTION_TOKEN` in your environment.

## Status

Five mocked tests cover argument validation, dry-run isolation, exact session/message targeting, failure without replacement, and cleanup. The installed SDK API has been inspected. Live delivery to your app remains a manual test; automated tests do not establish app visibility.

[Vision and approach](docs/vision-and-approach.md) describes the broader recording concept. The immediate scope is only this text-message handoff; live feedback is deferred.
