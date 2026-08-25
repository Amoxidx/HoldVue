import assert from 'node:assert/strict';
import test from 'node:test';
import { createRendererController } from '../src/renderer/renderer-app.ts';

class FakeElement {
  constructor(documentRef) { this.documentRef = documentRef; this.textContent = ''; this.innerHTML = ''; this.value = ''; this.checked = false; this.hidden = true; this.dataset = {}; this.listeners = new Map(); this.attributes = new Map(); this.children = []; this.open = false; }
  addEventListener(type, callback) { const list = this.listeners.get(type) ?? []; list.push(callback); this.listeners.set(type, list); }
  removeEventListener(type, callback) { this.listeners.set(type, (this.listeners.get(type) ?? []).filter(item => item !== callback)); }
  dispatch(type, extra = {}) { const event = { preventDefault() { this.prevented = true; }, currentTarget: this, target: this, ...extra }; for (const callback of this.listeners.get(type) ?? []) callback(event); return event; }
  setAttribute(name, value) { this.attributes.set(name, value); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  focus() { this.documentRef.activeElement = this; }
  showModal() { this.open = true; }
  close() { this.open = false; }
  querySelector(selector) { return selector === 'input[data-chain-id]' ? this.children[0] ?? null : null; }
  querySelectorAll(selector) { if (selector.includes('data-wallet-action')) return this.children; if (selector.includes('data-chain-id')) return this.children; return []; }
  set innerHTML(value) { this._innerHTML = value; if (value.includes('data-wallet-action')) { const ids = [...value.matchAll(/data-wallet-action="([^"]+)" data-wallet-id="([^"]+)"/g)]; this.children = ids.map(match => { const button = new FakeElement(this.documentRef); button.attributes.set('data-wallet-action', match[1]); button.attributes.set('data-wallet-id', match[2]); return button; }); } }
  get innerHTML() { return this._innerHTML; }
}

function syntheticWallet(family, id, address, options) { return { schemaVersion: 2, id, label: id, family, address, enabled: true, createdAt: 1, options }; }

function fixture() {
  const selectors = ['[data-status]', '[data-position-count]', '[data-wallet-list]', '[data-settings-wallet-list]', '[data-wallet-dialog]', '[data-wallet-form]', '[data-delete-dialog]', '[data-settings-dialog]', '[data-wallet-error]', '[data-add-wallet]', '[data-open-settings]', '[data-wallet-address]', '[data-wallet-label]', '[data-wallet-family]', '[data-wallet-enabled]', '[data-wallet-all-evm]', '[data-evm-options]', '[data-evm-chains]', '[data-wallet-detection]', '[data-wallet-cancel]', '[data-delete-cancel]', '[data-delete-confirm]', '[data-delete-wallet-label]', '[data-settings-close]', '[data-setting-currency]', '[data-setting-locale]', '[data-setting-theme]', '[data-setting-scheduler]', '[data-setting-spam]', '[data-setting-hidden-spam]'];
  const documentRef = { documentElement: { lang: 'de', dataset: {} }, activeElement: null, elements: new Map(), listeners: new Map(), querySelector(selector) { return this.elements.get(selector) ?? null; }, addEventListener(type, callback) { const list = this.listeners.get(type) ?? []; list.push(callback); this.listeners.set(type, list); }, removeEventListener(type, callback) { this.listeners.set(type, (this.listeners.get(type) ?? []).filter(item => item !== callback)); }, dispatch(type, extra = {}) { for (const callback of this.listeners.get(type) ?? []) callback({ key: extra.key, preventDefault() {} }); } };
  for (const selector of selectors) documentRef.elements.set(selector, new FakeElement(documentRef));
  documentRef.elements.get('[data-wallet-dialog]').hidden = true;
  documentRef.elements.get('[data-delete-dialog]').hidden = true;
  documentRef.elements.get('[data-settings-dialog]').hidden = true;
  const chainContainer = documentRef.elements.get('[data-evm-chains]');
  chainContainer.children = [1, 8453].map(id => { const input = new FakeElement(documentRef); input.value = String(id); input.checked = false; return input; });
  return documentRef;
}

function stateWithWallets() {
  return { schemaVersion: 2, settings: { schemaVersion: 2, currency: 'EUR', locale: 'de', theme: 'dark', schedulerEnabled: true, spamFilterEnabled: true, showHiddenSpamAssets: false, enabledChainIds: [], customChains: [], rpcOverrides: [], providerRefs: [] }, positions: [], wallets: [
    syntheticWallet('evm', 'evm-synthetic', `0x${'1'.repeat(40)}`, { autoScanCommonChains: true, chainIds: [] }),
    syntheticWallet('evm', 'evm-selected', `0x${'2'.repeat(40)}`, { autoScanCommonChains: false, chainIds: [1] }),
    syntheticWallet('bitcoin', 'btc-synthetic', 'btc-synthetic', { network: 'mainnet', addressType: 'address' }),
    syntheticWallet('solana', 'sol-synthetic', 'sol-synthetic', { network: 'devnet' }),
    syntheticWallet('cardano', 'ada-synthetic', 'ada-synthetic', { network: 'testnet' })
  ], sync: { schemaVersion: 1, statuses: [{ walletId: 'evm-synthetic', family: 'evm', providerId: 'evm', status: 'partial', lastAttemptAt: 1, lastSuccessAt: 1, errorCode: 'unconfigured' }] } };
}

test('renderer wallet onboarding, management, settings, copy, confirmation, keyboard and minute refresh are behavioral', async () => {
  const documentRef = fixture();
  let state = stateWithWallets();
  let minute;
  let nextFamily = 'evm';
  let clipboardMode = 'ok';
  let settingsFailure = false;
  const clipboard = { async writeText(value) { assert.equal(typeof value, 'string'); if (clipboardMode === 'fail') throw new Error('synthetic'); } };
  const success = value => ({ ok: true, value });
  const api = {
    async getState() { return success(state); },
    async detectWalletAddress(address) { return nextFamily === 'invalid' ? { ok: false, code: 'invalid', message: 'Synthetic invalid address.' } : { ok: true, family: nextFamily, normalized: address, network: nextFamily === 'solana' ? undefined : nextFamily === 'cardano' ? 'testnet' : nextFamily === 'bitcoin' ? 'mainnet' : undefined, kind: nextFamily === 'bitcoin' ? 'xpub' : undefined }; },
    async addWallet(input) { const wallet = syntheticWallet(input.family, `added-${state.wallets.length}`, input.address, input.options); state = { ...state, wallets: [...state.wallets, wallet] }; return success(state); },
    async updateWallet(id, input) { state = { ...state, wallets: state.wallets.map(wallet => wallet.id === id ? { ...wallet, ...input, options: input.options ?? wallet.options } : wallet) }; return success(state); },
    async deleteWallet(id) { state = { ...state, wallets: state.wallets.filter(wallet => wallet.id !== id) }; return success(state); },
    async refresh() { return success(state); },
    async updateSettings(patch) { if (settingsFailure) return { ok: false, code: 'storage-failed', message: 'Synthetic settings failure.' }; state = { ...state, settings: { ...state.settings, ...patch } }; return success(state); },
    async copyWalletAddress(id) { if (!state.wallets.some(wallet => wallet.id === id)) return { ok: false, code: 'not-found', message: 'Synthetic missing wallet.' }; if (clipboardMode === 'fail') return { ok: false, code: 'clipboard-failed', message: 'Synthetic clipboard failure.' }; return success({ copied: true }); },
    onMinute(callback) { minute = callback; return () => { minute = null; }; }
  };
  const controller = createRendererController(documentRef, api, { clipboard });
  const dispose = controller.start();
  await controller.render();
  assert.match(documentRef.elements.get('[data-wallet-list]').innerHTML, /evm-synthetic/);
  assert.equal(documentRef.elements.get('[data-position-count]').textContent, '0');
  assert.equal(documentRef.documentElement.dataset.state, 'ready');
  controller.start();
  assert.equal(documentRef.elements.get('[data-add-wallet]').listeners.get('click').length, 1);

  documentRef.elements.get('[data-add-wallet]').dispatch('click');
  assert.equal(documentRef.elements.get('[data-wallet-dialog]').hidden, false);
  documentRef.elements.get('[data-wallet-address]').value = `0x${'4'.repeat(40)}`;
  documentRef.elements.get('[data-wallet-label]').value = 'Added synthetic';
  documentRef.elements.get('[data-wallet-all-evm]').checked = false;
  documentRef.elements.get('[data-evm-chains]').children[0].checked = true;
  documentRef.elements.get('[data-wallet-address]').dispatch('input');
  await Promise.resolve();
  assert.match(documentRef.elements.get('[data-wallet-detection]').textContent, /EVM/);
  documentRef.elements.get('[data-wallet-form]').dispatch('submit');
  await Promise.resolve();
  assert.equal(state.wallets.length, 6);

  nextFamily = 'solana';
  documentRef.elements.get('[data-add-wallet]').dispatch('click');
  documentRef.elements.get('[data-wallet-address]').value = 'solana-synthetic';
  documentRef.elements.get('[data-wallet-label]').value = 'Sol synthetic';
  documentRef.elements.get('[data-wallet-address]').dispatch('input');
  await Promise.resolve();
  documentRef.elements.get('[data-wallet-form]').dispatch('submit');
  await Promise.resolve();
  assert.equal(state.wallets.at(-1).family, 'solana');
  assert.equal(state.wallets.at(-1).options.network, 'mainnet-beta');

  nextFamily = 'bitcoin';
  documentRef.elements.get('[data-add-wallet]').dispatch('click');
  documentRef.elements.get('[data-wallet-address]').value = 'bitcoin-synthetic';
  documentRef.elements.get('[data-wallet-label]').value = 'BTC synthetic';
  documentRef.elements.get('[data-wallet-address]').dispatch('input');
  await Promise.resolve();
  documentRef.elements.get('[data-wallet-form]').dispatch('submit');
  await Promise.resolve();
  nextFamily = 'cardano';
  documentRef.elements.get('[data-add-wallet]').dispatch('click');
  documentRef.elements.get('[data-wallet-address]').value = 'cardano-synthetic';
  documentRef.elements.get('[data-wallet-label]').value = 'ADA synthetic';
  documentRef.elements.get('[data-wallet-address]').dispatch('input');
  await Promise.resolve();
  documentRef.elements.get('[data-wallet-form]').dispatch('submit');
  await Promise.resolve();
  assert.equal(state.wallets.at(-1).family, 'cardano');

  const editButton = documentRef.elements.get('[data-wallet-list]').children.find(button => button.getAttribute('data-wallet-action') === 'edit');
  editButton.dispatch('click');
  documentRef.elements.get('[data-wallet-label]').value = 'Edited synthetic';
  documentRef.elements.get('[data-wallet-form]').dispatch('submit');
  await Promise.resolve();
  assert.equal(state.wallets[0].label, 'Edited synthetic');
  const copyButton = documentRef.elements.get('[data-wallet-list]').children.find(button => button.getAttribute('data-wallet-action') === 'copy');
  copyButton.dispatch('click');
  await Promise.resolve();
  clipboardMode = 'fail';
  copyButton.dispatch('click');
  await Promise.resolve();

  const deleteButton = documentRef.elements.get('[data-wallet-list]').children.find(button => button.getAttribute('data-wallet-action') === 'delete');
  deleteButton.dispatch('click');
  assert.equal(documentRef.elements.get('[data-delete-dialog]').hidden, false);
  documentRef.elements.get('[data-delete-cancel]').dispatch('click');
  assert.equal(documentRef.activeElement, deleteButton);
  deleteButton.dispatch('click');
  documentRef.elements.get('[data-delete-confirm]').dispatch('click');
  await Promise.resolve();
  assert.equal(state.wallets.length, 8);

  documentRef.elements.get('[data-open-settings]').dispatch('click');
  documentRef.elements.get('[data-setting-currency]').value = 'USD';
  documentRef.elements.get('[data-setting-currency]').dispatch('change');
  documentRef.elements.get('[data-setting-locale]').value = 'en';
  documentRef.elements.get('[data-setting-locale]').dispatch('change');
  documentRef.elements.get('[data-setting-theme]').value = 'light';
  documentRef.elements.get('[data-setting-theme]').dispatch('change');
  for (const selector of ['[data-setting-scheduler]', '[data-setting-spam]', '[data-setting-hidden-spam]']) documentRef.elements.get(selector).checked = false;
  documentRef.elements.get('[data-setting-scheduler]').dispatch('change');
  documentRef.elements.get('[data-setting-spam]').dispatch('change');
  documentRef.elements.get('[data-setting-hidden-spam]').dispatch('change');
  await Promise.resolve();
  assert.equal(state.settings.currency, 'USD');
  settingsFailure = true;
  documentRef.elements.get('[data-setting-theme]').dispatch('change');
  await Promise.resolve();
  assert.match(documentRef.elements.get('[data-wallet-error]').textContent, /updated|aktualisiert/i);
  settingsFailure = false;
  documentRef.dispatch('keydown', { key: 'Escape' });
  assert.equal(documentRef.elements.get('[data-settings-dialog]').hidden, true);
  minute?.();
  await Promise.resolve();
  dispose();
  assert.equal(minute, null);

  nextFamily = 'invalid';
  documentRef.elements.get('[data-add-wallet]').dispatch('click');
  documentRef.elements.get('[data-wallet-address]').value = 'bad';
  documentRef.elements.get('[data-wallet-address]').dispatch('input');
  await Promise.resolve();
  assert.equal(documentRef.elements.get('[data-wallet-error]').hidden, false);

  const invalidApi = { ...api, async getState() { return { unexpected: true }; }, onMinute() { return () => undefined; } };
  const invalidDocument = fixture();
  await createRendererController(invalidDocument, invalidApi).render();
  assert.equal(invalidDocument.documentElement.dataset.state, 'error');
  const minimalDocument = { documentElement: { lang: 'de', dataset: {} }, querySelector: () => null };
  await createRendererController(minimalDocument, api).render();
  const noButtonsDocument = fixture();
  noButtonsDocument.elements.get('[data-wallet-list]').querySelectorAll = undefined;
  await createRendererController(noButtonsDocument, api).render();
  const noDialogMethods = fixture();
  noDialogMethods.elements.get('[data-wallet-dialog]').showModal = undefined;
  noDialogMethods.elements.get('[data-wallet-dialog]').close = undefined;
  const noDialogController = createRendererController(noDialogMethods, api);
  noDialogController.start();
  await Promise.resolve();
  noDialogMethods.elements.get('[data-add-wallet]').dispatch('click');
  noDialogMethods.elements.get('[data-wallet-cancel]').dispatch('click');
  noDialogMethods.elements.get('[data-open-settings]').dispatch('click');
  noDialogMethods.elements.get('[data-settings-close]').dispatch('click');
  const noAddressDocument = fixture();
  noAddressDocument.elements.delete('[data-wallet-address]');
  const noAddressController = createRendererController(noAddressDocument, api);
  noAddressController.start();
  await noAddressController.render();
  noAddressDocument.elements.get('[data-add-wallet]').dispatch('click');
  const noFocusDocument = fixture();
  noFocusDocument.elements.get('[data-wallet-address]').focus = undefined;
  const noFocusController = createRendererController(noFocusDocument, api);
  noFocusController.start();
  await noFocusController.render();
  noFocusDocument.elements.get('[data-add-wallet]').dispatch('click');
  const noStateDocument = fixture();
  const noStateController = createRendererController(noStateDocument, api);
  noStateController.start();
  const noStateDelete = new FakeElement(noStateDocument);
  noStateDelete.attributes.set('data-wallet-action', 'delete');
  noStateDelete.attributes.set('data-wallet-id', 'missing-before-render');
  noStateDocument.elements.get('[data-wallet-list]').querySelectorAll = () => [noStateDelete];
  noStateDelete.dispatch('click');
  await Promise.resolve();

  // Exercise the renderer's fail-closed and optional DOM paths with only synthetic state.
  nextFamily = 'evm';
  const branchState = { ...state, settings: { ...state.settings, locale: 'en' }, wallets: [
    ...state.wallets,
    syntheticWallet('bitcoin', 'no-network-synthetic', 'no-network-synthetic', {}),
    syntheticWallet('solana', 'beta-synthetic', 'beta-synthetic', { network: 'mainnet-beta' }),
    syntheticWallet('cardano', 'unknown-network-synthetic', 'unknown-network-synthetic', { network: 'unknown' }),
    { ...syntheticWallet('evm', 'disabled-synthetic', `0x${'5'.repeat(40)}`, { autoScanCommonChains: true, chainIds: [] }), enabled: false }
  ] };
  const branchApi = { ...api, async getState() { return success(branchState); } };
  const branchDocument = fixture();
  const branchController = createRendererController(branchDocument, branchApi, { clipboard });
  await branchController.render();
  assert.match(branchDocument.elements.get('[data-wallet-list]').innerHTML, /All common chains/);

  const emptyDocument = fixture();
  await createRendererController(emptyDocument, { ...branchApi, async getState() { return success({ ...branchState, wallets: [] }); } }).render();
  assert.match(emptyDocument.elements.get('[data-wallet-list]').innerHTML, /No wallets connected/);
  const nullDocument = fixture();
  await createRendererController(nullDocument, { ...branchApi, async getState() { return null; } }).render();
  assert.equal(nullDocument.documentElement.dataset.state, 'error');
  const malformedDocument = fixture();
  await createRendererController(malformedDocument, { ...branchApi, async getState() { return { settings: branchState.settings, positions: null }; } }).render();
  assert.equal(malformedDocument.documentElement.dataset.state, 'error');
  const legacyDocument = fixture();
  await createRendererController(legacyDocument, { ...branchApi, async getState() { return { settings: branchState.settings, positions: [] }; } }).render();
  assert.match(legacyDocument.elements.get('[data-wallet-list]').innerHTML, /No wallets connected/);
  const legacyFullDocument = fixture();
  await createRendererController(legacyFullDocument, { ...branchApi, async getState() { return { settings: branchState.settings, positions: [], wallets: [] }; } }).render();
  assert.match(legacyFullDocument.elements.get('[data-wallet-list]').innerHTML, /No wallets connected/);

  const noContainerDocument = fixture();
  noContainerDocument.elements.delete('[data-evm-chains]');
  const noContainerController = createRendererController(noContainerDocument, branchApi, { clipboard });
  noContainerController.start();
  await noContainerController.render();
  noContainerDocument.elements.get('[data-add-wallet]').dispatch('click');
  noContainerDocument.elements.get('[data-wallet-address]').value = `0x${'6'.repeat(40)}`;
  noContainerDocument.elements.get('[data-wallet-label]').value = 'No chains synthetic';
  noContainerDocument.elements.get('[data-wallet-all-evm]').checked = false;
  noContainerDocument.elements.get('[data-wallet-address]').dispatch('input');
  await Promise.resolve();
  noContainerDocument.elements.get('[data-wallet-form]').dispatch('submit');
  await Promise.resolve();

  const noKindDocument = fixture();
  const noKindApi = { ...branchApi, async detectWalletAddress(address) { return { ok: true, family: 'bitcoin', normalized: address, network: 'mainnet' }; } };
  const noKindController = createRendererController(noKindDocument, noKindApi, { clipboard });
  noKindController.start();
  await noKindController.render();
  noKindDocument.elements.get('[data-add-wallet]').dispatch('click');
  noKindDocument.elements.get('[data-wallet-address]').value = 'bitcoin-address-synthetic';
  noKindDocument.elements.get('[data-wallet-label]').value = 'Bitcoin address synthetic';
  noKindDocument.elements.get('[data-wallet-address]').dispatch('input');
  await Promise.resolve();
  noKindDocument.elements.get('[data-wallet-form]').dispatch('submit');
  await Promise.resolve();

  const solanaEdit = branchDocument.elements.get('[data-wallet-list]').children.find(button => button.getAttribute('data-wallet-action') === 'edit' && button.getAttribute('data-wallet-id') === 'sol-synthetic');
  solanaEdit?.dispatch('click');
  branchDocument.elements.get('[data-wallet-cancel]').dispatch('click');
  const selectedEdit = branchDocument.elements.get('[data-wallet-list]').children.find(button => button.getAttribute('data-wallet-action') === 'edit' && button.getAttribute('data-wallet-id') === 'evm-selected');
  selectedEdit?.dispatch('click');
  branchDocument.elements.get('[data-wallet-cancel]').dispatch('click');
  const missingDelete = new FakeElement(branchDocument);
  missingDelete.attributes.set('data-wallet-action', 'delete');
  missingDelete.attributes.set('data-wallet-id', 'evm-selected');
  missingDelete.focus = undefined;
  branchDocument.elements.get('[data-wallet-list]').querySelectorAll = () => [missingDelete];
  await branchController.render();
  missingDelete.dispatch('click');
  branchDocument.elements.get('[data-delete-cancel]').dispatch('click');
  const noWalletDelete = new FakeElement(branchDocument);
  noWalletDelete.attributes.set('data-wallet-action', 'delete');
  noWalletDelete.attributes.set('data-wallet-id', 'missing-synthetic');
  branchDocument.elements.get('[data-wallet-list]').querySelectorAll = () => [noWalletDelete];
  await branchController.render();
  assert.equal(noWalletDelete.listeners.get('click')?.length, 1);
  noWalletDelete.dispatch('click');

  const incomplete = new FakeElement(branchDocument);
  branchDocument.elements.get('[data-wallet-list]').querySelectorAll = () => [incomplete];
  await branchController.render();
  const badCopy = new FakeElement(branchDocument);
  badCopy.attributes.set('data-wallet-action', 'copy');
  badCopy.attributes.set('data-wallet-id', 'not-present');
  branchDocument.elements.get('[data-wallet-list]').querySelectorAll = () => [badCopy];
  await branchController.render();
  badCopy.dispatch('click');

  const missingSettings = fixture();
  missingSettings.elements.delete('[data-settings-dialog]');
  const missingSettingsController = createRendererController(missingSettings, branchApi);
  missingSettingsController.start();
  await missingSettingsController.render();
  const settingsButton = missingSettings.elements.get('[data-open-settings]');
  settingsButton.dispatch('click');

  const emptyInputDocument = fixture();
  const emptyInputController = createRendererController(emptyInputDocument, branchApi);
  emptyInputController.start();
  await emptyInputController.render();
  emptyInputDocument.elements.get('[data-add-wallet]').dispatch('click');
  emptyInputDocument.elements.get('[data-wallet-address]').value = undefined;
  emptyInputDocument.elements.get('[data-wallet-address]').dispatch('input');
  await Promise.resolve();
  emptyInputDocument.elements.get('[data-wallet-address]').value = 'bad-synthetic';
  emptyInputDocument.elements.get('[data-wallet-address]').dispatch('input');
  await Promise.resolve();

  const throwingDetectDocument = fixture();
  const throwingDetectApi = { ...branchApi, async detectWalletAddress() { throw new Error('synthetic detection failure'); } };
  const throwingDetectController = createRendererController(throwingDetectDocument, throwingDetectApi);
  throwingDetectController.start();
  await throwingDetectController.render();
  throwingDetectDocument.elements.get('[data-add-wallet]').dispatch('click');
  throwingDetectDocument.elements.get('[data-wallet-address]').value = 'throwing-synthetic';
  throwingDetectDocument.elements.get('[data-wallet-address]').dispatch('input');
  await Promise.resolve();

  const invalidFormDocument = fixture();
  const invalidFormController = createRendererController(invalidFormDocument, branchApi);
  invalidFormController.start();
  await invalidFormController.render();
  invalidFormDocument.elements.get('[data-add-wallet]').dispatch('click');
  invalidFormDocument.elements.get('[data-wallet-address]').value = `0x${'7'.repeat(40)}`;
  invalidFormDocument.elements.get('[data-wallet-label]').value = '';
  invalidFormDocument.elements.get('[data-wallet-address]').dispatch('input');
  await Promise.resolve();
  invalidFormDocument.elements.get('[data-wallet-form]').dispatch('submit');

  const staleDocument = fixture();
  const staleController = createRendererController(staleDocument, branchApi);
  staleController.start();
  await staleController.render();
  staleDocument.elements.get('[data-add-wallet]').dispatch('click');
  staleDocument.elements.get('[data-wallet-address]').value = `0x${'8'.repeat(40)}`;
  staleDocument.elements.get('[data-wallet-label]').value = 'Stale synthetic';
  staleDocument.elements.get('[data-wallet-address]').dispatch('input');
  await Promise.resolve();
  staleDocument.elements.get('[data-wallet-address]').value = `0x${'9'.repeat(40)}`;
  staleDocument.elements.get('[data-wallet-form]').dispatch('submit');
  await Promise.resolve();

  const staleInvalidDocument = fixture();
  let staleDetectCalls = 0;
  const staleInvalidApi = { ...branchApi, async detectWalletAddress(address) { staleDetectCalls++; return staleDetectCalls === 1 ? { ok: true, family: 'evm', normalized: address } : { ok: false, code: 'invalid', message: 'Synthetic invalid address.' }; } };
  const staleInvalidController = createRendererController(staleInvalidDocument, staleInvalidApi);
  staleInvalidController.start();
  await staleInvalidController.render();
  staleInvalidDocument.elements.get('[data-add-wallet]').dispatch('click');
  staleInvalidDocument.elements.get('[data-wallet-address]').value = `0x${'a'.repeat(40)}`;
  staleInvalidDocument.elements.get('[data-wallet-label]').value = 'Stale invalid synthetic';
  staleInvalidDocument.elements.get('[data-wallet-address]').dispatch('input');
  await Promise.resolve();
  staleInvalidDocument.elements.get('[data-wallet-address]').value = `0x${'b'.repeat(40)}`;
  staleInvalidDocument.elements.get('[data-wallet-form]').dispatch('submit');
  await Promise.resolve();

  let mutationMode = 'invalid';
  const mutationDocument = fixture();
  const mutationApi = { ...branchApi, async updateSettings() { if (mutationMode === 'invalid') { mutationMode = 'throw'; return { ok: true, value: null }; } throw new Error('synthetic mutation failure'); } };
  const mutationController = createRendererController(mutationDocument, mutationApi);
  mutationController.start();
  await mutationController.render();
  mutationDocument.elements.get('[data-setting-theme]').dispatch('change');
  await Promise.resolve();
  mutationDocument.elements.get('[data-setting-theme]').dispatch('change');
  await Promise.resolve();
  mutationDocument.elements.get('[data-delete-confirm]').dispatch('click');

  let resolveDelayed;
  let delayedCalls = 0;
  const delayedDocument = fixture();
  const delayedApi = { ...branchApi, getState: () => delayedCalls++ === 0 ? new Promise(resolve => { resolveDelayed = resolve; }) : Promise.resolve(success(branchState)) };
  const delayedController = createRendererController(delayedDocument, delayedApi);
  delayedController.start();
  delayedDocument.elements.get('[data-setting-theme]').dispatch('change');
  resolveDelayed(success(branchState));
  await delayedController.render();

  // Exercise both the source and active-element focus fallbacks and each Escape branch.
  const sourceDocument = fixture();
  const sourceController = createRendererController(sourceDocument, branchApi);
  sourceController.start();
  await sourceController.render();
  const addButton = sourceDocument.elements.get('[data-add-wallet]');
  sourceDocument.elements.delete('[data-add-wallet]');
  sourceDocument.activeElement = null;
  addButton.dispatch('click');
  sourceDocument.dispatch('keydown', { key: 'Escape' });
  const sourceDelete = sourceDocument.elements.get('[data-wallet-list]').children.find(button => button.getAttribute('data-wallet-action') === 'delete');
  sourceDelete?.dispatch('click');
  sourceDocument.dispatch('keydown', { key: 'Escape' });
  sourceDocument.elements.get('[data-open-settings]').dispatch('click');
  sourceDocument.dispatch('keydown', { key: 'Enter' });
  sourceDocument.dispatch('keydown', { key: 'Escape' });

  const fallbackSettingDocument = fixture();
  const fallbackSettingController = createRendererController(fallbackSettingDocument, branchApi);
  fallbackSettingController.start();
  await fallbackSettingController.render();
  for (const selector of ['[data-setting-currency]', '[data-setting-locale]', '[data-setting-theme]']) {
    fallbackSettingDocument.elements.get(selector).value = undefined;
    fallbackSettingDocument.elements.get(selector).dispatch('change');
  }
  await Promise.resolve();
});
