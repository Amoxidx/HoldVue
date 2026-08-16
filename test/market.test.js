import assert from 'node:assert/strict';
import test from 'node:test';
import { createFmpSearchAdapter, FMP_PROFILE_URL, FMP_SEARCH_NAME_URL, FMP_SEARCH_SYMBOL_URL } from '../src/shared/market.ts';
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
