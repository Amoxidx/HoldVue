import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPortfolioViewModel, formatPortfolioValue, rangeWindow, selectHistoryPoints, sortPortfolioAssets } from '../src/shared/portfolio.ts';
import { PRICE_SCALE } from '../src/shared/state.ts';

const address = `0x${'a'.repeat(40)}`;
const settings = (extra = {}) => ({ schemaVersion: 5, currency: 'EUR', locale: 'de', theme: 'dark', schedulerEnabled: true, spamFilterEnabled: true, showHiddenSpamAssets: false, enabledChainIds: [], customChains: [], rpcOverrides: [], providerRefs: [], providerEndpoints: [], enabledProviderIds: [], hiddenAssetIds: [], ...extra });
const wallet = (id, family = 'evm', options = { autoScanCommonChains: true, chainIds: [] }) => ({ schemaVersion: 3, id, label: `Synthetic ${id}`, family, address: family === 'evm' ? address.replace('a', id === 'w2' ? 'b' : 'a') : `synthetic-${id}`, enabled: true, createdAt: 1, options });
const position = (id, walletId, overrides = {}) => ({ schemaVersion: 3, id, walletId, family: 'evm', chainId: 1, assetKind: 'native', assetId: 'native:eth', symbol: 'ETH', baseUnits: '1000000000000000000', quantity: '1', confirmedBaseUnits: '1000000000000000000', pendingBaseUnits: '0', decimals: 18, updatedAt: 1, spam: null, ...overrides });
const quote = (assetId, eur = '2000000000000', usd = '2200000000000') => ({ assetId, priceEurScaled: eur, priceUsdScaled: usd, scale: PRICE_SCALE, change24hPercentScaled: '50000', change24hEurPercentScaled: '50000', change24hUsdPercentScaled: '40000', previousPriceEurScaled: '1900000000000', previousPriceUsdScaled: '2100000000000', source: 'synthetic', sourceTimestamp: null, fetchedAt: 1 });
const valuation = (assetId, value = '2000000000000') => ({ assetId, quantityBaseUnits: '2000000000000000000', quantityDecimals: 18, priceEurScaled: '2000000000000', priceUsdScaled: '2200000000000', valueEurScaled: value, valueUsdScaled: value, dayChangeEurScaled: '100000000000', dayChangeUsdScaled: '90000000000', dayChangePercentScaled: '50000', status: 'valued' });
const baseState = (extra = {}) => ({ schemaVersion: 5, settings: settings(), wallets: [wallet('w1'), wallet('w2')], positions: [position('p1', 'w1'), position('p2', 'w2')], instruments: [], holdings: [], sync: { schemaVersion: 1, statuses: [] }, prices: { quotes: [quote('asset:evm:1:native:native:eth')], statuses: [{ assetId: 'asset:evm:1:native:native:eth', providerId: 'coingecko.keyless', status: 'ok', errorCode: null, lastGoodFetchedAt: 1 }], valuations: [valuation('asset:evm:1:native:native:eth')], history: [], totalEurScaled: '4000000000000', totalUsdScaled: '4400000000000', complete: true, valuedAssets: 1, totalAssets: 1, dayChangeEurScaled: '200000000000', dayChangeUsdScaled: '180000000000', dayChangePercentScaled: '50000', }, ...extra });

test('portfolio view model aggregates canonical wallet assets and preserves accounts', () => {
  const model = buildPortfolioViewModel(baseState());
  assert.equal(model.assets.length, 1);
  assert.equal(model.assets[0].quantity, '2');
  assert.equal(model.assets[0].accounts.length, 2);
  assert.equal(model.assets[0].source, 'Multiple accounts');
  assert.equal(model.assets[0].accounts[0].chain, '1');
  assert.equal(model.summary.totalScaled, '2000000000000');
  assert.equal(model.summary.dayChangePercentScaled, '52632');
});

test('portfolio view model handles holdings, hides spam, restores user-hidden assets and conflicts', () => {
  const instrument = { schemaVersion: 4, id: 'i', providerId: 'fmp.market', providerSymbol: 'SYN@X', symbol: 'SYN', name: 'Synthetic ETF', exchange: 'X', currency: 'EUR', type: 'etf' };
  const state = baseState({ settings: settings({ hiddenAssetIds: ['asset:evm:1:native:hidden'] }), positions: [position('p1', 'w1', { assetId: 'hidden', symbol: 'HID', baseUnits: '1', quantity: '0.000000000000000001' }), position('p2', 'w2', { assetId: 'native:eth', decimals: 6, baseUnits: '1', quantity: '0.000001' }), position('p3', 'w1', { assetId: 'native:conflict', symbol: 'CON', baseUnits: '1', quantity: '0.000000000000000001' }), position('p4', 'w2', { assetId: 'native:conflict', symbol: 'CON', decimals: 6, baseUnits: '1', quantity: '0.000001' }), position('p7', 'w1', { assetId: 'native:conflict', symbol: 'CON', baseUnits: '1', quantity: '0.000000000000000001' }), position('p5', 'w1', { assetKind: 'fungible', assetId: `0x${'c'.repeat(40)}`, symbol: 'AIR', baseUnits: '1', quantity: '0.000000000000000001', spam: { riskFlags: ['suspicious-name'], reasons: ['synthetic reason'], hiddenByDefault: true } }), position('p6', 'w1', { assetId: 'native:zero', baseUnits: '0', quantity: '0' })], instruments: [instrument], holdings: [{ schemaVersion: 4, id: 'h', instrumentId: 'i', quantityHundredths: '123', quantity: '1.23', updatedAt: 1 }, { schemaVersion: 4, id: 'hz', instrumentId: 'i', quantityHundredths: '0', quantity: '0', updatedAt: 1 }], prices: { quotes: [quote('asset:evm:1:native:hidden'), quote('asset:evm:1:native:native:eth'), quote('asset:evm:1:native:native:conflict'), quote(`asset:evm:1:fungible:0x${'c'.repeat(40)}`), quote('instrument:i')], statuses: [], valuations: [valuation('instrument:i', '1230000000000')], history: [], totalEurScaled: null, totalUsdScaled: null, complete: false, valuedAssets: 0, totalAssets: 4, dayChangeEurScaled: null, dayChangeUsdScaled: null, dayChangePercentScaled: null } });
  const model = buildPortfolioViewModel(state);
  assert.equal(model.hiddenAssets.length, 2);
  assert.equal(model.assets.some(item => item.kind === 'instrument'), true);
  assert.equal(model.assets.find(item => item.symbol === 'ETH')?.status, 'partial');
  assert.equal(model.assets.find(item => item.symbol === 'CON')?.status, 'partial');
  const shown = buildPortfolioViewModel({ ...state, settings: settings({ showHiddenSpamAssets: true }) });
  assert.equal(shown.assets.some(item => item.symbol === 'AIR'), true);
  const off = buildPortfolioViewModel({ ...state, settings: settings({ spamFilterEnabled: false }) });
  assert.equal(off.assets.some(item => item.symbol === 'AIR'), true);
});

test('portfolio keeps fallback networks, exact signed day math, and status boundaries', () => {
  const evmFallback = position('fallback-evm', 'w1', { chainId: null, assetId: 'native:fallback', symbol: 'FALL', baseUnits: '1', quantity: '0.000000000000000001' });
  const solFallback = position('fallback-sol', 'sol', { family: 'solana', chainId: null, assetId: 'native:fallback-sol', symbol: 'SOLS', decimals: 9, baseUnits: '1', quantity: '0.000000001' });
  const wallets = [wallet('w1'), wallet('sol', 'solana', {})];
  const emptyPrices = { quotes: [], statuses: [], valuations: [], history: [], totalEurScaled: null, totalUsdScaled: null, complete: false, valuedAssets: 0, totalAssets: 0, dayChangeEurScaled: null, dayChangeUsdScaled: null, dayChangePercentScaled: null };
  const fallback = buildPortfolioViewModel(baseState({ wallets, positions: [evmFallback, solFallback], prices: emptyPrices }));
  assert.equal(fallback.assets.find(item => item.symbol === 'FALL')?.accounts[0].chain, 'mainnet');
  assert.equal(fallback.assets.find(item => item.symbol === 'SOLS')?.accounts[0].chain, 'mainnet-beta');

  const assetId = 'asset:evm:1:native:native:neg';
  const negative = buildPortfolioViewModel(baseState({ positions: [position('neg', 'w1', { assetId: 'native:neg', symbol: 'NEG', baseUnits: '1', quantity: '0.000000000000000001' })], prices: { quotes: [quote(assetId)], statuses: [], valuations: [{ ...valuation(assetId, '100'), dayChangeEurScaled: '-100', dayChangeUsdScaled: '-100' }], history: [], totalEurScaled: null, totalUsdScaled: null, complete: false, valuedAssets: 0, totalAssets: 1, dayChangeEurScaled: null, dayChangeUsdScaled: null, dayChangePercentScaled: null } }));
  assert.equal(negative.summary.dayChangePercentScaled, '-500000');
  const zeroPrevious = buildPortfolioViewModel(baseState({ positions: [position('zero-previous', 'w1', { assetId: 'native:zero-previous', symbol: 'ZERO', baseUnits: '1', quantity: '0.000000000000000001' })], prices: { quotes: [quote('asset:evm:1:native:native:zero-previous')], statuses: [], valuations: [{ ...valuation('asset:evm:1:native:native:zero-previous', '100'), dayChangeEurScaled: '100', dayChangeUsdScaled: '100' }], history: [], totalEurScaled: null, totalUsdScaled: null, complete: false, valuedAssets: 0, totalAssets: 1, dayChangeEurScaled: null, dayChangeUsdScaled: null, dayChangePercentScaled: null } }));
  assert.equal(zeroPrevious.summary.dayChangePercentScaled, null);

  const duplicateSpam = [position('spam-a', 'w1', { assetKind: 'fungible', assetId: `0x${'d'.repeat(40)}`, symbol: 'DUST', baseUnits: '1', quantity: '0.000000000000000001', spam: null }), position('spam-b', 'w2', { assetKind: 'fungible', assetId: `0x${'d'.repeat(40)}`, symbol: 'DUST', baseUnits: '1', quantity: '0.000000000000000001', spam: { riskFlags: ['suspicious-name'], reasons: ['synthetic spam'], hiddenByDefault: true } })];
  const spamModel = buildPortfolioViewModel(baseState({ positions: duplicateSpam }));
  assert.equal(spamModel.hiddenAssets.some(item => item.symbol === 'DUST'), true);

  const staleId = 'asset:evm:1:native:native:stale';
  const stale = buildPortfolioViewModel(baseState({ positions: [position('stale', 'w1', { assetId: 'native:stale', symbol: 'STALE', baseUnits: '1', quantity: '0.000000000000000001' })], prices: { quotes: [quote(staleId)], statuses: [{ assetId: staleId, providerId: 'synthetic', status: 'stale', errorCode: null, lastGoodFetchedAt: 1 }], valuations: [], history: [], totalEurScaled: null, totalUsdScaled: null, complete: false, valuedAssets: 0, totalAssets: 1, dayChangeEurScaled: null, dayChangeUsdScaled: null, dayChangePercentScaled: null } }));
  assert.equal(stale.assets[0]?.status, 'stale');
});

test('portfolio ignores orphan and zero inputs while retaining deterministic edge branches', () => {
  const state = baseState({ positions: [position('zero', 'w1', { baseUnits: '0', quantity: '0' }), position('orphan', 'missing', { decimals: 0, baseUnits: '1', quantity: '1' }), position('flat', 'w1', { decimals: 0, assetId: 'flat', symbol: 'FLAT', baseUnits: '1', quantity: '1' })], holdings: [{ schemaVersion: 4, id: 'missing-holding', instrumentId: 'missing', quantityHundredths: '1', quantity: '0.01', updatedAt: 1 }], wallets: [wallet('w1')] });
  const model = buildPortfolioViewModel(state);
  assert.equal(model.assets.some(item => item.symbol === 'FLAT'), true);
  assert.equal(model.assets.some(item => item.symbol === 'orphan'), false);
});

test('portfolio sorting, ranges and exact formatting are deterministic', () => {
  const assets = [
    { assetId: 'b', valueScaled: null, dayChangeScaled: null, dayChangePercentScaled: null },
    { assetId: 'a', valueScaled: '200', dayChangeScaled: '-2', dayChangePercentScaled: '-10000' },
    { assetId: 'c', valueScaled: '100', dayChangeScaled: '1', dayChangePercentScaled: '5000' }
  ];
  assert.deepEqual(sortPortfolioAssets(assets, 'size').map(item => item.assetId), ['a', 'c', 'b']);
  assert.deepEqual(sortPortfolioAssets(assets, 'gainers').map(item => item.assetId), ['c', 'a', 'b']);
  assert.deepEqual(sortPortfolioAssets(assets, 'losers').map(item => item.assetId), ['a', 'c', 'b']);
  assert.deepEqual(sortPortfolioAssets([{ assetId: 'z', valueScaled: null, dayChangeScaled: null, dayChangePercentScaled: null }, { assetId: 'y', valueScaled: null, dayChangeScaled: null, dayChangePercentScaled: null }], 'size').map(item => item.assetId), ['y', 'z']);
  assert.deepEqual(sortPortfolioAssets([{ assetId: 'c', valueScaled: null, dayChangeScaled: null, dayChangePercentScaled: null }, { assetId: 'b', valueScaled: null, dayChangeScaled: null, dayChangePercentScaled: null }, { assetId: 'a', valueScaled: null, dayChangeScaled: null, dayChangePercentScaled: null }], 'size').map(item => item.assetId), ['a', 'b', 'c']);
  assert.deepEqual(sortPortfolioAssets([{ assetId: 'z', valueScaled: null, dayChangeScaled: null, dayChangePercentScaled: null }, { assetId: 'a', valueScaled: '1', dayChangeScaled: null, dayChangePercentScaled: null }], 'size').map(item => item.assetId), ['a', 'z']);
  assert.deepEqual(sortPortfolioAssets([{ assetId: 'b', valueScaled: '1', dayChangeScaled: null, dayChangePercentScaled: '100' }, { assetId: 'a', valueScaled: '1', dayChangeScaled: null, dayChangePercentScaled: '100' }], 'gainers').map(item => item.assetId), ['a', 'b']);
  assert.equal(rangeWindow('1D'), 86400000); assert.equal(rangeWindow('7D'), 604800000); assert.equal(rangeWindow('1M'), 2592000000); assert.equal(rangeWindow('1Y'), 31536000000); assert.equal(rangeWindow('MAX'), null);
  const points = [{ timestamp: 0 }, { timestamp: 86400000 }, { timestamp: 90000000 }];
  assert.equal(selectHistoryPoints(points, '1D', 90000000).length, 2); assert.equal(selectHistoryPoints(points, 'MAX', 90000000).length, 3);
  assert.equal(formatPortfolioValue(null, 'EUR'), '—'); assert.equal(formatPortfolioValue('1230000000000', 'EUR'), '1.23 EUR');
});

test('non-EVM wallet networks are retained in account identity', () => {
  const btc = wallet('btc', 'bitcoin', { network: 'testnet', addressType: 'address' });
  const sol = wallet('sol', 'solana', { network: 'devnet' });
  const state = baseState({ wallets: [btc, sol], positions: [position('pb', 'btc', { family: 'bitcoin', chainId: null, assetId: 'btc', symbol: 'BTC', decimals: 8, baseUnits: '1', quantity: '0.00000001' }), position('ps', 'sol', { family: 'solana', chainId: null, assetId: 'sol', symbol: 'SOL', decimals: 9, baseUnits: '1', quantity: '0.000000001' })], prices: { quotes: [], statuses: [], valuations: [], history: [], totalEurScaled: null, totalUsdScaled: null, complete: false, valuedAssets: 0, totalAssets: 0, dayChangeEurScaled: null, dayChangeUsdScaled: null, dayChangePercentScaled: null } });
  const model = buildPortfolioViewModel(state);
  assert.equal(model.assets.find(item => item.symbol === 'BTC')?.accounts[0].chain, 'testnet');
  assert.equal(model.assets.find(item => item.symbol === 'SOL')?.accounts[0].chain, 'devnet');
});
