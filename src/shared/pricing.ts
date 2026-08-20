import type { HttpJsonPort } from './transport.ts';
import { TransportError } from './transport.ts';
import type { Instrument, PortfolioState, Position, PriceQuote, PriceState, PriceStatus, Valuation, HistoryPoint, HistorySeries } from './state.ts';

// Keep this renderer-safe runtime module independent of state.ts.  state.ts
// owns the persisted schema constant; this matching literal is intentionally
// local so browser imports never pull Node-only address/hash code into the UI.
const PRICE_SCALE = 12 as const;

export const COINGECKO_PROVIDER_ID = 'coingecko.keyless';
export const COINGECKO_SIMPLE_PRICE_URL = 'https://api.coingecko.com/api/v3/simple/price';
export const COINGECKO_TOKEN_PRICE_URL = 'https://api.coingecko.com/api/v3/simple/token_price';
export const YAHOO_QUOTES_PROVIDER_ID = 'yahoo.finance';
export const YAHOO_CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart';
export const FMP_QUOTES_PROVIDER_ID = 'fmp.market';
export const FMP_BATCH_QUOTE_URL = 'https://financialmodelingprep.com/stable/batch-quote';
export const FMP_FOREX_QUOTE_URL = 'https://financialmodelingprep.com/stable/quote';

export type PriceAssetKind = 'native' | 'fungible' | 'instrument';
export interface PriceAsset {
  readonly assetId: string;
  readonly kind: PriceAssetKind;
  readonly family: Position['family'] | 'instrument';
  readonly symbol: string;
  readonly coingeckoId?: string;
  readonly platform?: string;
  readonly contractAddress?: string;
  readonly instrumentId?: string;
  readonly instrument?: Instrument;
}
export interface PriceContext { readonly http: HttpJsonPort; readonly now: number; readonly signal?: AbortSignal; }
export interface PriceProviderResult { readonly providerId: string; readonly quotes: readonly PriceQuote[]; readonly statuses: readonly PriceStatus[]; readonly partial: boolean; }
export interface PriceProvider { readonly id: string; fetch(assets: readonly PriceAsset[], context: PriceContext): Promise<PriceProviderResult>; }
const portIds = new WeakMap<object, number>(); let nextPortId = 1;
function portIdentity(value: object): number { const existing = portIds.get(value); if (existing !== undefined) return existing; const id = nextPortId++; portIds.set(value, id); return id; }

const MAX_DECIMAL_DIGITS = 36;
const MAX_INTEGER_DIGITS = 30;
const signedDecimalPattern = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
const decimalPattern = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

function expandFiniteNumber(value: number): string {
  const raw = String(value);
  if (!/[eE]/.test(raw)) return raw;
  const [mantissa = '0', exponentText = '0'] = raw.toLowerCase().split('e');
  const exponent = Number(exponentText);
  const negative = mantissa.startsWith('-');
  const normalized = negative ? mantissa.slice(1) : mantissa;
  const [whole = '0', fraction = ''] = normalized.split('.');
  const digits = `${whole}${fraction}`;
  const point = whole.length + exponent;
  const text = point <= 0 ? `0.${'0'.repeat(-point)}${digits}` : `${digits}${'0'.repeat(point - digits.length)}`;
  return negative ? `-${text}` : text;
}
function decimalParts(value: unknown, signed: boolean): { readonly negative: boolean; readonly whole: string; readonly fraction: string } | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_INTEGER_DIGITS + MAX_DECIMAL_DIGITS + 2) return null;
  const pattern = signed ? signedDecimalPattern : decimalPattern;
  if (!pattern.test(value) || value.includes('e') || value.includes('E')) return null;
  const negative = value.startsWith('-');
  const normalized = negative ? value.slice(1) : value;
  const [whole = '', fraction = ''] = normalized.split('.');
  if (whole.length > MAX_INTEGER_DIGITS || fraction.length > MAX_DECIMAL_DIGITS) return null;
  return { negative, whole, fraction };
}

export function decimalToScaled(value: unknown, scale: number = PRICE_SCALE, allowNegative = false): string | null {
  if (!Number.isSafeInteger(scale) || scale < 0 || scale > MAX_DECIMAL_DIGITS) return null;
  const text = typeof value === 'number' ? (Number.isFinite(value) ? expandFiniteNumber(value) : '') : value;
  const parts = decimalParts(text, allowNegative);
  if (!parts) return null;
  const retained = parts.fraction.slice(0, scale).padEnd(scale, '0');
  const discarded = parts.fraction.slice(scale);
  let magnitude = BigInt(`${parts.whole}${retained}`);
  if (discarded.length > 0 && Number(discarded[0]) >= 5) magnitude += 1n;
  if (magnitude === 0n && !allowNegative) return null;
  return parts.negative && magnitude > 0n ? `-${magnitude}` : magnitude.toString();
}

export function scaledToDecimal(value: string, scale: number = PRICE_SCALE): string {
  if (!/^-?(?:0|[1-9]\d*)$/.test(value)) throw new Error('scaled value is invalid');
  if (!Number.isSafeInteger(scale) || scale < 0 || scale > MAX_DECIMAL_DIGITS) throw new Error('scale is invalid');
  const negative = value.startsWith('-');
  const magnitude = negative ? value.slice(1) : value;
  if (scale === 0) return negative ? `-${magnitude}` : magnitude;
  const padded = magnitude.padStart(scale + 1, '0');
  const whole = padded.slice(0, -scale);
  const fraction = padded.slice(-scale).replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

function positiveScaled(value: unknown): string | null {
  const result = decimalToScaled(value, PRICE_SCALE, false);
  return result && result !== '0' ? result : null;
}
function signedScaled(value: unknown, scale = 4): string | null { return decimalToScaled(value, scale, true); }
function safeTimestamp(value: unknown): number | null { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null; }
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function mapError(error: unknown): { readonly status: PriceStatus['status']; readonly code: string } {
  if (error instanceof TransportError) {
    if (error.code === 'aborted') return { status: 'aborted', code: 'aborted' };
    if (error.code === 'timeout') return { status: 'error', code: 'timeout' };
    if (error.code === 'http' && error.status === 429) return { status: 'rate-limited', code: 'rate-limited' };
    return { status: 'error', code: error.code };
  }
  return { status: 'error', code: 'provider-error' };
}
function statusFor(assetId: string, providerId: string, status: PriceStatus['status'], errorCode: string | null, lastGoodFetchedAt: number | null): PriceStatus {
  return { assetId, providerId, status, errorCode, lastGoodFetchedAt };
}
function quote(assetId: string, eur: string, usd: string, source: string, fetchedAt: number, sourceTimestamp: number | null, change: string | null, previousPriceEurScaled: string | null = null, previousPriceUsdScaled: string | null = null, eurChange: string | null = change, usdChange: string | null = change): PriceQuote {
  return { assetId, priceEurScaled: eur, priceUsdScaled: usd, scale: PRICE_SCALE, change24hPercentScaled: change, change24hEurPercentScaled: eurChange, change24hUsdPercentScaled: usdChange, previousPriceEurScaled, previousPriceUsdScaled, source, sourceTimestamp, fetchedAt };
}

const nativeCoinIds: Record<string, string> = {
  'bitcoin:mainnet': 'bitcoin', 'solana:mainnet-beta': 'solana', 'cardano:mainnet': 'cardano',
  'evm:1': 'ethereum', 'evm:8453': 'ethereum', 'evm:42161': 'ethereum', 'evm:10': 'ethereum', 'evm:137': 'matic-network', 'evm:56': 'binancecoin', 'evm:43114': 'avalanche-2', 'evm:100': 'xdai', 'evm:59144': 'ethereum', 'evm:534352': 'ethereum', 'evm:324': 'ethereum', 'evm:42220': 'celo', 'evm:5000': 'mantle'
};
const platformIds: Record<string, string> = {
  '1': 'ethereum', '8453': 'base', '42161': 'arbitrum-one', '10': 'optimistic-ethereum', '137': 'polygon-pos', '56': 'binance-smart-chain', '43114': 'avalanche', '100': 'xdai', '59144': 'linea', '534352': 'scroll', '324': 'zksync', '42220': 'celo', '5000': 'mantle', solana: 'solana'
};

export function assetIdentityForPosition(position: Position, network?: string): PriceAsset {
  if (position.assetKind === 'native') {
    const key = position.family === 'evm' ? `evm:${position.chainId ?? ''}` : `${position.family}:${network ?? (position.family === 'solana' ? 'mainnet-beta' : 'mainnet')}`;
    const id = nativeCoinIds[key];
    const canonicalNetwork = position.family === 'evm' ? String(position.chainId ?? 'unknown') : network ?? (position.family === 'solana' ? 'mainnet-beta' : 'mainnet');
    const canonical = `asset:${position.family}:${canonicalNetwork}:native:${position.assetId}`;
    return id ? { assetId: canonical, kind: 'native', family: position.family, symbol: position.symbol, coingeckoId: id } : { assetId: canonical, kind: 'native', family: position.family, symbol: position.symbol };
  }
  if (position.family === 'evm' && position.chainId !== null && /^0x[0-9a-fA-F]{40}$/.test(position.assetId)) {
    return { assetId: `asset:evm:${position.chainId}:fungible:${position.assetId.toLowerCase()}`, kind: 'fungible', family: position.family, symbol: position.symbol, platform: platformIds[String(position.chainId)], contractAddress: position.assetId };
  }
  if (position.family === 'solana' && position.assetId.length > 20) return network === undefined || network === 'mainnet-beta' ? { assetId: `asset:solana:${network ?? 'mainnet-beta'}:fungible:${position.assetId}`, kind: 'fungible', family: position.family, symbol: position.symbol, platform: 'solana', contractAddress: position.assetId } : { assetId: `asset:solana:${network}:fungible:${position.assetId}`, kind: 'fungible', family: position.family, symbol: position.symbol };
  return { assetId: `asset:${position.family}:${network ?? 'unknown'}:fungible:${position.assetId}`, kind: 'fungible', family: position.family, symbol: position.symbol };
}
export function assetIdentityForInstrument(instrument: Instrument): PriceAsset { return { assetId: `instrument:${instrument.id}`, kind: 'instrument', family: 'instrument', symbol: instrument.symbol, instrumentId: instrument.id, instrument }; }

interface CoinGeckoOptions { readonly http: HttpJsonPort; readonly maxBatch?: number; readonly maxConcurrency?: number; readonly timeoutMs?: number; readonly maxBytes?: number; readonly wait?: (ms: number, signal?: AbortSignal) => Promise<void>; }
function geckoPrice(assetId: string, value: unknown, fetchedAt: number): PriceQuote | null {
  if (!record(value)) return null;
  const eur = positiveScaled(value.eur); const usd = positiveScaled(value.usd);
  if (!eur || !usd) return null;
  const eurChange = value.eur_24h_change === undefined ? null : signedScaled(value.eur_24h_change, 4);
  const usdChange = value.usd_24h_change === undefined ? null : signedScaled(value.usd_24h_change, 4);
  const change = usdChange ?? eurChange;
  const previousEur = eurChange === null ? null : previousFromPercent(eur, eurChange);
  const previousUsd = usdChange === null ? null : previousFromPercent(usd, usdChange);
  const sourceSeconds = safeTimestamp(value.last_updated_at);
  return quote(assetId, eur, usd, COINGECKO_PROVIDER_ID, fetchedAt, sourceSeconds === null ? null : sourceSeconds * 1000, change, previousEur, previousUsd, eurChange, usdChange);
}
export function createCoinGeckoPriceAdapter(options: CoinGeckoOptions): PriceProvider {
  const requestedBatch = Number(options.maxBatch); const batch = Number.isSafeInteger(requestedBatch) && requestedBatch > 0 && requestedBatch <= 250 ? requestedBatch : 50;
  const requestedConcurrency = Number(options.maxConcurrency); const concurrency = Number.isSafeInteger(requestedConcurrency) && requestedConcurrency > 0 && requestedConcurrency <= 8 ? requestedConcurrency : 2;
  const wait = options.wait ?? (async (ms: number, signal?: AbortSignal) => { await new Promise<void>((resolve, reject) => { const timer = setTimeout(resolve, ms); signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new TransportError('aborted', 'Price request was aborted.')); }, { once: true }); }); });
  return { id: COINGECKO_PROVIDER_ID, async fetch(assets, context) {
    const quotes: PriceQuote[] = []; const statuses: PriceStatus[] = []; let partial = false;
    let cooldown = false;
    const request = async (requestValue: Parameters<HttpJsonPort['requestJson']>[0]): Promise<unknown> => {
      let attempt = 0;
      while (true) {
        try { return await options.http.requestJson<unknown>(requestValue, context.signal); } catch (error) {
          const retryable = error instanceof TransportError && (error.code === 'http' && (error.status === 429 || (error.status !== null && error.status >= 500)));
          if (!retryable || attempt === 1) { if (error instanceof TransportError && error.code === 'http' && error.status === 429) cooldown = true; throw error; }
          await wait(100 * (attempt + 1), context.signal);
          attempt++;
        }
      }
    };
    const natives = assets.filter(asset => asset.coingeckoId);
    const tokens = assets.filter(asset => asset.platform && asset.contractAddress);
    const nativeGroups = [...new Map(natives.map(asset => [asset.coingeckoId!, asset])).values()];
    for (let offset = 0; offset < nativeGroups.length; offset += batch) {
      const group = nativeGroups.slice(offset, offset + batch);
      try {
        const ids = group.map(asset => asset.coingeckoId!).join(',');
        if (cooldown) throw new TransportError('http', 'Provider cooldown.', 429);
        const payload = await request({ url: `${COINGECKO_SIMPLE_PRICE_URL}?ids=${encodeURIComponent(ids)}&vs_currencies=eur,usd&include_24hr_change=true&include_last_updated_at=true`, timeoutMs: options.timeoutMs ?? 10_000, maxBytes: options.maxBytes ?? 512_000 });
        if (!record(payload)) throw new Error('malformed');
        for (const asset of natives.filter(item => group.some(groupItem => groupItem.coingeckoId === item.coingeckoId))) { const q = geckoPrice(asset.assetId, payload[asset.coingeckoId!], context.now); if (q) { quotes.push(q); statuses.push(statusFor(asset.assetId, COINGECKO_PROVIDER_ID, 'ok', null, context.now)); } else { partial = true; statuses.push(statusFor(asset.assetId, COINGECKO_PROVIDER_ID, 'unpriced', 'malformed', null)); } }
      } catch (error) { const mapped = mapError(error); partial = true; for (const asset of natives.filter(item => group.some(groupItem => groupItem.coingeckoId === item.coingeckoId))) statuses.push(statusFor(asset.assetId, COINGECKO_PROVIDER_ID, mapped.status, mapped.code, null)); if (mapped.status === 'rate-limited') await wait(100, context.signal); }
    }
    const tokenGroups = [...new Map(tokens.map(asset => [`${asset.platform!}:${asset.contractAddress!.toLowerCase()}`, asset])).values()];
    const runGroup = async (group: readonly PriceAsset[]): Promise<void> => {
      const platform = group[0]!.platform!;
      try {
        const addresses = group.map(asset => asset.contractAddress!).join(',');
        if (cooldown) throw new TransportError('http', 'Provider cooldown.', 429);
        const payload = await request({ url: `${COINGECKO_TOKEN_PRICE_URL}/${encodeURIComponent(platform)}?contract_addresses=${encodeURIComponent(addresses)}&vs_currencies=eur,usd&include_24hr_change=true&include_last_updated_at=true`, timeoutMs: options.timeoutMs ?? 10_000, maxBytes: options.maxBytes ?? 512_000 });
        if (!record(payload)) throw new Error('malformed');
        for (const asset of group) { const q = geckoPrice(asset.assetId, payload[asset.contractAddress!.toLowerCase()], context.now); if (q) { quotes.push(q); statuses.push(statusFor(asset.assetId, COINGECKO_PROVIDER_ID, 'ok', null, context.now)); } else { partial = true; statuses.push(statusFor(asset.assetId, COINGECKO_PROVIDER_ID, 'unpriced', 'malformed', null)); } }
      } catch (error) { const mapped = mapError(error); partial = true; for (const asset of group) statuses.push(statusFor(asset.assetId, COINGECKO_PROVIDER_ID, mapped.status, mapped.code, null)); if (mapped.status === 'rate-limited') await wait(100, context.signal); }
    };
    const groups: PriceAsset[][] = [];
    for (const platform of [...new Set(tokenGroups.map(asset => asset.platform!))]) {
      const platformAssets = tokenGroups.filter(asset => asset.platform === platform);
      for (let offset = 0; offset < platformAssets.length; offset += batch) groups.push(platformAssets.slice(offset, offset + batch));
    }
    for (let offset = 0; offset < groups.length; offset += concurrency) await Promise.all(groups.slice(offset, offset + concurrency).map(group => runGroup(group)));
    for (const asset of assets) if (!statuses.some(status => status.assetId === asset.assetId)) { partial = true; statuses.push(statusFor(asset.assetId, COINGECKO_PROVIDER_ID, cooldown ? 'rate-limited' : 'unpriced', cooldown ? 'rate-limited' : 'unsupported-asset', null)); }
    return { providerId: COINGECKO_PROVIDER_ID, quotes, statuses, partial };
  } };
}

interface FmpQuoteOptions { readonly http: HttpJsonPort; readonly getApiKey: () => string | null | Promise<string | null>; readonly timeoutMs?: number; readonly maxBytes?: number; readonly maxBatch?: number; }
function quoteRows(value: unknown): readonly Record<string, unknown>[] | null { if (!Array.isArray(value) || value.some(item => !record(item))) return null; return value as readonly Record<string, unknown>[]; }
function fmpPrice(value: unknown): string | null { return positiveScaled(value); }
function parseFx(value: unknown, symbol: string): string | null {
  const row = quoteRows(value)?.find(item => typeof item.symbol === 'string' && item.symbol.toUpperCase() === symbol.toUpperCase());
  return row ? fmpPrice(row.price ?? row.bid ?? row.ask) : null;
}
/**
 * FMP quote requests use the provider's quote identifier.  Older persisted
 * FMP candidates used `SYMBOL@EXCHANGE`; keep reading those deterministically
 * while local catalog entries can carry the real exchange-qualified symbol
 * (for example `EUNL.DE`).  The display symbol remains instrument.symbol.
 */
export function providerQuoteSymbol(instrument: Instrument): string {
  const providerSymbol = instrument.providerSymbol.trim();
  if (providerSymbol === '') return instrument.symbol.trim();
  const separator = providerSymbol.indexOf('@');
  if (separator <= 0) return providerSymbol;
  const legacySymbol = providerSymbol.slice(0, separator);
  const isLegacyLocalXetra = instrument.providerId === 'holdvue.catalog' && instrument.exchange.toUpperCase() === 'XETRA' && !legacySymbol.includes('.');
  return isLegacyLocalXetra ? `${legacySymbol}.DE` : legacySymbol;
}

export function yahooQuoteSymbol(instrument: Instrument): string | null {
  const symbol = providerQuoteSymbol(instrument);
  if (!/^[A-Za-z0-9.^=-]{1,32}$/.test(symbol)) return null;
  return (instrument.exchange.toUpperCase() === 'NYSE' || instrument.exchange.toUpperCase() === 'NASDAQ') ? symbol.replace('.', '-') : symbol;
}

interface YahooQuoteOptions { readonly http: HttpJsonPort; readonly timeoutMs?: number; readonly maxBytes?: number; }
interface YahooChartValue { readonly currency: string; readonly current: string; readonly previous: string | null; readonly timestamp: number | null; }

function yahooChartValue(value: unknown): YahooChartValue | null {
  if (!record(value) || !record(value.chart) || !Array.isArray(value.chart.result) || !record(value.chart.result[0])) return null;
  const result = value.chart.result[0];
  if (!record(result.meta) || typeof result.meta.currency !== 'string' || !/^[A-Za-z]{3}$/.test(result.meta.currency)) return null;
  const closes = record(result.indicators) && Array.isArray(result.indicators.quote) && record(result.indicators.quote[0]) && Array.isArray(result.indicators.quote[0].close) ? result.indicators.quote[0].close : [];
  const lastClose = [...closes].reverse().find(item => positiveScaled(item) !== null);
  const current = positiveScaled(result.meta.regularMarketPrice) ?? positiveScaled(lastClose);
  if (!current) return null;
  const previous = positiveScaled(result.meta.chartPreviousClose) ?? positiveScaled(result.meta.previousClose);
  const seconds = safeTimestamp(result.meta.regularMarketTime);
  return { currency: result.meta.currency.toUpperCase(), current, previous, timestamp: seconds === null ? null : seconds * 1000 };
}

function convertYahooPrice(value: string, currency: string, eurUsd: string | null, currencyUsd: string | null): { readonly eur: string; readonly usd: string } | null {
  const scale = 10n ** BigInt(PRICE_SCALE);
  if (currency === 'EUR') return eurUsd ? { eur: value, usd: roundedDivide(BigInt(value) * BigInt(eurUsd), scale).toString() } : null;
  if (currency === 'USD') return eurUsd ? { eur: roundedDivide(BigInt(value) * scale, BigInt(eurUsd)).toString(), usd: value } : null;
  if (!eurUsd || !currencyUsd) return null;
  const usd = roundedDivide(BigInt(value) * BigInt(currencyUsd), scale).toString();
  return { eur: roundedDivide(BigInt(usd) * scale, BigInt(eurUsd)).toString(), usd };
}

export function createYahooQuoteAdapter(options: YahooQuoteOptions): PriceProvider {
  return { id: YAHOO_QUOTES_PROVIDER_ID, async fetch(assets, context) {
    const instrumentAssets = assets.filter(asset => asset.kind === 'instrument' && asset.instrument);
    const statuses: PriceStatus[] = []; const quotes: PriceQuote[] = []; const values = new Map<string, YahooChartValue>();
    const request = async (symbol: string): Promise<YahooChartValue | null> => yahooChartValue(await options.http.requestJson<unknown>({ url: `${YAHOO_CHART_URL}/${encodeURIComponent(symbol)}?range=5d&interval=1d&events=history`, timeoutMs: options.timeoutMs ?? 10_000, maxBytes: options.maxBytes ?? 256_000, allowPublicPath: true }, context.signal));
    for (const asset of instrumentAssets) {
      const symbol = yahooQuoteSymbol(asset.instrument!);
      if (!symbol) { statuses.push(statusFor(asset.assetId, YAHOO_QUOTES_PROVIDER_ID, 'unpriced', 'unsupported-asset', null)); continue; }
      try {
        const value = await request(symbol);
        if (!value || value.currency !== asset.instrument!.currency.toUpperCase()) statuses.push(statusFor(asset.assetId, YAHOO_QUOTES_PROVIDER_ID, 'unpriced', value ? 'currency-mismatch' : 'missing-quote', null));
        else values.set(asset.assetId, value);
      } catch (error) { const mapped = mapError(error); statuses.push(statusFor(asset.assetId, YAHOO_QUOTES_PROVIDER_ID, mapped.status, mapped.code, null)); }
    }
    const currencies = new Set([...values.values()].map(value => value.currency));
    const fx = new Map<string, string>();
    const fetchFx = async (symbol: string): Promise<void> => {
      try { const value = await request(symbol); if (value) fx.set(symbol, value.current); } catch { /* represented as partial below */ }
    };
    if (currencies.size > 0) await fetchFx('EURUSD=X');
    for (const currency of currencies) if (currency !== 'EUR' && currency !== 'USD') await fetchFx(`${currency}USD=X`);
    for (const asset of instrumentAssets) {
      const value = values.get(asset.assetId); if (!value) continue;
      const converted = convertYahooPrice(value.current, value.currency, fx.get('EURUSD=X') ?? null, fx.get(`${value.currency}USD=X`) ?? null);
      const previous = value.previous ? convertYahooPrice(value.previous, value.currency, fx.get('EURUSD=X') ?? null, fx.get(`${value.currency}USD=X`) ?? null) : null;
      if (!converted) { statuses.push(statusFor(asset.assetId, YAHOO_QUOTES_PROVIDER_ID, 'partial', 'fx-unavailable', null)); continue; }
      const change = value.previous ? roundedDivide((BigInt(value.current) - BigInt(value.previous)) * 10000n * 100n, BigInt(value.previous)).toString() : null;
      quotes.push(quote(asset.assetId, converted.eur, converted.usd, YAHOO_QUOTES_PROVIDER_ID, context.now, value.timestamp, change, previous?.eur ?? null, previous?.usd ?? null));
      statuses.push(statusFor(asset.assetId, YAHOO_QUOTES_PROVIDER_ID, 'ok', null, context.now));
    }
    return { providerId: YAHOO_QUOTES_PROVIDER_ID, quotes, statuses, partial: statuses.some(status => status.status !== 'ok') };
  } };
}

export function createFmpQuoteAdapter(options: FmpQuoteOptions): PriceProvider {
  const requestedBatch = Number(options.maxBatch); const batch = Number.isSafeInteger(requestedBatch) && requestedBatch > 0 && requestedBatch <= 50 ? requestedBatch : 20;
  return { id: FMP_QUOTES_PROVIDER_ID, async fetch(assets, context) {
    const instrumentAssets = assets.filter(asset => asset.kind === 'instrument' && asset.instrument); const statuses: PriceStatus[] = []; const quotes: PriceQuote[] = [];
    let key: string | null = null; try { key = await options.getApiKey(); } catch { key = null; }
    if (!key || key.length > 4096) return { providerId: FMP_QUOTES_PROVIDER_ID, quotes, statuses: instrumentAssets.map(asset => statusFor(asset.assetId, FMP_QUOTES_PROVIDER_ID, 'unpriced', 'unconfigured', null)), partial: instrumentAssets.length > 0 };
    const currencies = [...new Set(instrumentAssets.map(asset => asset.instrument!.currency.toUpperCase()).filter(currency => currency !== 'USD' && currency !== 'EUR'))].slice(0, 10);
    const fx = new Map<string, string>();
    const fetchFx = async (symbol: string): Promise<void> => {
      try {
        const payload = await options.http.requestJson<unknown>({ url: `${FMP_FOREX_QUOTE_URL}?symbol=${encodeURIComponent(symbol)}`, headers: { apikey: key! }, timeoutMs: options.timeoutMs ?? 10_000, maxBytes: options.maxBytes ?? 128_000 }, context.signal);
        const rate = parseFx(payload, symbol); if (rate) fx.set(symbol, rate);
      } catch { /* a missing rate is represented as partial below */ }
    };
    await fetchFx('EURUSD');
    for (const currency of currencies) await fetchFx(`${currency}USD`);
    for (let offset = 0; offset < instrumentAssets.length; offset += batch) {
      const group = instrumentAssets.slice(offset, offset + batch); const symbols = group.map(asset => providerQuoteSymbol(asset.instrument!)).join(',');
      try {
        const payload = await options.http.requestJson<unknown>({ url: `${FMP_BATCH_QUOTE_URL}?symbols=${encodeURIComponent(symbols)}`, headers: { apikey: key }, timeoutMs: options.timeoutMs ?? 10_000, maxBytes: options.maxBytes ?? 512_000 }, context.signal);
        const rows = quoteRows(payload); if (!rows) throw new Error('malformed');
        for (const asset of group) {
          const instrument = asset.instrument!; const quoteSymbol = providerQuoteSymbol(instrument); const row = rows.find(item => typeof item.symbol === 'string' && item.symbol.toUpperCase() === quoteSymbol.toUpperCase()); const direct = row ? fmpPrice(row.price ?? row.priceClose) : null;
          if (!row || !direct) { statuses.push(statusFor(asset.assetId, FMP_QUOTES_PROVIDER_ID, 'unpriced', 'missing-quote', null)); continue; }
          const currency = instrument.currency.toUpperCase(); let eur: string | null = null; let usd: string | null = null; let previousEur: string | null = null; let previousUsd: string | null = null;
          const eurRate = fx.get('EURUSD');
          if (currency === 'EUR') { eur = direct; usd = eurRate ? roundedDivide(BigInt(direct) * BigInt(eurRate), 10n ** BigInt(PRICE_SCALE)).toString() : null; }
          else if (currency === 'USD') { usd = direct; eur = eurRate ? roundedDivide(BigInt(direct) * 10n ** BigInt(PRICE_SCALE), BigInt(eurRate)).toString() : null; }
          else { const usdRate = fx.get(`${currency}USD`); usd = usdRate ? roundedDivide(BigInt(direct) * BigInt(usdRate), 10n ** BigInt(PRICE_SCALE)).toString() : null; eur = usdRate && eurRate ? roundedDivide(BigInt(direct) * BigInt(usdRate), BigInt(eurRate)).toString() : null; }
          const previousRaw = fmpPrice(row.previousClose);
          if (previousRaw) {
            if (currency === 'EUR') { previousEur = previousRaw; previousUsd = eurRate ? roundedDivide(BigInt(previousRaw) * BigInt(eurRate), 10n ** BigInt(PRICE_SCALE)).toString() : null; }
            else if (currency === 'USD') { previousUsd = previousRaw; previousEur = eurRate ? roundedDivide(BigInt(previousRaw) * 10n ** BigInt(PRICE_SCALE), BigInt(eurRate)).toString() : null; }
            else { const usdRate = fx.get(`${currency}USD`); previousUsd = usdRate ? roundedDivide(BigInt(previousRaw) * BigInt(usdRate), 10n ** BigInt(PRICE_SCALE)).toString() : null; previousEur = usdRate && eurRate ? roundedDivide(BigInt(previousRaw) * BigInt(usdRate), BigInt(eurRate)).toString() : null; }
          }
          if (!eur || !usd) statuses.push(statusFor(asset.assetId, FMP_QUOTES_PROVIDER_ID, 'partial', 'fx-unavailable', null)); else { const change = previousEur && previousEur !== '0' ? roundedDivide((BigInt(eur) - BigInt(previousEur)) * 10000n * 100n, BigInt(previousEur)).toString() : signedScaled(row.changePercentage ?? row.changesPercentage, 4); quotes.push(quote(asset.assetId, eur, usd, FMP_QUOTES_PROVIDER_ID, context.now, safeTimestamp(row.timestamp) === null ? null : safeTimestamp(row.timestamp)! * 1000, change, previousEur, previousUsd)); statuses.push(statusFor(asset.assetId, FMP_QUOTES_PROVIDER_ID, 'ok', null, context.now)); }
        }
      } catch (error) { const mapped = mapError(error); for (const asset of group) statuses.push(statusFor(asset.assetId, FMP_QUOTES_PROVIDER_ID, mapped.status, mapped.code, null)); }
    }
    return { providerId: FMP_QUOTES_PROVIDER_ID, quotes, statuses, partial: statuses.some(status => status.status !== 'ok') };
  } };
}

function roundedDivide(numerator: bigint, denominator: bigint): bigint { if (denominator <= 0n) throw new Error('denominator'); const negative = numerator < 0n; const magnitude = negative ? -numerator : numerator; const rounded = (magnitude + denominator / 2n) / denominator; return negative ? -rounded : rounded; }
function multiplyQuantity(quantity: string, quantityDecimals: number, priceScaled: string): string { return roundedDivide(BigInt(quantity) * BigInt(priceScaled), 10n ** BigInt(quantityDecimals)).toString(); }
function previousFromPercent(value: string, percentScaled: string): string | null { const denominator = 1000000n + BigInt(percentScaled); return denominator > 0n ? roundedDivide(BigInt(value) * 1000000n, denominator).toString() : null; }
export interface PortfolioValuation { readonly assets: readonly Valuation[]; readonly totalEurScaled: string | null; readonly totalUsdScaled: string | null; readonly complete: boolean; readonly valuedAssets: number; readonly totalAssets: number; readonly dayChangeEurScaled: string | null; readonly dayChangeUsdScaled: string | null; readonly dayChangePercentScaled: string | null; }
export function valueAssets(inputs: readonly { readonly assetId: string; readonly quantityBaseUnits: string; readonly quantityDecimals: number; readonly quote?: PriceQuote; }[], includedAssetIds?: ReadonlySet<string>): PortfolioValuation {
  const selected = (input: { readonly assetId: string }): boolean => !includedAssetIds || includedAssetIds.has(input.assetId);
  const assets: Valuation[] = []; let eur = 0n; let usd = 0n; let valued = 0; let complete = true;
  for (const input of inputs) {
    const included = selected(input); const q = input.quote; if (!q) { if (included) complete = false; assets.push({ assetId: input.assetId, quantityBaseUnits: input.quantityBaseUnits, quantityDecimals: input.quantityDecimals, priceEurScaled: null, priceUsdScaled: null, valueEurScaled: null, valueUsdScaled: null, dayChangeEurScaled: null, dayChangeUsdScaled: null, dayChangePercentScaled: null, status: 'unpriced' }); continue; }
    const valueEur = multiplyQuantity(input.quantityBaseUnits, input.quantityDecimals, q.priceEurScaled); const valueUsd = multiplyQuantity(input.quantityBaseUnits, input.quantityDecimals, q.priceUsdScaled); eur += BigInt(valueEur); usd += BigInt(valueUsd); valued++;
    const eurChange = q.change24hEurPercentScaled ?? q.change24hPercentScaled;
    const usdChange = q.change24hUsdPercentScaled ?? q.change24hPercentScaled;
    const previousEur = q.previousPriceEurScaled ? multiplyQuantity(input.quantityBaseUnits, input.quantityDecimals, q.previousPriceEurScaled) : eurChange === null ? null : previousFromPercent(valueEur, eurChange);
    const previousUsd = q.previousPriceUsdScaled ? multiplyQuantity(input.quantityBaseUnits, input.quantityDecimals, q.previousPriceUsdScaled) : usdChange === null ? null : previousFromPercent(valueUsd, usdChange);
    const changeEur = previousEur === null ? null : (BigInt(valueEur) - BigInt(previousEur)).toString(); const changeUsd = previousUsd === null ? null : (BigInt(valueUsd) - BigInt(previousUsd)).toString();
    assets.push({ assetId: input.assetId, quantityBaseUnits: input.quantityBaseUnits, quantityDecimals: input.quantityDecimals, priceEurScaled: q.priceEurScaled, priceUsdScaled: q.priceUsdScaled, valueEurScaled: valueEur, valueUsdScaled: valueUsd, dayChangeEurScaled: changeEur, dayChangeUsdScaled: changeUsd, dayChangePercentScaled: q.change24hPercentScaled, status: 'valued' });
    if (!included) { eur -= BigInt(valueEur); usd -= BigInt(valueUsd); valued--; }
  }
  const selectedAssets = assets.filter(selected);
  const dayEur = selectedAssets.length > 0 && selectedAssets.every(item => item.dayChangeEurScaled !== null) ? selectedAssets.reduce((sum, item) => sum + BigInt(item.dayChangeEurScaled!), 0n).toString() : null; const dayUsd = selectedAssets.length > 0 && selectedAssets.every(item => item.dayChangeUsdScaled !== null) ? selectedAssets.reduce((sum, item) => sum + BigInt(item.dayChangeUsdScaled!), 0n).toString() : null;
  const previousTotalEur = dayEur === null || eur === BigInt(dayEur) ? null : eur - BigInt(dayEur);
  const dayPercent = previousTotalEur !== null && previousTotalEur !== 0n && dayEur !== null ? roundedDivide(BigInt(dayEur) * 10000n * 100n, previousTotalEur).toString() : null;
  return { assets, totalEurScaled: valued === 0 ? null : eur.toString(), totalUsdScaled: valued === 0 ? null : usd.toString(), complete: complete && valued === selectedAssets.length, valuedAssets: valued, totalAssets: selectedAssets.length, dayChangeEurScaled: complete ? dayEur : null, dayChangeUsdScaled: complete ? dayUsd : null, dayChangePercentScaled: complete ? dayPercent : null };
}

const MAX_HISTORY_POINTS = 12000;
function compactPoints(points: readonly HistoryPoint[]): HistoryPoint[] {
  const sorted = [...points].sort((a, b) => a.timestamp - b.timestamp); const deduped = [...new Map(sorted.map(point => [point.timestamp, point])).values()];
  if (deduped.length <= MAX_HISTORY_POINTS) return deduped;
  const latest = deduped.at(-1)!.timestamp;
  const tiers = new Map<number, HistoryPoint>();
  for (const point of deduped) {
    const age = latest - point.timestamp;
    const bucketSize = age <= 48 * 3600000 ? 1 : age <= 31 * 86400000 ? 30 * 60000 : age <= 400 * 86400000 ? 4 * 3600000 : 86400000;
    const bucket = bucketSize === 1 ? point.timestamp : Math.floor(point.timestamp / bucketSize) * bucketSize;
    tiers.set(bucket, point);
  }
  const compacted = [...tiers.values()].sort((a, b) => a.timestamp - b.timestamp);
  return compacted.length <= MAX_HISTORY_POINTS ? compacted : [compacted[0]!, ...compacted.slice(-(MAX_HISTORY_POINTS - 1))];
}
export function updateHistory(previous: readonly HistorySeries[], quotes: readonly PriceQuote[], valuation: PortfolioValuation, timestamp: number): readonly HistorySeries[] {
  const next = new Map(previous.map(series => [series.id, series]));
  for (const quoteValue of quotes) { const series = next.get(quoteValue.assetId) ?? { id: quoteValue.assetId, kind: 'asset-price' as const, points: [] }; const point: HistoryPoint = { timestamp, valueEurScaled: quoteValue.priceEurScaled, valueUsdScaled: quoteValue.priceUsdScaled, coverage: 'complete' }; next.set(quoteValue.assetId, { ...series, points: compactPoints([...series.points, point]) }); }
  if (valuation.totalEurScaled !== null && valuation.totalUsdScaled !== null) { const series = next.get('portfolio') ?? { id: 'portfolio', kind: 'portfolio-value' as const, points: [] }; next.set('portfolio', { ...series, points: compactPoints([...series.points, { timestamp, valueEurScaled: valuation.totalEurScaled, valueUsdScaled: valuation.totalUsdScaled, coverage: valuation.complete ? 'complete' : 'partial' }]) }); }
  for (const [id, series] of next) {
    if (series.kind === 'asset-price' && !quotes.some(quoteValue => quoteValue.assetId === id)) next.set(id, { ...series, points: compactPoints(series.points) });
  }
  return [...next.values()];
}

export function mergePriceState(previous: PriceState, result: PriceProviderResult, valuation: PortfolioValuation | null, now: number, activeAssetIds?: ReadonlySet<string>): PriceState {
  const good = new Map(previous.quotes.map(item => [item.assetId, item])); for (const item of result.quotes) good.set(item.assetId, item);
  const statusMap = new Map(previous.statuses.map(item => [item.assetId, item]));
  for (const item of result.statuses) {
    const oldQuote = good.get(item.assetId); const normalized = oldQuote && item.status !== 'ok' ? { ...item, status: 'stale' as const, lastGoodFetchedAt: oldQuote.fetchedAt } : item;
    statusMap.set(item.assetId, normalized);
  }
  const keep = activeAssetIds ?? new Set([...good.keys(), ...statusMap.keys()]);
  const histories = valuation ? updateHistory(previous.history.filter(series => series.id === 'portfolio' || keep.has(series.id)), result.quotes, valuation, now) : previous.history.filter(series => series.id === 'portfolio' || keep.has(series.id));
  return { quotes: [...good.values()].filter(item => keep.has(item.assetId)), statuses: [...statusMap.values()].filter(item => keep.has(item.assetId)), valuations: valuation?.assets ?? previous.valuations.filter(item => keep.has(item.assetId)), history: histories, totalEurScaled: valuation ? valuation.totalEurScaled : previous.totalEurScaled, totalUsdScaled: valuation ? valuation.totalUsdScaled : previous.totalUsdScaled, complete: valuation?.complete ?? previous.complete, valuedAssets: valuation?.valuedAssets ?? previous.valuedAssets, totalAssets: valuation?.totalAssets ?? previous.totalAssets, dayChangeEurScaled: valuation ? valuation.dayChangeEurScaled : previous.dayChangeEurScaled, dayChangeUsdScaled: valuation ? valuation.dayChangeUsdScaled : previous.dayChangeUsdScaled, dayChangePercentScaled: valuation ? valuation.dayChangePercentScaled : previous.dayChangePercentScaled };
}

export interface PricingCoordinatorContext { readonly http: HttpJsonPort; readonly signal?: AbortSignal; }
export interface PricingCoordinatorDependencies { readonly providers: readonly PriceProvider[]; readonly now: () => number; }
export interface PricingRun { readonly state: PortfolioState; readonly valuation: PortfolioValuation; readonly results: readonly PriceProviderResult[]; }
export interface PricingCoordinator { run(state: PortfolioState, context: PricingCoordinatorContext): Promise<PricingRun>; stop(): void; }

function quantityInputs(state: PortfolioState, assets: readonly PriceAsset[]): readonly { readonly assetId: string; readonly quantityBaseUnits: string; readonly quantityDecimals: number; }[] {
  const byId = new Map(assets.map(asset => [asset.assetId, asset]));
  const values = new Map<string, { assetId: string; quantityBaseUnits: string; quantityDecimals: number }>();
  for (const position of state.positions) { const wallet = state.wallets.find(item => item.id === position.walletId); const network = wallet && 'network' in wallet.options ? wallet.options.network : wallet?.family === 'solana' ? 'mainnet-beta' : 'mainnet'; const asset = assetIdentityForPosition(position, network); const prior = values.get(asset.assetId); if (prior && prior.quantityDecimals === position.decimals) prior.quantityBaseUnits = (BigInt(prior.quantityBaseUnits) + BigInt(position.baseUnits)).toString(); else if (!prior) values.set(asset.assetId, { assetId: asset.assetId, quantityBaseUnits: position.baseUnits, quantityDecimals: position.decimals }); }
  for (const holding of state.holdings) { const asset = byId.get(`instrument:${holding.instrumentId}`); if (asset) { const prior = values.get(asset.assetId); if (prior) prior.quantityBaseUnits = (BigInt(prior.quantityBaseUnits) + BigInt(holding.quantityHundredths)).toString(); else values.set(asset.assetId, { assetId: asset.assetId, quantityBaseUnits: holding.quantityHundredths, quantityDecimals: 2 }); } }
  return [...values.values()];
}

function includedAssetIds(state: PortfolioState, assets: readonly PriceAsset[], spamAssetIds: ReadonlySet<string>): ReadonlySet<string> {
  const hidden = new Set(state.settings.hiddenAssetIds);
  const spam = state.settings.spamFilterEnabled ? spamAssetIds : new Set<string>();
  return new Set(assets.filter(asset => !hidden.has(asset.assetId) && !spam.has(asset.assetId)).map(asset => asset.assetId));
}

export function createPricingCoordinator(dependencies: PricingCoordinatorDependencies): PricingCoordinator {
  const inFlight = new Map<string, Promise<PricingRun>>(); const controller = new AbortController(); let stopped = false;
  return {
    run(state, context) {
      if (stopped) return Promise.reject(new Error('stopped'));
      const key = JSON.stringify({ positions: state.positions, holdings: state.holdings, instruments: state.instruments, settings: state.settings, http: portIdentity(context.http) });
      const existing = inFlight.get(key); if (existing) return existing;
      const task = (async (): Promise<PricingRun> => {
        const taskController = new AbortController();
        const abortTask = (): void => taskController.abort();
        controller.signal.addEventListener('abort', abortTask, { once: true });
        context.signal?.addEventListener('abort', abortTask, { once: true });
        if (controller.signal.aborted || context.signal?.aborted) taskController.abort();
        const current = state.prices;
        try {
          const spamAssetIds = new Set<string>();
          const positionAssets = state.positions.map(position => { const wallet = state.wallets.find(item => item.id === position.walletId); const network = wallet && 'network' in wallet.options ? wallet.options.network : wallet?.family === 'solana' ? 'mainnet-beta' : 'mainnet'; const asset = assetIdentityForPosition(position, network); if (position.spam?.hiddenByDefault) spamAssetIds.add(asset.assetId); return asset; });
          const assets = [...positionAssets, ...state.instruments.filter(instrument => state.holdings.some(holding => holding.instrumentId === instrument.id)).map(assetIdentityForInstrument)];
          const uniqueAssets = [...new Map(assets.map(asset => [asset.assetId, asset])).values()];
          const providerResults: PriceProviderResult[] = [];
          const resolvedAssets = new Set<string>();
          for (const provider of dependencies.providers) {
            const explicitlyDisabled = (provider.id === COINGECKO_PROVIDER_ID || provider.id === YAHOO_QUOTES_PROVIDER_ID) && state.settings.providerRefs.some(reference => reference.providerId === provider.id && reference.enabled === false);
            const selected = uniqueAssets.filter(asset => provider.id === COINGECKO_PROVIDER_ID ? asset.kind !== 'instrument' : asset.kind === 'instrument' && !resolvedAssets.has(asset.assetId));
            if (selected.length === 0) continue;
            if (explicitlyDisabled) {
              providerResults.push({ providerId: provider.id, quotes: [], statuses: selected.map(asset => statusFor(asset.assetId, provider.id, 'unpriced', 'provider-disabled', null)), partial: true });
              continue;
            }
            try { const result = await provider.fetch(selected, { http: context.http, signal: taskController.signal, now: dependencies.now() }); providerResults.push(result); for (const item of result.quotes) resolvedAssets.add(item.assetId); } catch (error) { const mapped = mapError(error); providerResults.push({ providerId: provider.id, quotes: [], statuses: selected.map(asset => statusFor(asset.assetId, provider.id, mapped.status, mapped.code, null)), partial: true }); }
          }
          const allQuotes = providerResults.flatMap(result => result.quotes); const quoteMap = new Map(allQuotes.map(item => [item.assetId, item]));
          for (const item of current.quotes) if (!quoteMap.has(item.assetId)) quoteMap.set(item.assetId, item);
          const included = includedAssetIds(state, uniqueAssets, spamAssetIds);
          const valuation = valueAssets(quantityInputs(state, uniqueAssets).map(input => ({ ...input, quote: quoteMap.get(input.assetId) })), included);
          const active = new Set(uniqueAssets.map(asset => asset.assetId));
          const mergedResult: PriceProviderResult = {
            providerId: 'holdvue.pricing',
            quotes: allQuotes,
            statuses: providerResults.flatMap(result => result.statuses),
            partial: providerResults.some(result => result.partial),
          };
          const merged = mergePriceState(current, mergedResult, valuation, dependencies.now(), active);
          const next = { ...state, prices: merged };
          return { state: next, valuation, results: providerResults };
        } finally {
          controller.signal.removeEventListener('abort', abortTask);
          context.signal?.removeEventListener('abort', abortTask);
        }
      })().finally(() => { if (inFlight.get(key) === task) inFlight.delete(key); });
      inFlight.set(key, task); return task;
    },
    stop() { stopped = true; controller.abort(); }
  };
}
