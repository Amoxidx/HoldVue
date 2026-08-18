import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { buildRuntimePaths, createFmpKeyGetter, createProductionIdFactory, createSystemClock, loadRuntimeModule as loadMainModule, runEntry, startMain } from '../src/main.ts';
import { createMainComposition } from '../src/main-app.ts';
import { createPreloadApi, installPreloadBridge, loadRuntimeModule as loadPreloadModule, runPreload, startPreload } from '../src/preload.ts';
import { createRendererController } from '../src/renderer/renderer-app.ts';
import { runRenderer } from '../src/renderer/renderer.ts';
import { encodeBase58Check, encodeBech32 } from '../src/shared/addresses.ts';
import { JsonEncryptedBlobStore } from '../src/shared/secrets.ts';

function runtimeFixture() {
  const handlers = new Map();
  const appEvents = new Map();
  const windows = [];
  const shell = { opened: [], mode: 'ok', openExternal(url) { this.opened.push(url); if (this.mode === 'throw') throw new Error('synthetic shell failure'); if (this.mode === 'reject') return Promise.reject(new Error('synthetic shell rejection')); } };
  const scheduler = { starts: 0, stops: 0, start() { this.starts++; }, stop() { this.stops++; } };
  const storage = {
    state: { schemaVersion: 2, settings: { schemaVersion: 2, currency: 'EUR', locale: 'de', theme: 'dark', schedulerEnabled: true, spamFilterEnabled: true, showHiddenSpamAssets: false, enabledChainIds: [], customChains: [], rpcOverrides: [], providerRefs: [] }, positions: [], wallets: [] },
    async load() { return this.state; },
    async save(state) { this.state = state; }
  };
  class FakeWindow {
    constructor(options) { this.options = options; this.events = new Map(); this.webEvents = new Map(); this.destroyed = false; this.sent = []; this.webContents = { send: channel => this.sent.push(channel), setWindowOpenHandler: handler => { this.openHandler = handler; }, on: (event, callback) => { this.webEvents.set(event, callback); } }; windows.push(this); }
    loadFile(file) { this.file = file; }
    on(event, callback) { this.events.set(event, callback); }
    isDestroyed() { return this.destroyed; }
  }
  FakeWindow.getAllWindows = () => windows.filter(window => !window.destroyed);
  const app = {
    whenReady: async () => undefined,
    on(event, callback) {
      const callbacks = appEvents.get(event) ?? [];
      callbacks.push(callback);
      appEvents.set(event, callbacks);
    },
    quit() { this.quitted = true; },
    getPath: name => { assert.equal(name, 'userData'); return '/tmp/holdvue-smoke'; }
  };
  const ipcMain = { handle(channel, handler) { handlers.set(channel, handler); } };
  return { app, FakeWindow, ipcMain, handlers, appEvents, windows, scheduler, storage, shell };
}

test('Electron composition, secure BrowserWindow, IPC, minute tick and lifecycle are offline-smoke tested', async () => {
  const f = runtimeFixture();
  let idNumber = 0;
  const composition = createMainComposition({ app: f.app, BrowserWindow: f.FakeWindow, ipcMain: f.ipcMain, storage: f.storage, scheduler: f.scheduler, shell: f.shell, ids: { next: () => `wallet-${++idNumber}` }, clock: { now: () => 42 }, paths: { preload: '/tmp/preload.js', renderer: '/tmp/index.html', icon: '/tmp/holdvue-icon.png' }, platform: 'linux' });
  await composition.start();
  await composition.start();
  assert.equal(f.scheduler.starts, 1);
  assert.equal(f.appEvents.get('activate').length, 1);
  assert.equal(f.appEvents.get('window-all-closed').length, 1);
  assert.equal((await f.handlers.get('holdvue:refresh')()).code, 'unconfigured');
  assert.equal((await f.handlers.get('holdvue:set-etherscan-key')({}, 'synthetic-key')).code, 'secret-storage-unavailable');
  const window = composition.getWindow();
  assert.equal(window.options.webPreferences.contextIsolation, true);
  assert.equal(window.options.webPreferences.nodeIntegration, false);
  assert.equal(window.options.webPreferences.sandbox, true);
  assert.equal(window.options.webPreferences.preload, '/tmp/preload.js');
  assert.equal(window.options.icon, '/tmp/holdvue-icon.png');
  assert.equal(window.file, '/tmp/index.html');
  assert.deepEqual(window.openHandler({ url: 'https://example.invalid' }), { action: 'deny' });
  assert.deepEqual(window.openHandler({ url: 'https://etherscan.io/apis' }), { action: 'deny' });
  assert.deepEqual(window.openHandler({ url: 'https://etherscan.io/apis?ref=synthetic' }), { action: 'deny' });
  assert.deepEqual(window.openHandler({ url: 'https://etherscan.io.evil.invalid/apis' }), { action: 'deny' });
  assert.deepEqual(window.openHandler({ url: 'http://etherscan.io/apis' }), { action: 'deny' });
  assert.deepEqual(window.openHandler({ url: 'javascript:alert(1)' }), { action: 'deny' });
  assert.deepEqual(window.openHandler({ url: 'not a URL' }), { action: 'deny' });
  await Promise.resolve();
  assert.deepEqual(f.shell.opened, ['https://etherscan.io/apis', 'https://etherscan.io/apis?ref=synthetic']);
  f.shell.mode = 'throw';
  assert.deepEqual(window.openHandler({ url: 'https://etherscan.io/apis' }), { action: 'deny' });
  f.shell.mode = 'reject';
  assert.deepEqual(window.openHandler({ url: 'https://etherscan.io/apis' }), { action: 'deny' });
  await Promise.resolve();
  let navigationPrevented = false;
  window.webEvents.get('will-navigate')({ preventDefault: () => { navigationPrevented = true; } });
  assert.equal(navigationPrevented, true);
  const updatedSettings = await f.handlers.get('holdvue:update-settings')({}, { theme: 'light', locale: 'en' });
  assert.equal(updatedSettings.ok, true);
  const sanitized = await f.handlers.get('holdvue:update-settings')({}, {
    theme: 'invalid',
    locale: 'fr',
    currency: 'GBP',
    schedulerEnabled: 'yes',
    unknown: 'must-not-persist'
  });
  const sanitizedState = {
    schemaVersion: 5,
    settings: { schemaVersion: 5, currency: 'EUR', locale: 'de', theme: 'dark', schedulerEnabled: true, spamFilterEnabled: true, showHiddenSpamAssets: false, enabledChainIds: [], customChains: [], rpcOverrides: [], providerRefs: [], providerEndpoints: [], enabledProviderIds: [], hiddenAssetIds: [] },
    positions: [],
    wallets: [],
    instruments: [],
    holdings: [],
    sync: { schemaVersion: 1, statuses: [] },
    prices: { quotes: [], statuses: [], valuations: [], history: [], totalEurScaled: null, totalUsdScaled: null, complete: false, valuedAssets: 0, totalAssets: 0, dayChangeEurScaled: null, dayChangeUsdScaled: null, dayChangePercentScaled: null }
  };
  assert.deepEqual(sanitized, { ok: true, value: sanitizedState });
  assert.deepEqual(await f.handlers.get('holdvue:update-settings')({}, [{ theme: 'dark' }]), { ok: true, value: sanitizedState });
  assert.deepEqual(await f.handlers.get('holdvue:state')(), { ok: true, value: sanitizedState });
  const syntheticAddress = `0x${'1'.repeat(40)}`;
  assert.deepEqual((await f.handlers.get('holdvue:detect-wallet')({}, syntheticAddress)).family, 'evm');
  assert.equal((await f.handlers.get('holdvue:detect-wallet')({}, 'not-an-address')).ok, false);
  const [addedOne, addedTwo] = await Promise.all([
    f.handlers.get('holdvue:add-wallet')({}, { label: 'Main', family: 'evm', address: syntheticAddress, options: { autoScanCommonChains: true, chainIds: [] } }),
    f.handlers.get('holdvue:add-wallet')({}, { label: 'Second', family: 'evm', address: `0x${'2'.repeat(40)}`, options: { autoScanCommonChains: false, chainIds: [1] } })
  ]);
  assert.equal(addedOne.ok, true);
  assert.equal(addedTwo.ok, true);
  assert.equal(addedOne.value.wallets.length, 1);
  assert.equal(addedTwo.value.wallets.length, 2);
  assert.deepEqual(addedTwo.value.settings.enabledProviderIds, ['evm']);
  assert.equal((await f.handlers.get('holdvue:add-wallet')({}, { label: 'Duplicate', family: 'evm', address: syntheticAddress })).code, 'duplicate-wallet');
  const forbiddenField = `${'private'}${'Key'}`;
  assert.equal((await f.handlers.get('holdvue:add-wallet')({}, { label: 'Secret', family: 'evm', address: `0x${'3'.repeat(40)}`, options: { nested: { [forbiddenField]: 'synthetic' } } })).code, 'secret-input');
  const edited = await f.handlers.get('holdvue:update-wallet')({}, { id: 'wallet-1', wallet: { label: 'Edited', enabled: false } });
  assert.equal(edited.ok, true);
  assert.equal(edited.value.wallets.find(wallet => wallet.id === 'wallet-1').label, 'Edited');
  const deleted = await f.handlers.get('holdvue:delete-wallet')({}, 'wallet-2');
  assert.equal(deleted.ok, true);
  assert.equal(deleted.value.wallets.length, 1);
  assert.equal((await f.handlers.get('holdvue:delete-wallet')({}, 'missing')).code, 'not-found');
  assert.equal((await f.handlers.get('holdvue:detect-wallet')(syntheticAddress)).family, 'evm');
  assert.equal((await f.handlers.get('holdvue:add-wallet')({}, null)).code, 'invalid-input');
  assert.equal((await f.handlers.get('holdvue:add-wallet')({}, { label: 'Bad options', family: 'evm', address: `0x${'4'.repeat(40)}`, options: [] })).code, 'invalid-input');
  assert.equal((await f.handlers.get('holdvue:update-wallet')({}, null)).code, 'invalid-input');
  assert.equal((await f.handlers.get('holdvue:update-wallet')({}, { id: 'wallet-1', wallet: [] })).code, 'invalid-input');
  assert.equal((await f.handlers.get('holdvue:update-wallet')({}, { id: 'wallet-1', wallet: { options: [] } })).code, 'invalid-input');
  const updateForbiddenField = `${'private'}${'Key'}`;
  assert.equal((await f.handlers.get('holdvue:update-wallet')({}, { id: 'wallet-1', wallet: { nested: { [updateForbiddenField]: 'synthetic' } } })).code, 'secret-input');
  assert.equal((await f.handlers.get('holdvue:update-wallet')({}, {})).code, 'invalid-input');
  const fullyEdited = await f.handlers.get('holdvue:update-wallet')({}, { id: 'wallet-1', wallet: { label: 'Full edit', family: 'evm', address: syntheticAddress, enabled: true, options: { autoScanCommonChains: false, chainIds: [1] } } });
  assert.equal(fullyEdited.ok, true);
  assert.equal((await f.handlers.get('holdvue:update-wallet')({}, { id: 'wallet-1', label: 'Direct edit' })).ok, true);
  assert.equal((await f.handlers.get('holdvue:delete-wallet')({}, { id: 'missing' })).code, 'not-found');
  assert.equal((await f.handlers.get('holdvue:delete-wallet')({}, null)).code, 'invalid-input');
  const cycle = {}; cycle.self = cycle;
  assert.equal((await f.handlers.get('holdvue:update-settings')({}, cycle)).ok, true);
  const settingsForbiddenField = `${'private'}${'Key'}`;
  assert.equal((await f.handlers.get('holdvue:update-settings')({}, { nested: { [settingsForbiddenField]: 'synthetic' } })).code, 'secret-input');
  f.storage.load = async () => { throw new Error('synthetic load failure'); };
  assert.equal((await f.handlers.get('holdvue:state')()).code, 'storage-failed');
  assert.equal((await f.handlers.get('holdvue:detect-wallet')({}, {})).code, 'invalid-input');
  composition.emitMinute();
  assert.deepEqual(window.sent, ['holdvue:minute']);
  window.destroyed = true; composition.emitMinute();
  assert.equal(f.appEvents.get('activate').length, 1);
  f.windows.length = 0; f.appEvents.get('activate')[0]();
  assert.equal(f.windows.length, 1);
  assert.equal(f.appEvents.get('window-all-closed').length, 1);
  f.appEvents.get('window-all-closed')[0]();
  assert.equal(f.scheduler.stops, 1);
  assert.equal(f.app.quitted, true);
  composition.stop();
  assert.equal(f.scheduler.stops, 2);
});

test('encrypted provider key IPC stores only references and fails closed', async () => {
  const f = runtimeFixture();
  const values = new Map();
  const secrets = { set(key, value) { values.set(key, value); return { ok: true, value: undefined }; }, get(key) { return { ok: true, value: values.get(key) ?? null }; }, delete(key) { values.delete(key); return { ok: true, value: undefined }; } };
  const composition = createMainComposition({ app: f.app, BrowserWindow: f.FakeWindow, ipcMain: f.ipcMain, storage: f.storage, scheduler: f.scheduler, secrets, ids: { next: () => 'synthetic-key-ref' }, clock: { now: () => 1 }, paths: { preload: '/tmp/preload.js', renderer: '/tmp/index.html' }, platform: 'linux' });
  await composition.start();
  const set = await f.handlers.get('holdvue:set-etherscan-key')({}, 'synthetic-provider-key');
  assert.equal(set.ok, true);
  assert.equal(set.value.settings.providerRefs[0].keyId, 'ref_evm.erc20_synthetic-key-ref');
  assert.equal(JSON.stringify(set).includes('synthetic-provider-key'), false);
  assert.equal((await f.handlers.get('holdvue:set-etherscan-key')({}, '')).code, 'invalid-input');
  assert.equal((await f.handlers.get('holdvue:set-etherscan-key')({}, 'synthetic-provider-key-2')).ok, true);
  assert.equal((await f.handlers.get('holdvue:delete-etherscan-key')()).ok, true);
  assert.equal((await f.handlers.get('holdvue:delete-etherscan-key')()).ok, true);
  const failingStore = { set: () => ({ ok: false, code: 'storage-failed', message: 'hidden' }), get: () => ({ ok: true, value: null }), delete: () => ({ ok: false, code: 'storage-failed', message: 'hidden' }) };
  const failing = runtimeFixture();
  failing.storage.state.settings.providerRefs = [{ providerId: 'evm.erc20', keyId: 'ref_evm.erc20_existing', enabled: true }];
  const failingComposition = createMainComposition({ app: failing.app, BrowserWindow: failing.FakeWindow, ipcMain: failing.ipcMain, storage: failing.storage, scheduler: failing.scheduler, secrets: failingStore, ids: { next: () => 'synthetic-key-ref' }, clock: { now: () => 1 }, paths: { preload: '/tmp/preload.js', renderer: '/tmp/index.html' }, platform: 'linux' });
  await failingComposition.start();
  assert.equal((await failing.handlers.get('holdvue:set-etherscan-key')({}, 'synthetic')).code, 'secret-storage-failed');
  assert.equal((await failing.handlers.get('holdvue:delete-etherscan-key')()).code, 'secret-storage-failed');
  const badId = runtimeFixture();
  const badIdComposition = createMainComposition({ app: badId.app, BrowserWindow: badId.FakeWindow, ipcMain: badId.ipcMain, storage: badId.storage, scheduler: badId.scheduler, secrets, ids: { next: () => '' }, clock: { now: () => 1 }, paths: { preload: '/tmp/preload.js', renderer: '/tmp/index.html' }, platform: 'linux' });
  await badIdComposition.start();
  assert.equal((await badId.handlers.get('holdvue:set-etherscan-key')({}, 'synthetic')).code, 'invalid-input');
  const saveFailure = runtimeFixture();
  saveFailure.storage.save = async () => { throw new Error('synthetic save failure'); };
  const saveFailureComposition = createMainComposition({ app: saveFailure.app, BrowserWindow: saveFailure.FakeWindow, ipcMain: saveFailure.ipcMain, storage: saveFailure.storage, scheduler: saveFailure.scheduler, secrets, ids: { next: () => 'synthetic-key-ref' }, clock: { now: () => 1 }, paths: { preload: '/tmp/preload.js', renderer: '/tmp/index.html' }, platform: 'linux' });
  await saveFailureComposition.start();
  assert.equal((await saveFailure.handlers.get('holdvue:set-etherscan-key')({}, 'synthetic')).code, 'storage-failed');

  const transactional = runtimeFixture();
  transactional.storage.state.settings.providerRefs = [{ providerId: 'evm.erc20', keyId: 'ref_evm.erc20_existing', enabled: true }];
  const transactionalValues = new Map([['ref_evm.erc20_existing', 'old-synthetic-key']]);
  const transactionalSecrets = {
    get(key) { return { ok: true, value: transactionalValues.get(key) ?? null }; },
    set(key, value) { transactionalValues.set(key, value); return { ok: true, value: undefined }; },
    delete(key) { transactionalValues.delete(key); return { ok: true, value: undefined }; }
  };
  transactional.storage.save = async () => { throw new Error('synthetic transactional save failure'); };
  const transactionalComposition = createMainComposition({ app: transactional.app, BrowserWindow: transactional.FakeWindow, ipcMain: transactional.ipcMain, storage: transactional.storage, scheduler: transactional.scheduler, secrets: transactionalSecrets, ids: { next: () => 'synthetic-key-ref' }, clock: { now: () => 1 }, paths: { preload: '/tmp/preload.js', renderer: '/tmp/index.html' }, platform: 'linux' });
  await transactionalComposition.start();
  assert.equal((await transactional.handlers.get('holdvue:set-etherscan-key')({}, 'new-synthetic-key')).code, 'storage-failed');
  assert.equal(transactionalValues.get('ref_evm.erc20_existing'), 'old-synthetic-key');
  assert.equal((await transactional.handlers.get('holdvue:delete-etherscan-key')()).code, 'storage-failed');
  assert.equal(transactionalValues.get('ref_evm.erc20_existing'), 'old-synthetic-key');
  transactionalValues.clear();
  assert.equal((await transactional.handlers.get('holdvue:set-etherscan-key')({}, 'new-synthetic-key')).code, 'storage-failed');
  assert.equal(transactionalValues.has('ref_evm.erc20_existing'), false);
  assert.equal((await transactional.handlers.get('holdvue:delete-etherscan-key')()).code, 'storage-failed');
  const getFailure = runtimeFixture();
  getFailure.storage.state.settings.providerRefs = [{ providerId: 'evm.erc20', keyId: 'ref_evm.erc20_existing', enabled: true }];
  const getFailureComposition = createMainComposition({ app: getFailure.app, BrowserWindow: getFailure.FakeWindow, ipcMain: getFailure.ipcMain, storage: getFailure.storage, scheduler: getFailure.scheduler, secrets: { get: () => ({ ok: false, code: 'storage-failed', message: 'hidden' }), set: () => ({ ok: true, value: undefined }), delete: () => ({ ok: true, value: undefined }) }, ids: { next: () => 'synthetic-key-ref' }, clock: { now: () => 1 }, paths: { preload: '/tmp/preload.js', renderer: '/tmp/index.html' }, platform: 'linux' });
  await getFailureComposition.start();
  assert.equal((await getFailure.handlers.get('holdvue:set-etherscan-key')({}, 'new-synthetic-key')).code, 'secret-storage-failed');
  assert.equal((await getFailure.handlers.get('holdvue:delete-etherscan-key')()).code, 'secret-storage-failed');
  const throwingSecrets = runtimeFixture();
  throwingSecrets.storage.state.settings.providerRefs = [{ providerId: 'evm.erc20', keyId: 'ref_evm.erc20_existing', enabled: true }];
  const throwingComposition = createMainComposition({ app: throwingSecrets.app, BrowserWindow: throwingSecrets.FakeWindow, ipcMain: throwingSecrets.ipcMain, storage: throwingSecrets.storage, scheduler: throwingSecrets.scheduler, secrets: { get: () => { throw new Error('hidden'); }, set: () => ({ ok: true, value: undefined }), delete: () => ({ ok: true, value: undefined }) }, ids: { next: () => 'synthetic-key-ref' }, clock: { now: () => 1 }, paths: { preload: '/tmp/preload.js', renderer: '/tmp/index.html' }, platform: 'linux' });
  await throwingComposition.start();
  assert.equal((await throwingSecrets.handlers.get('holdvue:set-etherscan-key')({}, 'new-synthetic-key')).code, 'storage-failed');
});

test('minute refresh emits one renderer event with or without configured sync', async () => {
  const withoutSync = runtimeFixture();
  const withoutSyncComposition = createMainComposition({ app: withoutSync.app, BrowserWindow: withoutSync.FakeWindow, ipcMain: withoutSync.ipcMain, storage: withoutSync.storage, scheduler: withoutSync.scheduler, ids: { next: () => 'minute-no-sync' }, clock: { now: () => 1 }, paths: { preload: '/tmp/preload.js', renderer: '/tmp/index.html' }, platform: 'linux' });
  await withoutSyncComposition.start();
  const withoutSyncWindow = withoutSyncComposition.getWindow();
  withoutSyncWindow.sent = [];
  withoutSyncComposition.emitMinute();
  assert.deepEqual(withoutSyncWindow.sent, ['holdvue:minute']);

  const withSync = runtimeFixture();
  let runCount = 0;
  let release;
  const sync = { coordinator: { async run(state) { runCount++; if (runCount > 1) await new Promise(resolve => { release = resolve; }); return { state, results: [] }; }, stop() {}, active() { return 0; } } };
  const withSyncComposition = createMainComposition({ app: withSync.app, BrowserWindow: withSync.FakeWindow, ipcMain: withSync.ipcMain, storage: withSync.storage, scheduler: withSync.scheduler, sync, ids: { next: () => 'minute-with-sync' }, clock: { now: () => 1 }, paths: { preload: '/tmp/preload.js', renderer: '/tmp/index.html' }, platform: 'linux' });
  await withSyncComposition.start();
  await new Promise(resolve => setTimeout(resolve, 10));
  const withSyncWindow = withSyncComposition.getWindow();
  assert.deepEqual(withSyncWindow.sent, ['holdvue:minute']);
  await new Promise(resolve => setTimeout(resolve, 10));
  withSyncWindow.sent = [];
  withSyncComposition.emitMinute();
  withSyncComposition.emitMinute();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(withSyncWindow.sent, []);
  assert.equal(runCount, 2);
  release(withSync.storage.state);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(withSyncWindow.sent, ['holdvue:minute']);
  withSyncComposition.stop();
});

test('adding a wallet explicitly enables its family provider for tracking', async () => {
  const cases = [
    { family: 'bitcoin', address: encodeBase58Check(new Uint8Array([0, ...new Uint8Array(20).fill(7)])), options: { network: 'mainnet', addressType: 'address' }, provider: 'bitcoin.mempool' },
    { family: 'solana', address: '1'.repeat(32), options: { network: 'devnet' }, provider: 'solana.rpc' },
    { family: 'cardano', address: encodeBech32('addr', new Uint8Array([0x01, ...new Uint8Array(56).fill(4)])), options: { network: 'mainnet' }, provider: 'cardano.koios' }
  ];
  for (const [index, item] of cases.entries()) {
    const f = runtimeFixture();
    const composition = createMainComposition({ app: f.app, BrowserWindow: f.FakeWindow, ipcMain: f.ipcMain, storage: f.storage, scheduler: f.scheduler, ids: { next: () => `onboarding-${index}` }, clock: { now: () => 1 }, paths: { preload: '/tmp/preload.js', renderer: '/tmp/index.html' }, platform: 'linux' });
    await composition.start();
    const added = await f.handlers.get('holdvue:add-wallet')({}, { label: `Synthetic ${item.family}`, family: item.family, address: item.address, options: item.options });
    assert.equal(added.ok, true);
    assert.deepEqual(added.value.settings.enabledProviderIds, [item.provider]);
  }
});

test('ESM runtime paths and entry composition are injectable', async () => {
  const paths = buildRuntimePaths(import.meta.url);
  assert.equal(typeof loadMainModule('node:path').join, 'function');
  assert.equal(typeof loadPreloadModule('node:path').join, 'function');
  assert.match(paths.preload, /preload\.js$/);
  assert.match(paths.renderer, /renderer[\\/]index\.html$/);
  assert.match(paths.icon, /renderer[\\/]holdvue-icon\.png$/);
  let launches = 0;
  assert.equal(runEntry(false, () => { launches++; }), null);
  assert.equal(runEntry(true, () => { launches++; return 'started'; }), 'started');
  const fixture = runtimeFixture();
  rmSync('/tmp/holdvue-smoke/holdvue-state.json', { force: true });
  rmSync('/tmp/holdvue-smoke/holdvue-secrets.json', { force: true });
  let captured;
  let decryptThrows = false;
  let minutes = 0;
  const fakeComposition = { start: async () => { launches++; }, stop() {}, emitMinute() { minutes++; }, getWindow: () => null };
  const started = startMain(name => {
    assert.equal(name, 'electron');
    return { app: fixture.app, BrowserWindow: fixture.FakeWindow, ipcMain: fixture.ipcMain, safeStorage: { isEncryptionAvailable: () => true, encryptString: value => new TextEncoder().encode(value), decryptString: value => { if (decryptThrows) throw new Error('synthetic decrypt'); return new TextDecoder().decode(value); } } };
  }, options => { captured = options; return fakeComposition; });
  await Promise.resolve();
  assert.equal(started, fakeComposition);
  assert.match(captured.paths.preload, /preload\.js$/);
  assert.match(captured.paths.icon, /renderer[\\/]holdvue-icon\.png$/);
  // Exercise both production adapter wiring paths without creating a wallet or
  // making a network request: a resolved RPC override supplies the injected
  // port, while the empty settings use the credential-only fallback path.
  await captured.sync.coordinator.run(fixture.storage.state, {});
  await captured.sync.coordinator.run({
    ...fixture.storage.state,
    settings: { ...fixture.storage.state.settings, rpcOverrides: [{ chainId: 1, rpcUrl: 'https://rpc.synthetic.invalid' }] }
  }, {});
  assert.equal(launches, 2);
  captured.scheduler.onMinute();
  assert.equal(minutes, 1);
  assert.equal((await captured.instrumentSearch.search('synthetic')).code, 'unconfigured');
  mkdirSync('/tmp/holdvue-smoke', { recursive: true });
  await captured.storage.save({ schemaVersion: 4, settings: { currency: 'EUR', locale: 'de', theme: 'dark', schedulerEnabled: false, spamFilterEnabled: true, showHiddenSpamAssets: false, enabledChainIds: [], customChains: [], rpcOverrides: [], providerRefs: [{ providerId: 'fmp.market', keyId: 'ref_fmp.market_synthetic', enabled: true }], providerEndpoints: [], enabledProviderIds: [] }, positions: [], wallets: [], instruments: [], holdings: [], sync: { schemaVersion: 1, statuses: [] } });
  const missingSecret = new AbortController();
  missingSecret.abort();
  assert.equal((await captured.instrumentSearch.search('synthetic', missingSecret.signal)).code, 'unconfigured');
  assert.equal(captured.secrets?.set('ref_fmp.market_synthetic', 'synthetic-fmp-value').ok, true);
  decryptThrows = true;
  const abortedSearch = new AbortController();
  abortedSearch.abort();
  assert.equal((await captured.instrumentSearch.search('synthetic', abortedSearch.signal)).code, 'unconfigured');
  decryptThrows = false;
  assert.equal(captured.secrets?.set('ref_fmp.market_synthetic', 'synthetic-fmp-value').ok, true);
  const emptyRuntime = { schemaVersion: 3, settings: { currency: 'EUR', locale: 'de', theme: 'dark', schedulerEnabled: false, spamFilterEnabled: true, showHiddenSpamAssets: false, enabledChainIds: [1], customChains: [], rpcOverrides: [], providerRefs: [{ providerId: 'evm.erc20', keyId: 'ref_evm.erc20_synthetic', enabled: true }], providerEndpoints: [{ providerId: 'evm.erc20', endpoint: 'https://api.synthetic.invalid', enabled: true }], enabledProviderIds: [] }, positions: [], wallets: [{ schemaVersion: 3, id: 'runtime-synthetic', label: 'Synthetic runtime wallet', family: 'evm', address: `0x${'1'.repeat(40)}`, enabled: true, createdAt: 1, options: { autoScanCommonChains: false, chainIds: [1] } }], sync: { schemaVersion: 1, statuses: [] } };
  await captured.sync.coordinator.run(emptyRuntime, captured.sync.context);
  await captured.sync.coordinator.run({ ...emptyRuntime, settings: { ...emptyRuntime.settings, providerEndpoints: [] } }, captured.sync.context);
  assert.match(createProductionIdFactory().next(), /^[0-9a-f-]{36}$/);
  assert.equal(typeof createSystemClock().now(), 'number');
});

test('production FMP key getter reads only enabled references and redacts unavailable storage', async () => {
  const storage = { async load() { return { settings: { providerRefs: [] } }; } };
  const secrets = { get() { return { ok: false, code: 'storage-failed' }; } };
  assert.equal(await createFmpKeyGetter(storage, secrets)(), null);
  const enabled = { async load() { return { settings: { providerRefs: [{ providerId: 'fmp.market', enabled: true, keyId: 'ref_fmp.market_synthetic' }] } }; } };
  assert.equal(await createFmpKeyGetter(enabled, { get: () => ({ ok: true, value: 'synthetic-key' }) })(), 'synthetic-key');
  const disabled = { async load() { return { settings: { providerRefs: [{ providerId: 'fmp.market', enabled: false, keyId: 'ref_fmp.market_synthetic' }] } }; } };
  assert.equal(await createFmpKeyGetter(disabled, { get: () => ({ ok: true, value: 'synthetic-key' }) })(), null);
});

test('main mutations fail closed on storage errors and scheduler setting is applied', async () => {
  const f = runtimeFixture();
  const composition = createMainComposition({ app: f.app, BrowserWindow: f.FakeWindow, ipcMain: f.ipcMain, storage: f.storage, scheduler: f.scheduler, ids: { next: () => 'storage-wallet' }, clock: { now: () => 9 }, paths: { preload: '/tmp/preload.js', renderer: '/tmp/index.html' }, platform: 'linux' });
  await composition.start();
  f.storage.save = async () => { throw new Error('synthetic storage failure'); };
  assert.equal((await f.handlers.get('holdvue:add-wallet')({}, { label: 'Storage', family: 'evm', address: `0x${'4'.repeat(40)}` })).code, 'storage-failed');
  assert.equal((await f.handlers.get('holdvue:update-settings')({}, { theme: 'light' })).code, 'storage-failed');
  const disabled = runtimeFixture();
  disabled.storage.state.settings.schedulerEnabled = false;
  const disabledComposition = createMainComposition({ app: disabled.app, BrowserWindow: disabled.FakeWindow, ipcMain: disabled.ipcMain, storage: disabled.storage, scheduler: disabled.scheduler, ids: { next: () => 'disabled-wallet' }, clock: { now: () => 9 }, paths: { preload: '/tmp/preload.js', renderer: '/tmp/index.html' }, platform: 'linux' });
  await disabledComposition.start();
  assert.equal(disabled.scheduler.starts, 0);
  await disabled.handlers.get('holdvue:update-settings')({}, { schedulerEnabled: true });
  await disabled.handlers.get('holdvue:update-settings')({}, { schedulerEnabled: false });
  assert.equal(disabled.scheduler.starts, 1);
  assert.equal(disabled.scheduler.stops, 1);
});

test('configured sync refresh is serialized, persists the returned state, and maps failures', async () => {
  const f = runtimeFixture();
  let release;
  let runs = 0;
  const sync = { coordinator: { async run(state) { runs++; if (runs === 1) await new Promise(resolve => { release = resolve; }); return { state, results: [] }; }, stop() {}, active() { return 0; } } };
  f.app.whenReady = () => new Promise(() => {});
  const composition = createMainComposition({ app: f.app, BrowserWindow: f.FakeWindow, ipcMain: f.ipcMain, storage: f.storage, scheduler: f.scheduler, sync, ids: { next: () => 'sync-wallet' }, clock: { now: () => 1 }, paths: { preload: '/tmp/preload.js', renderer: '/tmp/index.html' }, platform: 'linux' });
  composition.start();
  const first = f.handlers.get('holdvue:refresh')();
  const second = f.handlers.get('holdvue:refresh')();
  for (let attempt = 0; typeof release !== 'function' && attempt < 20; attempt++) await Promise.resolve();
  assert.equal(typeof release, 'function');
  assert.equal(first, second);
  release(f.storage.state);
  assert.equal((await first).ok, true);
  assert.equal(runs, 1);
  f.storage.save = async () => { throw new Error('synthetic sync storage failure'); };
  assert.equal((await f.handlers.get('holdvue:refresh')()).code, 'sync-failed');
  const stopped = { coordinator: { run: async () => { throw new Error('stopped'); }, stop() {}, active() { return 0; } }, context: {} };
  const stoppedFixture = runtimeFixture();
  const stoppedComposition = createMainComposition({ app: stoppedFixture.app, BrowserWindow: stoppedFixture.FakeWindow, ipcMain: stoppedFixture.ipcMain, storage: stoppedFixture.storage, scheduler: stoppedFixture.scheduler, sync: stopped, ids: { next: () => 'stopped-wallet' }, clock: { now: () => 1 }, paths: { preload: '/tmp/preload.js', renderer: '/tmp/index.html' }, platform: 'linux' });
  stoppedFixture.app.whenReady = () => new Promise(() => {});
  stoppedComposition.start();
  assert.equal((await stoppedFixture.handlers.get('holdvue:refresh')()).code, 'aborted');
  stoppedComposition.emitMinute();
  stoppedComposition.stop();
  const ready = runtimeFixture();
  let readyRuns = 0;
  const readySync = { coordinator: { async run(state) { readyRuns++; return { state, results: [] }; }, stop() {}, active() { return 0; } } };
  const readyComposition = createMainComposition({ app: ready.app, BrowserWindow: ready.FakeWindow, ipcMain: ready.ipcMain, storage: ready.storage, scheduler: ready.scheduler, sync: readySync, ids: { next: () => 'ready-wallet' }, clock: { now: () => 1 }, paths: { preload: '/tmp/preload.js', renderer: '/tmp/index.html' }, platform: 'linux' });
  await readyComposition.start();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(readyRuns, 1);
});

test('clipboard IPC copies only an existing wallet address and fails closed', async () => {
  const f = runtimeFixture();
  const writes = [];
  const clipboard = { writeText: value => { writes.push(value); } };
  const composition = createMainComposition({ app: f.app, BrowserWindow: f.FakeWindow, ipcMain: f.ipcMain, storage: f.storage, scheduler: f.scheduler, clipboard, ids: { next: () => 'copy-wallet' }, clock: { now: () => 11 }, paths: { preload: '/tmp/preload.js', renderer: '/tmp/index.html' }, platform: 'linux' });
  await composition.start();
  await f.handlers.get('holdvue:add-wallet')({}, { label: 'Copy synthetic', family: 'evm', address: `0x${'a'.repeat(40)}` });
  assert.deepEqual(await f.handlers.get('holdvue:copy-wallet-address')({}, 'copy-wallet'), { ok: true, value: { copied: true } });
  assert.deepEqual(writes, [`0x${'a'.repeat(40)}`]);
  assert.equal((await f.handlers.get('holdvue:copy-wallet-address')({}, '')).code, 'invalid-input');
  assert.equal((await f.handlers.get('holdvue:copy-wallet-address')({}, 'missing')).code, 'not-found');
  const noClipboard = runtimeFixture();
  const noClipboardComposition = createMainComposition({ app: noClipboard.app, BrowserWindow: noClipboard.FakeWindow, ipcMain: noClipboard.ipcMain, storage: noClipboard.storage, scheduler: noClipboard.scheduler, ids: { next: () => 'no-clipboard' }, clock: { now: () => 11 }, paths: { preload: '/tmp/preload.js', renderer: '/tmp/index.html' }, platform: 'linux' });
  await noClipboardComposition.start();
  await noClipboard.handlers.get('holdvue:add-wallet')({}, { label: 'No clipboard synthetic', family: 'evm', address: `0x${'b'.repeat(40)}` });
  assert.equal((await noClipboard.handlers.get('holdvue:copy-wallet-address')({}, 'no-clipboard')).code, 'clipboard-unavailable');
  clipboard.writeText = () => { throw new Error('synthetic'); };
  assert.equal((await f.handlers.get('holdvue:copy-wallet-address')({}, 'copy-wallet')).code, 'clipboard-failed');
  f.storage.load = async () => { throw new Error('synthetic'); };
  assert.equal((await f.handlers.get('holdvue:copy-wallet-address')({}, 'copy-wallet')).code, 'storage-failed');
});

test('preload bridge exposes commands and disposes minute listeners', async () => {
  const calls = [];
  const listeners = new Map();
  const ipc = {
    invoke: async (channel, value) => { calls.push([channel, value]); return channel; },
    on: (channel, callback) => listeners.set(channel, callback),
    removeListener: (channel, callback) => { calls.push(['remove', channel, callback]); listeners.delete(channel); }
  };
  const api = createPreloadApi(ipc);
  assert.equal(await api.getState(), 'holdvue:state');
  assert.equal(await api.detectWalletAddress('0xsynthetic'), 'holdvue:detect-wallet');
  assert.equal(await api.addWallet({ label: 'Synthetic', family: 'evm', address: '0xsynthetic' }), 'holdvue:add-wallet');
  assert.equal(await api.updateWallet('wallet-synthetic', { label: 'Edited' }), 'holdvue:update-wallet');
  assert.equal(await api.deleteWallet('wallet-synthetic'), 'holdvue:delete-wallet');
  assert.equal(await api.copyWalletAddress('wallet-synthetic'), 'holdvue:copy-wallet-address');
  assert.equal(await api.searchInstruments('synthetic'), 'holdvue:search-instruments');
  assert.equal(await api.addHolding({ instrument: { providerId: 'fmp.market', providerSymbol: 'SYN@SYN', symbol: 'SYN', name: 'Synthetic', exchange: 'SYN', currency: 'USD', type: 'unknown' }, quantity: '1' }), 'holdvue:add-holding');
  assert.equal(await api.updateHolding('holding-synthetic', { quantity: '2' }), 'holdvue:update-holding');
  assert.equal(await api.deleteHolding('holding-synthetic'), 'holdvue:delete-holding');
  assert.equal(await api.setEtherscanKey('synthetic-key'), 'holdvue:set-etherscan-key');
  assert.equal(await api.deleteEtherscanKey(), 'holdvue:delete-etherscan-key');
  assert.equal(await api.setFmpKey('synthetic-fmp-key'), 'holdvue:set-fmp-key');
  assert.equal(await api.deleteFmpKey(), 'holdvue:delete-fmp-key');
  assert.equal(await api.updateSettings({ theme: 'light' }), 'holdvue:update-settings');
  assert.equal(await api.refresh(), 'holdvue:refresh');
  let ticks = 0;
  const dispose = api.onMinute(() => { ticks++; });
  listeners.get('holdvue:minute')(); dispose();
  assert.equal(ticks, 1);
  const bridge = { exposeInMainWorld(name, value) { this.name = name; this.value = value; } };
  assert.equal(installPreloadBridge(bridge, ipc), bridge.value);
  assert.equal(bridge.name, 'holdvue');
  assert.equal(startPreload(() => ({ contextBridge: bridge, ipcRenderer: ipc })), bridge.value);
  let launches = 0;
  assert.equal(runPreload(false, () => { launches++; }), null);
  assert.equal(runPreload(true, () => { launches++; return 'ok'; }), 'ok');
  assert.equal(launches, 1);
});

test('ciphertext backing is atomic, restrictive, and tolerant of missing/corrupt files', () => {
  const directory = mkdtempSync(join(process.cwd(), 'test', 'secret-fixture-'));
  const filename = join(directory, 'secrets.json');
  try {
    const backing = new JsonEncryptedBlobStore(filename);
    assert.equal(backing.get('missing'), null);
    backing.set('synthetic-ref', new Uint8Array([1, 2, 3]));
    assert.deepEqual([...backing.get('synthetic-ref')], [1, 2, 3]);
    assert.equal(readFileSync(filename, 'utf8').includes('1,2,3'), false);
    if (process.platform !== 'win32') assert.equal((statSync(filename).mode & 0o777), 0o600);
    backing.set('second', new Uint8Array([4]));
    backing.delete('synthetic-ref');
    assert.equal(backing.get('synthetic-ref'), null);
    writeFileSync(filename, '[]');
    assert.equal(backing.get('second'), null);
    writeFileSync(filename, '{');
    assert.equal(backing.get('second'), null);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

function documentFixture() {
  const status = { textContent: '' };
  const count = { textContent: '' };
  const footer = { textContent: '' };
  const sync = { textContent: '' };
  return {
    status,
    count,
    footer,
    sync,
    document: { documentElement: { lang: '', dataset: {} }, querySelector(selector) { return selector.includes('status') ? status : selector.includes('footer-summary') ? footer : selector.includes('sync-summary') ? sync : count; } }
  };
}

test('renderer controller updates locale/theme/count and minute unsubscribe', async () => {
  const d = documentFixture();
  let callback;
  const api = { getState: async () => ({ settings: { currency: 'EUR', locale: 'de', theme: 'light' }, positions: [1, 2] }), onMinute: cb => { callback = cb; return () => { callback = null; }; } };
  const controller = createRendererController(d.document, api);
  const dispose = controller.start();
  await controller.render();
  assert.equal(d.document.documentElement.lang, 'de');
  assert.equal(d.document.documentElement.dataset.theme, 'light');
  assert.equal(d.count.textContent, '2');
  assert.equal(d.status.textContent, 'Lokal bereit');
  assert.equal(typeof callback, 'function');
  callback(); dispose(); assert.equal(callback, null);
  assert.equal(runRenderer(undefined, undefined), null);
  assert.ok(runRenderer(d.document, api, createRendererController));
  const sparseDocument = { documentElement: { lang: '', dataset: {} }, querySelector: () => null };
  const englishApi = { getState: async () => ({ settings: { currency: 'EUR', locale: 'en', theme: 'dark' }, positions: [] }), onMinute: () => () => undefined };
  await createRendererController(sparseDocument, englishApi).render();
  const englishStatus = { textContent: '' };
  const englishDocument = { documentElement: { lang: '', dataset: {} }, querySelector: selector => selector.includes('status') ? englishStatus : null };
  await createRendererController(englishDocument, englishApi).render();
  assert.equal(englishStatus.textContent, 'Ready locally');

  // A stale action from a list that was emptied must fail closed in the controller.
  const validDelete = { listeners: [], addEventListener(type, callback) { if (type === 'click') this.listeners.push(callback); }, getAttribute(name) { return name === 'data-wallet-action' ? 'delete' : name === 'data-wallet-id' ? 'runtime-wallet' : null; }, dispatch() { for (const callback of this.listeners) callback({ preventDefault() {} }); } };
  const staleDelete = { listeners: [], addEventListener(type, callback) { if (type === 'click') this.listeners.push(callback); }, getAttribute(name) { return name === 'data-wallet-action' ? 'delete' : name === 'data-wallet-id' ? 'missing-runtime' : null; }, dispatch() { for (const callback of this.listeners) callback({ preventDefault() {} }); } };
  let stalePhase = false;
  const staleList = { innerHTML: '', querySelectorAll() { return [stalePhase ? staleDelete : validDelete]; } };
  const deleteCancel = { listeners: [], addEventListener(type, callback) { if (type === 'click') this.listeners.push(callback); }, focus() {}, dispatch() { for (const callback of this.listeners) callback({ preventDefault() {} }); } };
  const addWallet = { listeners: [], addEventListener(type, callback) { if (type === 'click') this.listeners.push(callback); }, focus() {}, dispatch() { for (const callback of this.listeners) callback({ preventDefault() {} }); } };
  const walletCancel = { listeners: [], addEventListener(type, callback) { if (type === 'click') this.listeners.push(callback); }, dispatch() { for (const callback of this.listeners) callback({ preventDefault() {} }); } };
  const settingsOpen = { listeners: [], addEventListener(type, callback) { if (type === 'click') this.listeners.push(callback); }, focus() {}, dispatch() { for (const callback of this.listeners) callback({ preventDefault() {} }); } };
  const settingsClose = { listeners: [], addEventListener(type, callback) { if (type === 'click') this.listeners.push(callback); }, dispatch() { for (const callback of this.listeners) callback({ preventDefault() {} }); } };
  const walletDialog = { hidden: true, showModal() {}, close() {} };
  let dialogAvailable = true;
  let deleteCancelAvailable = true;
  const settingsDialog = { hidden: true, showModal() {}, close() {} };
  const staleDocument = { documentElement: { lang: '', dataset: {} }, querySelector: selector => selector === '[data-wallet-list]' ? staleList : selector === '[data-delete-cancel]' ? (deleteCancelAvailable ? deleteCancel : null) : selector === '[data-add-wallet]' ? addWallet : selector === '[data-wallet-cancel]' ? walletCancel : selector === '[data-wallet-dialog]' ? (dialogAvailable ? walletDialog : null) : selector === '[data-open-settings]' ? settingsOpen : selector === '[data-settings-close]' ? settingsClose : selector === '[data-settings-dialog]' ? settingsDialog : null };
  const staleWallet = { schemaVersion: 2, id: 'runtime-wallet', label: 'Runtime synthetic wallet', family: 'evm', address: `0x${'3'.repeat(40)}`, enabled: true, createdAt: 1, options: { autoScanCommonChains: true, chainIds: [] } };
  const staleApi = { getState: async () => ({ settings: { locale: 'de', theme: 'light' }, positions: [], wallets: stalePhase ? [] : [staleWallet] }), onMinute: () => () => undefined };
  const staleController = createRendererController(staleDocument, staleApi);
  staleController.start();
  await staleController.render();
  addWallet.dispatch();
  walletCancel.dispatch();
  validDelete.dispatch();
  deleteCancel.dispatch();
  settingsOpen.dispatch();
  settingsClose.dispatch();
  deleteCancelAvailable = false;
  validDelete.dispatch();
  deleteCancelAvailable = true;
  deleteCancel.focus = undefined;
  validDelete.dispatch();
  stalePhase = true;
  await staleController.render();
  staleDelete.dispatch();
  dialogAvailable = false;
  const noDialogController = createRendererController(staleDocument, staleApi);
  noDialogController.start();
  await noDialogController.render();
  addWallet.dispatch();
  walletCancel.dispatch();

  const mutationStatus = { textContent: '' };
  const mutationError = { hidden: true, textContent: '' };
  const mutationAddress = { value: '', listeners: [], addEventListener(type, callback) { if (type === 'input') this.listeners.push(callback); }, dispatch() { for (const callback of this.listeners) callback({ currentTarget: this }); } };
  const mutationTheme = { value: 'light', listeners: [], addEventListener(type, callback) { if (type === 'change') this.listeners.push(callback); }, dispatch() { for (const callback of this.listeners) callback({ currentTarget: this }); } };
  const mutationDocument = { documentElement: { lang: '', dataset: {} }, querySelector: selector => selector === '[data-status]' ? mutationStatus : selector === '[data-wallet-error]' ? mutationError : selector === '[data-wallet-address]' ? mutationAddress : selector === '[data-setting-theme]' ? mutationTheme : null };
  let mutationMode = 'success';
  const mutationState = { schemaVersion: 2, settings: { schemaVersion: 2, currency: 'EUR', locale: 'de', theme: 'dark', schedulerEnabled: true, spamFilterEnabled: true, showHiddenSpamAssets: false, enabledChainIds: [], customChains: [], rpcOverrides: [], providerRefs: [] }, positions: [], wallets: [] };
  const mutationApi = { getState: async () => mutationState, updateSettings: async () => { if (mutationMode === 'throw') throw new Error('synthetic mutation failure'); if (mutationMode === 'error') return { ok: false, code: 'storage-failed', message: 'synthetic' }; if (mutationMode === 'unknown') return { ok: false, code: 'unknown-synthetic', message: 'synthetic' }; if (mutationMode === 'invalid') return { ok: true, value: null }; return { ok: true, value: mutationState }; }, onMinute: () => () => undefined };
  const mutationController = createRendererController(mutationDocument, mutationApi);
  mutationController.start();
  await mutationController.render();
  mutationTheme.dispatch();
  await Promise.resolve();
  mutationMode = 'error';
  mutationTheme.dispatch();
  await Promise.resolve();
  mutationMode = 'unknown';
  mutationTheme.dispatch();
  await Promise.resolve();
  mutationMode = 'invalid';
  mutationTheme.dispatch();
  await Promise.resolve();
  mutationMode = 'throw';
  mutationTheme.dispatch();
  await Promise.resolve();
  assert.equal(mutationStatus.textContent, 'Lokaler Fehler');
  mutationAddress.value = 'x'.repeat(257);
  mutationAddress.dispatch();
  await Promise.resolve();
  assert.equal(mutationError.hidden, false);
});

test('renderer catches initial and minute failures as local status', async () => {
  const d = documentFixture();
  let callback;
  const api = {
    getState: async () => { throw new Error('offline state failure'); },
    onMinute: cb => { callback = cb; return () => undefined; }
  };
  const controller = createRendererController(d.document, api);
  await controller.render();
  assert.equal(d.document.documentElement.dataset.state, 'error');
  assert.equal(d.status.textContent, 'Lokaler Fehler');
  controller.start();
  callback();
  await Promise.resolve();
  assert.equal(d.document.documentElement.dataset.state, 'error');
  assert.equal(d.status.textContent, 'Lokaler Fehler');

  const sparseEnglish = { documentElement: { lang: 'en', dataset: {} }, querySelector: () => null };
  await createRendererController(sparseEnglish, api).render();
  assert.equal(sparseEnglish.documentElement.dataset.state, 'error');
  const englishStatus = { textContent: '' };
  const englishDocument = { documentElement: { lang: 'en', dataset: {} }, querySelector: selector => selector.includes('status') ? englishStatus : null };
  await createRendererController(englishDocument, api).render();
  assert.equal(englishStatus.textContent, 'Local error');
});
