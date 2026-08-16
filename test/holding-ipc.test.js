import assert from 'node:assert/strict';
import test from 'node:test';
import { createMainComposition } from '../src/main-app.ts';
import { createEmptyPortfolioState } from '../src/shared/state.ts';

function fixture(initial = createEmptyPortfolioState()) {
  let state = initial;
  const handlers = new Map();
  const saves = [];
  const scheduler = { start() {}, stop() {} };
  const window = { webContents: { send() {}, setWindowOpenHandler() {}, on() {} }, loadFile() {}, on() {}, isDestroyed() { return false; } };
  const app = { whenReady: async () => {}, on() {}, quit() {}, getPath() { return '/tmp/synthetic'; } };
  const ipcMain = { handle(channel, handler) { handlers.set(channel, handler); } };
  const storage = { async load() { return state; }, async save(next) { state = next; saves.push(next); } };
  const BrowserWindow = class { constructor() { return window; } static getAllWindows() { return []; } };
  return { handlers, storage, app, ipcMain, BrowserWindow, scheduler, getState: () => state, saves };
}

const candidate = { providerId: 'fmp.market', providerSymbol: 'SYN@SYN', symbol: 'SYN', name: 'Synthetic Company', exchange: 'SYN', currency: 'USD', type: 'unknown' };
const resolved = { ...candidate, type: 'stock' };

test('holding IPC searches, resolves provider classifications, and serializes exact CRUD', async () => {
  const f = fixture();
  const search = { async search(query) { assert.equal(query, 'syn'); return { ok: true, value: [candidate], partial: false }; }, async resolve(value) { return { ...value, type: 'stock' }; } };
  const composition = createMainComposition({ app: f.app, BrowserWindow: f.BrowserWindow, ipcMain: f.ipcMain, storage: f.storage, scheduler: f.scheduler, ids: (() => { let id = 0; return { next: () => `id-${++id}` }; })(), clock: { now: () => 44 }, paths: { preload: '/tmp/preload', renderer: '/tmp/index' }, platform: 'linux', instrumentSearch: search });
  await composition.start();
  assert.deepEqual(await f.handlers.get('holdvue:search-instruments')({}, 'syn'), { ok: true, value: [candidate] });
  assert.equal((await f.handlers.get('holdvue:search-instruments')({}, '')).code, 'invalid-input');
  assert.equal((await f.handlers.get('holdvue:search-instruments')({}, 'x'.repeat(121))).code, 'invalid-input');
  const added = await f.handlers.get('holdvue:add-holding')({}, { instrument: candidate, quantity: '12.30' });
  assert.equal(added.ok, true);
  if (!added.ok) return;
  assert.equal(added.value.holdings[0].quantity, '12.3');
  assert.equal(added.value.holdings[0].quantityHundredths, '1230');
  assert.equal((await f.handlers.get('holdvue:add-holding')({}, { instrument: candidate, quantity: '1' })).code, 'duplicate-holding');
  assert.equal((await f.handlers.get('holdvue:add-holding')({}, { instrument: null, quantity: '1' })).code, 'invalid-input');
  const nestedSecretField = ['private', 'Key'].join('');
  assert.equal((await f.handlers.get('holdvue:add-holding')({}, { instrument: candidate, quantity: '1', nested: { [nestedSecretField]: 'synthetic' } })).code, 'secret-input');
  assert.equal((await f.handlers.get('holdvue:add-holding')({}, { instrument: candidate, quantity: 'bad' })).code, 'invalid-quantity');
  const id = added.value.holdings[0].id;
  const updated = await f.handlers.get('holdvue:update-holding')({}, { id, holding: { quantity: '4.5' } });
  assert.equal(updated.ok, true);
  if (updated.ok) assert.equal(updated.value.holdings[0].quantityHundredths, '450');
  assert.equal((await f.handlers.get('holdvue:update-holding')({}, { id, holding: [] })).code, 'invalid-input');
  assert.equal((await f.handlers.get('holdvue:update-holding')({}, { id, holding: { quantity: 4 } })).code, 'invalid-input');
  assert.equal((await f.handlers.get('holdvue:update-holding')({}, { id, holding: {} })).ok, true);
  assert.equal((await f.handlers.get('holdvue:update-holding')({}, { id, quantity: '5' })).ok, true);
  const updatedInstrument = await f.handlers.get('holdvue:update-holding')({}, { id, holding: { instrument: { ...candidate, providerSymbol: 'NEW@SYN', symbol: 'NEW', name: 'Synthetic New', type: 'unknown' } } });
  assert.equal(updatedInstrument.ok, true);
  assert.equal((await f.handlers.get('holdvue:update-holding')({}, { id: '', holding: {} })).code, 'invalid-input');
  assert.equal((await f.handlers.get('holdvue:update-holding')({}, { id, holding: { instrument: { ...candidate, type: 'unknown' } } })).ok, true);
  assert.equal((await f.handlers.get('holdvue:delete-holding')({}, id)).ok, true);
  assert.equal((await f.handlers.get('holdvue:delete-holding')({}, 'missing')).code, 'not-found');
  assert.equal((await f.handlers.get('holdvue:delete-holding')({}, '')).code, 'invalid-input');
  assert.equal((await f.handlers.get('holdvue:delete-holding')({}, { id: 'missing' })).code, 'not-found');
  assert.equal((await f.handlers.get('holdvue:delete-holding')({}, { id: 4 })).code, 'invalid-input');
  assert.equal((await f.handlers.get('holdvue:update-holding')({}, { id, holding: { instrument: {} } })).code, 'invalid-input');
  assert.equal(f.saves.length >= 4, true);
});

test('holding IPC rejects unclassified instruments without a resolver and handles provider failures', async () => {
  const noResolver = fixture();
  const composition = createMainComposition({ app: noResolver.app, BrowserWindow: noResolver.BrowserWindow, ipcMain: noResolver.ipcMain, storage: noResolver.storage, scheduler: noResolver.scheduler, ids: { next: () => 'id' }, clock: { now: () => 1 }, paths: { preload: '/tmp/preload', renderer: '/tmp/index' }, platform: 'linux' });
  await composition.start();
  assert.equal((await noResolver.handlers.get('holdvue:search-instruments')({}, 'syn')).code, 'unconfigured');
  assert.equal((await noResolver.handlers.get('holdvue:add-holding')({}, { instrument: candidate, quantity: '1' })).code, 'unsupported');
  assert.equal((await noResolver.handlers.get('holdvue:add-holding')({}, {})).code, 'invalid-input');
  assert.equal((await noResolver.handlers.get('holdvue:add-holding')({}, { instrument: { ...candidate, type: 'crypto' }, quantity: '1' })).code, 'invalid-input');
  const failing = fixture();
  const failingComposition = createMainComposition({ app: failing.app, BrowserWindow: failing.BrowserWindow, ipcMain: failing.ipcMain, storage: failing.storage, scheduler: failing.scheduler, ids: { next: () => 'id' }, clock: { now: () => 1 }, paths: { preload: '/tmp/preload', renderer: '/tmp/index' }, platform: 'linux', instrumentSearch: { async search() { return { ok: false, code: 'rate-limited', message: 'redacted' }; }, async resolve() { throw new Error('redacted'); } } });
  await failingComposition.start();
  assert.equal((await failing.handlers.get('holdvue:search-instruments')({}, 'syn')).code, 'rate-limited');
  assert.equal((await failing.handlers.get('holdvue:add-holding')({}, { instrument: candidate, quantity: '1' })).code, 'search-failed');
  const responseFailure = fixture();
  const responseFailureComposition = createMainComposition({ app: responseFailure.app, BrowserWindow: responseFailure.BrowserWindow, ipcMain: responseFailure.ipcMain, storage: responseFailure.storage, scheduler: responseFailure.scheduler, ids: { next: () => 'id' }, clock: { now: () => 1 }, paths: { preload: '/tmp/preload', renderer: '/tmp/index' }, platform: 'linux', instrumentSearch: { async search() { return { ok: true, value: [], partial: false }; }, async resolve() { return { ok: false, code: 'unsupported', message: 'synthetic' }; } } });
  await responseFailureComposition.start();
  assert.equal((await responseFailure.handlers.get('holdvue:add-holding')({}, { instrument: candidate, quantity: '1' })).code, 'unsupported');
  assert.equal((await responseFailure.handlers.get('holdvue:update-holding')({}, { id: 'synthetic', holding: { instrument: candidate } })).code, 'unsupported');
  const saveFailure = fixture();
  const saveFailureComposition = createMainComposition({ app: saveFailure.app, BrowserWindow: saveFailure.BrowserWindow, ipcMain: saveFailure.ipcMain, storage: saveFailure.storage, scheduler: saveFailure.scheduler, ids: { next: () => 'id' }, clock: { now: () => 1 }, paths: { preload: '/tmp/preload', renderer: '/tmp/index' }, platform: 'linux', instrumentSearch: { async search() { return { ok: true, value: [], partial: false }; }, async resolve() { return resolved; } } });
  await saveFailureComposition.start();
  saveFailure.storage.save = async () => { throw new Error('synthetic'); };
  assert.equal((await saveFailure.handlers.get('holdvue:add-holding')({}, { instrument: candidate, quantity: '1' })).code, 'storage-failed');
  const searchThrow = fixture();
  const searchThrowComposition = createMainComposition({ app: searchThrow.app, BrowserWindow: searchThrow.BrowserWindow, ipcMain: searchThrow.ipcMain, storage: searchThrow.storage, scheduler: searchThrow.scheduler, ids: { next: () => 'id' }, clock: { now: () => 1 }, paths: { preload: '/tmp/preload', renderer: '/tmp/index' }, platform: 'linux', instrumentSearch: { async search() { throw new Error('synthetic'); }, async resolve() { return resolved; } } });
  await searchThrowComposition.start();
  assert.equal((await searchThrow.handlers.get('holdvue:search-instruments')({}, 'syn')).code, 'search-failed');
});

test('instrument searches abort the previous request and stop aborts an active request', async () => {
  const f = fixture();
  let firstSignal;
  let pendingSignal;
  let calls = 0;
  const abortError = () => { const error = new Error('synthetic abort'); error.name = 'AbortError'; return error; };
  const search = {
    search(query, signal) {
      calls++;
      if (query === 'first' || query === 'pending') {
        if (query === 'first') firstSignal = signal;
        else pendingSignal = signal;
        return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(abortError()), { once: true }));
      }
      return Promise.resolve({ ok: true, value: [candidate], partial: false });
    },
    async resolve(value) { return { ...value, type: 'stock' }; }
  };
  const composition = createMainComposition({ app: f.app, BrowserWindow: f.BrowserWindow, ipcMain: f.ipcMain, storage: f.storage, scheduler: f.scheduler, ids: { next: () => 'id' }, clock: { now: () => 1 }, paths: { preload: '/tmp/preload', renderer: '/tmp/index' }, platform: 'linux', instrumentSearch: search });
  await composition.start();
  const first = f.handlers.get('holdvue:search-instruments')({}, 'first');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(firstSignal instanceof AbortSignal, true);
  const second = await f.handlers.get('holdvue:search-instruments')({}, 'second');
  assert.deepEqual(second, { ok: true, value: [candidate] });
  assert.equal(firstSignal.aborted, true);
  assert.equal((await first).code, 'aborted');
  const completed = await f.handlers.get('holdvue:search-instruments')({}, 'completed');
  assert.equal(completed.ok, true);
  assert.equal(calls, 3);
  const pending = f.handlers.get('holdvue:search-instruments')({}, 'pending');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(pendingSignal instanceof AbortSignal, true);
  composition.stop();
  assert.equal(pendingSignal.aborted, true);
  assert.equal((await pending).code, 'aborted');
});

test('a delayed abort cleanup cannot clear a newer search controller', async () => {
  const f = fixture();
  const abortError = () => { const error = new Error('synthetic abort'); error.name = 'AbortError'; return error; };
  const search = {
    search(query, signal) {
      if (query === 'late') return new Promise((resolve, reject) => signal.addEventListener('abort', () => setTimeout(() => reject(abortError()), 10), { once: true }));
      return Promise.resolve({ ok: true, value: [candidate], partial: false });
    },
    async resolve(value) { return { ...value, type: 'stock' }; }
  };
  const composition = createMainComposition({ app: f.app, BrowserWindow: f.BrowserWindow, ipcMain: f.ipcMain, storage: f.storage, scheduler: f.scheduler, ids: { next: () => 'id' }, clock: { now: () => 1 }, paths: { preload: '/tmp/preload', renderer: '/tmp/index' }, platform: 'linux', instrumentSearch: search });
  await composition.start();
  const late = f.handlers.get('holdvue:search-instruments')({}, 'late');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(await f.handlers.get('holdvue:search-instruments')({}, 'new'), { ok: true, value: [candidate] });
  assert.equal((await late).code, 'aborted');
});

test('FMP provider key lifecycle uses references only and remains transactional', async () => {
  const values = new Map();
  const secrets = { set(id, value) { values.set(id, value); return { ok: true, value: undefined }; }, get(id) { return { ok: true, value: values.get(id) ?? null }; }, delete(id) { values.delete(id); return { ok: true, value: undefined }; } };
  const f = fixture();
  const composition = createMainComposition({ app: f.app, BrowserWindow: f.BrowserWindow, ipcMain: f.ipcMain, storage: f.storage, scheduler: f.scheduler, secrets, ids: { next: () => 'fmp-ref' }, clock: { now: () => 1 }, paths: { preload: '/tmp/preload', renderer: '/tmp/index' }, platform: 'linux' });
  await composition.start();
  const set = await f.handlers.get('holdvue:set-fmp-key')({}, 'synthetic-fmp-secret');
  assert.equal(set.ok, true);
  if (set.ok) assert.equal(set.value.settings.providerRefs[0].keyId, 'ref_fmp.market_fmp-ref');
  assert.deepEqual([...values.values()], ['synthetic-fmp-secret']);
  assert.equal((await f.handlers.get('holdvue:set-fmp-key')({}, { apikey: 'synthetic' })).code, 'invalid-input');
  const deleted = await f.handlers.get('holdvue:delete-fmp-key')();
  assert.equal(deleted.ok, true);
  assert.equal(values.size, 0);
  const unavailable = fixture();
  const unavailableComposition = createMainComposition({ app: unavailable.app, BrowserWindow: unavailable.BrowserWindow, ipcMain: unavailable.ipcMain, storage: unavailable.storage, scheduler: unavailable.scheduler, ids: { next: () => 'id' }, clock: { now: () => 1 }, paths: { preload: '/tmp/preload', renderer: '/tmp/index' }, platform: 'linux' });
  await unavailableComposition.start();
  assert.equal((await unavailable.handlers.get('holdvue:set-fmp-key')({}, 'synthetic')).code, 'secret-storage-unavailable');
});
