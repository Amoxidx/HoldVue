import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeBase58Check, encodeBech32 } from '../src/shared/addresses.ts';
import { addHolding, addWallet, createEmptyPortfolioState, createProviderReference, deleteHolding, deleteWallet, hundredthsToQuantity, parsePortfolioState, quantityToHundredths, updateSettings, updateHolding, updateWallet } from '../src/shared/state.ts';

function syntheticEvmAddress() { return `0x${'1'.repeat(40)}`; }
function syntheticBitcoinAddress() { return encodeBase58Check(new Uint8Array([0, ...new Uint8Array(20).fill(7)])); }
function syntheticBitcoinTestAddress() { return encodeBase58Check(new Uint8Array([111, ...new Uint8Array(20).fill(7)])); }
function syntheticXpub() { const payload = new Uint8Array(78); payload.set(new Uint8Array([4, 136, 178, 30])); payload[45] = 2; payload[46] = 7; return encodeBase58Check(payload); }
function syntheticSolanaAddress() { return '1'.repeat(32); }
function syntheticSolanaAddressTwo() { return `${'1'.repeat(31)}2`; }
function syntheticCardanoAddress() { const bytes = new Uint8Array(57); bytes[0] = 0x01; bytes.fill(8, 1); return encodeBech32('addr', bytes); }
function syntheticCardanoTestAddress() { const bytes = new Uint8Array(57); bytes[0] = 0x00; bytes.fill(9, 1); return encodeBech32('addr_test', bytes); }
function syntheticCardanoStakeAddress() { const bytes = new Uint8Array(29); bytes[0] = 0xe1; bytes.fill(6, 1); return encodeBech32('stake', bytes); }

test('empty v2 state is deterministic, typed, and contains no positions or wallets', () => {
  const state = createEmptyPortfolioState();
  assert.equal(state.schemaVersion, 5);
  assert.equal(state.settings.schemaVersion, 5);
  assert.deepEqual(state.positions, []);
  assert.deepEqual(state.wallets, []);
  assert.deepEqual(state.instruments, []);
  assert.deepEqual(state.holdings, []);
  assert.deepEqual(state.settings.enabledChainIds, []);
  assert.deepEqual(state.settings.customChains, []);
  assert.deepEqual(state.settings.rpcOverrides, []);
  assert.deepEqual(state.settings.providerRefs, []);
  assert.equal(state.settings.currency, 'EUR');
  assert.equal(state.settings.locale, 'de');
  assert.equal(state.settings.theme, 'dark');
  assert.equal(state.settings.schedulerEnabled, true);
  assert.equal(state.settings.spamFilterEnabled, true);
});

test('position integrity rejects orphans, family mismatches, invalid chain families, and empty identity fields', () => {
  const wallet = { schemaVersion: 2, id: 'wallet-e', label: 'Synthetic EVM', family: 'evm', address: syntheticEvmAddress(), enabled: true, createdAt: 1, options: { autoScanCommonChains: true, chainIds: [] } };
  const valid = { schemaVersion: 2, id: 'position-valid', walletId: 'wallet-e', family: 'evm', chainId: 1, assetKind: 'native', assetId: 'native:1', symbol: 'SYN', quantity: '1', decimals: 18, updatedAt: 1, spam: null };
  const parsed = parsePortfolioState({ schemaVersion: 2, wallets: [wallet], positions: [valid, { ...valid, id: 'same-domain' }, { ...valid, id: 'orphan', walletId: 'missing' }, { ...valid, id: 'family', family: 'bitcoin', chainId: null }, { ...valid, id: 'btc-chain', family: 'bitcoin', chainId: 1 }, { ...valid, id: 'empty-asset', assetId: '' }, { ...valid, id: 'empty-symbol', symbol: '' }, { ...valid, id: 'empty-wallet', walletId: '' }] });
  assert.deepEqual(parsed.positions.map(position => position.id), ['position-valid']);
  assert.equal(parsePortfolioState({ schemaVersion: 3, wallets: [wallet], positions: [{ ...valid, id: 'signed-pending', baseUnits: '8', quantity: '8', confirmedBaseUnits: '10', pendingBaseUnits: '-2' }] }).positions[0].pendingBaseUnits, '-2');
  assert.deepEqual(parsePortfolioState({ schemaVersion: 3, wallets: [wallet], positions: [{ ...valid, id: 'mismatched-total', baseUnits: '10', quantity: '10', confirmedBaseUnits: '10', pendingBaseUnits: '-2' }] }).positions, []);
  assert.deepEqual(parsePortfolioState({ schemaVersion: 3, wallets: [wallet], positions: [{ ...valid, id: 'bad-pending', baseUnits: '10', quantity: '10', pendingBaseUnits: '2.5' }] }).positions, []);
});

test('v1 and malformed input migrate deterministically to sanitized v2', () => {
  assert.deepEqual(parsePortfolioState(null).positions, []);
  assert.equal(parsePortfolioState({ schemaVersion: 0 }).schemaVersion, 5);
  const migrated = parsePortfolioState({ schemaVersion: 1, settings: { currency: 'USD', locale: 'en', theme: 'light', schedulerEnabled: false }, positions: ['legacy'], wallets: ['legacy'] });
  assert.equal(migrated.schemaVersion, 5);
  assert.equal(migrated.settings.currency, 'USD');
  assert.equal(migrated.settings.locale, 'en');
  assert.equal(migrated.settings.theme, 'light');
  assert.equal(migrated.settings.schedulerEnabled, false);
  assert.deepEqual(migrated.positions, []);
  assert.deepEqual(migrated.wallets, []);
  const credentialRpc = ['https://', 'user', ':', 'synthetic', '@rpc.invalid'].join('');
  const parsed = parsePortfolioState({ schemaVersion: 2, settings: { enabledChainIds: [1, 1, -1, 'x'], customChains: [{ chainId: 7, name: 'Synthetic', nativeAsset: 'SYN', rpcUrl: 'https://rpc.invalid', explorerBaseUrl: 'https://explorer.invalid' }, { chainId: 7, name: 'Replacement', nativeAsset: 'REP', rpcUrl: 'https://rpc.invalid', explorerBaseUrl: 'https://explorer.invalid' }, { chainId: 900010, name: 'Six decimal', nativeAsset: 'SIX', nativeDecimals: 6, rpcUrl: 'https://rpc.invalid', explorerBaseUrl: 'https://explorer.invalid' }, { chainId: 900011, name: 'Invalid decimal', nativeAsset: 'BAD', nativeDecimals: 37, rpcUrl: 'https://rpc.invalid', explorerBaseUrl: 'https://explorer.invalid' }, { chainId: 1, name: 'Built-in collision', nativeAsset: 'BAD', rpcUrl: 'https://rpc.invalid', explorerBaseUrl: 'https://explorer.invalid' }, { chainId: 8, name: 'Credential', nativeAsset: 'BAD', rpcUrl: credentialRpc, explorerBaseUrl: 'https://explorer.invalid' }, { chainId: 9, name: 'HTTP', nativeAsset: 'BAD', rpcUrl: 'http://remote.invalid', explorerBaseUrl: 'https://explorer.invalid' }, null], rpcOverrides: [{ chainId: 1, rpcUrl: 'https://rpc.ethereum.synthetic' }, { chainId: 8453, rpcUrl: 'https://rpc.base.synthetic' }, { chainId: 0, rpcUrl: 'https://rpc.invalid' }, null, { chainId: 2, rpcUrl: 4 }, { chainId: 3, rpcUrl: 'http://remote.invalid' }], providerRefs: [{ providerId: 'indexer', keyId: 'ref_indexer_key1', enabled: true }, { providerId: 'indexer', keyId: 'ref_indexer_key2', enabled: false }, { providerId: '', keyId: 1, enabled: 'yes' }, { providerId: 'indexer', keyId: 'raw-secret', enabled: true }] }, positions: [{ schemaVersion: 2, id: 'position-1', walletId: 'evm-1', family: 'evm', chainId: 1, assetKind: 'fungible', assetId: 'synthetic-token', symbol: 'SYN', quantity: '12.5', decimals: 6, updatedAt: 10, spam: { riskFlags: ['suspicious-name', 'unknown'], reasons: ['synthetic', 4], hiddenByDefault: true } }, { schemaVersion: 2, id: 'position-2', walletId: 'bitcoin-1', family: 'bitcoin', chainId: null, assetKind: 'fungible', assetId: 'synthetic-token-2', symbol: 'SYN', quantity: '1', decimals: 18, updatedAt: 10 }, { schemaVersion: 2, id: 'position-1', walletId: 'wallet-1', family: 'evm', chainId: null, assetKind: 'native', assetId: 'native', symbol: 'SYN', quantity: '1', decimals: 18, updatedAt: 10, spam: null }, { id: 'bad', walletId: 'bad', family: 'evm', chainId: 1, assetKind: 'nft', assetId: 'bad', symbol: 'BAD', quantity: '1', decimals: 0, updatedAt: 10 }], wallets: [
    { schemaVersion: 2, id: 'bitcoin-1', label: 'Synthetic BTC', family: 'bitcoin', address: syntheticBitcoinAddress(), enabled: true, createdAt: 1, options: { network: 'mainnet', addressType: 'address' } },
    { schemaVersion: 2, id: 'solana-1', label: 'Synthetic SOL', family: 'solana', address: syntheticSolanaAddress(), enabled: true, createdAt: 2, options: { network: 'devnet' } },
    { schemaVersion: 2, id: 'solana-3', label: 'Synthetic SOL 3', family: 'solana', address: syntheticSolanaAddress(), enabled: true, createdAt: 7, options: { network: 'mainnet-beta' } },
    { schemaVersion: 2, id: 'cardano-1', label: 'Synthetic ADA', family: 'cardano', address: syntheticCardanoAddress(), enabled: true, createdAt: 3, options: { network: 'mainnet' } },
    { schemaVersion: 2, id: 'evm-1', label: 'Synthetic EVM', family: 'evm', address: syntheticEvmAddress(), enabled: true, createdAt: 4 },
    { schemaVersion: 2, id: 'solana-2', label: 'Synthetic SOL 2', family: 'solana', address: syntheticSolanaAddressTwo(), enabled: true, createdAt: 5, options: { network: 'testnet' } },
    { schemaVersion: 2, id: 'cardano-2', label: 'Synthetic ADA 2', family: 'cardano', address: syntheticCardanoTestAddress(), enabled: true, createdAt: 6, options: { network: 'testnet' } },
    { schemaVersion: 2, id: 'cardano-1', label: 'Duplicate', family: 'cardano', address: syntheticCardanoAddress(), enabled: true, createdAt: 4, options: { network: 'testnet' } },
    { schemaVersion: 2, id: 'bad', label: '', family: 'evm', address: syntheticEvmAddress(), createdAt: 4, options: {} },
    { schemaVersion: 2, id: 'bad-address', label: 'Bad address', family: 'evm', address: 'bad', createdAt: 4, options: {} },
    { schemaVersion: 2, id: 'bad-options', label: 'Default options', family: 'bitcoin', address: syntheticBitcoinAddress(), createdAt: 4, options: { network: 'invalid', addressType: 'invalid' } }
  ] });
  assert.deepEqual(parsed.settings.enabledChainIds, [1]);
  assert.equal(parsed.settings.customChains[0].name, 'Replacement');
  assert.equal(parsed.settings.customChains[0].nativeDecimals, 18);
  assert.equal(parsed.settings.customChains.some(chain => chain.chainId === 900010 && chain.nativeDecimals === 6), true);
  assert.equal(parsed.settings.customChains.some(chain => chain.chainId === 900011), false);
  assert.equal(parsed.settings.rpcOverrides.length, 2);
  assert.equal(parsed.settings.providerRefs[0].keyId, 'ref_indexer_key2');
  assert.equal(parsePortfolioState({ schemaVersion: 2, settings: { providerRefs: [{ providerId: 'indexer', keyId: 'ref_other_key', enabled: true }] } }).settings.providerRefs.length, 0);
  const endpointSettings = parsePortfolioState({ schemaVersion: 3, settings: { providerEndpoints: [
    { providerId: 'solana.rpc', endpoint: 'https://rpc.synthetic.invalid', enabled: true },
    { providerId: '', endpoint: 'https://rpc.synthetic.invalid', enabled: true },
    { providerId: 'solana.rpc', endpoint: 4, enabled: true },
    { providerId: 'solana.rpc', endpoint: 'not-a-url', enabled: true },
    { providerId: 'solana.rpc', endpoint: 'https://rpc.synthetic.invalid', enabled: 'yes' }
  ] } });
  assert.deepEqual(endpointSettings.settings.providerEndpoints, [{ providerId: 'solana.rpc', endpoint: 'https://rpc.synthetic.invalid', enabled: true }]);
  const integerWallet = { schemaVersion: 2, id: 'integer-wallet', label: 'Synthetic integer wallet', family: 'evm', address: syntheticEvmAddress(), createdAt: 1, options: { autoScanCommonChains: true, chainIds: [] } };
  const integerPosition = { schemaVersion: 2, id: 'integer-position', walletId: 'integer-wallet', family: 'evm', chainId: 1, assetKind: 'native', assetId: 'native:1', symbol: 'SYN', decimals: 0, quantity: '10', updatedAt: 1, spam: null };
  assert.equal(parsePortfolioState({ schemaVersion: 3, wallets: [integerWallet], positions: [integerPosition] }).positions[0].quantity, '10');
  assert.deepEqual(parsePortfolioState({ schemaVersion: 3, positions: [{ ...integerPosition, id: 'over-precision', decimals: 2, quantity: '1.234' }] }).positions, []);
  assert.equal(parsed.positions.length, 2);
  assert.equal(parsed.positions[0].spam.riskFlags.length, 1);
  assert.equal(parsed.wallets.filter(wallet => wallet.family === 'solana').every(wallet => wallet.options.network === 'mainnet-beta'), true);
  const autoBitcoin = parsePortfolioState({ schemaVersion: 2, wallets: [{ id: 'auto-btc', label: 'Auto BTC', family: 'bitcoin', address: syntheticBitcoinTestAddress(), createdAt: 1 }] });
  assert.equal(autoBitcoin.wallets[0].options.network, 'testnet');
  const autoMainnetBitcoin = parsePortfolioState({ schemaVersion: 2, wallets: [{ id: 'auto-btc-main', label: 'Auto BTC Main', family: 'bitcoin', address: syntheticBitcoinAddress(), createdAt: 1 }] });
  assert.equal(autoMainnetBitcoin.wallets[0].options.network, 'mainnet');
  const autoCardano = parsePortfolioState({ schemaVersion: 2, wallets: [{ id: 'auto-ada', label: 'Auto ADA', family: 'cardano', address: syntheticCardanoTestAddress(), createdAt: 1 }] });
  assert.equal(autoCardano.wallets[0].options.network, 'testnet');
  const stakeCardano = parsePortfolioState({ schemaVersion: 2, wallets: [{ id: 'stake-ada', label: 'Stake ADA', family: 'cardano', address: syntheticCardanoStakeAddress(), createdAt: 1 }] });
  assert.equal(stakeCardano.wallets[0].options.kind, 'stake');
  assert.equal(parsed.wallets.length, 6);
  const migratedWallet = parsePortfolioState({ schemaVersion: 1, wallets: [{ label: 'Migrated', family: 'evm', address: syntheticEvmAddress() }] });
  assert.equal(migratedWallet.wallets[0].id, 'migrated-wallet-1');
  assert.equal(migratedWallet.wallets[0].createdAt, 0);
  for (const network of ['testnet', 'mainnet-beta', 'invalid']) parsePortfolioState({ schemaVersion: 2, wallets: [{ id: `network-${network}`, label: 'Network branch', family: 'solana', address: syntheticSolanaAddressTwo(), options: { network } }] });
  const missingCreated = parsePortfolioState({ schemaVersion: 2, wallets: [{ id: 'missing-created', label: 'Missing created', family: 'evm', address: syntheticEvmAddress(), options: {} }] });
  assert.deepEqual(missingCreated.wallets, []);
  const missingEnabled = parsePortfolioState({ schemaVersion: 2, wallets: [{ id: 'missing-enabled', label: 'Missing enabled', family: 'evm', address: `0x${'2'.repeat(40)}`, createdAt: 7, options: {} }] });
  assert.equal(missingEnabled.wallets[0].enabled, true);
  const emptyManual = parsePortfolioState({ schemaVersion: 2, wallets: [{ id: 'empty-manual', label: 'Empty manual', family: 'evm', address: syntheticEvmAddress(), options: { autoScanCommonChains: false, chainIds: [] }, createdAt: 1 }] });
  assert.deepEqual(emptyManual.wallets, []);
  const invalidPositionFields = ['id', 'walletId', 'family', 'chainId', 'assetKind', 'assetId', 'symbol', 'quantity', 'decimals', 'updatedAt'];
  for (const field of invalidPositionFields) {
    const base = { schemaVersion: 2, id: 'position-invalid', walletId: 'wallet-1', family: 'evm', chainId: 1, assetKind: 'fungible', assetId: 'synthetic', symbol: 'SYN', quantity: '1', decimals: 18, updatedAt: 1 };
    parsePortfolioState({ schemaVersion: 2, positions: [{ ...base, [field]: field === 'chainId' ? -1 : field === 'decimals' ? 99 : field === 'assetKind' ? 'nft' : null }] });
  }
  const fallback = parsePortfolioState({ schemaVersion: 1, settings: { currency: 'GBP', locale: 'fr', theme: 'system', schedulerEnabled: 'yes', spamFilterEnabled: false }, positions: null, wallets: null });
  assert.equal(fallback.settings.currency, 'EUR');
  assert.equal(fallback.settings.locale, 'de');
  assert.equal(fallback.settings.theme, 'dark');
  assert.equal(fallback.settings.schedulerEnabled, true);
  assert.equal(fallback.settings.spamFilterEnabled, true);
  const updated = updateSettings(parsed, { theme: 'light', locale: 'en', spamFilterEnabled: false, showHiddenSpamAssets: true });
  assert.equal(updated.settings.theme, 'light');
  assert.equal(updated.settings.locale, 'en');
  assert.equal(updated.settings.spamFilterEnabled, false);
  const providerRef = createProviderReference('market.data', { next: () => 'synthetic-ref' });
  assert.equal(providerRef.keyId, 'ref_market.data_synthetic-ref');
  assert.equal(createProviderReference('MarketData', { next: () => 'synthetic-ref' }), null);
  assert.equal(createProviderReference('market.data', { next: () => 'not valid' }), null);
  assert.equal(createProviderReference('market.data', undefined), null);
});

test('wallet CRUD validates families, deduplicates, injects ids and clock, and removes positions', () => {
  const ids = { next: () => 'wallet-1' };
  const clock = { now: () => 1234 };
  const state = createEmptyPortfolioState();
  const added = addWallet(state, { label: 'Synthetic EVM', family: 'evm', address: syntheticEvmAddress(), options: { autoScanCommonChains: false, chainIds: [1] } }, { ids, clock });
  assert.equal(added.ok, true);
  if (!added.ok) return;
  assert.equal(added.value.wallets[0].id, 'wallet-1');
  assert.equal(added.value.wallets[0].createdAt, 1234);
  assert.equal(added.value.wallets[0].address, syntheticEvmAddress());
  const duplicate = addWallet(added.value, { id: 'wallet-2', label: 'Duplicate', family: 'evm', address: syntheticEvmAddress() }, { ids, clock });
  assert.equal(duplicate.ok, false);
  if (!duplicate.ok) assert.equal(duplicate.code, 'duplicate-wallet');
  const mismatch = addWallet(state, { label: 'Mismatch', family: 'bitcoin', address: syntheticEvmAddress() }, { ids, clock });
  assert.equal(mismatch.ok, false);
  if (!mismatch.ok) assert.equal(mismatch.code, 'invalid-address');
  const testnetBitcoin = syntheticBitcoinTestAddress();
  const networkMismatch = addWallet(state, { label: 'Wrong network', family: 'bitcoin', address: testnetBitcoin, options: { network: 'testnet' } }, { ids, clock });
  assert.equal(networkMismatch.ok, true);
  const mainnetOnlyMismatch = addWallet(state, { label: 'Wrong selected network', family: 'bitcoin', address: testnetBitcoin, options: { network: 'mainnet' } }, { ids, clock });
  assert.equal(mainnetOnlyMismatch.ok, false);
  const invalidNetwork = addWallet(state, { label: 'Invalid network', family: 'bitcoin', address: syntheticBitcoinAddress(), options: { network: 'sidechain' } }, { ids, clock });
  assert.equal(invalidNetwork.ok, false);
  const nestedSecretField = `${'private'}${'Key'}`;
  const nestedSecret = addWallet(state, { label: 'Nested secret', family: 'evm', address: syntheticEvmAddress(), options: { nested: { [nestedSecretField]: 'synthetic' } } }, { ids, clock });
  assert.equal(nestedSecret.ok, false);
  const cyclicOptions = {}; cyclicOptions.self = cyclicOptions;
  const cyclic = addWallet(state, { label: 'Cyclic options', family: 'evm', address: syntheticEvmAddress(), options: cyclicOptions }, { ids, clock });
  assert.equal(cyclic.ok, true);
  const secretField = `${'private'}${'Key'}`;
  const secret = addWallet(state, { label: 'Secret', family: 'evm', address: syntheticEvmAddress(), [secretField]: 'synthetic-secret' }, { ids, clock });
  assert.equal(secret.ok, false);
  if (!secret.ok) assert.equal(secret.code, 'secret-input');
  const invalidFamily = addWallet(state, { label: 'Invalid', family: 'other', address: syntheticEvmAddress() }, { ids, clock });
  assert.equal(invalidFamily.ok, false);
  if (!invalidFamily.ok) assert.equal(invalidFamily.code, 'invalid-input');
  const emptyLabel = addWallet(state, { label: '', family: 'evm', address: syntheticEvmAddress() }, { ids, clock });
  assert.equal(emptyLabel.ok, false);
  if (!emptyLabel.ok) assert.equal(emptyLabel.code, 'invalid-label');
  const invalidAddress = addWallet(state, { label: 'Invalid address', family: 'evm', address: 'bad' }, { ids, clock });
  assert.equal(invalidAddress.ok, false);
  if (!invalidAddress.ok) assert.equal(invalidAddress.code, 'invalid-address');
  const noManualChain = addWallet(state, { label: 'No selected chain', family: 'evm', address: syntheticEvmAddress(), options: { autoScanCommonChains: false, chainIds: [] } }, { ids, clock });
  assert.equal(noManualChain.ok, false);
  if (!noManualChain.ok) assert.equal(noManualChain.code, 'invalid-input');
  const emptyId = addWallet(state, { id: '', label: 'Factory id', family: 'evm', address: syntheticEvmAddress() }, { ids: { next: () => '' }, clock });
  assert.equal(emptyId.ok, false);
  if (!emptyId.ok) assert.equal(emptyId.code, 'invalid-input');
  const invalidTime = addWallet(state, { label: 'Invalid time', family: 'evm', address: syntheticEvmAddress(), createdAt: -1 }, { ids, clock });
  assert.equal(invalidTime.ok, false);
  if (!invalidTime.ok) assert.equal(invalidTime.code, 'invalid-input');
  const invalidEnabled = addWallet(state, { label: 'Invalid enabled', family: 'evm', address: syntheticEvmAddress(), enabled: 'yes' }, { ids, clock });
  assert.equal(invalidEnabled.ok, false);
  if (!invalidEnabled.ok) assert.equal(invalidEnabled.code, 'invalid-input');
  const invalidNullTime = addWallet(state, { label: 'Invalid null time', family: 'evm', address: syntheticEvmAddress(), createdAt: null }, { ids, clock });
  assert.equal(invalidNullTime.ok, false);
  if (!invalidNullTime.ok) assert.equal(invalidNullTime.code, 'invalid-input');
  const invalidClock = addWallet(state, { label: 'Invalid clock', family: 'evm', address: syntheticEvmAddress() }, { ids, clock: { now: () => -1 } });
  assert.equal(invalidClock.ok, false);
  if (!invalidClock.ok) assert.equal(invalidClock.code, 'invalid-input');
  const noIdFactory = addWallet(state, { label: 'No id factory', family: 'evm', address: syntheticEvmAddress() }, { ids: undefined, clock });
  assert.equal(noIdFactory.ok, false);
  const noClock = addWallet(state, { label: 'No clock', family: 'evm', address: syntheticEvmAddress() }, { ids, clock: undefined });
  assert.equal(noClock.ok, false);
  const xpub = addWallet(state, { label: 'Synthetic xpub', family: 'bitcoin', address: syntheticXpub(), options: { network: 'mainnet', addressType: 'xpub' } }, { ids, clock });
  assert.equal(xpub.ok, true);
  const xpubAutoNetwork = addWallet(state, { label: 'Synthetic xpub auto network', family: 'bitcoin', address: syntheticXpub(), options: { addressType: 'xpub' } }, { ids, clock });
  assert.equal(xpubAutoNetwork.ok, true);
  const autoBitcoinAdd = addWallet(state, { label: 'Synthetic BTC auto', family: 'bitcoin', address: syntheticBitcoinAddress() }, { ids, clock });
  assert.equal(autoBitcoinAdd.ok, true);
  const explicitAddressType = addWallet(state, { label: 'Synthetic BTC address type', family: 'bitcoin', address: syntheticBitcoinAddress(), options: { addressType: 'address' } }, { ids, clock });
  assert.equal(explicitAddressType.ok, true);
  const invalidSolanaOption = parsePortfolioState({ schemaVersion: 2, wallets: [{ id: 'invalid-sol', label: 'Invalid SOL option', family: 'solana', address: syntheticSolanaAddress(), createdAt: 1, options: { network: 'invalid' } }] });
  assert.equal(invalidSolanaOption.wallets[0].options.network, 'mainnet-beta');
  const edited = updateWallet(added.value, 'wallet-1', { label: 'Edited', enabled: false });
  assert.equal(edited.ok, true);
  if (!edited.ok) return;
  assert.equal(edited.value.wallets[0].label, 'Edited');
  assert.equal(edited.value.wallets[0].enabled, false);
  const invalidEdit = updateWallet(edited.value, 'wallet-1', { label: '' });
  assert.equal(invalidEdit.ok, false);
  const secondWallet = addWallet(edited.value, { id: 'wallet-2', label: 'Second', family: 'evm', address: `0x${'2'.repeat(40)}` }, { ids, clock });
  assert.equal(secondWallet.ok, true);
  if (secondWallet.ok) assert.equal(updateWallet(secondWallet.value, 'wallet-1', { label: 'Mapped' }).ok, true);
  const positioned = { ...edited.value, positions: [{ schemaVersion: 2, id: 'position-1', walletId: 'wallet-1', family: 'evm', chainId: 1, assetKind: 'native', assetId: 'native:1', symbol: 'SYN', quantity: '1', decimals: 18, updatedAt: 1, spam: null }] };
  const removed = deleteWallet(positioned, 'wallet-1');
  assert.equal(removed.ok, true);
  if (removed.ok) { assert.deepEqual(removed.value.wallets, []); assert.deepEqual(removed.value.positions, []); }
  const missing = deleteWallet(state, 'missing');
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.code, 'not-found');
  const missingEdit = updateWallet(state, 'missing', { label: 'x' });
  assert.equal(missingEdit.ok, false);
  if (!missingEdit.ok) assert.equal(missingEdit.code, 'not-found');
  assert.equal(syntheticBitcoinAddress().length > 0, true);
  assert.equal(encodeBech32('addr', new Uint8Array(29).fill(3)).startsWith('addr1'), true);
});

test('schema v4 migrates and round-trips exact manual stock and ETF quantities', () => {
  const instrument = { schemaVersion: 4, id: 'instrument-synthetic', providerId: 'fmp.market', providerSymbol: 'SYN@XETRA', symbol: 'SYN', name: 'Synthetic World Fund', exchange: 'XETRA', currency: 'EUR', type: 'etf' };
  const base = { schemaVersion: 4, id: 'holding-synthetic', instrumentId: instrument.id, updatedAt: 7 };
  const state = parsePortfolioState({ schemaVersion: 4, settings: {}, wallets: [], positions: [], instruments: [instrument, { ...instrument, id: 'duplicate', name: 'Duplicate' }, { ...instrument, id: 'bad', type: 'crypto' }], holdings: [
    { ...base, quantity: '1', quantityHundredths: '100' },
    { ...base, id: 'holding-duplicate', quantity: '1.20', quantityHundredths: '120' },
    { ...base, id: 'holding-1-2', quantity: '1.2', quantityHundredths: '120' },
    { ...base, id: 'holding-1-23', quantity: '1.23', quantityHundredths: '123' },
    { ...base, id: 'holding-large', quantityHundredths: '12345678901234567890123456', quantity: '123456789012345678901234.56' },
    { ...base, id: 'holding-mismatch', quantity: '1.23', quantityHundredths: '124' },
    { ...base, id: 'holding-orphan', instrumentId: 'missing', quantity: '1', quantityHundredths: '100' },
    { ...base, id: 'holding-bad-zero', quantity: '0', quantityHundredths: '0' },
    { ...base, id: 'holding-bad-exp', quantity: '1e2', quantityHundredths: '100' }
  ] });
  assert.equal(state.schemaVersion, 5);
  assert.equal(state.instruments.length, 1);
  assert.deepEqual(state.holdings.map(item => [item.id, item.quantityHundredths, item.quantity]), [['holding-synthetic', '100', '1']]);
  const malformed = parsePortfolioState({ schemaVersion: 4, settings: {}, wallets: [], positions: [], instruments: [null, { ...instrument, id: '' }, { ...instrument, id: null }, { ...instrument, currency: null }], holdings: [null, { ...base, id: null }, { ...base, instrumentId: '' }, { ...base, quantity: undefined, quantityHundredths: undefined }, { ...base, updatedAt: 'bad' }] });
  assert.deepEqual(malformed.instruments, []);
  assert.deepEqual(malformed.holdings, []);
  assert.deepEqual(parsePortfolioState({ schemaVersion: 4, settings: {} }).instruments, []);
  assert.deepEqual(parsePortfolioState({ schemaVersion: 4, settings: {} }).holdings, []);
  assert.equal(quantityToHundredths('1'), '100');
  assert.equal(quantityToHundredths('1.2'), '120');
  assert.equal(quantityToHundredths('1.23'), '123');
  assert.equal(quantityToHundredths('0'), null);
  assert.equal(quantityToHundredths('01'), null);
  assert.equal(quantityToHundredths('1.234'), null);
  assert.equal(quantityToHundredths('1e2'), null);
  assert.equal(hundredthsToQuantity('100'), '1');
  assert.equal(hundredthsToQuantity('120'), '1.2');
  assert.equal(hundredthsToQuantity('123'), '1.23');
  assert.equal(hundredthsToQuantity('1'), '0.1');
  const migrated = parsePortfolioState({ schemaVersion: 3, settings: {}, wallets: [], positions: [], instruments: [instrument], holdings: [{ ...base, quantity: '1' }] });
  assert.deepEqual(migrated.holdings, []);
  const missingArrays = parsePortfolioState({ schemaVersion: 4, settings: {} });
  assert.deepEqual(missingArrays.instruments, []);
  assert.deepEqual(missingArrays.holdings, []);
});

test('manual holding CRUD validates metadata, exact quantities, deduplication, and cleanup', () => {
  const ids = (() => { let value = 0; return { next: () => `holding-id-${++value}` }; })();
  const clock = { now: () => 22 };
  const instrument = { providerId: 'fmp.market', providerSymbol: 'SYN@NYSE', symbol: 'SYN', name: 'Synthetic Company', exchange: 'NYSE', currency: 'USD', type: 'stock' };
  let state = createEmptyPortfolioState();
  const added = addHolding(state, { instrument, quantity: '12.34' }, { ids, clock });
  assert.equal(added.ok, true);
  if (!added.ok) return;
  state = added.value;
  assert.deepEqual(state.holdings[0], { schemaVersion: 4, id: 'holding-id-2', instrumentId: 'holding-id-1', quantityHundredths: '1234', quantity: '12.34', updatedAt: 22 });
  assert.equal(addHolding(state, { instrument, quantity: '1' }, { ids, clock }).code, 'duplicate-holding');
  assert.equal(addHolding(state, { instrument: { ...instrument, providerId: 'Bad Provider' }, quantity: '1' }, { ids, clock }).code, 'invalid-instrument');
  assert.equal(addHolding(state, { instrument, quantity: '0' }, { ids, clock }).code, 'invalid-quantity');
  assert.equal(addHolding(state, { instrument, quantity: '1.234' }, { ids, clock }).code, 'invalid-quantity');
  assert.equal(addHolding(state, { instrument, quantity: '1', secret: 'synthetic' }, { ids, clock }).code, 'secret-input');
  const updated = updateHolding(state, 'holding-id-2', { quantity: '1.2' }, { ids, clock });
  assert.equal(updated.ok, true);
  if (!updated.ok) return;
  state = updated.value;
  assert.equal(state.holdings[0].quantityHundredths, '120');
  const second = addHolding(state, { ...{ instrument: { ...instrument, providerSymbol: 'OTHER@NYSE', symbol: 'OTH', name: 'Synthetic Other' }, quantity: '2' } }, { ids, clock });
  assert.equal(second.ok, true);
  if (!second.ok) return;
  state = second.value;
  assert.equal(updateHolding(state, 'holding-id-2', { instrument: { ...instrument, providerSymbol: 'OTHER@NYSE', symbol: 'OTH', name: 'Synthetic Other' } }, { ids, clock }).code, 'duplicate-holding');
  const changed = updateHolding(state, 'holding-id-2', { instrument: { ...instrument, providerSymbol: 'NEW@NYSE', symbol: 'NEW', name: 'Synthetic New' } }, { ids, clock });
  assert.equal(changed.ok, true);
  if (!changed.ok) return;
  state = changed.value;
  assert.equal(state.instruments.some(item => item.providerSymbol === 'NEW@NYSE'), true);
  assert.equal(state.instruments.some(item => item.providerSymbol === 'SYN@NYSE'), false);
  assert.equal(updateHolding(state, 'missing', { quantity: '1' }, { ids, clock }).code, 'not-found');
  assert.equal(updateHolding(state, 'holding-id-2', { quantity: 'nope' }, { ids, clock }).code, 'invalid-quantity');
  assert.equal(updateHolding(state, 'holding-id-2', { secret: 'synthetic' }, { ids, clock }).code, 'secret-input');
  assert.equal(updateHolding(state, 'holding-id-2', { instrument: { ...instrument, providerId: 'Bad Provider' } }, { ids, clock }).code, 'invalid-instrument');
  assert.equal(deleteHolding(state, 'missing').code, 'not-found');
  const deleted = deleteHolding(state, 'holding-id-2');
  assert.equal(deleted.ok, true);
  if (deleted.ok) assert.equal(deleted.value.holdings.some(item => item.id === 'holding-id-2'), false);
  const badId = addHolding(createEmptyPortfolioState(), { instrument, quantity: '1' }, { ids: { next: () => '' }, clock });
  assert.equal(badId.code, 'invalid-input');
  const badClock = addHolding(createEmptyPortfolioState(), { instrument, quantity: '1' }, { ids, clock: { now: () => -1 } });
  assert.equal(badClock.code, 'invalid-input');
  const reusableInstrument = parsePortfolioState({ schemaVersion: 4, settings: {}, wallets: [], positions: [], instruments: [{ ...instrument, id: 'reusable' }], holdings: [] });
  const reused = addHolding(reusableInstrument, { instrument, quantity: '1' }, { ids, clock });
  assert.equal(reused.ok, true);
  const invalidUpdateId = updateHolding(reused.ok ? reused.value : reusableInstrument, reused.ok ? reused.value.holdings[0].id : 'missing', { instrument: { ...instrument, providerSymbol: 'NEW-ID', symbol: 'NEW-ID', name: 'Synthetic New ID' } }, { ids: { next: () => '' }, clock });
  assert.equal(invalidUpdateId.code, 'invalid-input');
  const invalidUpdateClock = updateHolding(reused.ok ? reused.value : reusableInstrument, reused.ok ? reused.value.holdings[0].id : 'missing', { quantity: '2' }, { ids, clock: { now: () => -1 } });
  assert.equal(invalidUpdateClock.code, 'invalid-input');
});

test('price data is pruned when a wallet or manual holding disappears', () => {
  const wallet = { schemaVersion: 3, id: 'wallet-price', label: 'Synthetic', family: 'evm', address: syntheticEvmAddress(), enabled: true, createdAt: 1, options: { autoScanCommonChains: true, chainIds: [] } };
  const position = { schemaVersion: 3, id: 'position-price', walletId: wallet.id, family: 'evm', chainId: 1, assetKind: 'native', assetId: 'native:1', symbol: 'ETH', baseUnits: '1', quantity: '0.000000000000000001', confirmedBaseUnits: '1', pendingBaseUnits: '0', decimals: 18, updatedAt: 1, spam: null };
  const base = createEmptyPortfolioState();
  const walletState = { ...base, wallets: [wallet], positions: [position], prices: { ...base.prices, quotes: [{ assetId: 'asset:evm:1:native:native:1', priceEurScaled: '1', priceUsdScaled: '1', scale: 12, change24hPercentScaled: null, change24hEurPercentScaled: null, change24hUsdPercentScaled: null, previousPriceEurScaled: null, previousPriceUsdScaled: null, source: 'synthetic', sourceTimestamp: null, fetchedAt: 1 }], statuses: [], valuations: [], history: [{ id: 'asset:evm:1:native:native:1', kind: 'asset-price', points: [] }] } };
  assert.equal(parsePortfolioState(walletState).prices.quotes.length, 1);
  const deletedWallet = deleteWallet(walletState, wallet.id);
  assert.equal(deletedWallet.ok, true); assert.equal(deletedWallet.value.prices.quotes.length, 0); assert.equal(deletedWallet.value.prices.history.length, 0);
  const walletTwo = { ...wallet, id: 'wallet-price-two', address: `0x${'2'.repeat(40)}` };
  const shared = deleteWallet({ ...walletState, wallets: [wallet, walletTwo], positions: [position, { ...position, id: 'position-price-two', walletId: walletTwo.id }] }, wallet.id);
  assert.equal(shared.ok, true); assert.equal(shared.value.prices.quotes.length, 1);
  let generated = 0; const holdingState = addHolding(base, { instrument: { providerId: 'fmp.market', providerSymbol: 'SYN@X', symbol: 'SYN', name: 'Synthetic', exchange: 'X', currency: 'EUR', type: 'stock' }, quantity: '1' }, { ids: { next: () => `synthetic-id-${++generated}` }, clock: { now: () => 1 } });
  assert.equal(holdingState.ok, true);
  const withPrice = { ...holdingState.value, prices: { ...holdingState.value.prices, quotes: [{ assetId: `instrument:${holdingState.value.instruments[0].id}`, priceEurScaled: '1', priceUsdScaled: '1', scale: 12, change24hPercentScaled: null, change24hEurPercentScaled: null, change24hUsdPercentScaled: null, previousPriceEurScaled: null, previousPriceUsdScaled: null, source: 'synthetic', sourceTimestamp: null, fetchedAt: 1 }], statuses: [], valuations: [], history: [{ id: `instrument:${holdingState.value.instruments[0].id}`, kind: 'asset-price', points: [] }] } };
  assert.equal(parsePortfolioState(withPrice).prices.quotes.length, 1);
  const deletedHolding = deleteHolding(withPrice, holdingState.value.holdings[0].id);
  assert.equal(deletedHolding.ok, true); assert.equal(deletedHolding.value.prices.quotes.length, 0);
  const btcWallet = { schemaVersion: 3, id: 'wallet-btc-price', label: 'Synthetic BTC', family: 'bitcoin', address: syntheticBitcoinAddress(), enabled: true, createdAt: 1, options: { network: 'mainnet', addressType: 'address' } };
  const btcPosition = { schemaVersion: 3, id: 'position-btc-price', walletId: btcWallet.id, family: 'bitcoin', chainId: null, assetKind: 'native', assetId: 'native:btc', symbol: 'BTC', baseUnits: '1', quantity: '0.00000001', confirmedBaseUnits: '1', pendingBaseUnits: '0', decimals: 8, updatedAt: 1, spam: null };
  const btcState = { ...base, wallets: [btcWallet], positions: [btcPosition], prices: { ...base.prices, quotes: [{ assetId: 'asset:bitcoin:mainnet:native:native:btc', priceEurScaled: '1', priceUsdScaled: '1', scale: 12, change24hPercentScaled: null, change24hEurPercentScaled: null, change24hUsdPercentScaled: null, previousPriceEurScaled: null, previousPriceUsdScaled: null, source: 'synthetic', sourceTimestamp: null, fetchedAt: 1 }], statuses: [], valuations: [], history: [{ id: 'asset:bitcoin:mainnet:native:native:btc', kind: 'asset-price', points: [] }] } };
  assert.equal(parsePortfolioState(btcState).prices.quotes.length, 1);
  assert.equal(deleteWallet(btcState, btcWallet.id).ok, true);
});

test('position display names are bounded and optional during migration', () => {
  const wallet = { schemaVersion: 3, id: 'asset-name-wallet', label: 'Synthetic', family: 'evm', address: syntheticEvmAddress(), enabled: true, createdAt: 1, options: { autoScanCommonChains: true, chainIds: [] } };
  const basePosition = { schemaVersion: 3, id: 'asset-name-position', walletId: wallet.id, family: 'evm', chainId: 1, assetKind: 'fungible', assetId: 'synthetic-token', symbol: 'SYN', baseUnits: '1', quantity: '0.000000000000000001', confirmedBaseUnits: '1', pendingBaseUnits: '0', decimals: 18, updatedAt: 1, spam: null };
  assert.equal(parsePortfolioState({ schemaVersion: 5, settings: {}, wallets: [wallet], positions: [{ ...basePosition, assetName: 'Synthetic Token' }] }).positions[0].assetName, 'Synthetic Token');
  assert.equal(parsePortfolioState({ schemaVersion: 5, settings: {}, wallets: [wallet], positions: [{ ...basePosition, assetName: '\u0000bad' }] }).positions[0].assetName, undefined);
});
