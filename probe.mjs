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
  if (!values.url) throw new Error('--url must identify the existing runtime; no new runtime is spawned.');
  if (command === 'send' && (!values.session || !values.message?.trim()))
    throw new Error('send requires --session and --message.');
  return { command, ...values };
}

export async function run(args, injectedSdk) {
  const config = options(args);
  if (config.command === 'help') {
    console.log('Copilot walkthrough connection probe\n\nnode probe.mjs list --url <runtime-endpoint>\nnode probe.mjs send --url <runtime-endpoint> --session <id> --message "Reply with WALKTHROUGH_OK"\n\nAdd --dry-run to validate without connecting. Optional COPILOT_CONNECTION_TOKEN supplies runtime authentication.');
    return;
  }
  if (config['dry-run']) {
    console.log(JSON.stringify({ command: config.command, endpoint: config.url, session: config.session, connects: false }, null, 2));
    return;
  }
  const { CopilotClient, RuntimeConnection } = injectedSdk ?? await import('@github/copilot-sdk');
  const client = new CopilotClient({ connection: RuntimeConnection.forUri(config.url, {
    connectionToken: process.env.COPILOT_CONNECTION_TOKEN
  }) });
  let session;
  try {
    await client.start();
    const sessions = await client.listSessions();
    if (config.command === 'list') {
      console.log(JSON.stringify(sessions, null, 2));
      return;
    }
    if (!sessions.some(s => s.sessionId === config.session))
      throw new Error('Requested session is not listed by this runtime. No message sent.');
    session = await client.resumeSession(config.session, {
      onPermissionRequest: () => ({ kind: 'denied-interactively-by-user' })
    });
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
