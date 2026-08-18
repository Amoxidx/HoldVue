import assert from 'node:assert/strict';
import { basename } from 'node:path';
import vm from 'node:vm';
import { extractFile, listPackage } from '@electron/asar';

const archive = process.argv[2];
if (!archive) {
  console.error('usage: node scripts/smoke-package.mjs <app.asar>');
  process.exit(2);
}

const entries = listPackage(archive).map(entry => entry.replaceAll('\\', '/'));
assert.equal(entries.includes('/dist/preload.cjs'), true, 'packaged CommonJS preload is missing');
assert.equal(entries.includes('/dist/preload.js'), false, 'stale ESM preload must not be packaged');
assert.equal(entries.includes('/dist/renderer/index.html'), true, 'packaged renderer is missing');

const source = extractFile(archive, 'dist/preload.cjs').toString('utf8');
const invocations = [];
const listeners = new Map();
let exposedName = null;
let exposedApi = null;
const electron = {
  contextBridge: {
    exposeInMainWorld(name, value) {
      exposedName = name;
      exposedApi = value;
    }
  },
  ipcRenderer: {
    invoke(channel, ...args) {
      invocations.push([channel, ...args]);
      return Promise.resolve({ ok: true });
    },
    on(channel, callback) {
      listeners.set(channel, callback);
    },
    removeListener(channel, callback) {
      if (listeners.get(channel) === callback) listeners.delete(channel);
    }
  }
};
const moduleRef = { exports: {} };
const wrapper = new vm.Script(`(function (require, module, exports, process) { ${source}\n})`, { filename: 'preload.cjs' });
const execute = wrapper.runInNewContext({});
execute(name => {
  assert.equal(name, 'electron');
  return electron;
}, moduleRef, moduleRef.exports, { versions: { electron: 'package-smoke' } });

assert.equal(exposedName, 'holdvue');
assert.equal(typeof exposedApi?.getState, 'function');
assert.equal(typeof exposedApi?.addWallet, 'function');
assert.equal(typeof exposedApi?.searchInstruments, 'function');
assert.equal(typeof exposedApi?.updateSettings, 'function');
assert.equal(typeof exposedApi?.refresh, 'function');
await exposedApi.getState();
const dispose = exposedApi.onMinute(() => undefined);
assert.equal(listeners.has('holdvue:minute'), true);
dispose();
assert.equal(listeners.has('holdvue:minute'), false);
assert.deepEqual(invocations, [['holdvue:state']]);

console.log(JSON.stringify({ archive: basename(archive), preload: 'commonjs', bridge: exposedName, ipc: 'ok' }));
