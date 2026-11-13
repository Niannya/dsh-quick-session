import { mkdir, realpath, lstat } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';

export const RPC_CHANNEL = '/niannya-quick-session';
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const defaultDirectoryRoot = () => join(homedir(), 'Documents', 'DSH', 'QuickSessions');

export class QuickSessionError extends Error {
  constructor(code, message) { super(message); this.name = 'QuickSessionError'; this.code = code; }
}

export function validateRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new QuickSessionError('invalid-request', 'Expected a request object.');
  }
  if (Object.keys(value).some(key => !['requestId', 'agentPreset'].includes(key))) {
    throw new QuickSessionError('invalid-request', 'Unexpected request field.');
  }
  if (typeof value.requestId !== 'string' || !UUID_PATTERN.test(value.requestId)) {
    throw new QuickSessionError('invalid-request', 'requestId must be a version-4 UUID.');
  }
  if (value.agentPreset !== undefined && (typeof value.agentPreset !== 'string'
      || !value.agentPreset.trim() || value.agentPreset.length > 256)) {
    throw new QuickSessionError('invalid-request', 'agentPreset must be a nonempty preset id.');
  }
  return { requestId: value.requestId.toLowerCase(), agentPreset: value.agentPreset };
}

export function resolveDirectoryRoot(value) {
  const root = value === undefined || value === '' ? defaultDirectoryRoot() : value;
  if (typeof root !== 'string' || !root.trim() || root.includes('\0') || !isAbsolute(root)) {
    throw new QuickSessionError('invalid-directory-root', 'directoryRoot must be an absolute directory path.');
  }
  return root;
}

// Agent calls cannot turn creation of a new directory into a permission bypass.
// UI calls arrive separately through an authenticated owner-only RPC channel.
export function requireAgentPermission(policy) {
  if (policy?.mode !== 'danger-full-access') {
    throw new QuickSessionError('permission-denied',
      'Agent creation requires its existing full-access policy. Use the sidebar button instead; no permission is changed.');
  }
}

export function createQuickSessionOperation({ sessionController, directoryRoot,
  filesystem = { mkdir, realpath, lstat }, now = () => new Date(), capacity = 128 }) {
  const root = resolveDirectoryRoot(directoryRoot);
  const requests = new Map();
  const lifetime = new AbortController();
  let disposed = false;
  const abort = signal => signal.throwIfAborted();

  async function perform(request, signal) {
    abort(signal);
    await filesystem.mkdir(root, { recursive: true });
    abort(signal);
    const canonicalRoot = await filesystem.realpath(root);
    abort(signal);
    const date = now();
    const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const dayDirectory = join(canonicalRoot, day);
    await filesystem.mkdir(dayDirectory, { recursive: true });
    abort(signal);
    const dayInfo = await filesystem.lstat(dayDirectory);
    abort(signal);
    if (!dayInfo.isDirectory() || dayInfo.isSymbolicLink()) {
      throw new QuickSessionError('unsafe-directory', 'The date directory must be a real directory, not a link.');
    }
    const cwd = join(dayDirectory, request.requestId);
    // Exclusive creation: never reuse an unrelated or leftover directory.
    await filesystem.mkdir(cwd, { recursive: false });
    abort(signal);
    const canonicalCwd = await filesystem.realpath(cwd);
    abort(signal);
    const nativeRequest = { cwd: canonicalCwd };
    if (request.agentPreset !== undefined) nativeRequest.agentPreset = request.agentPreset;
    // No workspaceId, sessionId, model selection, permission override, or custom log records.
    const created = await sessionController.create(nativeRequest);
    return { ...created, cwd: canonicalCwd };
  }

  return {
    create(value, { signal, policy, fromAgent = false } = {}) {
      try {
        if (disposed) throw new QuickSessionError('disposed', 'The quick-session plugin is unloading.');
        if (fromAgent) requireAgentPermission(policy);
        const request = validateRequest(value);
        const combinedSignal = signal === undefined ? lifetime.signal : AbortSignal.any([signal, lifetime.signal]);
        abort(combinedSignal);
        const prior = requests.get(request.requestId);
        if (prior) {
          if (prior.agentPreset !== request.agentPreset) {
            throw new QuickSessionError('request-conflict', 'This requestId already belongs to another preset.');
          }
          return prior.promise;
        }
        if (requests.size >= capacity) {
          const oldestSettled = [...requests].find(([, entry]) => entry.settled);
          if (!oldestSettled) throw new QuickSessionError('busy', 'Too many creation requests are pending.');
          requests.delete(oldestSettled[0]);
        }
        const entry = { agentPreset: request.agentPreset, settled: false };
        entry.promise = perform(request, combinedSignal).finally(() => { entry.settled = true; });
        requests.set(request.requestId, entry);
        return entry.promise;
      } catch (error) { return Promise.reject(error); }
    },
    async dispose() {
      disposed = true;
      lifetime.abort(new QuickSessionError('disposed', 'The quick-session plugin is unloading.'));
      // Native create has no AbortSignal: drain its committed call before unload completes.
      await Promise.allSettled([...requests.values()].map(entry => entry.promise));
      requests.clear();
    },
  };
}

export function newRequest(agentPreset) {
  return { requestId: randomUUID(), ...(agentPreset === undefined ? {} : { agentPreset }) };
}
