import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { createQuickSessionOperation, newRequest } from '../core.js';

const root = resolve('.test-output', 'lifecycle-virtual');
const info = { isDirectory: () => true, isSymbolicLink: () => false };

test('unload cancels a pending directory operation before native creation', async () => {
  let release; let nativeCalls = 0;
  const operation = createQuickSessionOperation({ directoryRoot: root,
    filesystem: {
      mkdir: () => new Promise(resolve => { release = resolve; }),
      realpath: async path => path,
      lstat: async () => info,
    },
    sessionController: { create: async () => { nativeCalls++; return { sessionId: randomUUID() }; } },
  });
  const creation = operation.create(newRequest());
  const failed = assert.rejects(creation, /unloading/);
  const stopped = operation.dispose();
  await assert.rejects(operation.create(newRequest()), /unloading/);
  release();
  await Promise.all([failed, stopped]);
  assert.equal(nativeCalls, 0);
});

test('unload waits for native creation already committed before it completes', async () => {
  let finish; let drained = false;
  const operation = createQuickSessionOperation({ directoryRoot: root,
    filesystem: { mkdir: async () => {}, realpath: async path => path, lstat: async () => info },
    sessionController: { create: () => new Promise(resolve => { finish = resolve; }) },
  });
  const creation = operation.create(newRequest());
  for (let i = 0; i < 30 && !finish; i++) await Promise.resolve();
  assert.equal(typeof finish, 'function');
  const stopped = operation.dispose().then(() => { drained = true; });
  await Promise.resolve(); assert.equal(drained, false);
  finish({ sessionId: 'committed-session' });
  const [result] = await Promise.all([creation, stopped]);
  assert.equal(result.sessionId, 'committed-session'); assert.equal(drained, true);
});

test('caller cancellation after native commit does not delete a created session', async () => {
  const controller = new AbortController();
  const operation = createQuickSessionOperation({ directoryRoot: root,
    filesystem: { mkdir: async () => {}, realpath: async path => path, lstat: async () => info },
    sessionController: { create: async () => { controller.abort(); return { sessionId: 'completed' }; } },
  });
  assert.equal((await operation.create(newRequest(), { signal: controller.signal })).sessionId, 'completed');
  await operation.dispose();
});
