#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

export function options(args) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
    url: { type: 'string' }, session: { type: 'string' },
    message: { type: 'string' }, 'dry-run': { type: 'boolean' }, help: { type: 'boolean' }
  }});
  const command = positionals[0] ?? 'help';
  if (values.help || command === 'help') return { command: 'help' };
  if (!['list', 'send'].includes(command)) throw new Error('Use list or send.');
  if (command === 'list' && !values.url) throw new Error('list requires --url.');
  if (command === 'send' && (!values.session || !values.message?.trim()))
    throw new Error('send requires --session and --message.');
  return { command, ...values };
}

export async function run(args, injectedSdk) {
  const config = options(args);
  if (config.command === 'help') {
    console.log('Copilot walkthrough connection probe\n\nnode probe.mjs list --url <runtime-endpoint>\nnode probe.mjs send --session <id> --message "Reply with WALKTHROUGH_OK"\n\nAdd --dry-run to validate without connecting. Without --url, the SDK starts a local runtime using your Copilot credentials and session storage. Optional --url connects to an existing runtime; COPILOT_CONNECTION_TOKEN supplies its authentication.');
    return;
  }
  if (config['dry-run']) {
    console.log(JSON.stringify({ command: config.command, endpoint: config.url, session: config.session, connects: false }, null, 2));
    return;
  }
  const { CopilotClient, RuntimeConnection } = injectedSdk ?? await import('@github/copilot-sdk');
  const client = new CopilotClient(config.url ? { connection: RuntimeConnection.forUri(config.url, {
    connectionToken: process.env.COPILOT_CONNECTION_TOKEN
  }) } : {});
  let session;
  try {
    await client.start();
    if (config.command === 'list') {
      const sessions = await client.listSessions();
      console.log(JSON.stringify(sessions, null, 2));
      return;
    }
    session = await client.resumeSession(config.session, {
      allowTranscriptRecovery: false,
      onPermissionRequest: () => ({ kind: 'denied-interactively-by-user' })
    });
    console.log(`Target session: ${session.sessionId ?? config.session}`);
    console.log('Sending probe. SDK receipt does not confirm visibility in the app.');
    const response = await session.sendAndWait({ prompt: config.message, mode: 'enqueue' }, 30000);
    console.log(response?.data?.content ?? 'Session became idle without a final assistant message.');
    console.log('Verify the message and response in the original app conversation.');
  } finally {
    try { if (session) await session.disconnect(); }
    finally { await client.stop(); }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(process.argv.slice(2)).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
