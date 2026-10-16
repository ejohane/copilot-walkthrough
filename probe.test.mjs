import test from 'node:test';
import assert from 'node:assert/strict';
import { options, run } from './probe.mjs';

test('send requires session and nonempty message; endpoint is optional', () => {
  assert.throws(() => options(['send']), /--session/);
  assert.throws(() => options(['send', '--session', 'chosen', '--message', ' ']), /--message/);
  assert.equal(options(['send', '--session', 'chosen', '--message', 'hello']).session, 'chosen');
});

test('dry run does not load or connect to SDK', async () => {
  await run(['send', '--session', 'chosen', '--message', 'hello', '--dry-run'], {});
});

function mockSdk(calls, { missing = false, failSend = false } = {}) {
  return {
    RuntimeConnection: { forUri: (uri) => ({ uri }) },
    CopilotClient: class {
      constructor(config) { calls.push(['client', config]); }
      async start() {}
      async resumeSession(id, config) {
        calls.push(['resume', id]);
        assert.equal(config.allowTranscriptRecovery, false);
        assert.equal(config.onPermissionRequest().kind, 'denied-interactively-by-user');
        if (missing) throw new Error('session not found');
        return {
          sessionId: id,
          async sendAndWait(message) {
            calls.push(['send', message]);
            if (failSend) throw new Error('timeout');
            return { data: { content: 'OK' } };
          },
          async disconnect() { calls.push('disconnect'); }
        };
      }
      async stop() { calls.push('stop'); }
    }
  };
}
const args = ['send', '--session', 'chosen', '--message', 'hello'];

test('local runtime resumes exact ID and sends exact message', async () => {
  const calls = [];
  await run(args, mockSdk(calls));
  assert.deepEqual(calls, [['client', {}], ['resume', 'chosen'],
    ['send', { prompt: 'hello', mode: 'enqueue' }], 'disconnect', 'stop']);
});

test('missing session fails without sending or creating a replacement', async () => {
  const calls = [];
  await assert.rejects(run(args, mockSdk(calls, { missing: true })), /not found/);
  assert.deepEqual(calls, [['client', {}], ['resume', 'chosen'], 'stop']);
});

test('send failure disconnects and stops external runtime connection', async () => {
  const calls = [];
  await assert.rejects(run([...args, '--url', 'localhost:4321'], mockSdk(calls, { failSend: true })), /timeout/);
  assert.deepEqual(calls[0], ['client', { connection: { uri: 'localhost:4321' } }]);
  assert.deepEqual(calls.slice(-2), ['disconnect', 'stop']);
});
