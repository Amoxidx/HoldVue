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
  const disposeController = controller.start();
  for (const button of dom.window.document.querySelectorAll('button.icon-button')) assert.ok(button.getAttribute('aria-label'));
  const earlyProvider = dom.window.document.querySelector('[data-provider-id="evm"]');
  earlyProvider.checked = true;
  earlyProvider.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  const earlyEndpoint = dom.window.document.querySelector('[data-provider-endpoint="solana.rpc"]');
  earlyEndpoint.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  const earlyRpc = dom.window.document.querySelector('[data-rpc-chain-id="1"]');
  earlyRpc.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  await controller.render();
  const documentRef = dom.window.document;
  assert.equal(documentRef.querySelector('[data-wallet-add-slot]').dataset.empty, 'false');
  assert.equal(documentRef.querySelector('[data-holding-add-slot]').dataset.empty, 'true');
  assert.equal(documentRef.querySelector('[data-etherscan-onboarding]').hidden, false);
  assert.equal(documentRef.querySelector('[data-status]').getAttribute('data-state'), 'neutral');
  assert.equal(documentRef.querySelector('[data-settings-advanced]').open, false);
  assert.match(documentRef.querySelector('[data-settings-advanced] summary').textContent, /Erweiterte/);
  const refreshButton = documentRef.querySelector('[data-refresh]');
  refreshButton.dispatchEvent(new dom.window.Event('click', { bubbles: true, cancelable: true }));
  assert.equal(refreshButton.disabled, true); assert.equal(refreshButton.getAttribute('aria-busy'), 'true');
  assert.equal(documentRef.querySelector('[data-status]').getAttribute('data-state'), 'busy');
  await flush();
  assert.equal(refreshButton.disabled, false); assert.equal(refreshButton.getAttribute('aria-busy'), 'false');
  assert.equal(documentRef.querySelector('[data-status]').getAttribute('data-state'), 'neutral');
  assert.equal(documentRef.querySelectorAll('[data-wallet-cancel]').length, 1);
  assert.equal(documentRef.querySelectorAll('[data-wallet-cancel-close]').length, 1);
  assert.equal(documentRef.querySelectorAll('[data-settings-close]').length, 1);
  assert.equal(documentRef.querySelectorAll('[data-settings-close-icon]').length, 1);
  assert.equal(documentRef.querySelector('[data-wallet-solana-network]'), null);
  assert.equal(documentRef.querySelector('[data-solana-options]'), null);
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
  assert.equal(documentRef.querySelector('[data-etherscan-onboarding]').hidden, true);
  documentRef.querySelector('[data-etherscan-key-delete]').dispatchEvent(new dom.window.Event('click', { bubbles: true, cancelable: true }));
  assert.equal(documentRef.querySelector('[data-key-delete-provider]').textContent, 'Etherscan');
  documentRef.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(documentRef.querySelector('[data-key-delete-dialog]').hidden, true);
  documentRef.querySelector('[data-key-delete-confirm]').click();
  documentRef.querySelector('[data-etherscan-key-delete]').click();
  documentRef.querySelector('[data-key-delete-confirm]').click();
  await flush();
  assert.equal(documentRef.querySelector('[data-etherscan-onboarding]').hidden, false);

  const add = documentRef.querySelector('[data-add-wallet]');
  add.dispatchEvent(new dom.window.Event('click', { bubbles: true, cancelable: true }));
  const address = documentRef.querySelector('[data-wallet-address]');
  const detectionResult = documentRef.querySelector('[data-wallet-detection-result]');
  const family = documentRef.querySelector('[data-wallet-family]');
  assert.equal(detectionResult.dataset.state, 'idle');
  assert.equal(documentRef.querySelector('[data-detection-icon-use]').getAttribute('href'), '#icon-scan');
  assert.match(documentRef.querySelector('[data-wallet-detection]').textContent, /eingeben|einfügen/i);
  assert.equal(family.hidden, true);
  assert.equal(family.disabled, true);
  documentRef.querySelector('[data-wallet-detect]').click();
  address.value = 'x'.repeat(257);
  documentRef.querySelector('[data-wallet-detect]').click();
  assert.equal(detectionResult.dataset.state, 'error');
  assert.equal(documentRef.querySelector('[data-detection-icon-use]').getAttribute('href'), '#icon-alert-circle');
  address.value = syntheticEvm;
  address.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.equal(documentRef.querySelector('[data-detection-icon-use]').getAttribute('href'), '#icon-loader');
  documentRef.querySelector('[data-wallet-detect]').dispatchEvent(new dom.window.Event('click', { bubbles: true, cancelable: true }));
  await flush();
  assert.equal(detectionResult.dataset.state, 'success');
  assert.equal(documentRef.querySelector('[data-detection-icon-use]').getAttribute('href'), '#icon-check-circle');
  assert.match(documentRef.querySelector('[data-wallet-detection]').textContent, /EVM/);
  assert.equal(family.value, 'evm');
  assert.equal(family.disabled, true);
  const allCommon = documentRef.querySelector('[data-wallet-all-evm]');
  const chainInput = documentRef.querySelector('[data-chain-id]');
  assert.equal(chainInput.disabled, true);
  assert.equal(documentRef.querySelector('[data-evm-chains]').hidden, true);
  allCommon.checked = false;
  allCommon.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.equal(chainInput.disabled, false);
  assert.equal(documentRef.querySelector('[data-evm-chains]').hidden, false);
  documentRef.querySelector('[data-wallet-label]').value = 'Manual without chain';
  documentRef.querySelector('[data-wallet-form]').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await flush();
  assert.match(documentRef.querySelector('[data-wallet-error]').textContent, /mindestens/i);
  assert.equal(documentRef.querySelector('[data-global-feedback]').hidden, false);
  documentRef.querySelector('[data-wallet-cancel-close]').dispatchEvent(new dom.window.Event('click', { bubbles: true, cancelable: true }));
  assert.equal(documentRef.activeElement, add);
  add.dispatchEvent(new dom.window.Event('click', { bubbles: true, cancelable: true }));
  documentRef.querySelector('[data-wallet-address]').value = syntheticEvm;
  documentRef.querySelector('[data-wallet-address]').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  documentRef.querySelector('[data-wallet-cancel]').dispatchEvent(new dom.window.Event('click', { bubbles: true, cancelable: true }));
  assert.equal(documentRef.activeElement, add);
  add.dispatchEvent(new dom.window.Event('click', { bubbles: true, cancelable: true }));
  documentRef.querySelector('[data-wallet-address]').value = syntheticEvm;
  documentRef.querySelector('[data-wallet-address]').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  documentRef.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(documentRef.querySelector('[data-wallet-dialog]').hidden, true);
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

  add.click();
  documentRef.querySelector('[data-wallet-address]').value = syntheticEvm;
  documentRef.querySelector('[data-wallet-address]').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  documentRef.querySelector('[data-wallet-action="edit"]').click();
  assert.match(documentRef.querySelector('[data-wallet-dialog-title]').textContent, /bearbeiten/i);
  documentRef.querySelector('[data-wallet-cancel]').click();

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
  const yahooProvider = documentRef.querySelector('[data-provider-id="yahoo.finance"]');
  const geckoProvider = documentRef.querySelector('[data-provider-id="coingecko.keyless"]');
  assert.equal(yahooProvider.checked, true);
  assert.equal(geckoProvider.checked, true);
  yahooProvider.checked = false;
  yahooProvider.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  await flush();
  assert.equal(state.settings.providerRefs.find(item => item.providerId === 'yahoo.finance').enabled, false);
  assert.match(documentRef.querySelector('[data-fmp-key-status]').textContent, /Keine automatische|No automatic/);
  yahooProvider.checked = true;
  yahooProvider.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  await flush();
  geckoProvider.checked = false;
  geckoProvider.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  await flush();
  assert.equal(state.settings.providerRefs.find(item => item.providerId === 'coingecko.keyless').enabled, false);
  geckoProvider.checked = true;
  geckoProvider.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  await flush();
  assert.equal(state.settings.providerRefs.find(item => item.providerId === 'coingecko.keyless').enabled, true);
  documentRef.querySelector('[data-setting-locale]').value = 'en';
  documentRef.querySelector('[data-setting-locale]').dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  await flush();
  assert.equal(documentRef.documentElement.lang, 'en');
  assert.equal(documentRef.querySelector('h1').textContent, 'Your portfolio at a glance.');
  assert.match(documentRef.querySelector('[data-footer-summary]').textContent, /^USD · EN · Dark$/);
  for (const status of ['rate-limited', 'error', 'partial', 'ok', 'empty']) {
    state = { ...state, sync: { schemaVersion: 1, statuses: [{ walletId: 'dom-wallet', family: 'evm', providerId: 'evm', status, lastAttemptAt: 1, lastSuccessAt: status === 'ok' ? 1 : null, errorCode: status === 'ok' ? null : status }] } };
    await controller.render();
    assert.equal(documentRef.querySelector('[data-status]').getAttribute('data-state'), ({ 'rate-limited': 'warning', error: 'error', partial: 'warning', ok: 'ready', empty: 'neutral' })[status]);
    if (status === 'ok') assert.match(documentRef.querySelector('[data-sync-summary]').textContent, /Last wallet synchronization/);
  }
  state = { ...state, settings: { ...state.settings, locale: 'de' }, sync: { schemaVersion: 1, statuses: [{ walletId: 'older', family: 'evm', providerId: 'evm', status: 'ok', lastAttemptAt: 1, lastSuccessAt: 1, errorCode: null }, { walletId: 'newer', family: 'evm', providerId: 'evm', status: 'ok', lastAttemptAt: 2000, lastSuccessAt: 2000, errorCode: null }] } };
  await controller.render();
  const expectedLatest = new Intl.DateTimeFormat('de-DE', { dateStyle: 'short', timeStyle: 'short' }).format(2000);
  assert.match(documentRef.querySelector('[data-sync-summary]').textContent, new RegExp(expectedLatest.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  add.click();
  documentRef.querySelector('[data-wallet-address]').value = syntheticEvm;
  documentRef.querySelector('[data-wallet-address]').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  disposeController();
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
  for (let attempt = 0; attempt < 20 && !pending.has(second); attempt += 1) await new Promise(resolve => setTimeout(resolve, 25));
  pending.get(second)({ ok: true, family: 'evm', normalized: second });
  await flush();
  pending.get(first)?.({ ok: true, family: 'bitcoin', normalized: first, network: 'mainnet' });
  await flush();
  assert.match(dom.window.document.querySelector('[data-wallet-detection]').textContent, /EVM/);
  assert.equal(dom.window.document.querySelector('[data-wallet-family]').value, 'evm');
  const third = `0x${'3'.repeat(40)}`; const changedWithoutEvent = `0x${'4'.repeat(40)}`;
  input.value = third; input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  for (let attempt = 0; attempt < 20 && !pending.has(third); attempt += 1) await new Promise(resolve => setTimeout(resolve, 25));
  input.value = changedWithoutEvent;
  pending.get(third)({ ok: true, family: 'bitcoin', normalized: third, network: 'mainnet' });
  await flush();
  assert.equal(dom.window.document.querySelector('[data-wallet-family]').value, 'evm');
});

test('real DOM supports offline instrument search, exact holdings CRUD, keyboard selection and FMP key status', async () => {
  const dom = await domFixture();
  const instrument = { providerId: 'fmp.market', providerSymbol: 'SYN@SYN', symbol: 'SYN', name: 'Synthetic World ETF', exchange: 'SYN', currency: 'EUR', type: 'unknown' };
  const resolvedInstrument = { ...instrument, type: 'etf' };
  let state = { schemaVersion: 4, settings: { ...settings(), providerRefs: [] }, positions: [], wallets: [], instruments: [], holdings: [] };
  let refreshCalls = 0;
  const pending = new Map();
  const api = {
    async getState() { return success(state); },
    async detectWalletAddress() { return { ok: false, code: 'invalid', message: 'synthetic' }; },
    async searchInstruments(query) { return new Promise(resolve => pending.set(query, resolve)); },
    async addHolding(input) { const next = { ...state, instruments: [{ ...resolvedInstrument, id: 'instrument-dom' }], holdings: [{ schemaVersion: 4, id: 'holding-dom', instrumentId: 'instrument-dom', quantityHundredths: input.quantity === '1.23' ? '123' : '450', quantity: input.quantity, updatedAt: 2 }] }; state = next; return success(next); },
    async updateHolding(id, input) { state = { ...state, holdings: state.holdings.map(item => item.id === id ? { ...item, quantity: input.quantity, quantityHundredths: input.quantity === '4.5' ? '450' : item.quantityHundredths } : item) }; return success(state); },
    async deleteHolding(id) { state = { ...state, holdings: state.holdings.filter(item => item.id !== id), instruments: [] }; return success(state); },
    async addWallet() { return success(state); }, async updateWallet() { return success(state); }, async deleteWallet() { return success(state); }, async copyWalletAddress() { return success({ copied: true }); },
    async refresh() { refreshCalls++; return success(state); }, async updateSettings(patch) { state = { ...state, settings: { ...state.settings, ...patch } }; return success(state); },
    async setEtherscanKey() { return success(state); }, async deleteEtherscanKey() { return success(state); }, async setFmpKey() { state = { ...state, settings: { ...state.settings, providerRefs: [{ providerId: 'fmp.market', keyId: 'ref_fmp.market_synthetic', enabled: true }] } }; return success(state); }, async deleteFmpKey() { state = { ...state, settings: { ...state.settings, providerRefs: [] } }; return success(state); },
    onMinute() { return () => undefined; }
  };
  const controller = createRendererController(dom.window.document, api);
  const disposeController = controller.start();
  await controller.render();
  const documentRef = dom.window.document;
  assert.equal(documentRef.querySelector('[data-wallet-add-slot]').dataset.empty, 'true');
  assert.equal(documentRef.querySelector('[data-holding-add-slot]').dataset.empty, 'true');
  assert.equal(documentRef.querySelector('[data-etherscan-onboarding]').hidden, false);
  documentRef.querySelector('[data-open-etherscan-settings]').click();
  assert.equal(documentRef.querySelector('[data-settings-dialog]').hidden, false);
  assert.equal(documentRef.activeElement, documentRef.querySelector('[data-etherscan-key]'));
  documentRef.querySelector('[data-settings-close]').click();
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
  pending.get('second')(success([instrument, { ...instrument, providerId: 'holdvue.catalog', symbol: 'STK', providerSymbol: 'STK@SYN', name: 'Synthetic Stock', type: 'stock' }]));
  await flush();
  pending.get('first')(success([{ ...instrument, symbol: 'OLD', providerSymbol: 'OLD@SYN' }]));
  await flush();
  assert.equal(documentRef.querySelectorAll('[data-instrument-index]').length, 2);
  assert.match(documentRef.querySelector('[data-instrument-suggestions]').textContent, /LOKAL/);
  assert.equal(documentRef.querySelector('[data-instrument-status]').textContent, '');
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
  quantity.value = '1,23';
  documentRef.querySelector('[data-holding-form]').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await flush();
  assert.equal(documentRef.querySelector('[data-holding-add-slot]').dataset.empty, 'false');
  assert.equal(state.holdings[0].quantity, '1.23');
  assert.equal(refreshCalls, 1);
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
  assert.equal(documentRef.querySelector('[data-instrument-search-field]').hidden, true);
  documentRef.querySelector('[data-holding-quantity]').value = '4.5';
  documentRef.querySelector('[data-holding-form]').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await flush();
  assert.equal(refreshCalls, 2);
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
  assert.equal(documentRef.querySelector('[data-key-delete-dialog]').hidden, false);
  assert.equal(documentRef.querySelector('[data-key-delete-provider]').textContent, 'FMP');
  documentRef.querySelector('[data-key-delete-cancel]').click();
  assert.equal(documentRef.querySelector('[data-key-delete-dialog]').hidden, true);
  documentRef.querySelector('[data-fmp-key-delete]').click();
  documentRef.querySelector('[data-key-delete-confirm]').click();
  await flush();
  assert.equal(documentRef.querySelector('[data-key-delete-dialog]').hidden, true);
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
  assert.match(documentRef.querySelector('[data-instrument-status]').textContent, /Keine passenden/i);
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
  assert.match(dom.window.document.querySelector('[data-holding-list]').textContent, /Noch kein Kurs/);
  current = { ...state, settings: { ...state.settings, currency: 'USD' }, prices: { ...state.prices, quotes: [], valuations: [{ assetId: 'instrument:instrument-price', quantityBaseUnits: '100', quantityDecimals: 2, priceEurScaled: null, priceUsdScaled: '1000000000000', valueEurScaled: null, valueUsdScaled: '1000000000000', dayChangeEurScaled: null, dayChangeUsdScaled: null, dayChangePercentScaled: null, status: 'valued' }] } };
  await controller.render(); assert.match(dom.window.document.querySelector('[data-holding-list]').textContent, /Noch kein Kurs/);
  current = { ...state, prices: { ...state.prices, quotes: [{ assetId: 'instrument:instrument-price', priceEurScaled: '1230000000000', priceUsdScaled: '1300000000000', scale: 12, change24hPercentScaled: null, previousPriceEurScaled: null, previousPriceUsdScaled: null, source: 'synthetic', sourceTimestamp: null, fetchedAt: 1 }], valuations: [{ assetId: 'instrument:instrument-price', quantityBaseUnits: '100', quantityDecimals: 2, priceEurScaled: '1230000000000', priceUsdScaled: '1300000000000', valueEurScaled: '1230000000000', valueUsdScaled: '1300000000000', dayChangeEurScaled: null, dayChangeUsdScaled: null, dayChangePercentScaled: null, status: 'valued' }], totalEurScaled: '1230000000000', totalUsdScaled: '1300000000000', valuedAssets: 1, totalAssets: 1, complete: true } };
  await controller.render(); assert.match(dom.window.document.querySelector('[data-holding-list]').textContent, /1,23/);
  for (const [source, expected] of [['yahoo.finance', 'Yahoo Finance'], ['fmp.market', 'FMP'], ['coingecko.keyless', 'CoinGecko']]) {
    current = { ...current, prices: { ...current.prices, quotes: [{ ...current.prices.quotes[0], source }] } };
    await controller.render();
    assert.match(dom.window.document.querySelector('[data-holding-list]').textContent, new RegExp(expected));
  }
  current = { ...current, settings: { ...current.settings, currency: 'USD' }, prices: { ...current.prices, quotes: [{ ...current.prices.quotes[0], priceEurScaled: null, priceUsdScaled: null }], valuations: [] } };
  await controller.render(); assert.match(dom.window.document.querySelector('[data-holding-list]').textContent, /Noch kein Kurs/);
  current = { ...current, settings: { ...current.settings, locale: 'en' }, prices: { ...current.prices, quotes: [{ ...current.prices.quotes[0], priceEurScaled: '1230000000000', priceUsdScaled: '1300000000000' }] } };
  await controller.render(); assert.match(dom.window.document.querySelector('[data-holding-list]').textContent, /USD/);
});

test('local catalog selection explains keyless save and unconfigured price CTA opens FMP settings', async () => {
  const dom = await domFixture();
  const candidate = { providerId: 'holdvue.catalog', providerSymbol: 'EUNL.DE', symbol: 'EUNL', name: 'Synthetic MSCI World ETF', exchange: 'XETRA', currency: 'EUR', type: 'etf' };
  let searchCandidate = candidate;
  let state = {
    schemaVersion: 5,
    settings: { ...settings(), providerRefs: undefined },
    positions: [],
    wallets: [],
    instruments: [],
    holdings: [],
    sync: { schemaVersion: 1, statuses: [] },
    prices: { quotes: [], statuses: [], valuations: [], history: [], totalEurScaled: null, totalUsdScaled: null, complete: false, valuedAssets: 0, totalAssets: 0, dayChangeEurScaled: null, dayChangeUsdScaled: null, dayChangePercentScaled: null }
  };
  const api = {
    async getState() { return success(state); },
    async searchInstruments() { return success([searchCandidate]); },
    async addHolding(input) {
      state = { ...state, instruments: [{ ...candidate, schemaVersion: 4, id: 'instrument-eunl' }], holdings: [{ schemaVersion: 4, id: 'holding-eunl', instrumentId: 'instrument-eunl', quantityHundredths: '100', quantity: input.quantity, updatedAt: 1 }], prices: { ...state.prices, statuses: [], totalAssets: 1 } };
      return success(state);
    },
    async updateHolding() { return success(state); }, async deleteHolding() { return success(state); },
    async addWallet() { return success(state); }, async updateWallet() { return success(state); }, async deleteWallet() { return success(state); }, async copyWalletAddress() { return success({ copied: true }); },
    async refresh() { return success(state); }, async updateSettings(patch) { state = { ...state, settings: { ...state.settings, ...patch } }; return success(state); },
    async setEtherscanKey() { return success(state); }, async deleteEtherscanKey() { return success(state); }, async setFmpKey() { return success(state); }, async deleteFmpKey() { return success(state); },
    onMinute() { return () => undefined; }
  };
  const controller = createRendererController(dom.window.document, api);
  const dispose = controller.start();
  await controller.render();
  const documentRef = dom.window.document;
  searchCandidate = { ...candidate, providerId: 'fmp.market' };
  documentRef.querySelector('[data-add-holding]').click();
  documentRef.querySelector('[data-instrument-search]').value = 'fmp-unconfigured';
  documentRef.querySelector('[data-instrument-search]').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 315));
  documentRef.querySelector('[data-instrument-index="0"]').click();
  assert.match(documentRef.querySelector('[data-instrument-price-hint]').textContent, /Yahoo Finance/i);
  documentRef.querySelector('[data-holding-cancel]').click();
  searchCandidate = candidate;
  documentRef.querySelector('[data-add-holding]').click();
  const search = documentRef.querySelector('[data-instrument-search]');
  search.value = 'eunl';
  search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 315));
  documentRef.querySelector('[data-instrument-index="0"]').click();
  assert.match(documentRef.querySelector('[data-instrument-price-hint]').textContent, /ohne Key|without a key/i);
  documentRef.querySelector('[data-holding-quantity]').value = '1';
  documentRef.querySelector('[data-holding-form]').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(documentRef.querySelector('[data-position-count]').textContent, '1');
  const holdingText = documentRef.querySelector('[data-holding-list]').textContent;
  assert.match(holdingText, /Noch kein Kurs/);
  assert.doesNotMatch(holdingText, /Preis nicht verfügbar ·/);
  assert.equal(documentRef.querySelector('[data-price-source-setup]'), null);
  state = { ...state, settings: { ...state.settings, providerRefs: [{ providerId: 'yahoo.finance', keyId: null, enabled: false }] }, prices: { ...state.prices, statuses: [] } };
  await controller.render();
  documentRef.querySelector('[data-add-holding]').click();
  documentRef.querySelector('[data-instrument-search]').value = 'local-disabled';
  documentRef.querySelector('[data-instrument-search]').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 315));
  documentRef.querySelector('[data-instrument-index="0"]').click();
  assert.match(documentRef.querySelector('[data-instrument-price-hint]').textContent, /Yahoo Finance/i);
  documentRef.querySelector('[data-holding-cancel]').click();
  const setup = documentRef.querySelector('[data-price-source-setup]');
  assert.ok(setup);
  setup.click();
  assert.equal(documentRef.querySelector('[data-settings-dialog]').hidden, false);
  assert.equal(documentRef.activeElement, documentRef.querySelector('[data-provider-id="yahoo.finance"]'));
  assert.match(documentRef.querySelector('[data-fmp-key]').previousElementSibling.textContent, /optional|Fallback/i);
  documentRef.querySelector('[data-settings-close]').click();
  documentRef.querySelector('[data-provider-id="yahoo.finance"]').remove();
  setup.click();
  assert.equal(documentRef.activeElement, documentRef.querySelector('[data-fmp-key]'));
  documentRef.querySelector('[data-settings-close]').click();
  documentRef.querySelector('[data-holding-action="edit"]').click();
  assert.match(documentRef.querySelector('[data-instrument-price-hint]').textContent, /Yahoo Finance|automatische Standardkurse/i);
  documentRef.querySelector('[data-holding-cancel]').click();
  state = { ...state, settings: { ...state.settings, providerRefs: [{ providerId: 'fmp.market', keyId: 'ref_fmp.market_synthetic', enabled: true }] } };
  await controller.render();
  documentRef.querySelector('[data-holding-action="edit"]').click();
  assert.match(documentRef.querySelector('[data-instrument-price-hint]').textContent, /Yahoo|keyless|konfiguriert|configured/i);
  documentRef.querySelector('[data-holding-cancel]').click();
  documentRef.querySelector('[data-add-holding]').click();
  const configuredSearch = documentRef.querySelector('[data-instrument-search]');
  configuredSearch.value = 'configured-local';
  configuredSearch.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 315));
  documentRef.querySelector('[data-instrument-index="0"]').click();
  assert.match(documentRef.querySelector('[data-instrument-price-hint]').textContent, /Yahoo Finance|keyless|automatische Kurse sind aktiv|automatic prices are active/i);
  documentRef.querySelector('[data-holding-cancel]').click();
  searchCandidate = { ...candidate, providerId: 'fmp.market' };
  documentRef.querySelector('[data-add-holding]').click();
  configuredSearch.value = 'configured-remote';
  configuredSearch.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 315));
  documentRef.querySelector('[data-instrument-index="0"]').click();
  assert.match(documentRef.querySelector('[data-instrument-price-hint]').textContent, /Yahoo Finance|FMP-Fallback|automatische Aktien.*aktiv|automatic stock.*active/i);
  documentRef.querySelector('[data-holding-cancel]').click();
  state = { ...state, instruments: state.instruments.map(instrument => ({ ...instrument, providerId: 'fmp.market' })) };
  await controller.render();
  documentRef.querySelector('[data-holding-action="edit"]').click();
  assert.match(documentRef.querySelector('[data-instrument-price-hint]').textContent, /Yahoo Finance|FMP-Fallback|automatische Aktien.*aktiv|automatic stock.*active/i);
  documentRef.querySelector('[data-holding-cancel]').click();
  for (const [status, expected] of [['partial', 'teilweise'], ['rate-limited', 'Limit'], ['error', 'nicht erreichbar'], ['aborted', 'nicht erreichbar'], ['ok', 'Preis noch nicht verfügbar']]) {
    state = { ...state, prices: { ...state.prices, statuses: [{ assetId: 'instrument:instrument-eunl', providerId: 'fmp.market', status, errorCode: null, lastGoodFetchedAt: null }] } };
    await controller.render();
    assert.match(documentRef.querySelector('[data-holding-list]').textContent, new RegExp(expected, 'i'));
  }
  state = { ...state, prices: { ...state.prices, quotes: [{ assetId: 'instrument:instrument-eunl', priceEurScaled: '1000000000000', priceUsdScaled: '1100000000000', scale: 12, change24hPercentScaled: null, change24hEurPercentScaled: null, change24hUsdPercentScaled: null, previousPriceEurScaled: null, previousPriceUsdScaled: null, source: 'synthetic', sourceTimestamp: null, fetchedAt: 1 }], statuses: [{ assetId: 'instrument:instrument-eunl', providerId: 'fmp.market', status: 'stale', errorCode: 'timeout', lastGoodFetchedAt: 1 }] } };
  await controller.render();
  assert.match(documentRef.querySelector('[data-holding-list]').textContent, /Letzter Kurs|1,00/);
  dispose();
});
