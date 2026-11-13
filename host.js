import { createQuickSessionOperation, newRequest, RPC_CHANNEL, QuickSessionError } from './core.js';

export const inject = ['sessionController', 'connection', 'webServer', 'tools', 'sandboxPolicy'];

export function createRpcHandler(operation) {
  return async (endpoint, payload, signal, peer) => {
    // Private RPC channels are authenticated but do not apply Gateway RemoteAccess.
    if (peer?.principal?.kind !== 'owner') {
      return { ok: false, error: { code: 'quick-session/permission-denied', message: 'Only the owner may create a quick session.', details: {} } };
    }
    if (endpoint !== 'create') {
      return { ok: false, error: { code: 'quick-session/not-found', message: 'Unknown quick-session operation.', details: {} } };
    }
    try {
      return { ok: true, value: await operation.create(payload, { signal }) };
    } catch (error) {
      return { ok: false, error: {
        code: `quick-session/${error instanceof QuickSessionError ? error.code : 'create-failed'}`,
        message: error instanceof Error ? error.message : String(error), details: {},
      } };
    }
  };
}

// defineTool is supplied by the package entry so core/Host behavior can be tested
// without installing a duplicate Harness runtime in the development repository.
export function applyHost(ctx, config, defineTool) {
  ctx.effect(() => {
    const operation = createQuickSessionOperation({
      sessionController: ctx.sessionController, directoryRoot: config.directoryRoot,
    });
    const stopRpc = ctx.connection.rpc.handle(RPC_CHANNEL, createRpcHandler(operation));
    const stopTool = ctx.tools.register(defineTool({
      name: 'create_quick_session',
      description: 'Create an ordinary Agent session without a project, with a persistent working directory. Returns the session id and directory; does not open a view or send a prompt. Requires the caller’s existing full-access file policy.',
      parameters: {
        agent_preset: { type: 'string', description: 'Optional preset id. Omitted inherits the calling Agent’s preset, otherwise the native default.' },
      },
      output: {
        schema: {
          type: 'object', additionalProperties: false,
          properties: {
            sessionId: { type: 'string', required: true },
            cwd: { type: 'string', required: true },
            agentPreset: { type: 'string' },
          },
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      async execute(args, exec) {
        if (!exec.agent) throw new QuickSessionError('permission-denied', 'An Agent session is required.');
        const policy = ctx.sandboxPolicy.resolve({ session: exec.agent.session });
        const presets = ctx.get('agentPresets');
        const agentPreset = args.agent_preset ?? presets?.presetForSession(exec.agent.session) ?? undefined;
        return operation.create(newRequest(agentPreset), { signal: exec.signal, policy, fromAgent: true });
      },
    }));
    return async () => {
      stopTool();
      const draining = operation.dispose();
      try { await stopRpc(); } finally { await draining; }
      // Persistent user directories and native sessions deliberately remain.
    };
  }, 'quick-session: host operation, RPC, and Agent tool');
}
