import assert from 'node:assert/strict';
import test from 'node:test';
import { createEmptyPortfolioState } from '../src/shared/state.ts';
import { classifyFungibleToken, evaluateSpamRules, shouldShowPosition } from '../src/shared/spam.ts';
import { createSafeStorageSecretStore } from '../src/shared/secrets.ts';

function flaggedPosition() {
  return { schemaVersion: 2, id: 'position-synthetic', walletId: 'wallet-synthetic', family: 'evm', chainId: 1, assetKind: 'fungible', assetId: 'synthetic', symbol: 'SYN', quantity: '1', decimals: 18, updatedAt: 1, spam: { riskFlags: ['suspicious-name'], reasons: ['synthetic'], hiddenByDefault: true } };
}

test('spam classifier is deterministic, explainable, and never flags native assets', () => {
  const native = classifyFungibleToken({ assetKind: 'native', name: 'claim free', symbol: 'N', decimals: 999, quantity: 'not-a-number', airdrop: true });
  assert.deepEqual(native, { riskFlags: [], reasons: [], hiddenByDefault: false });
  const clean = classifyFungibleToken({ assetKind: 'fungible', name: 'Synthetic Token', symbol: 'SYN', url: 'https://synthetic.invalid/token', decimals: 18, quantity: '12.5', verified: true, airdrop: false });
  assert.deepEqual(clean.riskFlags, []);
  const risky = classifyFungibleToken({ assetKind: 'fungible', name: 'Free Airdrop Claim', symbol: '', url: 'https://bit.ly/synthetic', decimals: 99, quantity: 'x'.repeat(81), verified: false, airdrop: true });
  assert.deepEqual(risky.riskFlags, ['metadata-missing', 'suspicious-name', 'suspicious-url', 'invalid-decimals', 'implausible-quantity', 'unverified', 'airdrop-signal']);
  assert.equal(risky.reasons.length, risky.riskFlags.length);
  assert.equal(evaluateSpamRules({ assetKind: 'fungible', name: 'Synthetic', symbol: 'SYN', decimals: 18, quantity: '1' }).length, 0);
});

test('spam visibility follows settings while native positions remain visible', () => {
  const state = createEmptyPortfolioState();
  const native = { ...flaggedPosition(), assetKind: 'native', spam: null };
  const flagged = flaggedPosition();
  assert.equal(shouldShowPosition(native, state.settings), true);
  assert.equal(shouldShowPosition(flagged, state.settings), false);
  assert.equal(shouldShowPosition(flagged, { ...state.settings, showHiddenSpamAssets: true }), true);
  assert.equal(shouldShowPosition(flagged, { ...state.settings, spamFilterEnabled: false }), true);
  assert.equal(shouldShowPosition({ ...flagged, spam: null }, state.settings), true);
});

function encryptedStore() {
  const values = new Map();
  return {
    values,
    safe: {
      isEncryptionAvailable: () => true,
      encryptString: value => new TextEncoder().encode(`enc:${value}`),
      decryptString: value => new TextDecoder().decode(value).replace(/^enc:/, '')
    },
    backing: { get: key => values.get(key) ?? null, set: (key, value) => values.set(key, value), delete: key => values.delete(key) }
  };
}

test('safeStorage secret adapter fails closed and never stores plaintext', () => {
  const unavailable = createSafeStorageSecretStore(undefined, { get: () => null, set() {}, delete() {} });
  assert.equal(unavailable.set('ref', 'synthetic').code, 'unavailable');
  assert.equal(unavailable.get('ref').code, 'unavailable');
  assert.equal(unavailable.delete('ref').code, 'unavailable');
  const fixture = encryptedStore();
  const store = createSafeStorageSecretStore(fixture.safe, fixture.backing);
  assert.equal(store.set('', 'synthetic').code, 'invalid-id');
  assert.equal(store.set('ref', '').code, 'invalid-id');
  assert.equal(store.set('ref', 'synthetic-value').ok, true);
  assert.notDeepEqual(fixture.values.get('ref'), new TextEncoder().encode('synthetic-value'));
  assert.deepEqual(store.get('ref'), { ok: true, value: 'synthetic-value' });
  assert.deepEqual(store.delete('ref'), { ok: true, value: undefined });
  assert.deepEqual(store.get('ref'), { ok: true, value: null });
  const unavailableEncryption = createSafeStorageSecretStore({ ...fixture.safe, isEncryptionAvailable: () => false }, fixture.backing);
  assert.equal(unavailableEncryption.get('ref').code, 'unavailable');
  const encryptFailure = createSafeStorageSecretStore({ ...fixture.safe, encryptString: () => { throw new Error('synthetic'); } }, fixture.backing);
  assert.equal(encryptFailure.set('ref', 'synthetic').code, 'encrypt-failed');
  const decryptFailure = createSafeStorageSecretStore({ ...fixture.safe, decryptString: () => { throw new Error('synthetic'); } }, fixture.backing);
  fixture.values.set('ref', new Uint8Array([1]));
  assert.equal(decryptFailure.get('ref').code, 'decrypt-failed');
  assert.equal(store.get('').code, 'invalid-id');
  assert.equal(store.delete('').code, 'invalid-id');
  assert.equal(store.set(1, 'synthetic').code, 'invalid-id');
  assert.equal(store.set('ref', null).code, 'invalid-id');
  const backingGetFailure = createSafeStorageSecretStore(fixture.safe, { get: () => { throw new Error('synthetic'); }, set() {}, delete() {} });
  assert.equal(backingGetFailure.get('ref').code, 'storage-failed');
  const backingSetFailure = createSafeStorageSecretStore(fixture.safe, { get: () => null, set: () => { throw new Error('synthetic'); }, delete() {} });
  assert.equal(backingSetFailure.set('ref', 'synthetic').code, 'storage-failed');
  const backingDeleteFailure = createSafeStorageSecretStore(fixture.safe, { get: () => null, set() {}, delete: () => { throw new Error('synthetic'); } });
  assert.equal(backingDeleteFailure.delete('ref').code, 'storage-failed');
  const availabilityFailure = createSafeStorageSecretStore({ isEncryptionAvailable: () => { throw new Error('synthetic'); }, encryptString: fixture.safe.encryptString, decryptString: fixture.safe.decryptString }, fixture.backing);
  assert.equal(availabilityFailure.get('ref').code, 'unavailable');
  let available = true;
  const changing = createSafeStorageSecretStore({ ...fixture.safe, isEncryptionAvailable: () => available }, fixture.backing);
  available = false;
  assert.equal(changing.set('ref', 'synthetic').code, 'unavailable');
});
