import test from 'node:test';
import assert from 'node:assert/strict';
import { options, run } from './probe.mjs';

test('requires an explicit runtime and target; never falls back to a fresh session', () => {
  assert.throws(() => options(['list']), /--url/);
  assert.throws(() => options(['send', '--url', 'localhost:4321']), /--session/);
});

test('dry run does not touch the SDK', async () => {
  await run(['list', '--url', 'localhost:4321', '--dry-run'], {});
});

test('unknown session is rejected and connection cleaned up', async () => {
  let stopped = false;
  const sdk = { RuntimeConnection: { forUri: () => ({}) }, CopilotClient: class {
    async start() {} async listSessions() { return []; }
    async resumeSession() { assert.fail('must not resume'); }
    async stop() { stopped = true; }
  }};
  await assert.rejects(run(['send', '--url', 'localhost:4321', '--session', 'missing', '--message', 'hello'], sdk), /not listed/);
  assert.equal(stopped, true);
});

test('sends to selected session and cleans up after a failed send', async () => {
  const calls = [];
  const sdk = { RuntimeConnection: { forUri: () => ({}) }, CopilotClient: class {
    async start() {} async listSessions() { return [{ sessionId: 'chosen' }]; }
    async resumeSession(id, config) {
      assert.equal(id, 'chosen');
      assert.equal(config.onPermissionRequest().kind, 'denied-interactively-by-user');
      return { async sendAndWait(message) { calls.push(message); throw new Error('offline'); },
        async disconnect() { calls.push('disconnect'); } };
    }
    async stop() { calls.push('stop'); }
  }};
  await assert.rejects(run(['send', '--url', 'localhost:4321', '--session', 'chosen', '--message', 'hello'], sdk), /offline/);
  assert.deepEqual(calls, [{ prompt: 'hello', mode: 'enqueue' }, 'disconnect', 'stop']);
});
