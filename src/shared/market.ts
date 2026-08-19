import type { InstrumentInput, InstrumentType } from './state.ts';
import { TransportError, type HttpJsonPort } from './transport.ts';

export const FMP_PROVIDER_ID = 'fmp.market';
export const LOCAL_CATALOG_PROVIDER_ID = 'holdvue.catalog';
export const FMP_SEARCH_SYMBOL_URL = 'https://financialmodelingprep.com/stable/search-symbol';
export const FMP_SEARCH_NAME_URL = 'https://financialmodelingprep.com/stable/search-name';
export const FMP_PROFILE_URL = 'https://financialmodelingprep.com/stable/profile';

export type InstrumentCandidate = Omit<InstrumentInput, 'type'> & { readonly type: InstrumentInput['type'] | 'unknown' };
export type InstrumentSearchErrorCode = 'unconfigured' | 'invalid-query' | 'rate-limited' | 'unauthorized' | 'timeout' | 'aborted' | 'malformed' | 'unsupported' | 'error';
export interface InstrumentSearchFailure { readonly ok: false; readonly code: InstrumentSearchErrorCode; readonly message: string; }
export interface InstrumentSearchSuccess { readonly ok: true; readonly value: readonly InstrumentCandidate[]; readonly partial: boolean; }
export type InstrumentSearchResult = InstrumentSearchSuccess | InstrumentSearchFailure;

export interface InstrumentSearchAdapter {
  search(query: string, signal?: AbortSignal): Promise<InstrumentSearchResult>;
  resolve(candidate: InstrumentCandidate, signal?: AbortSignal): Promise<InstrumentInput | InstrumentSearchFailure>;
}

interface CatalogEntry extends InstrumentInput { readonly aliases: readonly string[]; }

const LOCAL_CATALOG: readonly CatalogEntry[] = [
  { providerId: LOCAL_CATALOG_PROVIDER_ID, providerSymbol: 'EUNL.DE', symbol: 'EUNL', name: 'iShares Core MSCI World UCITS ETF USD (Acc)', exchange: 'XETRA', currency: 'EUR', type: 'etf', aliases: ['msci world', 'world etf'] },
  { providerId: LOCAL_CATALOG_PROVIDER_ID, providerSymbol: 'XDWD.DE', symbol: 'XDWD', name: 'Xtrackers MSCI World UCITS ETF 1C', exchange: 'XETRA', currency: 'EUR', type: 'etf', aliases: ['msci world', 'world etf'] },
  { providerId: LOCAL_CATALOG_PROVIDER_ID, providerSymbol: 'SPPW.DE', symbol: 'SPPW', name: 'SPDR MSCI World UCITS ETF', exchange: 'XETRA', currency: 'EUR', type: 'etf', aliases: ['msci world', 'world etf'] },
  { providerId: LOCAL_CATALOG_PROVIDER_ID, providerSymbol: 'VWCE.DE', symbol: 'VWCE', name: 'Vanguard FTSE All-World UCITS ETF USD Accumulating', exchange: 'XETRA', currency: 'EUR', type: 'etf', aliases: ['all world', 'ftse world'] },
  { providerId: LOCAL_CATALOG_PROVIDER_ID, providerSymbol: 'SXR8.DE', symbol: 'SXR8', name: 'iShares Core S&P 500 UCITS ETF USD (Acc)', exchange: 'XETRA', currency: 'EUR', type: 'etf', aliases: ['sp 500', 's&p 500'] },
  { providerId: LOCAL_CATALOG_PROVIDER_ID, providerSymbol: 'SXRV.DE', symbol: 'SXRV', name: 'iShares Nasdaq 100 UCITS ETF USD (Acc)', exchange: 'XETRA', currency: 'EUR', type: 'etf', aliases: ['nasdaq 100'] },
  { providerId: LOCAL_CATALOG_PROVIDER_ID, providerSymbol: 'IUSN.DE', symbol: 'IUSN', name: 'iShares MSCI World Small Cap UCITS ETF', exchange: 'XETRA', currency: 'EUR', type: 'etf', aliases: ['msci world small cap', 'small caps'] },
  { providerId: LOCAL_CATALOG_PROVIDER_ID, providerSymbol: 'IS3S.DE', symbol: 'IS3S', name: 'iShares Edge MSCI World Minimum Volatility UCITS ETF', exchange: 'XETRA', currency: 'EUR', type: 'etf', aliases: ['msci world minimum volatility'] },
  { providerId: LOCAL_CATALOG_PROVIDER_ID, providerSymbol: 'XDWH.DE', symbol: 'XDWH', name: 'Xtrackers MSCI World Health Care UCITS ETF 1C', exchange: 'XETRA', currency: 'EUR', type: 'etf', aliases: ['healthcare etf', 'health care etf'] },
  { providerId: LOCAL_CATALOG_PROVIDER_ID, providerSymbol: 'AAPL@NASDAQ', symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ', currency: 'USD', type: 'stock', aliases: ['apple'] },
  { providerId: LOCAL_CATALOG_PROVIDER_ID, providerSymbol: 'MSFT@NASDAQ', symbol: 'MSFT', name: 'Microsoft Corporation', exchange: 'NASDAQ', currency: 'USD', type: 'stock', aliases: ['microsoft'] },
  { providerId: LOCAL_CATALOG_PROVIDER_ID, providerSymbol: 'NVDA@NASDAQ', symbol: 'NVDA', name: 'NVIDIA Corporation', exchange: 'NASDAQ', currency: 'USD', type: 'stock', aliases: ['nvidia'] },
  { providerId: LOCAL_CATALOG_PROVIDER_ID, providerSymbol: 'AMZN@NASDAQ', symbol: 'AMZN', name: 'Amazon.com, Inc.', exchange: 'NASDAQ', currency: 'USD', type: 'stock', aliases: ['amazon'] },
  { providerId: LOCAL_CATALOG_PROVIDER_ID, providerSymbol: 'GOOGL@NASDAQ', symbol: 'GOOGL', name: 'Alphabet Inc. Class A', exchange: 'NASDAQ', currency: 'USD', type: 'stock', aliases: ['google', 'alphabet'] },
  { providerId: LOCAL_CATALOG_PROVIDER_ID, providerSymbol: 'META@NASDAQ', symbol: 'META', name: 'Meta Platforms, Inc.', exchange: 'NASDAQ', currency: 'USD', type: 'stock', aliases: ['facebook', 'meta'] },
  { providerId: LOCAL_CATALOG_PROVIDER_ID, providerSymbol: 'TSLA@NASDAQ', symbol: 'TSLA', name: 'Tesla, Inc.', exchange: 'NASDAQ', currency: 'USD', type: 'stock', aliases: ['tesla'] },
  { providerId: LOCAL_CATALOG_PROVIDER_ID, providerSymbol: 'BRK.B@NYSE', symbol: 'BRK.B', name: 'Berkshire Hathaway Inc. Class B', exchange: 'NYSE', currency: 'USD', type: 'stock', aliases: ['berkshire hathaway'] },
  { providerId: LOCAL_CATALOG_PROVIDER_ID, providerSymbol: 'JPM@NYSE', symbol: 'JPM', name: 'JPMorgan Chase & Co.', exchange: 'NYSE', currency: 'USD', type: 'stock', aliases: ['jp morgan'] },
  { providerId: LOCAL_CATALOG_PROVIDER_ID, providerSymbol: 'V@NYSE', symbol: 'V', name: 'Visa Inc.', exchange: 'NYSE', currency: 'USD', type: 'stock', aliases: ['visa'] },
  { providerId: LOCAL_CATALOG_PROVIDER_ID, providerSymbol: 'SAP.DE@XETRA', symbol: 'SAP.DE', name: 'SAP SE', exchange: 'XETRA', currency: 'EUR', type: 'stock', aliases: ['sap'] },
  { providerId: LOCAL_CATALOG_PROVIDER_ID, providerSymbol: 'SIE.DE@XETRA', symbol: 'SIE.DE', name: 'Siemens AG', exchange: 'XETRA', currency: 'EUR', type: 'stock', aliases: ['siemens'] },
  { providerId: LOCAL_CATALOG_PROVIDER_ID, providerSymbol: 'ALV.DE@XETRA', symbol: 'ALV.DE', name: 'Allianz SE', exchange: 'XETRA', currency: 'EUR', type: 'stock', aliases: ['allianz'] },
  { providerId: LOCAL_CATALOG_PROVIDER_ID, providerSymbol: 'DTE.DE@XETRA', symbol: 'DTE.DE', name: 'Deutsche Telekom AG', exchange: 'XETRA', currency: 'EUR', type: 'stock', aliases: ['telekom'] },
  { providerId: LOCAL_CATALOG_PROVIDER_ID, providerSymbol: 'MBG.DE@XETRA', symbol: 'MBG.DE', name: 'Mercedes-Benz Group AG', exchange: 'XETRA', currency: 'EUR', type: 'stock', aliases: ['mercedes benz', 'daimler'] }
];

function normalizedSearch(value: string): string { return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim(); }
function catalogCandidate(entry: CatalogEntry): InstrumentCandidate { const { aliases: _aliases, ...candidate } = entry; return candidate; }
function catalogScore(entry: CatalogEntry, query: string): number {
  const symbol = normalizedSearch(entry.symbol); const name = normalizedSearch(entry.name);
  return symbol === query ? 0 : symbol.startsWith(query) ? 1 : name.startsWith(query) ? 2 : name.includes(query) ? 3 : 4;
}

export function createLocalCatalogSearchAdapter(maxResults = 10): InstrumentSearchAdapter {
  const limit = Number.isSafeInteger(maxResults) && maxResults > 0 && maxResults <= 50 ? maxResults : 10;
  return {
    async search(query) {
      const normalized = typeof query === 'string' ? normalizedSearch(query) : '';
      if (normalized.length === 0 || normalized.length > 120) return { ok: false, code: 'invalid-query', message: 'Search text is invalid.' };
      const tokens = normalized.split(/\s+/);
      const matches = LOCAL_CATALOG.filter(entry => {
        const searchable = normalizedSearch(`${entry.symbol} ${entry.name} ${entry.exchange} ${entry.aliases.join(' ')}`);
        return tokens.every(token => searchable.includes(token));
      }).sort((left, right) => catalogScore(left, normalized) - catalogScore(right, normalized) || left.name.localeCompare(right.name)).slice(0, limit).map(catalogCandidate);
      return { ok: true, value: matches, partial: false };
    },
    async resolve(candidate) {
      if (candidate.providerId !== LOCAL_CATALOG_PROVIDER_ID) return { ok: false, code: 'unsupported', message: 'This instrument provider is unsupported.' };
      const canonical = LOCAL_CATALOG.find(entry => entry.providerSymbol === candidate.providerSymbol);
      return canonical ? catalogCandidate(canonical) as InstrumentInput : { ok: false, code: 'unsupported', message: 'This catalog instrument is unsupported.' };
    }
  };
}

export function createCombinedSearchAdapter(adapters: readonly InstrumentSearchAdapter[], maxResults = 12): InstrumentSearchAdapter {
  const limit = Number.isSafeInteger(maxResults) && maxResults > 0 && maxResults <= 50 ? maxResults : 12;
  return {
    async search(query, signal) {
      const successes: InstrumentSearchSuccess[] = []; const failures: InstrumentSearchFailure[] = [];
      for (const adapter of adapters) { const result = await adapter.search(query, signal); if (result.ok) successes.push(result); else failures.push(result); if (!result.ok && result.code === 'aborted') return result; }
      if (successes.length === 0) return failures.find(failure => failure.code === 'rate-limited') ?? failures[0] ?? { ok: false, code: 'unconfigured', message: 'No instrument provider is configured.' };
      const deduped = new Map<string, InstrumentCandidate>();
      for (const success of successes) for (const candidate of success.value) { const key = `${candidate.symbol.toLowerCase()}:${candidate.exchange.toLowerCase()}`; if (!deduped.has(key)) deduped.set(key, candidate); }
      return { ok: true, value: [...deduped.values()].slice(0, limit), partial: successes.some(success => success.partial) || failures.some(failure => failure.code !== 'unconfigured') };
    },
    async resolve(candidate, signal) {
      for (const adapter of adapters) { const result = await adapter.resolve(candidate, signal); if (!('ok' in result) || result.ok !== false || result.code !== 'unsupported') return result; }
      return { ok: false, code: 'unsupported', message: 'This instrument provider is unsupported.' };
    }
  };
}

export interface FmpSearchOptions {
  readonly http: HttpJsonPort;
  readonly getApiKey: () => string | null | Promise<string | null>;
  readonly maxResults?: number;
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
}

interface FmpRow {
  readonly symbol: string;
  readonly name: string;
  readonly exchange: string;
  readonly currency: string;
  readonly type: InstrumentType | 'unknown';
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function text(value: unknown, max: number): string | null { return typeof value === 'string' && value.trim() !== '' && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value) ? value.trim() : null; }
function parseType(value: unknown): InstrumentCandidate['type'] | null {
  if (value === undefined) return 'unknown';
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return normalized === 'stock' || normalized === 'etf' ? normalized : null;
}

function parseRows(value: unknown): FmpRow[] {
  if (!Array.isArray(value)) throw new Error('malformed');
  const rows: FmpRow[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const symbol = text(item.symbol, 80);
    const name = text(item.name, 160);
    const exchange = text(item.exchangeShortName ?? item.exchange ?? item.stockExchange, 80);
    const currency = text(item.currency, 8)?.toUpperCase() ?? null;
    const type = parseType(item.type);
    if (!symbol || !name || !exchange || !currency || !/^[A-Z]{3}$/.test(currency) || type === null) continue;
    rows.push({ symbol, name, exchange, currency, type });
  }
  return rows;
}

function mapError(error: unknown): InstrumentSearchFailure {
  if (error instanceof TransportError) {
    if (error.code === 'aborted') return { ok: false, code: 'aborted', message: 'Instrument search was cancelled.' };
    if (error.code === 'timeout') return { ok: false, code: 'timeout', message: 'Instrument provider timed out.' };
    if (error.code === 'http' && (error.status === 401 || error.status === 403)) return { ok: false, code: 'unauthorized', message: 'Instrument provider authorization failed.' };
    if (error.code === 'http' && error.status === 429) return { ok: false, code: 'rate-limited', message: 'Instrument provider rate limit reached.' };
    return { ok: false, code: error.code === 'invalid-json' || error.code === 'too-large' ? 'malformed' : 'error', message: 'Instrument provider request failed.' };
  }
  return { ok: false, code: 'malformed', message: 'Instrument provider response was invalid.' };
}

function toInput(row: FmpRow): InstrumentCandidate {
  return { providerId: FMP_PROVIDER_ID, providerSymbol: `${row.symbol.toUpperCase()}@${row.exchange.toUpperCase()}`, symbol: row.symbol, name: row.name, exchange: row.exchange, currency: row.currency, type: row.type };
}

function parseProfileType(value: unknown): InstrumentType | null {
  if (!Array.isArray(value) || value.length === 0 || !isRecord(value[0])) return null;
  if (value[0].isEtf === true && value[0].isActivelyTrading === true) return 'etf';
  if (value[0].isEtf === false && value[0].isFund === false && value[0].isActivelyTrading === true) return 'stock';
  return null;
}

function rank(row: InstrumentCandidate, query: string): number {
  const normalized = query.toLowerCase();
  const symbol = row.symbol.toLowerCase();
  const name = row.name.toLowerCase();
  return (symbol === normalized ? 0 : symbol.startsWith(normalized) ? 1 : name.startsWith(normalized) ? 2 : name.includes(normalized) ? 3 : 4);
}

export type FmpSearchAdapter = InstrumentSearchAdapter;

export function createFmpSearchAdapter(options: FmpSearchOptions): FmpSearchAdapter {
  const maxResults = options.maxResults === undefined ? 10 : Number.isSafeInteger(options.maxResults) && options.maxResults > 0 && options.maxResults <= 50 ? options.maxResults : 10;
  return {
    async search(query, signal) {
      const normalized = typeof query === 'string' ? query.trim() : '';
      if (normalized.length === 0 || normalized.length > 120) return { ok: false, code: 'invalid-query', message: 'Search text is invalid.' };
      let key: string | null;
      try { key = await options.getApiKey(); } catch { return { ok: false, code: 'unconfigured', message: 'An instrument provider key is required.' }; }
      if (typeof key !== 'string' || key.length === 0 || key.length > 4096) return { ok: false, code: 'unconfigured', message: 'An instrument provider key is required.' };
      const endpoints = [FMP_SEARCH_SYMBOL_URL, FMP_SEARCH_NAME_URL];
      const responses: InstrumentCandidate[] = [];
      const failures: InstrumentSearchFailure[] = [];
      for (const endpoint of endpoints) {
        try {
          const url = `${endpoint}?query=${encodeURIComponent(normalized)}`;
          const payload = await options.http.requestJson<unknown>({ url, headers: { apikey: key }, timeoutMs: options.timeoutMs ?? 10_000, maxBytes: options.maxBytes ?? 512_000 }, signal);
          for (const row of parseRows(payload)) responses.push(toInput(row));
        } catch (error) {
          failures.push(mapError(error));
          if (signal?.aborted) break;
        }
      }
      if (responses.length === 0 && failures.length > 0) return failures.find(item => item.code === 'aborted') ?? failures.find(item => item.code === 'rate-limited') ?? failures[0]!;
      const deduped = new Map<string, InstrumentCandidate>();
      for (const row of responses) {
        const keyValue = `${row.providerId}:${row.providerSymbol.toLowerCase()}:${row.exchange.toLowerCase()}`;
        if (!deduped.has(keyValue)) deduped.set(keyValue, row);
      }
      const value = [...deduped.values()].sort((left, right) => rank(left, normalized) - rank(right, normalized) || left.name.localeCompare(right.name)).slice(0, maxResults);
      return { ok: true, value, partial: failures.length > 0 };
    },
    async resolve(candidate, signal) {
      if (candidate.providerId !== FMP_PROVIDER_ID) return { ok: false, code: 'unsupported', message: 'This instrument provider is unsupported.' };
      let key: string | null;
      try { key = await options.getApiKey(); } catch { return { ok: false, code: 'unconfigured', message: 'An instrument provider key is required.' }; }
      if (typeof key !== 'string' || key.length === 0 || key.length > 4096) return { ok: false, code: 'unconfigured', message: 'An instrument provider key is required.' };
      try {
        const url = `${FMP_PROFILE_URL}?symbol=${encodeURIComponent(candidate.symbol)}`;
        const payload = await options.http.requestJson<unknown>({ url, headers: { apikey: key }, timeoutMs: options.timeoutMs ?? 10_000, maxBytes: options.maxBytes ?? 512_000 }, signal);
        const profile = Array.isArray(payload) && isRecord(payload[0]) ? payload[0] : null;
        const resolvedType = parseProfileType(payload);
        if (!profile || resolvedType === null) return { ok: false, code: 'unsupported', message: 'The provider did not classify this instrument safely.' };
        const profileSymbol = text(profile.symbol, 80);
        const profileExchange = text(profile.exchangeShortName ?? profile.exchange ?? profile.stockExchange, 80);
        const profileName = text(profile.companyName ?? profile.name, 160);
        const profileCurrency = text(profile.currency, 8)?.toUpperCase() ?? null;
        if (!profileSymbol || !profileExchange || !profileName || !profileCurrency || !/^[A-Z]{3}$/.test(profileCurrency)) return { ok: false, code: 'unsupported', message: 'The provider did not return complete instrument metadata.' };
        if (profileSymbol.toUpperCase() !== candidate.symbol.toUpperCase()) return { ok: false, code: 'malformed', message: 'The provider instrument did not match the selected symbol.' };
        if (profileExchange.toLowerCase() !== candidate.exchange.toLowerCase()) return { ok: false, code: 'malformed', message: 'The provider instrument did not match the selected exchange.' };
        return { ...candidate, providerSymbol: `${profileSymbol.toUpperCase()}@${profileExchange.toUpperCase()}`, symbol: profileSymbol, name: profileName, exchange: profileExchange, currency: profileCurrency, type: resolvedType };
      } catch (error) { return mapError(error); }
    }
  };
}
