import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve, join } from 'node:path';
import { mkdir, stat } from 'node:fs/promises';
import { createQuickSessionOperation, validateRequest, resolveDirectoryRoot, requireAgentPermission, newRequest } from '../core.js';
import { createRpcHandler, applyHost } from '../host.js';

const root = resolve('.test-output', 'virtual');
const id = () => randomUUID();
function fixture({ create, capacity, unsafeDay = false, failMkdir = false } = {}) {
  const directories = new Set();
  const calls = [];
  const filesystem = {
    async mkdir(path, options) {
      if (failMkdir) throw Object.assign(new Error('write denied'), { code: 'EACCES' });
      if (directories.has(path) && !options.recursive) throw Object.assign(new Error('already exists'), { code: 'EEXIST' });
      directories.add(path);
    },
    async realpath(path) { return path; },
    async lstat() { return { isDirectory: () => true, isSymbolicLink: () => unsafeDay }; },
  };
  const operation = createQuickSessionOperation({
    directoryRoot: root, filesystem, capacity,
    now: () => new Date(2026, 10, 13, 22),
    sessionController: { async create(request) {
      calls.push(request);
      return create ? create(request) : { sessionId: `native-${calls.length}`, ...(request.agentPreset ? { agentPreset: request.agentPreset } : {}) };
    } },
  });
  return { operation, calls, directories };
}

test('creates an ordinary native session with only an absolute cwd', async () => {
  const f = fixture(); const requestId = id();
  const result = await f.operation.create({ requestId });
  assert.deepEqual(f.calls, [{ cwd: join(root, '2026-11-13', requestId) }]);
  assert.equal(result.sessionId, 'native-1'); assert.equal(result.cwd, f.calls[0].cwd);
  assert.ok(!('workspaceId' in f.calls[0])); assert.ok(!('sessionId' in f.calls[0]));
});

test('forwards an explicit preset without selecting a model or modifying permissions', async () => {
  const f = fixture(); const result = await f.operation.create(newRequest('coder'));
  assert.equal(result.agentPreset, 'coder');
  assert.deepEqual(Object.keys(f.calls[0]).sort(), ['agentPreset', 'cwd']);
});

test('different requests receive different persistent directories', async () => {
  const f = fixture();
  const [a, b] = await Promise.all([f.operation.create(newRequest()), f.operation.create(newRequest())]);
  assert.notEqual(a.cwd, b.cwd); assert.equal(f.calls.length, 2);
});

test('concurrent identical requests share one promise and one native creation', async () => {
  const f = fixture(); const request = newRequest();
  const a = f.operation.create(request); const b = f.operation.create(request);
  assert.equal(a, b); assert.deepEqual(await a, await b); assert.equal(f.calls.length, 1);
});

test('settled request retry returns the original session', async () => {
  const f = fixture(); const request = newRequest();
  const first = await f.operation.create(request);
  assert.deepEqual(await f.operation.create(request), first); assert.equal(f.calls.length, 1);
});

test('request ids are case-normalized', async () => {
  const f = fixture(); const request = newRequest();
  const first = await f.operation.create(request);
  assert.deepEqual(await f.operation.create({ requestId: request.requestId.toUpperCase() }), first);
});

test('same id with a different preset refuses without additional side effects', async () => {
  const f = fixture(); const request = newRequest('a'); await f.operation.create(request);
  await assert.rejects(f.operation.create({ ...request, agentPreset: 'b' }), /another preset/);
  assert.equal(f.calls.length, 1);
});

for (const value of [null, [], 'x', {}, { requestId: '../escape' }, { requestId: id(), cwd: root }, { requestId: id(), workspaceId: 'x' }, { requestId: id(), agentPreset: '' }, { requestId: id(), agentPreset: ' ' }, { requestId: id(), agentPreset: 1 }]) {
  test(`invalid request is rejected before writing: ${JSON.stringify(value)}`, async () => {
    const f = fixture(); await assert.rejects(f.operation.create(value));
    assert.equal(f.directories.size, 0); assert.equal(f.calls.length, 0);
  });
}

for (const value of ['relative', ' ', '\0', 12]) {
  test(`invalid directory root is rejected: ${JSON.stringify(value)}`, () => {
    assert.throws(() => resolveDirectoryRoot(value), /absolute directory/);
  });
}

test('default directory root is absolute and independent of the process project cwd', () => {
  assert.equal(resolveDirectoryRoot(''), resolveDirectoryRoot(undefined));
  assert.notEqual(resolveDirectoryRoot(''), process.cwd());
});

test('pre-aborted creation writes nothing', async () => {
  const f = fixture(); const controller = new AbortController(); controller.abort();
  await assert.rejects(f.operation.create(newRequest(), { signal: controller.signal }));
  assert.equal(f.directories.size, 0); assert.equal(f.calls.length, 0);
});

test('a linked date directory is rejected before leaf/session creation', async () => {
  const f = fixture({ unsafeDay: true });
  await assert.rejects(f.operation.create(newRequest()), /not a link/); assert.equal(f.calls.length, 0);
});

test('filesystem denial is not retried through another capability', async () => {
  const f = fixture({ failMkdir: true }); await assert.rejects(f.operation.create(newRequest()), /write denied/);
  assert.equal(f.calls.length, 0); assert.equal(f.directories.size, 0);
});

test('native creation failure preserves files and retains the failed request', async () => {
  const f = fixture({ create: async () => { throw new Error('preset unavailable'); } });
  const request = newRequest(); await assert.rejects(f.operation.create(request), /preset unavailable/);
  const size = f.directories.size; await assert.rejects(f.operation.create(request), /preset unavailable/);
  assert.equal(f.directories.size, size); assert.equal(f.calls.length, 1);
});

test('unload does not remove directories or sessions', async () => {
  const f = fixture(); await f.operation.create(newRequest()); const size = f.directories.size;
  f.operation.dispose(); assert.equal(f.directories.size, size); assert.equal(f.calls.length, 1);
});

test('too many pending requests fail closed without evicting active work', async () => {
  let finish; let creates = 0;
  const f = fixture({ capacity: 1, create: () => ++creates === 1
    ? new Promise(resolve => { finish = resolve; })
    : Promise.resolve({ sessionId: 'next-native' }) });
  const first = f.operation.create(newRequest());
  await assert.rejects(f.operation.create(newRequest()), /pending/);
  // Wait until the fake native controller receives the first request.
  for (let i = 0; i < 10 && !finish; i++) await Promise.resolve();
  finish({ sessionId: 'native' }); await first;
  assert.equal((await f.operation.create(newRequest())).sessionId, 'next-native');
});

for (const mode of ['read-only', 'workspace-write', undefined]) {
  test(`Agent cannot bypass its ${mode ?? 'missing'} policy`, async () => {
    assert.throws(() => requireAgentPermission({ mode }), /existing full-access/);
    const f = fixture();
    await assert.rejects(f.operation.create(newRequest(), { fromAgent: true, policy: { mode } }), /existing full-access/);
    assert.equal(f.directories.size, 0);
  });
}

test('existing full-access Agent policy allows the same Host operation', async () => {
  const f = fixture(); await f.operation.create(newRequest(), { fromAgent: true, policy: { mode: 'danger-full-access' } });
  assert.equal(f.calls.length, 1);
});

test('private RPC rejects missing/non-owner identity before invoking the operation', async () => {
  let called = 0; const handler = createRpcHandler({ create: async () => { called++; } });
  for (const peer of [undefined, { principal: { kind: 'api' } }, { principal: { kind: 'agent' } }]) {
    const result = await handler('create', newRequest(), undefined, peer);
    assert.equal(result.ok, false); assert.equal(result.error.code, 'quick-session/permission-denied');
  }
  assert.equal(called, 0);
});

test('private RPC rejects unknown endpoint without calling creation', async () => {
  let called = false; const handler = createRpcHandler({ create: async () => { called = true; } });
  assert.equal((await handler('delete', {}, undefined, { principal: { kind: 'owner' } })).ok, false);
  assert.equal(called, false);
});

test('owner RPC unwraps success and preserves native failure messages', async () => {
  const f = fixture(); const handler = createRpcHandler(f.operation); const owner = { principal: { kind: 'owner' } };
  const result = await handler('create', newRequest(), undefined, owner);
  assert.equal(result.ok, true); assert.equal(result.value.sessionId, 'native-1');
  const invalid = await handler('create', {}, undefined, owner);
  assert.equal(invalid.ok, false); assert.equal(invalid.error.code, 'quick-session/invalid-request');
});

test('Host registrations are removed on unload without directory deletion', async () => {
  let cleanup, tool, rpc, stoppedTool = 0, stoppedRpc = 0;
  const ctx = {
    sessionController: { create: async () => ({ sessionId: 'real-native' }) },
    connection: { rpc: { handle(channel, handler) { rpc = { channel, handler }; return async () => { stoppedRpc++; }; } } },
    tools: { register(definition) { tool = definition; return () => { stoppedTool++; }; } },
    sandboxPolicy: { resolve: () => ({ mode: 'workspace-write' }) },
    get: () => undefined,
    effect(fn) { cleanup = fn(); },
  };
  applyHost(ctx, { directoryRoot: resolve('.test-output', id()) }, definition => definition);
  assert.equal(rpc.channel, '/niannya-quick-session'); assert.equal(tool.name, 'create_quick_session');
  await assert.rejects(tool.execute({}, { agent: { session: {} } }), /existing full-access/);
  await assert.rejects(tool.execute({}, {}), /Agent session/);
  await cleanup(); assert.equal(stoppedTool, 1); assert.equal(stoppedRpc, 1);
});

test('real filesystem smoke test creates a persistent leaf under the repository test root', async () => {
  const testRoot = resolve('.test-output', id()); await mkdir(testRoot, { recursive: true });
  let nativeRequest;
  const operation = createQuickSessionOperation({ directoryRoot: testRoot, sessionController: {
    async create(request) { nativeRequest = request; return { sessionId: 'smoke-native' }; },
  } });
  const result = await operation.create(newRequest());
  assert.equal((await stat(result.cwd)).isDirectory(), true); assert.equal(nativeRequest.cwd, result.cwd);
  operation.dispose(); assert.equal((await stat(result.cwd)).isDirectory(), true);
  // Do not clean up: the plugin and its tests never delete user/test directories.
});
