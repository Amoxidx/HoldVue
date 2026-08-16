import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { createRendererController } from '../src/renderer/renderer-app.ts';

const syntheticEvm = `0x${'c'.repeat(40)}`;
const settings = () => ({ schemaVersion: 2, currency: 'EUR', locale: 'de', theme: 'dark', schedulerEnabled: true, spamFilterEnabled: true, showHiddenSpamAssets: false, enabledChainIds: [], customChains: [], rpcOverrides: [], providerRefs: [] });
const wallet = (id = 'dom-wallet') => ({ schemaVersion: 2, id, label: 'Synthetic DOM wallet', family: 'evm', address: syntheticEvm, enabled: true, createdAt: 1, options: { autoScanCommonChains: true, chainIds: [] } });
const xpubWallet = () => ({ schemaVersion: 2, id: 'dom-xpub', label: 'Synthetic xpub wallet', family: 'bitcoin', address: 'xpub-synthetic', enabled: true, createdAt: 1, options: { network: 'mainnet', addressType: 'xpub' } });
const success = value => ({ ok: true, value });
const flush = () => new Promise(resolve => setImmediate(resolve));

async function domFixture() {
  const html = await readFile(new URL('../src/renderer/index.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: 'file:///holdvue/index.html' });
  for (const dialog of dom.window.document.querySelectorAll('dialog')) {
    dialog.showModal = () => { dialog.open = true; };
    dialog.close = () => { dialog.open = false; };
  }
  return dom;
}

test('real index DOM wires every dialog control, locale, focus, full address and EVM options', async () => {
  const dom = await domFixture();
  let state = { schemaVersion: 2, settings: settings(), positions: [], wallets: [wallet(), xpubWallet()] };
  const api = {
    async getState() { return success(state); },
    async detectWalletAddress(address) { return { ok: true, family: 'evm', normalized: address }; },
    async addWallet(input) { state = { ...state, wallets: [...state.wallets, { ...wallet('added-dom'), ...input }] }; return success(state); },
    async updateWallet(id, input) { state = { ...state, wallets: state.wallets.map(item => item.id === id ? { ...item, ...input } : item) }; return success(state); },
    async deleteWallet(id) { state = { ...state, wallets: state.wallets.filter(item => item.id !== id) }; return success(state); },
    async copyWalletAddress() { return success({ copied: true }); },
    async refresh() { return success(state); },
    async updateSettings(patch) { state = { ...state, settings: { ...state.settings, ...patch } }; return success(state); },
    async setEtherscanKey(value) { state = { ...state, settings: { ...state.settings, providerRefs: [{ providerId: 'evm.erc20', keyId: 'ref_evm.erc20_synthetic', enabled: true }] } }; assert.equal(value, 'synthetic-key'); return success(state); },
    async deleteEtherscanKey() { state = { ...state, settings: { ...state.settings, providerRefs: [] } }; return success(state); },
    onMinute() { return () => undefined; }
  };
  const controller = createRendererController(dom.window.document, api);
  controller.start();
  const earlyEndpoint = dom.window.document.querySelector('[data-provider-endpoint="solana.rpc"]');
  earlyEndpoint.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  const earlyRpc = dom.window.document.querySelector('[data-rpc-chain-id="1"]');
  earlyRpc.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  await controller.render();
  const documentRef = dom.window.document;
  documentRef.querySelector('[data-refresh]').dispatchEvent(new dom.window.Event('click', { bubbles: true, cancelable: true }));
  await flush();
  assert.equal(documentRef.querySelectorAll('[data-wallet-cancel]').length, 1);
  assert.equal(documentRef.querySelectorAll('[data-wallet-cancel-close]').length, 1);
  assert.equal(documentRef.querySelectorAll('[data-settings-close]').length, 1);
  assert.equal(documentRef.querySelectorAll('[data-settings-close-icon]').length, 1);
  assert.equal(documentRef.querySelector('.wallet-address').textContent, syntheticEvm);
  assert.match(documentRef.querySelector('[data-wallet-action="copy"]').getAttribute('aria-label'), /Synthetic DOM wallet/);
  const staleDelete = documentRef.querySelector('[data-wallet-action="delete"]');
  const populatedState = state;
  state = { ...state, wallets: [] };
  await controller.render();
  staleDelete.dispatchEvent(new dom.window.Event('click', { bubbles: true, cancelable: true }));
  state = populatedState;
  await controller.render();

  const gear = documentRef.querySelector('[data-open-settings]');
  gear.focus();
  gear.dispatchEvent(new dom.window.Event('click', { bubbles: true, cancelable: true }));
  documentRef.querySelector('[data-settings-close-icon]').dispatchEvent(new dom.window.Event('click', { bubbles: true, cancelable: true }));
  assert.equal(documentRef.activeElement, gear);
  gear.dispatchEvent(new dom.window.Event('click', { bubbles: true, cancelable: true }));
  documentRef.querySelector('[data-settings-close]').dispatchEvent(new dom.window.Event('click', { bubbles: true, cancelable: true }));
  assert.equal(documentRef.activeElement, gear);
  const solanaEndpoint = documentRef.querySelector('[data-provider-endpoint="solana.rpc"]');
  solanaEndpoint.value = 'https://solana.synthetic.invalid';
  solanaEndpoint.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  solanaEndpoint.value = '';
  solanaEndpoint.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  const rpcOverride = documentRef.querySelector('[data-rpc-chain-id="1"]');
  rpcOverride.value = 'https://rpc.synthetic.invalid';
  rpcOverride.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  const keyInput = documentRef.querySelector('[data-etherscan-key]');
  documentRef.querySelector('[data-etherscan-key-save]').dispatchEvent(new dom.window.Event('click', { bubbles: true, cancelable: true }));
  keyInput.value = 'synthetic-key';
  documentRef.querySelector('[data-etherscan-key-save]').dispatchEvent(new dom.window.Event('click', { bubbles: true, cancelable: true }));
  await flush();
  assert.equal(keyInput.value, '');
  documentRef.querySelector('[data-etherscan-key-delete]').dispatchEvent(new dom.window.Event('click', { bubbles: true, cancelable: true }));

  const add = documentRef.querySelector('[data-add-wallet]');
  add.dispatchEvent(new dom.window.Event('click', { bubbles: true, cancelable: true }));
  const address = documentRef.querySelector('[data-wallet-address]');
  address.value = syntheticEvm;
  address.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  await flush();
  assert.equal(documentRef.querySelector('[data-wallet-family]').disabled, true);
  const allCommon = documentRef.querySelector('[data-wallet-all-evm]');
  const chainInput = documentRef.querySelector('[data-chain-id]');
  assert.equal(chainInput.disabled, true);
  allCommon.checked = false;
  allCommon.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.equal(chainInput.disabled, false);
  documentRef.querySelector('[data-wallet-label]').value = 'Manual without chain';
  documentRef.querySelector('[data-wallet-form]').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await flush();
  assert.match(documentRef.querySelector('[data-wallet-error]').textContent, /mindestens/i);
  documentRef.querySelector('[data-wallet-cancel-close]').dispatchEvent(new dom.window.Event('click', { bubbles: true, cancelable: true }));
  assert.equal(documentRef.activeElement, add);
  add.dispatchEvent(new dom.window.Event('click', { bubbles: true, cancelable: true }));
  documentRef.querySelector('[data-wallet-cancel]').dispatchEvent(new dom.window.Event('click', { bubbles: true, cancelable: true }));
  assert.equal(documentRef.activeElement, add);
  add.dispatchEvent(new dom.window.Event('click', { bubbles: true, cancelable: true }));
  documentRef.querySelector('[data-wallet-address]').value = syntheticEvm;
  documentRef.querySelector('[data-wallet-address]').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  await flush();
  documentRef.querySelector('[data-wallet-form]').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await flush();
  assert.match(documentRef.querySelector('[data-wallet-error]').textContent, /Label/i);
  documentRef.querySelector('[data-wallet-label]').value = 'Programmatic mismatch';
  documentRef.querySelector('[data-wallet-family]').value = 'unsupported-family';
  documentRef.querySelector('[data-wallet-form]').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await flush();
  assert.match(documentRef.querySelector('[data-wallet-error]').textContent, /ungültig/i);
  documentRef.querySelector('[data-wallet-cancel]').dispatchEvent(new dom.window.Event('click', { bubbles: true, cancelable: true }));

  const edit = documentRef.querySelector('[data-wallet-action="edit"]');
  edit.focus();
  edit.dispatchEvent(new dom.window.Event('click', { bubbles: true, cancelable: true }));
  documentRef.querySelector('[data-wallet-label]').value = 'Edited DOM wallet';
  documentRef.querySelector('[data-wallet-form]').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await flush();
  assert.equal(documentRef.activeElement, documentRef.querySelector('[data-wallet-action="edit"]'));

  const xpubEdit = documentRef.querySelector('[data-wallet-action="edit"][data-wallet-id="dom-xpub"]');
  xpubEdit.focus();
  xpubEdit.dispatchEvent(new dom.window.Event('click', { bubbles: true, cancelable: true }));
  documentRef.querySelector('[data-wallet-form]').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await flush();
  assert.equal(state.wallets.find(item => item.id === 'dom-xpub').options.addressType, 'xpub');

  const evmEdit = documentRef.querySelector('[data-wallet-action="edit"][data-wallet-id="dom-wallet"]');
  evmEdit.dispatchEvent(new dom.window.Event('click', { bubbles: true, cancelable: true }));
  documentRef.querySelector('[data-wallet-all-evm]').checked = false;
  documentRef.querySelector('[data-wallet-all-evm]').dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  documentRef.querySelector('[data-chain-id]').checked = true;
  documentRef.querySelector('[data-wallet-form]').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await flush();
  assert.equal(state.wallets.find(item => item.id === 'dom-wallet').options.autoScanCommonChains, false);
  assert.deepEqual(state.wallets.find(item => item.id === 'dom-wallet').options.chainIds, [1]);

  const settingsEdit = documentRef.querySelector('[data-open-settings]');
  settingsEdit.dispatchEvent(new dom.window.Event('click', { bubbles: true, cancelable: true }));
  const settingsWalletEdit = documentRef.querySelector('[data-settings-wallet-list] [data-wallet-action="edit"]');
  settingsWalletEdit.focus();
  settingsWalletEdit.dispatchEvent(new dom.window.Event('click', { bubbles: true, cancelable: true }));
  documentRef.querySelector('[data-wallet-form]').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await flush();
  assert.equal(documentRef.activeElement, documentRef.querySelector('[data-settings-wallet-list] [data-wallet-action="edit"]'));
  const settingsDelete = documentRef.querySelector('[data-settings-wallet-list] [data-wallet-action="delete"]');
  settingsDelete.dispatchEvent(new dom.window.Event('click', { bubbles: true, cancelable: true }));
  settingsDelete.remove();
  documentRef.querySelector('[data-delete-cancel]').dispatchEvent(new dom.window.Event('click', { bubbles: true, cancelable: true }));
  assert.equal(documentRef.activeElement, documentRef.querySelector('[data-settings-close]'));

  const deleteButton = documentRef.querySelector('[data-wallet-action="delete"]');
  deleteButton.focus();
  deleteButton.dispatchEvent(new dom.window.Event('click', { bubbles: true, cancelable: true }));
  documentRef.querySelector('[data-delete-cancel]').dispatchEvent(new dom.window.Event('click', { bubbles: true, cancelable: true }));
  assert.equal(documentRef.activeElement, deleteButton);
  documentRef.querySelector('[data-wallet-action="delete"]').dispatchEvent(new dom.window.Event('click', { bubbles: true, cancelable: true }));
  documentRef.querySelector('[data-delete-confirm]').dispatchEvent(new dom.window.Event('click', { bubbles: true, cancelable: true }));
  await flush();
  assert.equal(documentRef.activeElement, add);

  documentRef.querySelector('[data-setting-currency]').value = 'USD';
  documentRef.querySelector('[data-setting-currency]').dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  await flush();
  const evmProvider = documentRef.querySelector('[data-provider-id="evm"]');
  evmProvider.checked = true;
  evmProvider.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  await flush();
  assert.deepEqual(state.settings.enabledProviderIds, ['evm']);
  documentRef.querySelector('[data-setting-locale]').value = 'en';
  documentRef.querySelector('[data-setting-locale]').dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  await flush();
  assert.equal(documentRef.documentElement.lang, 'en');
  assert.equal(documentRef.querySelector('h1').textContent, 'Your portfolio stays local.');
  assert.match(documentRef.querySelector('[data-footer-summary]').textContent, /^USD · EN · Dark$/);
  for (const status of ['rate-limited', 'error', 'partial', 'ok', 'empty']) {
    state = { ...state, sync: { schemaVersion: 1, statuses: [{ walletId: 'dom-wallet', family: 'evm', providerId: 'evm', status, lastAttemptAt: 1, lastSuccessAt: status === 'ok' ? 1 : null, errorCode: status === 'ok' ? null : status }] } };
    await controller.render();
    if (status === 'ok') assert.match(documentRef.querySelector('[data-sync-summary]').textContent, /Last wallet synchronization/);
  }
});

test('real DOM ignores out-of-order address detection results', async () => {
  const dom = await domFixture();
  const pending = new Map();
  const state = { schemaVersion: 2, settings: settings(), positions: [], wallets: [] };
  const api = {
    async getState() { return success(state); },
    detectWalletAddress(address) { return new Promise(resolve => pending.set(address, resolve)); },
    async addWallet() { return success(state); }, async updateWallet() { return success(state); }, async deleteWallet() { return success(state); }, async copyWalletAddress() { return success({ copied: true }); }, async updateSettings() { return success(state); }, onMinute() { return () => undefined; }
  };
  const controller = createRendererController(dom.window.document, api);
  controller.start();
  await controller.render();
  dom.window.document.querySelector('[data-add-wallet]').click();
  const input = dom.window.document.querySelector('[data-wallet-address]');
  const first = `0x${'1'.repeat(40)}`; const second = `0x${'2'.repeat(40)}`;
  input.value = first; input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  input.value = second; input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  pending.get(second)({ ok: true, family: 'evm', normalized: second });
  await flush();
  pending.get(first)({ ok: true, family: 'bitcoin', normalized: first, network: 'mainnet' });
  await flush();
  assert.match(dom.window.document.querySelector('[data-wallet-detection]').textContent, /EVM/);
  assert.equal(dom.window.document.querySelector('[data-wallet-family]').value, 'evm');
});

test('real DOM supports offline instrument search, exact holdings CRUD, keyboard selection and FMP key status', async () => {
  const dom = await domFixture();
  const instrument = { providerId: 'fmp.market', providerSymbol: 'SYN@SYN', symbol: 'SYN', name: 'Synthetic World ETF', exchange: 'SYN', currency: 'EUR', type: 'unknown' };
  const resolvedInstrument = { ...instrument, type: 'etf' };
  let state = { schemaVersion: 4, settings: { ...settings(), providerRefs: [] }, positions: [], wallets: [], instruments: [], holdings: [] };
  const pending = new Map();
  const api = {
    async getState() { return success(state); },
    async detectWalletAddress() { return { ok: false, code: 'invalid', message: 'synthetic' }; },
    async searchInstruments(query) { return new Promise(resolve => pending.set(query, resolve)); },
    async addHolding(input) { const next = { ...state, instruments: [{ ...resolvedInstrument, id: 'instrument-dom' }], holdings: [{ schemaVersion: 4, id: 'holding-dom', instrumentId: 'instrument-dom', quantityHundredths: input.quantity === '1.23' ? '123' : '450', quantity: input.quantity, updatedAt: 2 }] }; state = next; return success(next); },
    async updateHolding(id, input) { state = { ...state, holdings: state.holdings.map(item => item.id === id ? { ...item, quantity: input.quantity, quantityHundredths: input.quantity === '4.5' ? '450' : item.quantityHundredths } : item) }; return success(state); },
    async deleteHolding(id) { state = { ...state, holdings: state.holdings.filter(item => item.id !== id), instruments: [] }; return success(state); },
    async addWallet() { return success(state); }, async updateWallet() { return success(state); }, async deleteWallet() { return success(state); }, async copyWalletAddress() { return success({ copied: true }); },
    async refresh() { return success(state); }, async updateSettings(patch) { state = { ...state, settings: { ...state.settings, ...patch } }; return success(state); },
    async setEtherscanKey() { return success(state); }, async deleteEtherscanKey() { return success(state); }, async setFmpKey() { state = { ...state, settings: { ...state.settings, providerRefs: [{ providerId: 'fmp.market', keyId: 'ref_fmp.market_synthetic', enabled: true }] } }; return success(state); }, async deleteFmpKey() { state = { ...state, settings: { ...state.settings, providerRefs: [] } }; return success(state); },
    onMinute() { return () => undefined; }
  };
  const controller = createRendererController(dom.window.document, api);
  const disposeController = controller.start();
  await controller.render();
  const documentRef = dom.window.document;
  const add = documentRef.querySelector('[data-add-holding]');
  add.click();
  documentRef.querySelector('[data-holding-form]').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  assert.match(documentRef.querySelector('[data-holding-error]').textContent, /Instrumentdaten/i);
  const search = documentRef.querySelector('[data-instrument-search]');
  search.value = '';
  search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  add.click();
  documentRef.querySelector('[data-holding-cancel]').click();
  search.value = 'rapid';
  search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  search.value = 'rapid-again';
  search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  search.value = 'first';
  search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 315));
  search.value = 'second';
  search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 315));
  pending.get('second')(success([instrument, { ...instrument, symbol: 'STK', providerSymbol: 'STK@SYN', name: 'Synthetic Stock', type: 'stock' }]));
  await flush();
  pending.get('first')(success([{ ...instrument, symbol: 'OLD', providerSymbol: 'OLD@SYN' }]));
  await flush();
  assert.equal(documentRef.querySelectorAll('[data-instrument-index]').length, 2);
  documentRef.querySelector('[data-instrument-index]').setAttribute('data-instrument-index', '999');
  documentRef.querySelector('[data-instrument-index]').dispatchEvent(new dom.window.Event('click', { bubbles: true, cancelable: true }));
  documentRef.querySelector('[data-instrument-index]').setAttribute('data-instrument-index', '0');
  documentRef.querySelector('[data-instrument-search]').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
  documentRef.querySelector('[data-instrument-search]').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
  search.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  search.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  assert.doesNotMatch(documentRef.querySelector('[data-selected-instrument]').textContent, /Typ wird geprüft/);
  const quantity = documentRef.querySelector('[data-holding-quantity]');
  quantity.value = '1.234';
  documentRef.querySelector('[data-holding-form]').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  assert.match(documentRef.querySelector('[data-holding-error]').textContent, /höchstens zwei/i);
  quantity.value = '1.23';
  documentRef.querySelector('[data-holding-form]').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await flush();
  assert.equal(state.holdings[0].quantity, '1.23');
  assert.equal(documentRef.activeElement, add);
  const staleHoldingDelete = documentRef.querySelector('[data-holding-action="delete"]');
  const holdingsState = state;
  state = { ...state, instruments: [], holdings: [{ ...holdingsState.holdings[0] }] };
  await controller.render();
  staleHoldingDelete.dispatchEvent(new dom.window.Event('click', { bubbles: true, cancelable: true }));
  state = holdingsState;
  await controller.render();
  const edit = documentRef.querySelector('[data-holding-action="edit"]');
  edit.focus();
  edit.click();
  assert.equal(documentRef.querySelector('[data-instrument-search]').disabled, true);
  documentRef.querySelector('[data-holding-quantity]').value = '4.5';
  documentRef.querySelector('[data-holding-form]').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await flush();
  assert.equal(documentRef.activeElement, documentRef.querySelector('[data-holding-action="edit"]'));
  const del = documentRef.querySelector('[data-holding-action="delete"]');
  del.focus();
  del.click();
  documentRef.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(documentRef.querySelector('[data-holding-delete-dialog]').hidden, true);
  documentRef.querySelector('[data-holding-action="delete"]').click();
  documentRef.querySelector('[data-holding-delete-cancel]').click();
  assert.equal(documentRef.activeElement, del);
  documentRef.querySelector('[data-holding-action="delete"]').click();
  documentRef.querySelector('[data-holding-delete-confirm]').click();
  await flush();
  assert.equal(documentRef.activeElement, add);
  add.click();
  documentRef.querySelector('[data-holding-cancel-close]').click();
  assert.equal(documentRef.activeElement, add);
  documentRef.querySelector('[data-open-settings]').click();
  const fmpInput = documentRef.querySelector('[data-fmp-key]');
  fmpInput.value = 'synthetic-fmp';
  documentRef.querySelector('[data-fmp-key-save]').click();
  await flush();
  assert.match(documentRef.querySelector('[data-fmp-key-status]').textContent, /konfiguriert/i);
  documentRef.querySelector('[data-fmp-key-delete]').click();
  await flush();
  documentRef.querySelector('[data-fmp-key-save]').click();
  assert.match(documentRef.querySelector('[data-wallet-error]').textContent, /Eingaben/i);
  documentRef.querySelector('[data-settings-close]').click();
  documentRef.querySelector('[data-add-holding]').click();
  api.searchInstruments = async () => ({ ok: false, code: 'synthetic-provider-code', message: 'synthetic' });
  documentRef.querySelector('[data-instrument-search]').value = 'unknown-error';
  documentRef.querySelector('[data-instrument-search]').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 315));
  assert.match(documentRef.querySelector('[data-holding-error]').textContent, /Aktion|action/i);
  documentRef.querySelector('[data-instrument-search]').value = 'failure';
  api.searchInstruments = async () => ({ ok: false, code: 'rate-limited', message: 'synthetic' });
  documentRef.querySelector('[data-instrument-search]').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 315));
  assert.match(documentRef.querySelector('[data-holding-error]').textContent, /Limit/i);
  api.searchInstruments = async () => ({ ok: true, value: null });
  documentRef.querySelector('[data-instrument-search]').value = 'malformed';
  documentRef.querySelector('[data-instrument-search]').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 315));
  assert.match(documentRef.querySelector('[data-holding-error]').textContent, /fehlgeschlagen/i);
  api.searchInstruments = async () => ({ ok: true, value: [] });
  documentRef.querySelector('[data-instrument-search]').value = 'empty';
  documentRef.querySelector('[data-instrument-search]').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 315));
  assert.match(documentRef.querySelector('[data-instrument-status]').textContent, /Noch keine/i);
  documentRef.querySelector('[data-holding-cancel]').click();
  documentRef.querySelector('[data-add-holding]').click();
  documentRef.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(documentRef.querySelector('[data-holding-dialog]').hidden, true);
  documentRef.querySelector('[data-holding-delete-confirm]').click();
  api.searchInstruments = async () => { throw new Error('synthetic'); };
  documentRef.querySelector('[data-add-holding]').click();
  documentRef.querySelector('[data-instrument-search]').value = 'throws';
  documentRef.querySelector('[data-instrument-search]').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 315));
  await flush();
  assert.match(documentRef.querySelector('[data-holding-error]').textContent, /fehlgeschlagen/i);
  documentRef.querySelector('[data-add-holding]').click();
  api.searchInstruments = async () => success([instrument]);
  documentRef.querySelector('[data-instrument-search]').value = 'cleanup';
  documentRef.querySelector('[data-instrument-search]').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  documentRef.querySelector('[data-instrument-suggestions]').remove();
  documentRef.querySelector('[data-instrument-search]').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 315));
  documentRef.querySelector('[data-instrument-search]').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  documentRef.querySelector('[data-add-holding]').remove();
  documentRef.querySelector('[data-open-settings]').remove();
  documentRef.querySelector('[data-holding-cancel]').click();
  disposeController();

  const stockDom = await domFixture();
  const stockInstrument = { ...instrument, symbol: 'STK', providerSymbol: 'STK@SYN', type: 'stock' };
  const stockApi = { ...api, async getState() { return success({ ...state, holdings: [], instruments: [] }); }, async searchInstruments() { return success([stockInstrument]); } };
  const stockController = createRendererController(stockDom.window.document, stockApi);
  const disposeStock = stockController.start();
  await stockController.render();
  stockDom.window.document.querySelector('[data-add-holding]').click();
  stockDom.window.document.querySelector('[data-holding-cancel]').click();
  stockDom.window.document.querySelector('[data-add-holding]').click();
  const stockSearch = stockDom.window.document.querySelector('[data-instrument-search]');
  stockSearch.value = 'stock';
  stockSearch.dispatchEvent(new stockDom.window.Event('input', { bubbles: true }));
  stockDom.window.document.querySelector('[data-holding-cancel]').click();
  stockDom.window.document.querySelector('[data-add-holding]').click();
  stockSearch.value = 'stock';
  stockSearch.dispatchEvent(new stockDom.window.Event('input', { bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 315));
  stockDom.window.document.querySelector('[data-instrument-index]').click();
  assert.doesNotMatch(stockDom.window.document.querySelector('[data-selected-instrument]').textContent, /Typ wird geprüft/);
  disposeStock();
  const missingListDom = await domFixture();
  const missingListApi = { ...stockApi, async searchInstruments() { return new Promise(resolve => setTimeout(() => resolve(success([stockInstrument])), 1)); } };
  const missingListController = createRendererController(missingListDom.window.document, missingListApi);
  const disposeMissingList = missingListController.start();
  await missingListController.render();
  missingListDom.window.document.querySelector('[data-add-holding]').click();
  const missingSearch = missingListDom.window.document.querySelector('[data-instrument-search]');
  missingSearch.value = 'missing-list';
  missingSearch.dispatchEvent(new missingListDom.window.Event('input', { bubbles: true }));
  missingListDom.window.document.querySelector('[data-instrument-suggestions]').remove();
  await new Promise(resolve => setTimeout(resolve, 315));
  disposeMissingList();
  const pendingDom = await domFixture();
  const pendingController = createRendererController(pendingDom.window.document, missingListApi);
  const disposePending = pendingController.start();
  await pendingController.render();
  pendingDom.window.document.querySelector('[data-add-holding]').click();
  const pendingSearch = pendingDom.window.document.querySelector('[data-instrument-search]');
  pendingSearch.value = 'pending-cleanup';
  pendingSearch.dispatchEvent(new pendingDom.window.Event('input', { bubbles: true }));
  disposePending();
});

test('real DOM renders fixed-point valuation summary and fail-closed unavailable prices', async () => {
  const dom = await domFixture();
  const state = { schemaVersion: 5, settings: { ...settings(), currency: 'EUR' }, positions: [], wallets: [], instruments: [{ schemaVersion: 4, id: 'instrument-price', providerId: 'fmp.market', providerSymbol: 'SYN@X', symbol: 'SYN', name: 'Synthetic', exchange: 'X', currency: 'EUR', type: 'stock' }], holdings: [{ schemaVersion: 4, id: 'holding-price', instrumentId: 'instrument-price', quantityHundredths: '100', quantity: '1', updatedAt: 1 }], sync: { schemaVersion: 1, statuses: [] }, prices: { quotes: [{ assetId: 'instrument:instrument-price', priceEurScaled: 'bad', priceUsdScaled: '1', scale: 12, change24hPercentScaled: null, previousPriceEurScaled: null, previousPriceUsdScaled: null, source: 'synthetic', sourceTimestamp: null, fetchedAt: 1 }], statuses: [], valuations: [], history: [], totalEurScaled: null, totalUsdScaled: null, complete: false, valuedAssets: 0, totalAssets: 1, dayChangeEurScaled: null, dayChangeUsdScaled: null, dayChangePercentScaled: null } };
  let current = state;
  const api = { getState: async () => success(current), onMinute: () => () => undefined };
  const controller = createRendererController(dom.window.document, api);
  await controller.render();
  assert.equal(dom.window.document.querySelector('[data-portfolio-total]').textContent, '—');
  assert.match(dom.window.document.querySelector('[data-holding-list]').textContent, /Preis nicht verfügbar/);
  current = { ...state, settings: { ...state.settings, currency: 'USD' }, prices: { ...state.prices, quotes: [], valuations: [{ assetId: 'instrument:instrument-price', quantityBaseUnits: '100', quantityDecimals: 2, priceEurScaled: null, priceUsdScaled: '1000000000000', valueEurScaled: null, valueUsdScaled: '1000000000000', dayChangeEurScaled: null, dayChangeUsdScaled: null, dayChangePercentScaled: null, status: 'valued' }] } };
  await controller.render(); assert.match(dom.window.document.querySelector('[data-holding-list]').textContent, /Preis nicht verfügbar/);
  current = { ...state, prices: { ...state.prices, quotes: [{ assetId: 'instrument:instrument-price', priceEurScaled: '1230000000000', priceUsdScaled: '1300000000000', scale: 12, change24hPercentScaled: null, previousPriceEurScaled: null, previousPriceUsdScaled: null, source: 'synthetic', sourceTimestamp: null, fetchedAt: 1 }], valuations: [{ assetId: 'instrument:instrument-price', quantityBaseUnits: '100', quantityDecimals: 2, priceEurScaled: '1230000000000', priceUsdScaled: '1300000000000', valueEurScaled: '1230000000000', valueUsdScaled: '1300000000000', dayChangeEurScaled: null, dayChangeUsdScaled: null, dayChangePercentScaled: null, status: 'valued' }], totalEurScaled: '1230000000000', totalUsdScaled: '1300000000000', valuedAssets: 1, totalAssets: 1, complete: true } };
  await controller.render(); assert.match(dom.window.document.querySelector('[data-holding-list]').textContent, /1,23/);
  current = { ...current, settings: { ...current.settings, currency: 'USD' }, prices: { ...current.prices, quotes: [{ ...current.prices.quotes[0], priceEurScaled: null, priceUsdScaled: null }], valuations: [] } };
  await controller.render(); assert.match(dom.window.document.querySelector('[data-holding-list]').textContent, /Preis nicht verfügbar/);
  current = { ...current, settings: { ...current.settings, locale: 'en' }, prices: { ...current.prices, quotes: [{ ...current.prices.quotes[0], priceEurScaled: '1230000000000', priceUsdScaled: '1300000000000' }] } };
  await controller.render(); assert.match(dom.window.document.querySelector('[data-holding-list]').textContent, /USD/);
});
