// Run only through the installed Electron with ELECTRON_RUN_AS_NODE=1.
// This reads runtime libraries and uses mocked services; it does not activate the plugin.
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { resolve } = require('node:path');
const runtimeRequire = createRequire(process.argv[2]);
const SchemaModule = runtimeRequire('@deepseek-ai/schemastery');
const z = SchemaModule.default || SchemaModule;
const { defineTool } = runtimeRequire('@deepseek-ai/dsh-tools');
const { applyHost } = require('../host.js');
(async () => {
  const schema = z.object({ directoryRoot: z.string().default('').description('Directory root') });
  assert.equal(schema({}).directoryRoot, '');
  assert.throws(() => schema({ directoryRoot: 1 }));
  let cleanup, tool;
  const ctx = {
    sessionController: { create: async () => { throw new Error('Must not create a real native session in this test'); } },
    connection: { rpc: { handle: () => async () => {} } },
    tools: { register: value => { tool = value; return () => {}; } },
    sandboxPolicy: { resolve: () => ({ mode: 'workspace-write' }) },
    get: () => undefined,
    effect: callback => { cleanup = callback(); },
  };
  applyHost(ctx, { directoryRoot: resolve('.test-output', 'runtime-library-smoke') }, defineTool);
  assert.equal(tool.name, 'create_quick_session');
  await assert.rejects(tool.execute({}, { agent: { session: {} } }), /existing full-access/);
  await cleanup();
  console.log('Installed Schemastery and defineTool smoke checks passed; no profile activation or session creation.');
})().catch(error => { console.error(error); process.exitCode = 1; });
