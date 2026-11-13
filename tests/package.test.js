import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { PACKAGE_NAME } from '../constants.js';

const text = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('manifest targets the current DSH version and exports every runtime resource', async () => {
  const manifest = JSON.parse(await text('package.json'));
  assert.equal(manifest.name, PACKAGE_NAME); assert.equal(manifest.engines.dsh, '0.2.2-rc.3');
  assert.equal(manifest.private, true); assert.equal(manifest.dsh.client.platform, 'web');
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml');
  for (const path of ['index.js', 'host.js', 'core.js', 'constants.js', 'client.js', 'cordis.patch.yml', 'icon.svg', 'README.md']) {
    assert.ok(manifest.files.includes(path), `${path} not packed`);
    await access(new URL(`../${path}`, import.meta.url));
  }
  for (const locale of ['en', 'zh']) {
    const value = JSON.parse(await text(`locale/${locale}.json`));
    assert.ok(value.meta.title && value.meta.description);
  }
  assert.equal(manifest.exports['./icon'], './icon.svg');
  assert.equal(manifest.exports['./locale/*.json'], './locale/*.json');
  assert.ok(!Object.keys(manifest.scripts).some(key => ['preinstall', 'install', 'postinstall', 'prepare'].includes(key)));
});

test('Client registers a matching ModuleLoader id without importing Harness UI internals', async () => {
  const source = await text('client.js'); let registration;
  runInNewContext(source, { window: { __ModuleLoader__: { load: value => { registration = value; } } } });
  assert.equal(registration.id, PACKAGE_NAME); assert.equal(typeof registration.factory, 'function');
  assert.ok(!/require\(['"]@deepseek-ai\/dsh-client-/.test(source));
  assert.ok(!/host\.call|document\.querySelector|document\.body/.test(source));
  assert.ok(source.includes("ctx.uiWorkspace.openSession(result.value.sessionId)"));
  assert.ok(source.includes("ctx.slots.inject('sidebar.session.action'"));
  // This tests bundle registration/source contracts, not React rendering or visual behavior.
});
