import type { Currency } from './ports.ts';
import type { Holding, Instrument, PortfolioState, Position, PriceQuote, Valuation, WalletSource } from './state.ts';
import { assetIdentityForInstrument, assetIdentityForPosition, scaledToDecimal } from './pricing.ts';

export type PortfolioSort = 'size' | 'gainers' | 'losers';
export type PortfolioRange = '1D' | '7D' | '1M' | '1Y' | 'MAX';

export interface PortfolioAccountView {
  readonly id: string;
  readonly label: string;
  readonly family: Position['family'] | 'broker';
  readonly chain: string;
  readonly address: string;
  readonly quantityBaseUnits: string;
  readonly quantity: string;
  readonly valueScaled: string | null;
}

export interface PortfolioAssetView {
  readonly assetId: string;
  readonly kind: 'wallet' | 'instrument';
  readonly symbol: string;
  readonly name: string;
  source: string;
  readonly decimals: number;
  readonly quantityBaseUnits: string;
  readonly quantity: string;
  readonly priceScaled: string | null;
  readonly valueScaled: string | null;
  readonly dayChangeScaled: string | null;
  readonly dayChangePercentScaled: string | null;
  readonly status: 'valued' | 'unpriced' | 'partial' | 'hidden' | 'stale';
  readonly stale: boolean;
  readonly spamReasons: readonly string[];
  readonly accounts: readonly PortfolioAccountView[];
}

export interface PortfolioSummary {
  readonly currency: Currency;
  readonly totalScaled: string | null;
  readonly dayChangeScaled: string | null;
  readonly dayChangePercentScaled: string | null;
  readonly valuedAssets: number;
  readonly totalAssets: number;
  readonly complete: boolean;
}

export interface PortfolioViewModel {
  readonly currency: Currency;
  readonly assets: readonly PortfolioAssetView[];
  readonly hiddenAssets: readonly PortfolioAssetView[];
  readonly summary: PortfolioSummary;
}

const zero = (value: string): boolean => BigInt(value) === 0n;
const add = (left: string, right: string): string => (BigInt(left) + BigInt(right)).toString();
const roundedDivide = (numerator: bigint, denominator: bigint): bigint => {
  const negative = numerator < 0n;
  const magnitude = negative ? -numerator : numerator;
  const rounded = (magnitude + denominator / 2n) / denominator;
  return negative ? -rounded : rounded;
};
const multiplyQuantity = (baseUnits: string, decimals: number, scaled: string): string => roundedDivide(BigInt(baseUnits) * BigInt(scaled), 10n ** BigInt(decimals)).toString();
const valueFor = (quantity: string, decimals: number, quote: string | null): string | null => {
  if (quote === null) return null;
  try { return multiplyQuantity(quantity, decimals, quote); } catch { return null; }
};
const percentFor = (total: string | null, day: string | null): string | null => {
  if (total === null || day === null) return null;
  const previous = BigInt(total) - BigInt(day);
  return previous <= 0n ? null : roundedDivide(BigInt(day) * 1000000n, previous).toString();
};

function walletNetwork(wallet: WalletSource): string {
  if ('network' in wallet.options) return wallet.options.network;
  return wallet.family === 'solana' ? 'mainnet-beta' : 'mainnet';
}
function quoteMap(state: PortfolioState): Map<string, PriceQuote> { return new Map(state.prices.quotes.map(item => [item.assetId, item])); }
function valuationMap(state: PortfolioState): Map<string, Valuation> { return new Map(state.prices.valuations.map(item => [item.assetId, item])); }
function statusMap(state: PortfolioState): Map<string, { readonly status: string; readonly stale: boolean }> {
  return new Map(state.prices.statuses.map(item => [item.assetId, { status: item.status, stale: item.status === 'stale' }]));
}
function nativeName(symbol: string): string {
  const known: Record<string, string> = { BTC: 'Bitcoin', ETH: 'Ethereum', SOL: 'Solana', ADA: 'Cardano', POL: 'Polygon', BNB: 'BNB', AVAX: 'Avalanche', XDAI: 'xDAI', CELO: 'Celo', MNT: 'Mantle' };
  return known[symbol.toUpperCase()] ?? symbol;
}
function accountFor(position: Position, wallet: WalletSource, quantityBaseUnits: string, valueScaled: string | null): PortfolioAccountView {
  const chain = position.chainId === null ? walletNetwork(wallet) : String(position.chainId);
  return { id: position.id, label: wallet.label, family: wallet.family, chain, address: wallet.address, quantityBaseUnits, quantity: position.quantity, valueScaled };
}

interface Aggregate {
  readonly assetId: string;
  readonly kind: 'wallet' | 'instrument';
  readonly symbol: string;
  readonly name: string;
  source: string;
  readonly decimals: number;
  quantityBaseUnits: string;
  conflict: boolean;
  spamHiddenByDefault: boolean;
  readonly spamReasons: string[];
  readonly accounts: PortfolioAccountView[];
}

function putPosition(groups: Map<string, Aggregate>, position: Position, wallet: WalletSource): void {
  if (zero(position.baseUnits)) return;
  const identity = assetIdentityForPosition(position, position.family === 'evm' ? undefined : walletNetwork(wallet));
  const key = identity.assetId;
  const prior = groups.get(key);
  if (prior) {
    if (prior.decimals === position.decimals && !prior.conflict) prior.quantityBaseUnits = add(prior.quantityBaseUnits, position.baseUnits);
    else prior.conflict = true;
    if (prior.source !== wallet.label) prior.source = 'Multiple accounts';
    prior.spamHiddenByDefault = prior.spamHiddenByDefault || position.spam?.hiddenByDefault === true;
    for (const reason of position.spam?.reasons ?? []) if (!prior.spamReasons.includes(reason)) prior.spamReasons.push(reason);
    prior.accounts.push(accountFor(position, wallet, position.baseUnits, null));
    return;
  }
  groups.set(key, { assetId: identity.assetId, kind: 'wallet', symbol: position.symbol, name: position.assetName ?? (position.assetKind === 'native' ? nativeName(position.symbol) : position.symbol), source: wallet.label, decimals: position.decimals, quantityBaseUnits: position.baseUnits, conflict: false, spamHiddenByDefault: position.spam?.hiddenByDefault === true, spamReasons: [...new Set(position.spam?.reasons ?? [])], accounts: [accountFor(position, wallet, position.baseUnits, null)] });
}
function putHolding(groups: Map<string, Aggregate>, holding: Holding, instrument: Instrument): void {
  if (zero(holding.quantityHundredths)) return;
  const asset = assetIdentityForInstrument(instrument);
  groups.set(asset.assetId, { assetId: asset.assetId, kind: 'instrument', symbol: instrument.symbol, name: instrument.name, source: `${instrument.exchange} · ${instrument.providerId}`, decimals: 2, quantityBaseUnits: holding.quantityHundredths, conflict: false, spamHiddenByDefault: false, spamReasons: [], accounts: [{ id: holding.id, label: instrument.exchange, family: 'broker', chain: instrument.exchange, address: instrument.providerSymbol, quantityBaseUnits: holding.quantityHundredths, quantity: holding.quantity, valueScaled: null }] });
}

function toAssetView(group: Aggregate, quotes: Map<string, PriceQuote>, valuations: Map<string, Valuation>, statuses: Map<string, { readonly status: string; readonly stale: boolean }>, currency: Currency): PortfolioAssetView {
  const quote = quotes.get(group.assetId);
  const valuation = valuations.get(group.assetId);
  const status = statuses.get(group.assetId);
  const priceScaled = quote ? currency === 'EUR' ? quote.priceEurScaled : quote.priceUsdScaled : null;
  const valueScaled = group.conflict ? null : valuation ? currency === 'EUR' ? valuation.valueEurScaled : valuation.valueUsdScaled : null;
  const dayChangeScaled = group.conflict ? null : valuation ? currency === 'EUR' ? valuation.dayChangeEurScaled : valuation.dayChangeUsdScaled : null;
  const dayPercent = quote ? currency === 'EUR' ? quote.change24hEurPercentScaled : quote.change24hUsdPercentScaled : null;
  const stale = status?.stale ?? false;
  const resolved = group.conflict ? 'partial' : status?.status === 'stale' ? 'stale' : valuation?.status ?? (priceScaled === null ? 'unpriced' : 'partial');
  const accounts = group.accounts.map(account => ({ ...account, valueScaled: group.conflict ? null : valueFor(account.quantityBaseUnits, group.decimals, priceScaled) }));
  return { assetId: group.assetId, kind: group.kind, symbol: group.symbol, name: group.name, source: group.source, decimals: group.decimals, quantityBaseUnits: group.quantityBaseUnits, quantity: group.kind === 'instrument' ? group.accounts[0]!.quantity : formatQuantity(group.quantityBaseUnits, group.decimals), priceScaled, valueScaled, dayChangeScaled, dayChangePercentScaled: dayPercent, status: resolved as PortfolioAssetView['status'], stale, spamReasons: group.spamReasons, accounts };
}
function formatQuantity(value: string, decimals: number): string {
  if (decimals === 0) return value;
  const decimal = scaledToDecimal(value, decimals);
  return decimal;
}

export function buildPortfolioViewModel(state: PortfolioState): PortfolioViewModel {
  const groups = new Map<string, Aggregate>();
  for (const position of state.positions) {
    const wallet = state.wallets.find(item => item.id === position.walletId);
    if (wallet) putPosition(groups, position, wallet);
  }
  for (const holding of state.holdings) {
    const instrument = state.instruments.find(item => item.id === holding.instrumentId);
    if (instrument) putHolding(groups, holding, instrument);
  }
  const quotes = quoteMap(state); const valuations = valuationMap(state); const statuses = statusMap(state);
  const spamHiddenIds = new Set([...groups.values()].filter(group => group.spamHiddenByDefault).map(group => group.assetId));
  const allAssets = [...groups.values()].map(group => toAssetView(group, quotes, valuations, statuses, state.settings.currency));
  const hiddenIds = new Set(state.settings.hiddenAssetIds);
  const quarantined = (asset: PortfolioAssetView): boolean => asset.kind === 'wallet' && spamHiddenIds.has(asset.assetId) && state.settings.spamFilterEnabled && !state.settings.showHiddenSpamAssets;
  const hiddenAssets = allAssets.filter(asset => hiddenIds.has(asset.assetId) || quarantined(asset)).map(asset => ({ ...asset, status: 'hidden' as const }));
  const assets = allAssets.filter(asset => !hiddenIds.has(asset.assetId) && !quarantined(asset));
  const excludedSpam = new Set(state.settings.spamFilterEnabled ? [...groups.values()].filter(group => group.spamHiddenByDefault).map(group => group.assetId) : []);
  const summaryAssets = assets.filter(asset => !excludedSpam.has(asset.assetId));
  const valued = summaryAssets.filter(asset => asset.valueScaled !== null);
  const total = valued.length === 0 ? null : valued.reduce((sum, asset) => add(sum, asset.valueScaled!), '0');
  const dayAssets = summaryAssets.filter(asset => asset.dayChangeScaled !== null);
  const day = dayAssets.length === summaryAssets.length && summaryAssets.length > 0 ? dayAssets.reduce((sum, asset) => add(sum, asset.dayChangeScaled!), '0') : null;
  return { currency: state.settings.currency, assets, hiddenAssets, summary: { currency: state.settings.currency, totalScaled: total, dayChangeScaled: day, dayChangePercentScaled: percentFor(total, day), valuedAssets: valued.length, totalAssets: summaryAssets.length, complete: summaryAssets.length > 0 && valued.length === summaryAssets.length } };
}

export function sortPortfolioAssets(assets: readonly PortfolioAssetView[], sort: PortfolioSort): readonly PortfolioAssetView[] {
  const result = [...assets];
  result.sort((left, right) => {
    const l = sort === 'size' ? left.valueScaled : left.dayChangePercentScaled;
    const r = sort === 'size' ? right.valueScaled : right.dayChangePercentScaled;
    const missingOrder = (l === null ? 1 : 0) - (r === null ? 1 : 0);
    if (missingOrder !== 0) return missingOrder;
    const leftValue = BigInt(l ?? '0'); const rightValue = BigInt(r ?? '0');
    const order = sort === 'losers' ? leftValue - rightValue : rightValue - leftValue;
    return order === 0n ? left.assetId.localeCompare(right.assetId) : order > 0n ? 1 : -1;
  });
  return result;
}

export function rangeWindow(range: PortfolioRange): number | null {
  const values: Record<PortfolioRange, number | null> = { '1D': 86400000, '7D': 604800000, '1M': 2592000000, '1Y': 31536000000, MAX: null };
  return values[range];
}
export function selectHistoryPoints<T extends { readonly timestamp: number }>(points: readonly T[], range: PortfolioRange, now: number): readonly T[] {
  const window = rangeWindow(range);
  if (window === null) return [...points];
  return points.filter(point => point.timestamp >= now - window && point.timestamp <= now);
}
export function formatPortfolioValue(value: string | null, currency: Currency): string {
  if (value === null) return '—';
  const decimal = scaledToDecimal(value);
  return `${decimal} ${currency}`;
}
