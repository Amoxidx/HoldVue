import assert from 'node:assert/strict';
import test from 'node:test';
import { createCombinedSearchAdapter, createFmpSearchAdapter, createLocalCatalogSearchAdapter, createYahooSearchAdapter, FMP_PROFILE_URL, FMP_SEARCH_NAME_URL, FMP_SEARCH_SYMBOL_URL, LOCAL_CATALOG_PROVIDER_ID, YAHOO_PROVIDER_ID, YAHOO_SEARCH_URL } from '../src/shared/market.ts';
import { TransportError } from '../src/shared/transport.ts';

function httpFixture(responses) {
  const calls = [];
  return {
    calls,
    http: {
      async requestJson(request) {
        calls.push(request);
        const path = new URL(request.url).pathname;
        const value = responses[path];
        if (value instanceof Error) throw value;
        if (typeof value === 'function') return value(request);
        return value;
      }
    }
  };
}

const searchRows = [
  { symbol: 'SYNW', name: 'Synthetic World ETF', currency: 'EUR', stockExchange: 'Synthetic Exchange', exchangeShortName: 'SYN' },
  { symbol: 'SYNW', name: 'Synthetic World ETF', currency: 'EUR', stockExchange: 'Synthetic Exchange', exchangeShortName: 'SYN' },
  { symbol: 'SYNCO', name: 'Synthetic Company', currency: 'USD', exchangeShortName: 'SYN', type: 'stock' },
  { symbol: 'EXACT', name: 'Exact Synthetic', currency: 'USD', exchange: 'SYN', type: 'stock' },
  { symbol: 'PREFIX', name: 'Prefix Synthetic', currency: 'USD', stockExchange: 'SYN', type: 'stock' },
  { symbol: 'ZZZ', name: 'Synthetic Zeta', currency: 'USD', exchangeShortName: 'SYN' },
  { symbol: 'NUM', name: 'Synthetic Number', currency: 'USD', exchangeShortName: 'SYN', type: 4 },
  { symbol: 'COIN', name: 'Synthetic Coin', currency: 'USD', exchangeShortName: 'SYN', type: 'crypto' },
  { symbol: 'BAD', name: 'Bad Currency', currency: 'EU', exchangeShortName: 'SYN' },
  { symbol: 'MISSINGCURRENCY', name: 'Missing Currency', exchangeShortName: 'SYN' },
  { symbol: '', name: 'Missing symbol', currency: 'USD', exchangeShortName: 'SYN' },
  null
];

test('local catalog searches common instruments without a provider key and resolves canonical metadata', async () => {
  const adapter = createLocalCatalogSearchAdapter();
  const world = await adapter.search('msci wo');
  assert.equal(world.ok, true);
  if (!world.ok) return;
  assert.equal(world.partial, false);
  assert.equal(world.value.length >= 3, true);
  assert.equal(world.value[0].providerId, LOCAL_CATALOG_PROVIDER_ID);
  assert.match(world.value[0].name, /MSCI World/i);
  const exact = await adapter.search('AAPL');
  assert.equal(exact.ok && exact.value[0].symbol, 'AAPL');
  assert.equal((await adapter.search('V')).ok, true);
  assert.equal((await adapter.search('S')).ok, true);
  assert.equal((await adapter.search('iShares')).ok, true);
  assert.equal((await adapter.search('AAP')).ok, true);
  assert.equal((await adapter.search('Apple')).ok, true);
  assert.equal((await adapter.search('World')).ok, true);
  assert.equal((await adapter.search('world etf')).ok, true);
  assert.equal((await adapter.search('all world')).ok, true);
  assert.equal((await adapter.search('not-in-catalog')).ok, true);
  assert.equal((await adapter.search('')).code, 'invalid-query');
  assert.equal((await adapter.search(4)).code, 'invalid-query');
  assert.equal((await adapter.search('x'.repeat(121))).code, 'invalid-query');
  const limited = await createLocalCatalogSearchAdapter(1).search('msci');
  assert.equal(limited.ok && limited.value.length, 1);
  const defaulted = await createLocalCatalogSearchAdapter(0).search('msci');
  assert.equal(defaulted.ok && defaulted.value.length > 1, true);
  const selected = world.value[0];
  const canonical = await adapter.resolve({ ...selected, name: 'Tampered synthetic name' });
  assert.equal(canonical.name, selected.name);
  assert.equal((await adapter.resolve({ ...selected, providerId: 'other.provider' })).code, 'unsupported');
  assert.equal((await adapter.resolve({ ...selected, providerSymbol: 'MISSING@X' })).code, 'unsupported');
});

test('combined search merges catalog and optional providers without making a missing key a dead end', async () => {
  const local = createLocalCatalogSearchAdapter();
  const duplicate = { providerId: 'fmp.market', providerSymbol: 'AAPL@NASDAQ', symbol: 'AAPL', name: 'Remote Apple', exchange: 'NASDAQ', currency: 'USD', type: 'stock' };
  const remote = { async search() { return { ok: true, value: [duplicate], partial: true }; }, async resolve(candidate) { return candidate.providerId === 'fmp.market' ? { ...candidate, type: 'stock' } : { ok: false, code: 'unsupported', message: 'synthetic' }; } };
  const combined = createCombinedSearchAdapter([local, remote], 1);
  const merged = await combined.search('apple');
  assert.equal(merged.ok, true);
  if (merged.ok) { assert.equal(merged.value.length, 1); assert.equal(merged.value[0].providerId, LOCAL_CATALOG_PROVIDER_ID); assert.equal(merged.partial, true); }
  const unconfigured = { async search() { return { ok: false, code: 'unconfigured', message: 'synthetic' }; }, async resolve() { return { ok: false, code: 'unconfigured', message: 'synthetic' }; } };
  const keyless = await createCombinedSearchAdapter([local, unconfigured], 0).search('msci wo');
  assert.equal(keyless.ok, true);
  if (keyless.ok) assert.equal(keyless.partial, false);
  const rate = { ...unconfigured, async search() { return { ok: false, code: 'rate-limited', message: 'synthetic' }; } };
  const partial = await createCombinedSearchAdapter([local, rate]).search('apple');
  assert.equal(partial.ok && partial.partial, true);
  const aborted = { ...unconfigured, async search() { return { ok: false, code: 'aborted', message: 'synthetic' }; } };
  assert.equal((await createCombinedSearchAdapter([local, aborted]).search('apple')).code, 'aborted');
  assert.equal((await createCombinedSearchAdapter([unconfigured, rate]).search('none')).code, 'rate-limited');
  assert.equal((await createCombinedSearchAdapter([unconfigured]).search('none')).code, 'unconfigured');
  assert.equal((await createCombinedSearchAdapter([]).search('none')).code, 'unconfigured');
  const localCandidate = (await local.search('apple')).value[0];
  assert.equal((await combined.resolve(localCandidate)).providerId, LOCAL_CATALOG_PROVIDER_ID);
  assert.equal((await combined.resolve(duplicate)).providerId, 'fmp.market');
  assert.equal((await createCombinedSearchAdapter([local, unconfigured]).resolve(duplicate)).code, 'unconfigured');
  assert.equal((await createCombinedSearchAdapter([local]).resolve(duplicate)).code, 'unsupported');
});

test('Yahoo Finance search is keyless, filters instrument types and resolves exact canonical metadata', async () => {
  const response = { quotes: [
    { symbol: 'SYN', longname: 'Synthetic Equity', exchange: 'SYNX', currency: 'usd', quoteType: 'EQUITY' },
    { symbol: 'SYN', longname: 'Duplicate Synthetic Equity', exchange: 'SYNX', currency: 'USD', quoteType: 'EQUITY' },
    { symbol: 'ETF.DE', shortname: 'Synthetic ETF', exchDisp: 'Synthetic Display', currency: 'EUR', quoteType: 'ETF' },
    { symbol: 'INFER.DE', shortname: 'Inferred Euro ETF', exchange: 'GER', quoteType: 'ETF' },
    { symbol: 'USINFER', shortname: 'Inferred US Equity', exchange: 'NMS', quoteType: 'EQUITY' },
    { symbol: 'FUND', shortname: 'Unsupported Fund', exchange: 'SYNX', currency: 'USD', quoteType: 'MUTUALFUND' },
    { symbol: 'BAD', shortname: 'Bad currency', exchange: 'SYNX', currency: 'US', quoteType: 'EQUITY' },
    { symbol: 'NOCURRENCY', shortname: 'Missing currency', exchange: 'SYNX', quoteType: 'EQUITY' },
    { symbol: 'BADTYPE', shortname: 'Bad type', exchange: 'SYNX', currency: 'USD', quoteType: 4 },
    { symbol: 'NONAME', exchange: 'SYNX', currency: 'USD', quoteType: 'EQUITY' },
    null
  ] };
  const fixture = httpFixture({ [new URL(YAHOO_SEARCH_URL).pathname]: response });
  const adapter = createYahooSearchAdapter({ http: fixture.http, maxResults: 5, timeoutMs: 1, maxBytes: 2 });
  const found = await adapter.search('syn');
  assert.equal(found.ok, true);
  if (!found.ok) return;
  assert.deepEqual(found.value.map(item => [item.providerId, item.symbol, item.type]), [[YAHOO_PROVIDER_ID, 'SYN', 'stock'], [YAHOO_PROVIDER_ID, 'ETF.DE', 'etf'], [YAHOO_PROVIDER_ID, 'INFER.DE', 'etf'], [YAHOO_PROVIDER_ID, 'USINFER', 'stock']]);
  assert.equal(new URL(fixture.calls[0].url).searchParams.get('q'), 'syn');
  assert.equal(fixture.calls[0].timeoutMs, 1); assert.equal(fixture.calls[0].maxBytes, 2);
  assert.equal((await adapter.resolve(found.value[0])).name, 'Synthetic Equity');
  assert.equal((await adapter.resolve({ ...found.value[0], providerSymbol: 'MISSING' })).code, 'unsupported');
  assert.equal((await adapter.resolve({ ...found.value[0], providerId: 'other' })).code, 'unsupported');
});

test('Yahoo Finance search validates input and maps malformed and transport failures', async () => {
  const malformed = httpFixture({ [new URL(YAHOO_SEARCH_URL).pathname]: {} });
  const adapter = createYahooSearchAdapter({ http: malformed.http, maxResults: 0 });
  assert.equal((await adapter.search('')).code, 'invalid-query');
  assert.equal((await adapter.search(4)).code, 'invalid-query');
  assert.equal((await adapter.search('x'.repeat(121))).code, 'invalid-query');
  assert.equal((await adapter.search('x')).code, 'malformed');
  assert.equal((await adapter.resolve({ providerId: YAHOO_PROVIDER_ID, providerSymbol: 'SYN', symbol: 'SYN', name: 'Synthetic', exchange: 'SYN', currency: 'USD', type: 'stock' })).code, 'malformed');
  const timeout = httpFixture({ [new URL(YAHOO_SEARCH_URL).pathname]: new TransportError('timeout', 'synthetic') });
  assert.equal((await createYahooSearchAdapter({ http: timeout.http, maxResults: 51 }).search('x')).code, 'timeout');
  const empty = httpFixture({ [new URL(YAHOO_SEARCH_URL).pathname]: { quotes: [] } });
  const emptyResult = await createYahooSearchAdapter({ http: empty.http }).search('x');
  assert.equal(emptyResult.ok && emptyResult.value.length, 0);
  const badQuotes = httpFixture({ [new URL(YAHOO_SEARCH_URL).pathname]: { quotes: null } });
  assert.equal((await createYahooSearchAdapter({ http: badQuotes.http }).search('x')).code, 'malformed');
});

test('FMP search combines official symbol/name schemas, ranks and deduplicates safely', async () => {
  const fixture = httpFixture({ [new URL(FMP_SEARCH_SYMBOL_URL).pathname]: searchRows, [new URL(FMP_SEARCH_NAME_URL).pathname]: searchRows });
  const adapter = createFmpSearchAdapter({ http: fixture.http, getApiKey: () => 'synthetic-fmp-key', maxResults: 10 });
  const result = await adapter.search('syn');
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.partial, false);
  assert.deepEqual(result.value.map(item => [item.symbol, item.type]), [['SYNCO', 'stock'], ['SYNW', 'unknown'], ['ZZZ', 'unknown'], ['EXACT', 'stock'], ['PREFIX', 'stock']]);
  assert.equal(result.value[1].providerSymbol, 'SYNW@SYN');
  assert.equal(fixture.calls.length, 2);
  assert.equal(fixture.calls[0].headers.apikey, 'synthetic-fmp-key');
  assert.equal(new URL(fixture.calls[0].url).searchParams.get('query'), 'syn');
  const limited = createFmpSearchAdapter({ http: fixture.http, getApiKey: () => 'synthetic', maxResults: 0 });
  const limitedResult = await limited.search('syn');
  assert.equal(limitedResult.ok, true);
  if (limitedResult.ok) assert.equal(limitedResult.value.length, 5);
  assert.equal((await adapter.search('exact')).ok, true);
  assert.equal((await adapter.search('zeta')).ok, true);
});

test('FMP profile resolver strictly classifies stock and ETF and rejects mismatches', async () => {
  const fixture = httpFixture({ [new URL(FMP_PROFILE_URL).pathname]: request => {
    const symbol = new URL(request.url).searchParams.get('symbol');
    if (symbol === 'ETF') return [{ symbol: 'ETF', name: 'Synthetic ETF', currency: 'EUR', exchangeShortName: 'SYN', isEtf: true, isFund: true, isActivelyTrading: true }];
    if (symbol === 'STOCK') return [{ symbol: 'STOCK', name: 'Synthetic Stock', currency: 'USD', exchangeShortName: 'SYN', isEtf: false, isFund: false, isActivelyTrading: true }];
    if (symbol === 'MISSING') return [{ symbol: 'MISSING', exchangeShortName: 'SYN' }];
    if (symbol === 'FALLBACK') return [{ symbol: 'FALLBACK', companyName: 'Synthetic Fallback', currency: 'USD', exchange: 'SYN', isEtf: false, isFund: false, isActivelyTrading: true }];
    if (symbol === 'STOCKEX') return [{ symbol: 'STOCKEX', name: 'Synthetic Stock Exchange', currency: 'USD', stockExchange: 'SYN', isEtf: false, isFund: false, isActivelyTrading: true }];
    if (symbol === 'NONAME') return [{ symbol: 'NONAME', currency: 'USD', exchangeShortName: 'SYN', isEtf: false, isFund: false, isActivelyTrading: true }];
    if (symbol === 'NOCURRENCY') return [{ symbol: 'NOCURRENCY', name: 'Synthetic No Currency', exchangeShortName: 'SYN', isEtf: false, isFund: false, isActivelyTrading: true }];
    if (symbol === 'MISMATCH') return [{ symbol: 'OTHER', name: 'Synthetic ETF', currency: 'EUR', exchangeShortName: 'SYN', isEtf: true, isFund: true, isActivelyTrading: true }];
    if (symbol === 'EXCHANGE') return [{ symbol: 'EXCHANGE', name: 'Synthetic ETF', currency: 'EUR', exchangeShortName: 'OTHER', isEtf: true, isFund: true, isActivelyTrading: true }];
    return {};
  } });
  const adapter = createFmpSearchAdapter({ http: fixture.http, getApiKey: async () => 'synthetic' });
  const candidate = { providerId: 'fmp.market', providerSymbol: 'ETF@SYN', symbol: 'ETF', name: 'Synthetic ETF', exchange: 'SYN', currency: 'EUR', type: 'unknown' };
  assert.equal((await adapter.resolve(candidate)).type, 'etf');
  assert.equal((await adapter.resolve({ ...candidate, symbol: 'STOCK', providerSymbol: 'STOCK@SYN' })).type, 'stock');
  assert.equal((await adapter.resolve({ ...candidate, symbol: 'MISSING', providerSymbol: 'MISSING@SYN' })).code, 'unsupported');
  assert.equal((await adapter.resolve({ ...candidate, symbol: 'FALLBACK', providerSymbol: 'FALLBACK@SYN' })).type, 'stock');
  assert.equal((await adapter.resolve({ ...candidate, symbol: 'STOCKEX', providerSymbol: 'STOCKEX@SYN' })).type, 'stock');
  assert.equal((await adapter.resolve({ ...candidate, symbol: 'NONAME', providerSymbol: 'NONAME@SYN' })).code, 'unsupported');
  assert.equal((await adapter.resolve({ ...candidate, symbol: 'NOCURRENCY', providerSymbol: 'NOCURRENCY@SYN' })).code, 'unsupported');
  assert.equal((await adapter.resolve({ ...candidate, symbol: 'MISMATCH', providerSymbol: 'MISMATCH@SYN' })).code, 'malformed');
  assert.equal((await adapter.resolve({ ...candidate, symbol: 'EXCHANGE', providerSymbol: 'EXCHANGE@SYN' })).code, 'malformed');
  const known = { ...candidate, type: 'stock' };
  assert.equal((await adapter.resolve(known)).type, 'etf');
  assert.equal((await adapter.resolve({ ...candidate, providerId: 'other.provider' })).code, 'unsupported');
  const malformed = httpFixture({ [new URL(FMP_PROFILE_URL).pathname]: [] });
  const malformedAdapter = createFmpSearchAdapter({ http: malformed.http, getApiKey: () => 'synthetic' });
  assert.equal((await malformedAdapter.resolve(candidate)).code, 'unsupported');
});

test('FMP search fails closed for missing keys, malformed payloads, limits and provider errors', async () => {
  const fixture = httpFixture({ [new URL(FMP_SEARCH_SYMBOL_URL).pathname]: new TransportError('http', 'redacted', 429), [new URL(FMP_SEARCH_NAME_URL).pathname]: new TransportError('http', 'redacted', 429) });
  const adapter = createFmpSearchAdapter({ http: fixture.http, getApiKey: () => null });
  assert.equal((await adapter.search('x')).code, 'unconfigured');
  assert.equal((await adapter.search('')).code, 'invalid-query');
  assert.equal((await adapter.search(4)).code, 'invalid-query');
  assert.equal((await adapter.search('x'.repeat(121))).code, 'invalid-query');
  const rate = createFmpSearchAdapter({ http: fixture.http, getApiKey: () => 'synthetic' });
  assert.equal((await rate.search('x')).code, 'rate-limited');
  const timeout = httpFixture({ [new URL(FMP_SEARCH_SYMBOL_URL).pathname]: new TransportError('timeout', 'redacted'), [new URL(FMP_SEARCH_NAME_URL).pathname]: new TransportError('timeout', 'redacted') });
  assert.equal((await createFmpSearchAdapter({ http: timeout.http, getApiKey: () => 'synthetic' }).search('x')).code, 'timeout');
  const malformed = httpFixture({ [new URL(FMP_SEARCH_SYMBOL_URL).pathname]: {}, [new URL(FMP_SEARCH_NAME_URL).pathname]: {} });
  assert.equal((await createFmpSearchAdapter({ http: malformed.http, getApiKey: () => 'synthetic' }).search('x')).code, 'malformed');
  const network = httpFixture({ [new URL(FMP_SEARCH_SYMBOL_URL).pathname]: new Error('synthetic'), [new URL(FMP_SEARCH_NAME_URL).pathname]: searchRows });
  const partial = await createFmpSearchAdapter({ http: network.http, getApiKey: () => 'synthetic' }).search('syn');
  assert.equal(partial.ok, true);
  if (partial.ok) assert.equal(partial.partial, true);
  const unauthorized = httpFixture({ [new URL(FMP_PROFILE_URL).pathname]: new TransportError('http', 'redacted', 401) });
  assert.equal((await createFmpSearchAdapter({ http: unauthorized.http, getApiKey: () => 'synthetic' }).resolve({ providerId: 'fmp.market', providerSymbol: 'SYN@SYN', symbol: 'SYN', name: 'Synthetic', exchange: 'SYN', currency: 'USD', type: 'unknown' })).code, 'unauthorized');
  const aborted = new AbortController(); aborted.abort();
  const abortFixture = httpFixture({ [new URL(FMP_SEARCH_SYMBOL_URL).pathname]: new TransportError('aborted', 'redacted'), [new URL(FMP_SEARCH_NAME_URL).pathname]: searchRows });
  assert.equal((await createFmpSearchAdapter({ http: abortFixture.http, getApiKey: () => 'synthetic' }).search('x', aborted.signal)).code, 'aborted');
  const invalidJson = httpFixture({ [new URL(FMP_SEARCH_SYMBOL_URL).pathname]: new TransportError('invalid-json', 'redacted'), [new URL(FMP_SEARCH_NAME_URL).pathname]: new TransportError('invalid-json', 'redacted') });
  assert.equal((await createFmpSearchAdapter({ http: invalidJson.http, getApiKey: () => 'synthetic' }).search('x')).code, 'malformed');
  const networkError = httpFixture({ [new URL(FMP_SEARCH_SYMBOL_URL).pathname]: new TransportError('network', 'redacted'), [new URL(FMP_SEARCH_NAME_URL).pathname]: new TransportError('network', 'redacted') });
  assert.equal((await createFmpSearchAdapter({ http: networkError.http, getApiKey: () => 'synthetic' }).search('x')).code, 'error');
  const getThrow = createFmpSearchAdapter({ http: fixture.http, getApiKey: () => { throw new Error('synthetic'); } });
  assert.equal((await getThrow.search('syn')).code, 'unconfigured');
  assert.equal((await getThrow.resolve({ providerId: 'fmp.market', providerSymbol: 'SYN@SYN', symbol: 'SYN', name: 'Synthetic', exchange: 'SYN', currency: 'USD', type: 'unknown' })).code, 'unconfigured');
  const emptyKey = createFmpSearchAdapter({ http: fixture.http, getApiKey: () => '' });
  assert.equal((await emptyKey.resolve({ providerId: 'fmp.market', providerSymbol: 'SYN@SYN', symbol: 'SYN', name: 'Synthetic', exchange: 'SYN', currency: 'USD', type: 'unknown' })).code, 'unconfigured');
});
