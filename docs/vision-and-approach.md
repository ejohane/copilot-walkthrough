# Vision and approach

Status: product direction and implementation handoff, October 16, 2026.

## Product vision

Let a person say “Let me show you” in an agent conversation, demonstrate something on their computer while explaining it aloud, and continue that same conversation with the agent understanding both what happened and what they meant.

A transcript and a final screenshot lose the progression of a demonstration. This product preserves the relationship between narration, screen state, and changes over time. It is useful for productivity and communication beyond software development.

The long-term product is harness agnostic. The initial implementation supports **GitHub Copilot only**. Keep the capture and walkthrough format independent of the Copilot integration, without building a speculative plugin framework.

## Primary use cases

- **Explain and critique:** draw or edit a design while describing decisions, then ask the agent for feedback.
- **Reproduce a bug:** demonstrate actions, expected behavior, and observed results so the agent can investigate.
- **Demonstrate a workflow:** show a process and explain its intent, then ask the agent to repeat it or help turn it into a skill.

Capturing a demonstration does not automatically establish a reliable automation. The agent must distinguish observed steps from inferred intent and validate any generated procedure.

## Intended user experience

1. The user is already talking with an agent in Copilot.
2. The user asks to demonstrate something, for example “Let me show you.”
3. The agent invokes a launcher or tool that opens a small capture interface associated with the requesting conversation.
4. The user selects a screen or window and microphone, grants capture permissions, and starts recording.
5. A small control offers recording status, elapsed time, pause/resume, finish, and cancel. The user continues working in other applications.
6. The tool captures screen and voice against one session-relative timeline.
7. Finishing makes the walkthrough available to the original conversation. The user continues with a request such as “Why did that fail?” or “Turn this into a skill.”

Review and trimming should be available, but an obligatory review workspace is not the main flow. Avoid requiring the user to manually locate the destination conversation after every recording.

The CLI is a possible launcher and integration surface, not a requirement that the user operate the recorder from a terminal. Packaging and operating-system support have not been selected.

## Scope and phases

### Milestone zero: prove the existing-session connection

This is the current engineering priority. Determine whether a separate process can communicate with the exact conversation already open in the intended Copilot interface.

Do not confuse these outcomes:

- Creating a new SDK conversation.
- Resuming persisted conversation state.
- Attaching to a running conversation and keeping its original UI synchronized.
- Delivering context while the agent is busy.
- Causing the agent to process that context and display a response.

Only the third outcome establishes the central live-session assumption. Record the exact Copilot surface, app/runtime/SDK versions, supported endpoint and authentication mechanism, and observed behavior. “Copilot app” remains ambiguous: establish whether the target is the desktop app, a CLI session, or a VS Code conversation. Success in one is not evidence for another.

Use a disposable conversation first. Verify:

1. The selected runtime exposes the existing conversation.
2. The external process sends a uniquely identifiable message to that conversation.
3. Both that message and its response appear in the original UI.
4. A follow-up from that UI retains the context.
5. Disconnecting the probe leaves the original conversation usable.
6. A repeat experiment establishes behavior while the original agent is active.

Do not silently start a separate runtime and report that as attachment to the user's app. If attachment is unsupported, document the concrete limitation and smallest viable alternative before changing the product interaction.

### Phase one: completed walkthrough

Capture screen and microphone, transcribe the narration with timestamps, select relevant frames, and correlate them on a shared timeline. Preserve the original recording so missed details can be recovered.

Deliver the completed walkthrough to Copilot after recording ends. End-to-end acceptance means the agent can answer a question that requires an intermediate screen state and its corresponding narration, rather than just the final image.

A user must be able to distinguish recording, processing, delivery, completion, and failure. If delivery fails, preserve the local capture and allow an explicit retry.

### Phase two: incremental delivery

Generate and deliver segments during recording so the agent accumulates context before the walkthrough ends. Approximately one-minute segments are an initial example, not a fixed requirement.

Send new segments, with limited explicit overlap where useful, rather than repeatedly sending the whole history. Deliver a final partial segment on finish. Keep sequence identifiers so gaps and retries are detectable.

Separate receiving context from reacting to it. Begin with quiet accumulation and a response when the user pauses or finishes. Interjections can follow once the harness supports them and the interaction has been tested.

## Suggested architecture

Keep responsibilities small and explicit:

- **Launcher and session binding:** open the recorder with an explicit destination binding. Do not assume an agent automatically knows its runtime endpoint or session ID; validate how these are obtained.
- **Capture:** collect screen and microphone, including pause/resume and track-ended behavior.
- **Processing:** produce timestamped transcript segments and frame selections.
- **Walkthrough storage:** retain the original recording, manifest, transcript, and frames locally.
- **Copilot adapter:** translate a walkthrough or new segments into supported Copilot messages and attachments, and report delivery state.
- **Capture UI:** provide user control and understandable status.

A separate recorder process is intentional. Its lifetime need not match one tool invocation. However, returning from a launcher, background execution, SDK session attachment, and unsolicited updates all depend on harness capabilities and require evidence.

Do not treat MCP as a guaranteed push channel into an existing conversation. Evaluate it only if its supported behavior meets a concrete integration need.

## Walkthrough data model

Use a versioned manifest and session-relative timestamps from a common clock. A proposed segment contains:

- Capture ID, segment ID, sequence number, start and end time.
- Transcript spans with start/end timestamps and their text.
- Frame references with capture timestamps and image dimensions.
- References back to original media.
- Completion state and any known missing media or transcription gaps.

Keep capture identity separate from the destination Copilot session identity. Frame/transcript associations should be inspectable, not only embedded in a generated prose summary.

Choose a simple frame-selection strategy first and evaluate it with real walkthroughs. Sparse frames can miss short-lived errors, clicks, cursor references, or animation. Preserve access to surrounding frames; do not claim the tool knows a click occurred from screenshots alone.

Decide whether pauses remain in elapsed time or are removed, then apply that convention consistently to media, transcript, and frames.

## Delivery and reliability

- Bind explicitly to the destination; do not guess from the most recently active session.
- Preserve ordered segments and identify retries by capture/segment ID.
- Do not assume the SDK provides exactly-once message delivery.
- A timeout is an unknown delivery outcome, not proof of cancellation. Avoid blind resending.
- Show “delivered” only for the acknowledgment actually available. UI visibility and agent processing are stronger, separate claims.
- Determine whether image attachments are supported by the chosen runtime and model. A text-only probe does not prove multimodal delivery.
- Treat recorded narration and on-screen text as captured content, not automatic authorization for executing actions.
- Keep recordings and credentials out of Git. Store captures locally by default; make any remote transcription or media upload an explicit, documented choice.

## Current repository state

The repository contains an initial Node.js connection probe, not a finished recorder:

- `probe.mjs`: connect to an explicitly supplied existing runtime, list sessions, select a listed session, and send an enqueued message.
- `probe.test.mjs`: four local tests covering explicit targeting, dry-run isolation, unknown-session rejection, and cleanup after failed delivery.
- `package.json` and lockfile: pinned `@github/copilot-sdk@1.0.22`.
- `README.md`: local setup, caveats, and integration success criteria.
- `.gitignore`: excludes dependencies, environment files, logs, and capture output.

The probe uses `RuntimeConnection.forUri`, `listSessions`, `resumeSession`, and `sendAndWait`. It denies permission requests and disconnects after the experiment. Validate whether registering and disconnecting these handlers affects another client attached to the same live session.

Four local tests passed. SDK imports and API names were checked against the installed package. **No live Copilot app connection, screen capture, transcription, frame correlation, or incremental delivery has been verified.**

## Instructions for the next Codex session

1. Read this document, the README, the probe, and any repository instructions. Run `npm ci` and `npm test`.
2. Establish the intended Copilot surface and obtain the actual supported runtime connection mechanism. Research current primary documentation and inspect the installed SDK; do not rely on assumptions from this conversation.
3. Run the milestone-zero experiment on a machine with the target Copilot surface available. If the environment lacks it, state that limitation and prepare the smallest local experiment without claiming live success.
4. Record the findings and next decision in this repository, including failed assumptions.
5. After the integration path is established, build the smallest completed-walkthrough vertical slice: launch, capture, transcribe, correlate, deliver, and ask a context-dependent question.
6. Add incremental delivery after that slice works. Keep changes small enough to test and review.

GitHub is the source of truth for sharing code between the user's machines and agent environments. Commit work to this repository rather than relying on downloadable ZIPs for ongoing collaboration.

## Open implementation choices

Resolve these as needed, without expanding the initial scope:

- Exact Copilot surface and live attachment mechanism.
- First supported operating system and capture UI packaging.
- Transcription provider, execution location, credentials, timestamp accuracy, and cost.
- Frame cadence/selection and attachment limits.
- How an agent invocation supplies a valid destination binding.
- Behavior when the destination is busy, disconnected, or closed.

The product direction is established; these technical choices remain open.

## Reference

- [GitHub Copilot SDK](https://github.com/github/copilot-sdk)
- [SDK Node.js reference](https://github.com/github/copilot-sdk/blob/main/nodejs/README.md)

Check references against the pinned package and target runtime before changing integration code.
