import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COINGECKO_PROVIDER_ID, COINGECKO_SIMPLE_PRICE_URL, COINGECKO_TOKEN_PRICE_URL, FMP_BATCH_QUOTE_URL, FMP_FOREX_QUOTE_URL, YAHOO_CHART_URL, YAHOO_QUOTES_PROVIDER_ID,
  assetIdentityForInstrument, assetIdentityForPosition, createCoinGeckoPriceAdapter, createFmpQuoteAdapter, createPricingCoordinator, createYahooQuoteAdapter, providerQuoteSymbol, yahooQuoteSymbol,
  decimalToScaled, mergePriceState, roundsToZeroInBothCurrencies, scaledToDecimal, updateHistory, valueAssets
} from '../src/shared/pricing.ts';
import { canonicalEvmNativeAssetId, canonicalizePersistedAssetId, isEvmNativeSystemContract, knownEvmNativeCoinId } from '../src/shared/asset-identity.ts';
import { createEmptyPortfolioState, parsePortfolioState, PRICE_SCALE } from '../src/shared/state.ts';
import { TransportError } from '../src/shared/transport.ts';

const httpContext = { now: 1_700_000_000_000 };
const contract = `0x${'a'.repeat(40)}`;
const quote = (assetId, eur = '1000000000000', usd = '1100000000000', change = '50000') => ({ assetId, priceEurScaled: eur, priceUsdScaled: usd, scale: PRICE_SCALE, change24hPercentScaled: change, change24hEurPercentScaled: change, change24hUsdPercentScaled: change, previousPriceEurScaled: null, previousPriceUsdScaled: null, source: 'synthetic', sourceTimestamp: null, fetchedAt: httpContext.now });

function fakeHttp(handler) { return { async requestJson(request, signal) { if (signal?.aborted) throw new TransportError('aborted', 'aborted'); return handler(request); } }; }
function nativePosition(overrides = {}) { return { schemaVersion: 3, id: 'p', walletId: 'w', family: 'evm', chainId: 1, assetKind: 'native', assetId: 'native:1', symbol: 'ETH', baseUnits: '1000000000000000000', quantity: '1', confirmedBaseUnits: '1000000000000000000', pendingBaseUnits: '0', decimals: 18, updatedAt: 1, spam: null, ...overrides }; }

test('fixed-point decimals reject unsafe values and round ties deterministically', () => {
  assert.equal(decimalToScaled('1.1234567890125'), '1123456789013');
  assert.equal(decimalToScaled(1e-12), '1');
  assert.equal(decimalToScaled(1e-9), '1000');
  assert.equal(decimalToScaled('1e-3'), null);
  assert.equal(decimalToScaled('-1'), null);
  assert.equal(decimalToScaled('0'), null);
  assert.equal(decimalToScaled('1.2', 0), '1');
  assert.equal(decimalToScaled('1.6', 0), '2');
  assert.equal(decimalToScaled('1', -1), null);
  assert.equal(decimalToScaled('1', 37), null);
  assert.equal(decimalToScaled('9'.repeat(31)), null);
  assert.equal(decimalToScaled(Number.NaN), null);
  assert.equal(decimalToScaled(Number.POSITIVE_INFINITY), null);
  assert.equal(scaledToDecimal('1000000000000'), '1');
  assert.equal(scaledToDecimal('-1000000000000'), '-1');
  assert.equal(scaledToDecimal('12', 0), '12');
  assert.throws(() => scaledToDecimal('1.2'));
  assert.throws(() => scaledToDecimal('1', 37));
  assert.equal(decimalToScaled(1e21), '1000000000000000000000000000000000');
  assert.equal(decimalToScaled(1.23e-1), '123000000000');
  assert.equal(decimalToScaled(-1.23e-1, PRICE_SCALE, true), '-123000000000');
  assert.equal(decimalToScaled(1.23e-7), '123000');
  assert.equal(decimalToScaled(-1.23e-7, PRICE_SCALE, true), '-123000');
  assert.equal(decimalToScaled('-0', PRICE_SCALE, true), '0');
  assert.equal(decimalToScaled('-0.1', PRICE_SCALE, true), '-100000000000');
  assert.equal(decimalToScaled(`1.${'0'.repeat(37)}`), null);
  assert.equal(decimalToScaled('1.2344', 3), '1234');
  assert.equal(scaledToDecimal('-0'), '-0');
  assert.equal(scaledToDecimal('-1'), '-0.000000000001');
  assert.equal(scaledToDecimal('-12', 0), '-12');
  assert.equal(scaledToDecimal('0'), '0');
  assert.equal(roundsToZeroInBothCurrencies('0', '4999999999'), true);
  assert.equal(roundsToZeroInBothCurrencies('5000000000', '1'), false);
  assert.equal(roundsToZeroInBothCurrencies('1', '5000000000'), false);
  assert.equal(roundsToZeroInBothCurrencies(null, '1'), false);
  assert.equal(roundsToZeroInBothCurrencies('1', null), false);
});

test('asset identities stack canonical native coins while preserving chain-specific tokens and unsupported assets', () => {
  const eth = assetIdentityForPosition(nativePosition());
  const base = assetIdentityForPosition(nativePosition({ chainId: 8453, assetId: 'native:8453' }));
  assert.equal(eth.assetId, base.assetId); assert.equal(eth.assetId, 'asset:evm:native:ethereum'); assert.equal(eth.coingeckoId, 'ethereum'); assert.equal(base.coingeckoId, 'ethereum');
  const sol = assetIdentityForPosition(nativePosition({ family: 'solana', chainId: null, assetId: 'native:sol', symbol: 'SOL' }), 'devnet');
  assert.equal(sol.coingeckoId, undefined); assert.match(sol.assetId, /devnet/);
  const token = assetIdentityForPosition(nativePosition({ assetKind: 'fungible', assetId: contract, symbol: 'SYN' }));
  assert.equal(token.platform, 'ethereum'); assert.equal(token.contractAddress, contract);
  const solToken = assetIdentityForPosition(nativePosition({ family: 'solana', chainId: null, assetKind: 'fungible', assetId: `mint-${'x'.repeat(24)}`, symbol: 'SYN' }), 'devnet');
  assert.equal(solToken.platform, undefined); assert.match(solToken.assetId, /devnet/);
  const unknown = assetIdentityForPosition(nativePosition({ family: 'cardano', chainId: null, assetId: 'asset:unknown', symbol: 'SYN' }), 'testnet');
  assert.equal(unknown.coingeckoId, undefined); assert.match(unknown.assetId, /testnet/);
  const instrument = assetIdentityForInstrument({ schemaVersion: 4, id: 'i', providerId: 'fmp.market', providerSymbol: 'SYN@X', symbol: 'SYN', name: 'Synthetic', exchange: 'X', currency: 'EUR', type: 'stock' });
  assert.equal(instrument.assetId, 'instrument:i');
  assert.match(assetIdentityForPosition(nativePosition({ chainId: null }), 'mainnet').assetId, /unknown/);
  assert.equal(assetIdentityForPosition(nativePosition({ family: 'evm', chainId: 1 }), 'mainnet').assetId, 'asset:evm:native:ethereum');
  assert.equal(assetIdentityForPosition(nativePosition({ family: 'bitcoin', chainId: null, assetId: 'native:btc', symbol: 'BTC' })).coingeckoId, 'bitcoin');
  assert.equal(assetIdentityForPosition(nativePosition({ family: 'solana', chainId: null, assetId: 'native:sol', symbol: 'SOL' })).coingeckoId, 'solana');
  assert.equal(assetIdentityForPosition(nativePosition({ family: 'solana', chainId: null, assetKind: 'fungible', assetId: `mint-${'x'.repeat(24)}` })).platform, 'solana');
  assert.match(assetIdentityForPosition(nativePosition({ family: 'cardano', chainId: null, assetId: 'asset:unknown', symbol: 'SYN' })).assetId, /unknown/);
  assert.match(assetIdentityForPosition(nativePosition({ family: 'cardano', chainId: null, assetKind: 'fungible', assetId: 'asset:unknown', symbol: 'SYN' })).assetId, /unknown/);
  assert.equal(knownEvmNativeCoinId(null), undefined);
  assert.equal(knownEvmNativeCoinId(8453), 'ethereum');
  assert.equal(canonicalEvmNativeAssetId(1, 'native:custom'), 'asset:evm:1:native:native:custom');
  assert.equal(canonicalEvmNativeAssetId(null, 'native:custom'), 'asset:evm:unknown:native:native:custom');
  assert.equal(canonicalizePersistedAssetId('asset:evm:8453:native:native:8453'), 'asset:evm:native:ethereum');
  assert.equal(canonicalizePersistedAssetId('asset:evm:1:native:native:2'), 'asset:evm:1:native:native:2');
  assert.equal(canonicalizePersistedAssetId('asset:evm:999999:native:native:999999'), 'asset:evm:999999:native:native:999999');
  assert.equal(canonicalizePersistedAssetId('instrument:synthetic'), 'instrument:synthetic');
  assert.equal(isEvmNativeSystemContract(137, `0x${'0'.repeat(36)}1010`), true);
  assert.equal(isEvmNativeSystemContract(137, `0x${'0'.repeat(39)}1`), false);
  assert.equal(isEvmNativeSystemContract(null, `0x${'0'.repeat(36)}1010`), false);
});

test('CoinGecko keyless adapter parses official fields, aliases native ids, groups token platforms and marks partials', async () => {
  const token2 = `0x${'b'.repeat(40)}`;
  const requests = [];
  const http = fakeHttp(request => {
    requests.push(request.url);
    if (request.url.startsWith(COINGECKO_SIMPLE_PRICE_URL)) return { ethereum: { eur: 2000, usd: '2200.1234567890123', eur_24h_change: 2, usd_24h_change: 5, last_updated_at: 123 } };
    if (request.url.includes('/ethereum?')) return { [contract.toLowerCase()]: { eur: 2, usd: 2.2, last_updated_at: 124 } };
    if (request.url.includes('/solana?')) return { [token2.toLowerCase()]: { eur: 3, usd: 3.3 } };
    return {};
  });
  const adapter = createCoinGeckoPriceAdapter({ http, maxBatch: 1, maxConcurrency: 1 });
  const assets = [
    { assetId: 'eth-main', kind: 'native', family: 'evm', symbol: 'ETH', coingeckoId: 'ethereum' },
    { assetId: 'eth-base', kind: 'native', family: 'evm', symbol: 'ETH', coingeckoId: 'ethereum' },
    { assetId: 'token-eth', kind: 'fungible', family: 'evm', symbol: 'SYN', platform: 'ethereum', contractAddress: contract },
    { assetId: 'token-sol', kind: 'fungible', family: 'solana', symbol: 'SYN', platform: 'solana', contractAddress: token2 },
    { assetId: 'unknown', kind: 'fungible', family: 'cardano', symbol: 'SYN' }
  ];
  const result = await adapter.fetch(assets, { ...httpContext, http });
  assert.equal(result.quotes.length, 4); assert.equal(result.statuses.find(item => item.assetId === 'unknown')?.errorCode, 'unsupported-asset');
  assert.notEqual(result.quotes.find(item => item.assetId === 'eth-main')?.previousPriceEurScaled, result.quotes.find(item => item.assetId === 'eth-main')?.previousPriceUsdScaled);
  assert.ok(requests.some(url => url.includes('include_last_updated_at=true'))); assert.equal(requests.filter(url => url.includes('/ethereum?')).length, 1);
  const malformed = createCoinGeckoPriceAdapter({ http: fakeHttp(() => ({ ethereum: { eur: 0, usd: 1 } })), wait: async () => undefined });
  assert.equal((await malformed.fetch([assets[0]], { ...httpContext, http })).partial, true);
  const providerError = createCoinGeckoPriceAdapter({ http: fakeHttp(() => 'malformed') });
  assert.equal((await providerError.fetch([assets[0]], { ...httpContext, http })).statuses[0].errorCode, 'provider-error');
});

test('CoinGecko retry, cooldown, abort and malformed transport states are structured', async () => {
  let calls = 0; let waits = 0;
  const http = fakeHttp(() => { calls++; if (calls < 3) throw new TransportError('http', 'limited', 429); return { ethereum: { eur: 1, usd: 1 } }; });
  const adapter = createCoinGeckoPriceAdapter({ http, wait: async () => { waits++; } });
  const asset = { assetId: 'a', kind: 'native', family: 'evm', symbol: 'ETH', coingeckoId: 'ethereum' };
  const result = await adapter.fetch([asset], { ...httpContext, http }); assert.equal(result.statuses[0].status, 'rate-limited'); assert.equal(calls, 2); assert.equal(waits, 2);
  const abort = new AbortController(); abort.abort(); const aborted = await adapter.fetch([asset], { ...httpContext, http: fakeHttp(() => { throw new TransportError('aborted', 'aborted'); }), signal: abort.signal }); assert.equal(aborted.statuses[0].status, 'aborted');
  const defaultWait = createCoinGeckoPriceAdapter({ http: fakeHttp(() => { throw new TransportError('http', 'limited', 429); }) });
  assert.equal((await defaultWait.fetch([asset], { ...httpContext, http: fakeHttp(() => { throw new TransportError('http', 'limited', 429); }) })).statuses[0].status, 'rate-limited');
});

test('CoinGecko keyless token pricing sends one contract per public request', async () => {
  const first = `0x${'c'.repeat(40)}`;
  const second = `0x${'d'.repeat(40)}`;
  const requests = [];
  const waits = [];
  const http = fakeHttp(request => {
    const url = new URL(request.url);
    const addresses = url.searchParams.get('contract_addresses').split(',');
    requests.push(addresses);
    return { [addresses[0].toLowerCase()]: { eur: 1, usd: 1.2 } };
  });
  const assets = [first, second].map((contractAddress, index) => ({ assetId: `base-${index}`, kind: 'fungible', family: 'evm', symbol: 'BASE', platform: 'base', contractAddress }));
  const result = await createCoinGeckoPriceAdapter({ http, maxBatch: 50, maxConcurrency: 1, requestDelayMs: 1, wait: async milliseconds => { waits.push(milliseconds); } }).fetch(assets, { ...httpContext, http });
  assert.equal(result.quotes.length, 2);
  assert.deepEqual(requests, [[first], [second]]);
  assert.deepEqual(waits, [1]);
});

function yahooPayload(currency, current, previous, timestamp = 123, closes = []) {
  return { chart: { result: [{ meta: { currency, regularMarketPrice: current, chartPreviousClose: previous, regularMarketTime: timestamp }, indicators: { quote: [{ close: closes }] } }] } };
}

test('Yahoo Finance prices keylessly convert EUR, USD and other currencies with exact source metadata', async () => {
  const requests = [];
  const http = fakeHttp(request => {
    requests.push(request);
    const symbol = decodeURIComponent(new URL(request.url).pathname.split('/').at(-1));
    if (symbol === 'EURUSD=X') return yahooPayload('USD', 1.1, 1.09);
    if (symbol === 'JPYUSD=X') return yahooPayload('USD', 0.007, 0.0069);
    if (symbol === 'EUNL.DE') return yahooPayload('EUR', 100, 90);
    if (symbol === 'USD') return yahooPayload('USD', undefined, 19, null, [null, 20]);
    if (symbol === 'JPY') return { chart: { result: [{ meta: { currency: 'jpy', regularMarketPrice: 1000, previousClose: 900 }, indicators: { quote: [{ close: [] }] } }] } };
    if (symbol === 'NOPREV.DE') return yahooPayload('EUR', 8, null);
    return null;
  });
  const make = (id, currency, providerSymbol = id, exchange = 'SYN') => assetIdentityForInstrument({ schemaVersion: 4, id, providerId: 'holdvue.catalog', providerSymbol, symbol: id, name: 'Synthetic', exchange, currency, type: 'etf' });
  const assets = [make('eur', 'EUR', 'EUNL.DE', 'XETRA'), make('usd', 'USD', 'USD'), make('jpy', 'JPY', 'JPY'), make('noprev', 'EUR', 'NOPREV.DE', 'XETRA')];
  const result = await createYahooQuoteAdapter({ http }).fetch(assets, { ...httpContext, http });
  assert.equal(result.providerId, YAHOO_QUOTES_PROVIDER_ID); assert.equal(result.partial, false); assert.equal(result.quotes.length, 4);
  assert.equal(result.quotes.every(item => item.source === YAHOO_QUOTES_PROVIDER_ID), true);
  assert.equal(result.quotes.find(item => item.assetId === 'instrument:eur').sourceTimestamp, 123000);
  assert.equal(result.quotes.find(item => item.assetId === 'instrument:usd').change24hPercentScaled, '52632');
  assert.equal(result.quotes.find(item => item.assetId === 'instrument:jpy').sourceTimestamp, null);
  assert.equal(result.quotes.find(item => item.assetId === 'instrument:noprev').change24hPercentScaled, null);
  assert.equal(result.quotes.find(item => item.assetId === 'instrument:noprev').previousPriceEurScaled, null);
  assert.equal(requests.every(item => item.allowPublicPath === true), true);
  assert.equal(requests.some(item => item.url.startsWith(`${YAHOO_CHART_URL}/EUNL.DE`)), true);
  assert.equal(yahooQuoteSymbol(assets[0].instrument), 'EUNL.DE');
  assert.equal(yahooQuoteSymbol({ ...assets[0].instrument, exchange: 'NYSE', providerSymbol: 'BRK.B@NYSE' }), 'BRK-B');
  assert.equal(yahooQuoteSymbol({ ...assets[0].instrument, providerSymbol: 'bad symbol' }), null);
});

test('Yahoo Finance adapter fails closed for invalid symbols, responses, currencies, transport and FX gaps', async () => {
  const make = (id, currency = 'EUR', providerSymbol = id) => assetIdentityForInstrument({ schemaVersion: 4, id, providerId: 'yahoo.finance', providerSymbol, symbol: id, name: 'Synthetic', exchange: 'SYN', currency, type: 'stock' });
  const invalid = make('invalid', 'EUR', 'bad symbol');
  const mismatch = make('mismatch'); const missing = make('missing'); const malformed = make('malformed'); const thrown = make('thrown');
  const http = fakeHttp(request => {
    const symbol = decodeURIComponent(new URL(request.url).pathname.split('/').at(-1));
    if (symbol === 'mismatch') return yahooPayload('USD', 1, 1);
    if (symbol === 'missing') return { chart: { result: [] } };
    if (symbol === 'malformed') return { chart: { result: [{ meta: { currency: 'EU', regularMarketPrice: 1 }, indicators: {} }] } };
    if (symbol === 'thrown') throw new TransportError('timeout', 'synthetic');
    return yahooPayload('USD', 1.1, 1);
  });
  const result = await createYahooQuoteAdapter({ http, timeoutMs: 1, maxBytes: 2 }).fetch([invalid, mismatch, missing, malformed, thrown], { ...httpContext, http });
  assert.deepEqual(result.statuses.map(item => item.errorCode), ['unsupported-asset', 'currency-mismatch', 'missing-quote', 'missing-quote', 'timeout']);
  assert.equal(result.partial, true); assert.equal(result.quotes.length, 0);

  const noFxHttp = fakeHttp(request => {
    const symbol = decodeURIComponent(new URL(request.url).pathname.split('/').at(-1));
    if (symbol.endsWith('=X')) throw new Error('synthetic FX failure');
    return yahooPayload(symbol === 'gbp' ? 'GBP' : symbol === 'usd' ? 'USD' : 'EUR', 10, 9);
  });
  const noFx = await createYahooQuoteAdapter({ http: noFxHttp }).fetch([make('eur'), make('usd', 'USD'), make('gbp', 'GBP')], { ...httpContext, http: noFxHttp });
  assert.equal(noFx.statuses.every(item => item.errorCode === 'fx-unavailable'), true);
  const missingCrossHttp = fakeHttp(request => {
    const symbol = decodeURIComponent(new URL(request.url).pathname.split('/').at(-1));
    if (symbol === 'EURUSD=X') return yahooPayload('USD', 1.1, 1);
    if (symbol === 'JPYUSD=X') return null;
    return yahooPayload('JPY', 100, 90);
  });
  const missingCross = await createYahooQuoteAdapter({ http: missingCrossHttp }).fetch([make('jpy-cross', 'JPY')], { ...httpContext, http: missingCrossHttp });
  assert.equal(missingCross.statuses[0].errorCode, 'fx-unavailable');
  assert.equal((await createYahooQuoteAdapter({ http }).fetch([], { ...httpContext, http })).partial, false);

  const odd = make('odd');
  const malformedShapes = [null, {}, { chart: null }, { chart: { result: null } }, { chart: { result: [null] } }, { chart: { result: [{ meta: null }] } }, { chart: { result: [{ meta: { currency: 4 } }] } }, { chart: { result: [{ meta: { currency: 'EUR' }, indicators: null }] } }, { chart: { result: [{ meta: { currency: 'EUR' }, indicators: { quote: null } }] } }, { chart: { result: [{ meta: { currency: 'EUR' }, indicators: { quote: [null] } }] } }, { chart: { result: [{ meta: { currency: 'EUR' }, indicators: { quote: [{}] } }] } }, { chart: { result: [{ meta: { currency: 'EUR', regularMarketPrice: 0 }, indicators: { quote: [{ close: [null] }] } }] } }];
  for (const shape of malformedShapes) {
    const shapeHttp = fakeHttp(() => shape);
    const shaped = await createYahooQuoteAdapter({ http: shapeHttp }).fetch([odd], { ...httpContext, http: shapeHttp });
    assert.equal(shaped.statuses[0].errorCode, 'missing-quote');
  }
});

test('pricing adapters fail closed across option defaults, cooldown aliases, and malformed envelopes', async () => {
  const assets = [
    { assetId: 'eth', kind: 'native', family: 'evm', symbol: 'ETH', coingeckoId: 'ethereum' },
    { assetId: 'btc', kind: 'native', family: 'bitcoin', symbol: 'BTC', coingeckoId: 'bitcoin' }
  ];
  let calls = 0;
  const limitedHttp = fakeHttp(() => { calls++; throw new TransportError('http', 'limited'); });
  const limited = createCoinGeckoPriceAdapter({ http: limitedHttp, maxBatch: 0, maxConcurrency: 0, wait: async () => undefined });
  const limitedResult = await limited.fetch(assets, { ...httpContext, http: limitedHttp });
  assert.equal(calls, 1); assert.equal(limitedResult.statuses.every(item => item.status === 'error'), true);
  const cooldownHttp = fakeHttp(() => { throw new TransportError('http', 'limited', 429); });
  const cooldown = createCoinGeckoPriceAdapter({ http: cooldownHttp, maxBatch: 1, maxConcurrency: 1, wait: async () => undefined });
  const cooldownResult = await cooldown.fetch(assets, { ...httpContext, http: cooldownHttp });
  assert.equal(cooldownResult.statuses.every(item => item.status === 'rate-limited'), true);
  const token = { assetId: 'token', kind: 'fungible', family: 'evm', symbol: 'SYN', platform: 'ethereum', contractAddress: contract };
  const malformedToken = createCoinGeckoPriceAdapter({ http: fakeHttp(() => null), wait: async () => undefined });
  assert.equal((await malformedToken.fetch([token], { ...httpContext, http: fakeHttp(() => null) })).statuses[0].errorCode, 'provider-error');
  const statusless = createCoinGeckoPriceAdapter({ http: fakeHttp(() => { throw new TransportError('http', 'bad'); }), wait: async () => undefined });
  assert.equal((await statusless.fetch([assets[0]], { ...httpContext, http: fakeHttp(() => { throw new TransportError('http', 'bad'); }) })).statuses[0].errorCode, 'http');
  const invalidOptions = createCoinGeckoPriceAdapter({ http: fakeHttp(() => ({})), maxBatch: 251, maxConcurrency: 9, wait: async () => undefined });
  assert.equal((await invalidOptions.fetch([], { ...httpContext, http: fakeHttp(() => ({})) })).partial, false);
  const tiny = createCoinGeckoPriceAdapter({ http: fakeHttp(() => ({ ethereum: { eur: 1, usd: 1 } })), maxBatch: 250, maxConcurrency: 8, wait: async () => undefined });
  assert.equal((await tiny.fetch([assets[0]], { ...httpContext, http: fakeHttp(() => ({ ethereum: { eur: 1, usd: 1 } })) })).quotes.length, 1);
  const nullOptions = createCoinGeckoPriceAdapter({ http: fakeHttp(() => ({})), maxBatch: null, maxConcurrency: null, wait: async () => undefined });
  assert.equal((await nullOptions.fetch([], { ...httpContext, http: fakeHttp(() => ({})) })).partial, false);
  const noRecord = createCoinGeckoPriceAdapter({ http: fakeHttp(() => ({ ethereum: null })), wait: async () => undefined });
  assert.equal((await noRecord.fetch([assets[0]], { ...httpContext, http: fakeHttp(() => ({ ethereum: null })) })).statuses[0].errorCode, 'malformed');
  let serverErrors = 0;
  const retry5xx = createCoinGeckoPriceAdapter({ http: fakeHttp(() => { serverErrors++; throw new TransportError('http', 'server', 503); }), wait: async () => undefined });
  assert.equal((await retry5xx.fetch([assets[0]], { ...httpContext, http: fakeHttp(() => { throw new TransportError('http', 'server', 503); }), signal: undefined })).statuses[0].status, 'error');
  const abortWait = new AbortController(); const waiting = createCoinGeckoPriceAdapter({ http: fakeHttp(() => { throw new TransportError('http', 'limited', 429); }) }); const waitingRun = waiting.fetch([assets[0]], { ...httpContext, http: fakeHttp(() => { throw new TransportError('http', 'limited', 429); }), signal: abortWait.signal }); setImmediate(() => abortWait.abort()); assert.equal((await waitingRun).statuses[0].status, 'aborted');
  const cooldownUnknown = createCoinGeckoPriceAdapter({ http: fakeHttp(() => { throw new TransportError('http', 'limited', 429); }), maxBatch: 1, wait: async () => undefined });
  const unknownResult = await cooldownUnknown.fetch([{ ...assets[0] }, { assetId: 'unknown-after', kind: 'fungible', family: 'cardano', symbol: 'SYN' }, { assetId: 'token-after', kind: 'fungible', family: 'evm', symbol: 'SYN', platform: 'ethereum', contractAddress: contract }], { ...httpContext, http: fakeHttp(() => { throw new TransportError('http', 'limited', 429); }) });
  assert.equal(unknownResult.statuses.find(item => item.assetId === 'unknown-after')?.status, 'rate-limited');
  assert.equal(unknownResult.statuses.find(item => item.assetId === 'token-after')?.status, 'rate-limited');
  const missingToken = createCoinGeckoPriceAdapter({ http: fakeHttp(() => ({})), wait: async () => undefined });
  assert.equal((await missingToken.fetch([{ assetId: 'missing-token', kind: 'fungible', family: 'evm', symbol: 'SYN', platform: 'ethereum', contractAddress: contract }], { ...httpContext, http: fakeHttp(() => ({})) })).statuses[0].errorCode, 'malformed');
});

test('FMP quote adapter uses batch quote and cached official quote FX without key leakage', async () => {
  const requests = [];
  const instrument = { schemaVersion: 4, id: 'i', providerId: 'fmp.market', providerSymbol: 'EUNL.DE', symbol: 'EUNL', name: 'Synthetic ETF', exchange: 'XETRA', currency: 'USD', type: 'stock' };
  const asset = assetIdentityForInstrument(instrument);
  const http = fakeHttp(request => {
    requests.push(request);
    if (request.url.startsWith(FMP_FOREX_QUOTE_URL)) return [{ symbol: 'EURUSD', price: 1.1 }];
    if (request.url.startsWith(FMP_BATCH_QUOTE_URL)) return [{ symbol: 'EUNL.DE', price: 10, previousClose: 9, timestamp: 123 }];
    return [];
  });
  const adapter = createFmpQuoteAdapter({ http, getApiKey: async () => 'synthetic-key' });
  const result = await adapter.fetch([asset, { ...asset, assetId: 'instrument:j' }], { ...httpContext, http });
  assert.equal(result.quotes.length, 2); assert.equal(result.statuses.find(item => item.assetId === asset.assetId)?.status, 'ok');
  assert.equal(providerQuoteSymbol(instrument), 'EUNL.DE');
  assert.equal(providerQuoteSymbol({ ...instrument, providerSymbol: ' ' }), 'EUNL');
  assert.equal(providerQuoteSymbol({ ...instrument, providerId: 'holdvue.catalog', providerSymbol: 'EUNL@XETRA' }), 'EUNL.DE');
  assert.equal(providerQuoteSymbol({ ...instrument, providerId: 'holdvue.catalog', providerSymbol: 'SAP.DE@XETRA', symbol: 'SAP.DE' }), 'SAP.DE');
  assert.equal(providerQuoteSymbol({ ...instrument, providerSymbol: 'SYN@X' }), 'SYN');
  assert.ok(requests.some(item => item.url.includes('EUNL.DE')));
  assert.equal(requests.filter(item => item.url.startsWith(FMP_FOREX_QUOTE_URL)).length, 1); assert.ok(requests.every(item => !item.url.includes('synthetic-key'))); assert.equal(result.quotes[0].sourceTimestamp, 123000);
  const noKey = await createFmpQuoteAdapter({ http, getApiKey: () => null }).fetch([asset], { ...httpContext, http }); assert.equal(noKey.statuses[0].errorCode, 'unconfigured');
  const bad = await createFmpQuoteAdapter({ http: fakeHttp(() => { throw new TransportError('http', 'bad', 401); }), getApiKey: () => 'synthetic-key' }).fetch([asset], { ...httpContext, http }); assert.equal(bad.statuses[0].status, 'error');
});

test('FMP FX failures, missing rows, currencies and missing daily data stay partial', async () => {
  const instrument = currency => assetIdentityForInstrument({ schemaVersion: 4, id: currency, providerId: 'fmp.market', providerSymbol: `${currency}@X`, symbol: currency, name: 'Synthetic', exchange: 'X', currency, type: 'stock' });
  const http = fakeHttp(request => { if (request.url.startsWith(FMP_FOREX_QUOTE_URL)) return []; return [{ symbol: 'USD', price: 2 }]; });
  const result = await createFmpQuoteAdapter({ http, getApiKey: () => 'synthetic-key' }).fetch([instrument('USD'), instrument('JPY')], { ...httpContext, http });
  assert.equal(result.quotes.length, 0); assert.ok(result.statuses.every(item => item.status === 'unpriced' || item.status === 'partial'));
  assert.equal((await createFmpQuoteAdapter({ http, getApiKey: async () => { throw new Error('missing'); } }).fetch([instrument('USD')], { ...httpContext, http })).statuses[0].errorCode, 'unconfigured');
  assert.equal((await createFmpQuoteAdapter({ http, getApiKey: () => 'synthetic-key' }).fetch([], { ...httpContext, http })).partial, false);
});

test('FMP EUR and non-USD conversion uses distinct cached quote rates and previous close', async () => {
  const eur = assetIdentityForInstrument({ schemaVersion: 4, id: 'eur', providerId: 'fmp.market', providerSymbol: 'EUR@X', symbol: 'EUR', name: 'Synthetic', exchange: 'X', currency: 'EUR', type: 'stock' });
  const jpy = assetIdentityForInstrument({ schemaVersion: 4, id: 'jpy', providerId: 'fmp.market', providerSymbol: 'JPY@X', symbol: 'JPY', name: 'Synthetic', exchange: 'X', currency: 'JPY', type: 'stock' });
  const requests = [];
  const http = fakeHttp(request => { requests.push(request.url); if (request.url.includes('EURUSD')) return [{ symbol: 'EURUSD', price: 1.2 }]; if (request.url.includes('JPYUSD')) return [{ symbol: 'JPYUSD', price: 0.01 }]; return [{ symbol: 'EUR', price: 10, previousClose: 9 }, { symbol: 'JPY', price: 1000, previousClose: 900 }]; });
  const result = await createFmpQuoteAdapter({ http, getApiKey: () => 'synthetic-key' }).fetch([eur, jpy], { ...httpContext, http });
  assert.equal(result.quotes.length, 2); assert.equal(requests.filter(url => url.includes('EURUSD')).length, 1); assert.equal(requests.filter(url => url.includes('JPYUSD')).length, 1); assert.ok(result.quotes.every(item => item.previousPriceEurScaled !== null));
});

test('FMP quote parser keeps malformed, missing-FX, and missing-daily fields partial', async () => {
  const make = (id, currency) => assetIdentityForInstrument({ schemaVersion: 4, id, providerId: 'fmp.market', providerSymbol: `${id}@X`, symbol: id, name: 'Synthetic', exchange: 'X', currency, type: 'stock' });
  const eur = make('EUR2', 'EUR'); const usd = make('USD2', 'USD'); const jpy = make('JPY2', 'JPY');
  const http = fakeHttp(request => {
    if (request.url.startsWith(FMP_FOREX_QUOTE_URL)) {
      if (request.url.includes('EURUSD')) return [{ symbol: 'EURUSD', bid: 1.1 }];
      return [];
    }
    if (request.url.startsWith(FMP_BATCH_QUOTE_URL)) return [
      { symbol: 'EUR2', price: 10 },
      { symbol: 'USD2', priceClose: 11 },
      { symbol: 'JPY2', price: 100 }
    ];
    return [];
  });
  const result = await createFmpQuoteAdapter({ http, getApiKey: () => 'synthetic-key', maxBatch: 0 }).fetch([eur, usd, jpy], { ...httpContext, http });
  assert.equal(result.quotes.length, 2);
  assert.equal(result.statuses.find(item => item.assetId === 'instrument:JPY2')?.status, 'partial');
  const malformed = createFmpQuoteAdapter({ http: fakeHttp(request => request.url.startsWith(FMP_FOREX_QUOTE_URL) ? [null] : null), getApiKey: () => 'synthetic-key', maxBatch: 51 });
  assert.equal((await malformed.fetch([usd], { ...httpContext, http: fakeHttp(request => request.url.startsWith(FMP_FOREX_QUOTE_URL) ? [null] : null) })).statuses[0].status, 'error');
  const fallback = createFmpQuoteAdapter({ http: fakeHttp(request => request.url.startsWith(FMP_FOREX_QUOTE_URL) ? [{ symbol: 'EURUSD', ask: 1.2 }] : [{ symbol: 'USD2', price: 10, changesPercentage: 2 }]), getApiKey: () => 'synthetic-key', maxBatch: 1 });
  const fallbackResult = await fallback.fetch([usd], { ...httpContext, http: fakeHttp(request => request.url.startsWith(FMP_FOREX_QUOTE_URL) ? [{ symbol: 'EURUSD', ask: 1.2 }] : [{ symbol: 'USD2', price: 10, changesPercentage: 2 }]) });
  assert.equal(fallbackResult.quotes.length, 1);
  const noFx = (currency, id) => assetIdentityForInstrument({ schemaVersion: 4, id, providerId: 'fmp.market', providerSymbol: `${id}@X`, symbol: id, name: 'Synthetic', exchange: 'X', currency, type: 'stock' });
  const noFxHttp = fakeHttp(request => request.url.startsWith(FMP_FOREX_QUOTE_URL) ? [] : [{ symbol: 'EUR3', price: 10, previousClose: 9 }, { symbol: 'USD3', price: 10, previousClose: 9 }, { symbol: 'JPY3', price: 100, previousClose: 90 }]);
  const noFxResult = await createFmpQuoteAdapter({ http: noFxHttp, getApiKey: () => 'synthetic-key' }).fetch([noFx('EUR', 'EUR3'), noFx('USD', 'USD3'), noFx('JPY', 'JPY3')], { ...httpContext, http: noFxHttp });
  assert.equal(noFxResult.quotes.length, 0);
  const jpyOnlyHttp = fakeHttp(request => request.url.includes('EURUSD') ? [] : request.url.includes('JPYUSD') ? [{ symbol: 'JPYUSD', price: 0.01 }] : [{ symbol: 'JPY3', price: 100, previousClose: 90 }]);
  const jpyOnly = await createFmpQuoteAdapter({ http: jpyOnlyHttp, getApiKey: () => 'synthetic-key' }).fetch([noFx('JPY', 'JPY3')], { ...httpContext, http: jpyOnlyHttp });
  assert.equal(jpyOnly.quotes.length, 0);
});

test('valuation uses exact quantities, previous-percent math, incomplete totals and history compaction', () => {
  const complete = valueAssets([{ assetId: 'a', quantityBaseUnits: '2', quantityDecimals: 0, quote: quote('a', '1000000000000', '1200000000000', '50000') }]);
  assert.equal(complete.totalEurScaled, '2000000000000'); assert.equal(complete.dayChangeEurScaled, '95238095238'); assert.equal(complete.dayChangePercentScaled, '50000');
  const partial = valueAssets([{ assetId: 'a', quantityBaseUnits: '1', quantityDecimals: 0, quote: quote('a') }, { assetId: 'b', quantityBaseUnits: '1', quantityDecimals: 0 }]);
  assert.equal(partial.complete, false); assert.equal(partial.valuedAssets, 1); assert.equal(partial.assets[1].status, 'unpriced');
  const history = updateHistory([], [quote('a')], partial, 10); assert.equal(history.find(item => item.id === 'portfolio')?.points[0].coverage, 'partial');
  const repeated = Array.from({ length: 13000 }, (_, index) => ({ timestamp: index * 60000, valueEurScaled: '1', valueUsdScaled: '1', coverage: 'complete' }));
  const compacted = updateHistory([{ id: 'a', kind: 'asset-price', points: repeated }], [quote('a')], complete, 13000 * 60000);
  assert.ok((compacted.find(item => item.id === 'a')?.points.length ?? 0) <= 12000); assert.equal(compacted.find(item => item.id === 'a')?.points.at(-1)?.timestamp, 13000 * 60000);
  assert.equal(complete.assets[0].status, 'valued');
  assert.equal(valueAssets([]).totalEurScaled, null);
  const impossible = valueAssets([{ assetId: 'bad', quantityBaseUnits: '1', quantityDecimals: 0, quote: quote('bad', '1', '1', '-1000000') }]); assert.equal(impossible.assets[0].dayChangeEurScaled, null);
  assert.throws(() => valueAssets([{ assetId: 'bad-negative-previous', quantityBaseUnits: '1', quantityDecimals: 0, quote: { ...quote('bad-negative-previous', '1000000000000', '1000000000000', null), previousPriceEurScaled: '-1', previousPriceUsdScaled: '-1' } }]), /denominator/);
  const negative = valueAssets([{ assetId: 'negative', quantityBaseUnits: '1', quantityDecimals: 0, quote: quote('negative', '1000000000000', '1000000000000', '-50000') }]); assert.ok(Number(negative.dayChangeEurScaled) < 0);
  const noDay = valueAssets([{ assetId: 'no-day', quantityBaseUnits: '1', quantityDecimals: 0, quote: quote('no-day', '1000000000000', '1000000000000', null) }]); assert.equal(noDay.dayChangeEurScaled, null);
  const previous = valueAssets([{ assetId: 'previous', quantityBaseUnits: '1', quantityDecimals: 0, quote: { ...quote('previous', '1000000000000', '1000000000000', null), previousPriceEurScaled: '900000000000', previousPriceUsdScaled: '800000000000' } }]); assert.equal(previous.assets[0].dayChangeEurScaled, '100000000000');
  const perCurrency = valueAssets([{ assetId: 'per-currency', quantityBaseUnits: '1', quantityDecimals: 0, quote: { ...quote('per-currency', '1000000000000', '1000000000000', null), change24hEurPercentScaled: null, change24hUsdPercentScaled: '50000', change24hPercentScaled: null } }]); assert.equal(perCurrency.assets[0].dayChangeEurScaled, null);
  const long = Array.from({ length: 12001 }, (_, index) => ({ timestamp: index * 86400000, valueEurScaled: '1', valueUsdScaled: '1', coverage: 'complete' }));
  assert.ok((updateHistory([{ id: 'long', kind: 'asset-price', points: long }], [], complete, 12001 * 86400000).find(item => item.id === 'long')?.points.length ?? 0) <= 12000);
});

test('merge preserves stale last-good data, provider statuses and prunes orphans', () => {
  const previous = { quotes: [quote('a')], statuses: [{ assetId: 'a', providerId: COINGECKO_PROVIDER_ID, status: 'ok', errorCode: null, lastGoodFetchedAt: 1 }], valuations: [], history: [], totalEurScaled: null, totalUsdScaled: null, complete: false, valuedAssets: 0, totalAssets: 0, dayChangeEurScaled: null, dayChangeUsdScaled: null, dayChangePercentScaled: null };
  const merged = mergePriceState(previous, { providerId: COINGECKO_PROVIDER_ID, quotes: [], statuses: [{ assetId: 'a', providerId: COINGECKO_PROVIDER_ID, status: 'error', errorCode: 'timeout', lastGoodFetchedAt: null }], partial: true }, null, 2, new Set(['a']));
  assert.equal(merged.statuses[0].status, 'stale'); assert.equal(merged.quotes.length, 1);
  const pruned = mergePriceState(previous, { providerId: COINGECKO_PROVIDER_ID, quotes: [], statuses: [], partial: false }, null, 2, new Set()); assert.equal(pruned.quotes.length, 0);
  const fresh = mergePriceState(previous, { providerId: COINGECKO_PROVIDER_ID, quotes: [quote('a')], statuses: [{ assetId: 'a', providerId: COINGECKO_PROVIDER_ID, status: 'ok', errorCode: null, lastGoodFetchedAt: 2 }], partial: false }, completeValuation(), 3, new Set(['a'])); assert.equal(fresh.statuses[0].status, 'ok');
  assert.equal(mergePriceState(previous, { providerId: COINGECKO_PROVIDER_ID, quotes: [], statuses: [], partial: false }, null, 4).quotes.length, 1);
});

function completeValuation() { return valueAssets([{ assetId: 'a', quantityBaseUnits: '1', quantityDecimals: 0, quote: quote('a') }]); }

test('pricing coordinator single-flight, aggregation, provider failure and stop are deterministic', async () => {
  let calls = 0;
  const provider = { id: COINGECKO_PROVIDER_ID, async fetch(assets, context) { calls++; return { providerId: COINGECKO_PROVIDER_ID, quotes: assets.map(asset => quote(asset.assetId)), statuses: assets.map(asset => ({ assetId: asset.assetId, providerId: COINGECKO_PROVIDER_ID, status: 'ok', errorCode: null, lastGoodFetchedAt: context.now })), partial: false }; } };
  const state = createEmptyPortfolioState();
  const populated = { ...state, wallets: [{ schemaVersion: 3, id: 'w', label: 'Synthetic', family: 'evm', address: 'synthetic', enabled: true, createdAt: 1, options: { autoScanCommonChains: true, chainIds: [] } }], positions: [nativePosition()], prices: state.prices };
  const coordinator = createPricingCoordinator({ providers: [provider], now: () => 2 });
  const port = fakeHttp(() => ({})); const first = coordinator.run(populated, { http: port }); const second = coordinator.run(populated, { http: port });
  await first; await second; assert.equal(calls, 1);
  await coordinator.run(populated, { http: fakeHttp(() => ({})) }); assert.equal(calls, 2);
  coordinator.stop(); await assert.rejects(() => coordinator.run(populated, { http: fakeHttp(() => ({})) }), /stopped/);
});

test('pricing coordinator combines stop and caller abort signals including pre-aborted input', async () => {
  let observedStop = false;
  const provider = { id: COINGECKO_PROVIDER_ID, async fetch(assets, context) { return await new Promise(resolve => { context.signal.addEventListener('abort', () => { observedStop = true; resolve({ providerId: COINGECKO_PROVIDER_ID, quotes: [], statuses: assets.map(asset => ({ assetId: asset.assetId, providerId: COINGECKO_PROVIDER_ID, status: 'aborted', errorCode: 'aborted', lastGoodFetchedAt: null })), partial: true }); }); }); } };
  const state = { ...createEmptyPortfolioState(), positions: [nativePosition()] };
  const coordinator = createPricingCoordinator({ providers: [provider], now: () => 3 }); const running = coordinator.run(state, { http: fakeHttp(() => ({})) });
  await Promise.resolve(); coordinator.stop(); await running; assert.equal(observedStop, true);
  const caller = new AbortController(); caller.abort(); let preAborted = false;
  const preProvider = { id: COINGECKO_PROVIDER_ID, async fetch(assets, context) { preAborted = context.signal.aborted; return { providerId: COINGECKO_PROVIDER_ID, quotes: [], statuses: assets.map(asset => ({ assetId: asset.assetId, providerId: COINGECKO_PROVIDER_ID, status: 'aborted', errorCode: 'aborted', lastGoodFetchedAt: null })), partial: true }; } };
  const pre = createPricingCoordinator({ providers: [preProvider], now: () => 4 }); await pre.run(state, { http: fakeHttp(() => ({})), signal: caller.signal }); assert.equal(preAborted, true);
});

test('pricing coordinator handles network fallbacks, duplicate quantities, skipped providers, and provider errors', async () => {
  const btcPosition = nativePosition({ id: 'btc-1', walletId: 'btc', family: 'bitcoin', chainId: null, assetId: 'native:btc', symbol: 'BTC', decimals: 8, baseUnits: '2', quantity: '0.00000002' });
  const btcPosition2 = { ...btcPosition, id: 'btc-2', walletId: 'btc-2', decimals: 7, baseUnits: '3', quantity: '0.0000003' };
  const btcPosition3 = { ...btcPosition, id: 'btc-3', walletId: 'btc', decimals: 8, baseUnits: '4', quantity: '0.00000004' };
  const solPosition = nativePosition({ id: 'sol-1', walletId: 'sol', family: 'solana', chainId: null, assetId: 'native:sol', symbol: 'SOL', decimals: 9 });
  const orphanSol = nativePosition({ id: 'sol-2', walletId: 'missing', family: 'solana', chainId: null, assetId: 'native:sol', symbol: 'SOL', decimals: 9 });
  const fallbackSol = nativePosition({ id: 'sol-3', walletId: 'sol-fallback', family: 'solana', chainId: null, assetId: 'native:sol', symbol: 'SOL', decimals: 9 });
  const state = {
    ...createEmptyPortfolioState(),
    wallets: [
      { schemaVersion: 3, id: 'btc', label: 'Synthetic', family: 'bitcoin', address: 'synthetic-btc', enabled: true, createdAt: 1, options: { network: 'mainnet', addressType: 'address' } },
      { schemaVersion: 3, id: 'btc-2', label: 'Synthetic two', family: 'bitcoin', address: 'synthetic-btc-2', enabled: true, createdAt: 1, options: { network: 'mainnet', addressType: 'address' } },
      { schemaVersion: 3, id: 'sol', label: 'Synthetic sol', family: 'solana', address: 'synthetic-sol', enabled: true, createdAt: 1, options: { network: 'devnet' } },
      { schemaVersion: 3, id: 'sol-fallback', label: 'Synthetic fallback', family: 'solana', address: 'synthetic-sol-fallback', enabled: true, createdAt: 1, options: {} }
    ], positions: [btcPosition, btcPosition2, btcPosition3, solPosition, orphanSol, fallbackSol], prices: createEmptyPortfolioState().prices,
    instruments: [{ schemaVersion: 4, id: 'i', providerId: 'fmp.market', providerSymbol: 'SYN@X', symbol: 'SYN', name: 'Synthetic', exchange: 'X', currency: 'USD', type: 'stock' }],
    holdings: [{ schemaVersion: 4, id: 'h1', instrumentId: 'i', quantityHundredths: '100', quantity: '1', updatedAt: 1 }, { schemaVersion: 4, id: 'h2', instrumentId: 'i', quantityHundredths: '50', quantity: '0.5', updatedAt: 1 }]
  };
  let calls = 0;
  const provider = { id: COINGECKO_PROVIDER_ID, async fetch(assets, context) { calls++; return { providerId: COINGECKO_PROVIDER_ID, quotes: assets.map(asset => quote(asset.assetId)), statuses: assets.map(asset => ({ assetId: asset.assetId, providerId: COINGECKO_PROVIDER_ID, status: 'ok', errorCode: null, lastGoodFetchedAt: context.now })), partial: false }; } };
  const skipped = { id: 'unrelated', async fetch() { throw new Error('should be skipped'); } };
  const run = await createPricingCoordinator({ providers: [provider, skipped], now: () => 5 }).run(state, { http: fakeHttp(() => ({})) });
  assert.equal(calls, 1); assert.equal(run.valuation.valuedAssets, 3); assert.equal(run.valuation.assets.some(asset => asset.assetId.includes('bitcoin')), true);
  const failing = { id: COINGECKO_PROVIDER_ID, async fetch() { throw new TransportError('timeout', 'timeout'); } };
  const failed = await createPricingCoordinator({ providers: [failing], now: () => 5 }).run(state, { http: fakeHttp(() => ({})) });
  assert.equal(failed.results.length, 1);
  const stalePosition = nativePosition(); const staleAssetId = assetIdentityForPosition(stalePosition).assetId; const staleBase = createEmptyPortfolioState();
  const staleState = { ...staleBase, wallets: [{ schemaVersion: 3, id: 'w', label: 'Synthetic', family: 'evm', address: 'synthetic', enabled: true, createdAt: 1, options: { autoScanCommonChains: true, chainIds: [] } }], positions: [stalePosition], prices: { ...staleBase.prices, quotes: [quote(staleAssetId)], statuses: [{ assetId: staleAssetId, providerId: COINGECKO_PROVIDER_ID, status: 'ok', errorCode: null, lastGoodFetchedAt: 1 }] } };
  const stale = await createPricingCoordinator({ providers: [failing], now: () => 6 }).run(staleState, { http: fakeHttp(() => ({})) });
  assert.equal(stale.valuation.valuedAssets, 1); assert.equal(stale.state.prices.totalEurScaled, '1000000000000'); assert.equal(stale.state.prices.statuses[0].status, 'stale');
  const orphanQuote = quote('orphan'); const orphanValuation = valueAssets([{ assetId: 'orphan', quantityBaseUnits: '1', quantityDecimals: 0, quote: orphanQuote }]);
  const noMatch = await createPricingCoordinator({ providers: [skipped], now: () => 5 }).run({ ...state, positions: [], instruments: [], holdings: [], prices: { ...state.prices, quotes: [orphanQuote], statuses: [{ assetId: 'orphan', providerId: COINGECKO_PROVIDER_ID, status: 'ok', errorCode: null, lastGoodFetchedAt: 1 }], valuations: orphanValuation.assets, totalEurScaled: orphanValuation.totalEurScaled, totalUsdScaled: orphanValuation.totalUsdScaled, complete: true, valuedAssets: 1, totalAssets: 1, dayChangeEurScaled: '1', dayChangeUsdScaled: '1', dayChangePercentScaled: '1' } }, { http: fakeHttp(() => ({})) });
  assert.equal(noMatch.results.length, 0); assert.equal(noMatch.state.prices.quotes.length, 0); assert.equal(noMatch.state.prices.totalEurScaled, null); assert.equal(noMatch.state.prices.totalUsdScaled, null); assert.equal(noMatch.state.prices.valuedAssets, 0); assert.equal(noMatch.state.prices.totalAssets, 0);
  assert.equal(noMatch.state.prices.dayChangeEurScaled, null); assert.equal(noMatch.state.prices.dayChangeUsdScaled, null); assert.equal(noMatch.state.prices.dayChangePercentScaled, null);
});

test('pricing coordinator honors explicit keyless-provider switches and falls back after missing Yahoo quotes', async () => {
  const base = createEmptyPortfolioState();
  const instrument = { schemaVersion: 4, id: 'switch', providerId: 'holdvue.catalog', providerSymbol: 'SWITCH.DE', symbol: 'SWITCH', name: 'Synthetic Switch ETF', exchange: 'XETRA', currency: 'EUR', type: 'etf' };
  const state = { ...base, instruments: [instrument], holdings: [{ schemaVersion: 4, id: 'holding-switch', instrumentId: instrument.id, quantityHundredths: '100', quantity: '1', updatedAt: 1 }] };
  let yahooCalls = 0; let fallbackCalls = 0;
  const missingYahoo = { id: YAHOO_QUOTES_PROVIDER_ID, async fetch(assets) { yahooCalls++; return { providerId: YAHOO_QUOTES_PROVIDER_ID, quotes: [], statuses: assets.map(asset => ({ assetId: asset.assetId, providerId: YAHOO_QUOTES_PROVIDER_ID, status: 'unpriced', errorCode: 'missing-quote', lastGoodFetchedAt: null })), partial: true }; } };
  const fallback = { id: 'fmp.market', async fetch(assets, context) { fallbackCalls++; return { providerId: 'fmp.market', quotes: assets.map(asset => quote(asset.assetId)), statuses: assets.map(asset => ({ assetId: asset.assetId, providerId: 'fmp.market', status: 'ok', errorCode: null, lastGoodFetchedAt: context.now })), partial: false }; } };
  const run = await createPricingCoordinator({ providers: [missingYahoo, fallback], now: () => 20 }).run(state, { http: fakeHttp(() => ({})) });
  assert.equal(yahooCalls, 1); assert.equal(fallbackCalls, 1); assert.equal(run.valuation.valuedAssets, 1); assert.equal(run.state.prices.statuses[0].providerId, 'fmp.market');
  assert.equal(run.state.prices.history.find(series => series.id === 'portfolio')?.points.length, 1);

  const disabled = { ...state, settings: { ...state.settings, providerRefs: [{ providerId: YAHOO_QUOTES_PROVIDER_ID, keyId: null, enabled: false }, { providerId: COINGECKO_PROVIDER_ID, keyId: null, enabled: false }] } };
  yahooCalls = 0; fallbackCalls = 0;
  const disabledRun = await createPricingCoordinator({ providers: [missingYahoo, fallback], now: () => 21 }).run(disabled, { http: fakeHttp(() => ({})) });
  assert.equal(yahooCalls, 0); assert.equal(fallbackCalls, 1); assert.equal(disabledRun.valuation.valuedAssets, 1);
  let cryptoCalls = 0;
  const crypto = { id: COINGECKO_PROVIDER_ID, async fetch() { cryptoCalls++; throw new Error('disabled provider was called'); } };
  const cryptoState = { ...disabled, positions: [nativePosition()] };
  const cryptoRun = await createPricingCoordinator({ providers: [crypto], now: () => 22 }).run(cryptoState, { http: fakeHttp(() => ({})) });
  assert.equal(cryptoCalls, 0); assert.equal(cryptoRun.results.length, 1); assert.equal(cryptoRun.results[0].statuses[0].errorCode, 'provider-disabled');
});

test('pricing totals and portfolio history exclude hidden or quarantined assets while retaining their prices', async () => {
  const wallet = { schemaVersion: 3, id: 'w', label: 'Synthetic wallet', family: 'evm', address: 'synthetic-wallet', enabled: true, createdAt: 1, options: { autoScanCommonChains: true, chainIds: [] } };
  const visible = nativePosition({ id: 'visible', walletId: 'w', assetId: 'native:visible', symbol: 'VIS' });
  const hidden = nativePosition({ id: 'hidden', walletId: 'w', assetKind: 'fungible', assetId: `0x${'d'.repeat(40)}`, symbol: 'HID', spam: { riskFlags: ['suspicious-name'], reasons: ['synthetic'], hiddenByDefault: true } });
  const hiddenId = assetIdentityForPosition(hidden).assetId;
  const base = createEmptyPortfolioState();
  const previousHidden = valueAssets([{ assetId: hiddenId, quantityBaseUnits: hidden.baseUnits, quantityDecimals: hidden.decimals, quote: quote(hiddenId) }]).assets[0];
  const provider = { id: COINGECKO_PROVIDER_ID, async fetch(assets, context) { return { providerId: COINGECKO_PROVIDER_ID, quotes: assets.map(asset => quote(asset.assetId)), statuses: assets.map(asset => ({ assetId: asset.assetId, providerId: COINGECKO_PROVIDER_ID, status: 'ok', errorCode: null, lastGoodFetchedAt: context.now })), partial: false }; } };
  const state = { ...base, wallets: [wallet], positions: [visible, hidden], prices: { ...base.prices, valuations: previousHidden ? [previousHidden] : [] }, settings: { ...base.settings, hiddenAssetIds: [hiddenId], showHiddenSpamAssets: true } };
  const run = await createPricingCoordinator({ providers: [provider], now: () => 9 }).run(state, { http: fakeHttp(() => ({})) });
  assert.equal(run.valuation.totalAssets, 1); assert.equal(run.valuation.valuedAssets, 1); assert.equal(run.valuation.assets.some(item => item.assetId === hiddenId), true);
  assert.equal(run.state.prices.history.some(series => series.id === hiddenId && series.kind === 'asset-price'), true);
  assert.equal(run.state.prices.history.find(series => series.id === 'portfolio')?.points.at(-1)?.valueEurScaled, '1000000000000');
  assert.equal(run.state.prices.valuations.some(item => item.assetId === hiddenId), true);

  const spamState = { ...state, settings: { ...base.settings, hiddenAssetIds: [], showHiddenSpamAssets: true } };
  const spamRun = await createPricingCoordinator({ providers: [provider], now: () => 10 }).run(spamState, { http: fakeHttp(() => ({})) });
  assert.equal(spamRun.valuation.totalAssets, 1);
  const filterOff = await createPricingCoordinator({ providers: [provider], now: () => 11 }).run({ ...spamState, settings: { ...spamState.settings, spamFilterEnabled: false } }, { http: fakeHttp(() => ({})) });
  assert.equal(filterOff.valuation.totalAssets, 2);

  const solWallet = { schemaVersion: 3, id: 'sol', label: 'Synthetic Solana', family: 'solana', address: 'synthetic-solana', enabled: true, createdAt: 1, options: { network: 'devnet' } };
  const solSpam = nativePosition({ id: 'sol-spam', walletId: 'sol', family: 'solana', chainId: null, assetKind: 'fungible', assetId: `mint-${'x'.repeat(24)}`, symbol: 'SOLX', spam: { riskFlags: ['suspicious-name'], reasons: ['synthetic'], hiddenByDefault: true } });
  const networkRun = await createPricingCoordinator({ providers: [provider], now: () => 12 }).run({ ...spamState, wallets: [wallet, solWallet], positions: [visible, hidden, solSpam] }, { http: fakeHttp(() => ({})) });
  assert.equal(networkRun.valuation.totalAssets, 1);
  const orphanRun = await createPricingCoordinator({ providers: [provider], now: () => 13 }).run({ ...spamState, positions: [{ ...hidden, walletId: 'missing' }] }, { http: fakeHttp(() => ({})) });
  assert.equal(orphanRun.valuation.totalAssets, 0);
  const dust = nativePosition({ id: 'dust', walletId: 'w', assetId: 'native:dust', symbol: 'DUST', baseUnits: '1', quantity: '0.000000000000000001' });
  const dustRun = await createPricingCoordinator({ providers: [provider], now: () => 14 }).run({ ...base, wallets: [wallet], positions: [dust] }, { http: fakeHttp(() => ({})) });
  assert.equal(dustRun.valuation.totalAssets, 0); assert.equal(dustRun.valuation.totalEurScaled, null);
});

test('schema v5 price state migration is strict, bounded and deterministic', () => {
  const validQuote = quote('asset');
  const validStatus = { assetId: 'asset', providerId: COINGECKO_PROVIDER_ID, status: 'ok', errorCode: null, lastGoodFetchedAt: httpContext.now };
  const validValuation = { assetId: 'asset', quantityBaseUnits: '2', quantityDecimals: 0, priceEurScaled: '1', priceUsdScaled: '1', valueEurScaled: '2', valueUsdScaled: '2', dayChangeEurScaled: '-1', dayChangeUsdScaled: '0', dayChangePercentScaled: '50000', status: 'valued' };
  const validPoint = { timestamp: 1, valueEurScaled: '1', valueUsdScaled: '1', coverage: 'complete' };
  const parsed = parsePortfolioState({ schemaVersion: 5, settings: {}, wallets: [], positions: [], instruments: [], holdings: [], sync: { schemaVersion: 1, statuses: [] }, prices: {
    quotes: [validQuote, { ...validQuote, assetId: '' }, { ...validQuote, scale: 8 }, { ...validQuote, priceEurScaled: '0' }, { ...validQuote, assetId: 'fallback-change', change24hUsdPercentScaled: undefined }, { ...validQuote, assetId: 'bad-change', change24hUsdPercentScaled: 1 }],
    statuses: [validStatus, { ...validStatus, status: 'bad' }, { ...validStatus, providerId: 'BAD!' }],
    valuations: [validValuation, { ...validValuation, quantityBaseUnits: '-1' }, { ...validValuation, status: 'unpriced', priceEurScaled: null, priceUsdScaled: null, valueEurScaled: null, valueUsdScaled: null, dayChangeEurScaled: null, dayChangeUsdScaled: null, dayChangePercentScaled: null }],
    history: [{ id: 'asset', kind: 'asset-price', points: [validPoint, { ...validPoint, timestamp: 2, coverage: 'partial' }, { timestamp: -1, valueEurScaled: '1', valueUsdScaled: '1', coverage: 'complete' }] }, null, { id: '', kind: 'asset-price', points: [] }, { id: 'bad', kind: 'bad', points: [] }],
    totalEurScaled: '2', totalUsdScaled: '3', complete: true, valuedAssets: 1, totalAssets: 1, dayChangeEurScaled: '-1', dayChangeUsdScaled: '0', dayChangePercentScaled: '-2500'
  } });
  assert.equal(parsed.prices.quotes.length, 2); assert.equal(parsed.prices.statuses.length, 1); assert.equal(parsed.prices.valuations.length, 1); assert.equal(parsed.prices.history.length, 1); assert.equal(parsed.prices.history[0].points.length, 2); assert.equal(parsed.prices.dayChangeEurScaled, '-1');
  assert.deepEqual(parsePortfolioState({ schemaVersion: 4, settings: {}, wallets: [], positions: [], instruments: [], holdings: [] }).prices.quotes, []);
  assert.deepEqual(parsePortfolioState({ schemaVersion: 5, settings: {}, wallets: [], positions: [], instruments: [], holdings: [], prices: null }).prices.quotes, []);
  const sparse = parsePortfolioState({ schemaVersion: 5, settings: {}, wallets: [], positions: [], instruments: [], holdings: [], prices: {
    quotes: [{ ...validQuote, change24hPercentScaled: null, change24hEurPercentScaled: undefined, change24hUsdPercentScaled: null, previousPriceEurScaled: '2', previousPriceUsdScaled: '3' }, { ...validQuote, assetId: 'bad', sourceTimestamp: 'bad', fetchedAt: -1 }],
    statuses: [{ ...validStatus, errorCode: 'timeout', lastGoodFetchedAt: null }, { ...validStatus, assetId: 'bad-status', errorCode: 1 }],
    valuations: [{ ...validValuation, priceEurScaled: null, priceUsdScaled: null, valueEurScaled: null, valueUsdScaled: null, dayChangeEurScaled: null, dayChangeUsdScaled: null, dayChangePercentScaled: null, status: 'unpriced' }, { ...validValuation, assetId: 'bad-valuation', priceEurScaled: 'bad' }],
    history: [{ id: 'sparse', kind: 'asset-price', points: [{ timestamp: 1, valueEurScaled: '0', valueUsdScaled: null, coverage: 'complete' }, { timestamp: 2, valueEurScaled: '0', valueUsdScaled: '1', coverage: 'complete' }] }, { id: 'bad-history', kind: 'bad', points: [] }],
    totalEurScaled: null, totalUsdScaled: 'bad', complete: false, valuedAssets: -1, totalAssets: 1.2, dayChangeEurScaled: null, dayChangeUsdScaled: 'bad', dayChangePercentScaled: '-1'
  } });
  assert.equal(sparse.prices.quotes.length, 1); assert.equal(sparse.prices.statuses.length, 1); assert.equal(sparse.prices.valuations.length, 1); assert.equal(sparse.prices.history.length, 1); assert.equal(sparse.prices.history[0].points.length, 1);
  const nonArrays = parsePortfolioState({ schemaVersion: 5, settings: {}, wallets: [], positions: [], instruments: [], holdings: [], prices: { quotes: {}, statuses: {}, valuations: {}, history: {}, totalEurScaled: null, totalUsdScaled: null, complete: false, valuedAssets: 0, totalAssets: 0, dayChangeEurScaled: null, dayChangeUsdScaled: null, dayChangePercentScaled: null } });
  assert.deepEqual(nonArrays.prices.quotes, []);
});
