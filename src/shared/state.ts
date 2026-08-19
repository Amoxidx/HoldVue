import type { Currency, Locale } from './ports.ts';
import { detectAddress, validateAddressForFamily, type AddressDetection, type AddressErrorCode } from './addresses.ts';
import { DEFAULT_NATIVE_DECIMALS, validateCustomChain, validateEndpointUrl } from './chains.ts';

export const CURRENT_SCHEMA_VERSION = 5 as const;
export type Theme = 'light' | 'dark';
export type WalletFamily = 'evm' | 'bitcoin' | 'solana' | 'cardano';
export type BitcoinNetwork = 'mainnet' | 'testnet';
export type BitcoinAddressType = 'address' | 'xpub' | 'ypub' | 'zpub' | 'tpub' | 'upub' | 'vpub';

export interface EvmWalletOptions {
  readonly autoScanCommonChains: boolean;
  readonly chainIds: readonly number[];
}

export interface BitcoinWalletOptions {
  readonly network: BitcoinNetwork;
  readonly addressType: BitcoinAddressType;
}

export interface SolanaWalletOptions {
  readonly network: 'mainnet-beta';
}

export interface CardanoWalletOptions {
  readonly network: 'mainnet' | 'testnet';
  readonly kind: 'payment' | 'stake';
}

interface WalletSourceBase {
  readonly schemaVersion: 3;
  readonly id: string;
  readonly label: string;
  readonly address: string;
  readonly enabled: boolean;
  readonly createdAt: number;
}

export interface EvmWalletSource extends WalletSourceBase {
  readonly family: 'evm';
  readonly options: EvmWalletOptions;
}

export interface BitcoinWalletSource extends WalletSourceBase {
  readonly family: 'bitcoin';
  readonly options: BitcoinWalletOptions;
}

export interface SolanaWalletSource extends WalletSourceBase {
  readonly family: 'solana';
  readonly options: SolanaWalletOptions;
}

export interface CardanoWalletSource extends WalletSourceBase {
  readonly family: 'cardano';
  readonly options: CardanoWalletOptions;
}

export type WalletSource = EvmWalletSource | BitcoinWalletSource | SolanaWalletSource | CardanoWalletSource;

export interface SpamAssessment {
  readonly riskFlags: readonly SpamRiskFlag[];
  readonly reasons: readonly string[];
  readonly hiddenByDefault: boolean;
}

export type SpamRiskFlag = 'metadata-missing' | 'suspicious-name' | 'suspicious-url' | 'invalid-decimals' | 'implausible-quantity' | 'unverified' | 'airdrop-signal';

export interface Position {
  readonly schemaVersion: 3;
  readonly id: string;
  readonly walletId: string;
  readonly family: WalletFamily;
  readonly chainId: number | null;
  readonly assetKind: 'native' | 'fungible';
  readonly assetId: string;
  readonly symbol: string;
  /** Optional provider-supplied display name; never used as an identity. */
  readonly assetName?: string;
  /** Exact integer quantity in the asset's smallest unit. */
  readonly baseUnits: string;
  /** Exact decimal rendering derived from baseUnits; never a JS number. */
  readonly quantity: string;
  readonly confirmedBaseUnits: string;
  readonly pendingBaseUnits: string;
  readonly decimals: number;
  readonly updatedAt: number;
  readonly spam: SpamAssessment | null;
}

export type InstrumentType = 'stock' | 'etf';

/** Canonical metadata returned by the immutable local catalog or a configured market provider. */
export interface Instrument {
  readonly schemaVersion: 4;
  readonly id: string;
  readonly providerId: string;
  /** Stable provider key, normally symbol plus the provider's exchange identity. */
  readonly providerSymbol: string;
  readonly symbol: string;
  readonly name: string;
  readonly exchange: string;
  readonly currency: string;
  readonly type: InstrumentType;
}

export interface InstrumentInput {
  readonly providerId: string;
  readonly providerSymbol: string;
  readonly symbol: string;
  readonly name: string;
  readonly exchange: string;
  readonly currency: string;
  readonly type: InstrumentType;
}

export interface Holding {
  readonly schemaVersion: 4;
  readonly id: string;
  readonly instrumentId: string;
  /** Exact quantity in hundredths; never a floating-point number. */
  readonly quantityHundredths: string;
  /** Canonical human-readable quantity derived from quantityHundredths. */
  readonly quantity: string;
  readonly updatedAt: number;
}

export interface HoldingInput {
  readonly instrument: InstrumentInput;
  readonly quantity: string;
}

export interface HoldingEditInput {
  readonly quantity?: string;
  readonly instrument?: InstrumentInput;
}

export interface CustomChain {
  readonly chainId: number;
  readonly name: string;
  readonly nativeAsset: string;
  readonly nativeDecimals: number;
  readonly rpcUrl: string;
  readonly explorerBaseUrl: string;
}

export interface ProviderReference {
  readonly providerId: string;
  readonly keyId: string | null;
  readonly enabled: boolean;
}

export interface ProviderEndpoint {
  readonly providerId: string;
  readonly endpoint: string;
  readonly enabled: boolean;
}

export type SyncStatusCode = 'ok' | 'empty' | 'partial' | 'unsupported' | 'unconfigured' | 'rate-limited' | 'error' | 'aborted';
export interface WalletSyncStatus {
  readonly walletId: string;
  readonly family: WalletFamily;
  readonly providerId: string;
  readonly status: SyncStatusCode;
  readonly lastAttemptAt: number | null;
  readonly lastSuccessAt: number | null;
  readonly errorCode: string | null;
}
export interface SyncState {
  readonly schemaVersion: 1;
  readonly statuses: readonly WalletSyncStatus[];
}

/** Fixed-point price scale used by persisted quotes and valuations. */
/** Twelve decimal places keeps sub-cent crypto prices exact while remaining bounded. */
export const PRICE_SCALE = 12 as const;
export type PriceStatusCode = 'ok' | 'unpriced' | 'partial' | 'rate-limited' | 'error' | 'aborted' | 'stale';
export interface PriceQuote {
  readonly assetId: string;
  readonly priceEurScaled: string;
  readonly priceUsdScaled: string;
  readonly scale: typeof PRICE_SCALE;
  readonly change24hPercentScaled: string | null;
  readonly change24hEurPercentScaled: string | null;
  readonly change24hUsdPercentScaled: string | null;
  readonly previousPriceEurScaled: string | null;
  readonly previousPriceUsdScaled: string | null;
  readonly source: string;
  readonly sourceTimestamp: number | null;
  readonly fetchedAt: number;
}
export interface PriceStatus {
  readonly assetId: string;
  readonly providerId: string;
  readonly status: PriceStatusCode;
  readonly errorCode: string | null;
  readonly lastGoodFetchedAt: number | null;
}
export interface Valuation {
  readonly assetId: string;
  readonly quantityBaseUnits: string;
  readonly quantityDecimals: number;
  readonly priceEurScaled: string | null;
  readonly priceUsdScaled: string | null;
  readonly valueEurScaled: string | null;
  readonly valueUsdScaled: string | null;
  readonly dayChangeEurScaled: string | null;
  readonly dayChangeUsdScaled: string | null;
  readonly dayChangePercentScaled: string | null;
  readonly status: 'valued' | 'unpriced' | 'partial';
}
export type HistoryCoverage = 'complete' | 'partial';
export interface HistoryPoint {
  readonly timestamp: number;
  readonly valueEurScaled: string;
  readonly valueUsdScaled: string;
  readonly coverage: HistoryCoverage;
}
export interface HistorySeries {
  readonly id: string;
  readonly kind: 'asset-price' | 'portfolio-value';
  readonly points: readonly HistoryPoint[];
}
export interface PriceState {
  readonly quotes: readonly PriceQuote[];
  readonly statuses: readonly PriceStatus[];
  readonly valuations: readonly Valuation[];
  readonly history: readonly HistorySeries[];
  readonly totalEurScaled: string | null;
  readonly totalUsdScaled: string | null;
  readonly complete: boolean;
  readonly valuedAssets: number;
  readonly totalAssets: number;
  readonly dayChangeEurScaled: string | null;
  readonly dayChangeUsdScaled: string | null;
  readonly dayChangePercentScaled: string | null;
}

export interface ChainRpcOverride {
  readonly chainId: number;
  readonly rpcUrl: string;
}

export interface Settings {
  readonly schemaVersion: 5;
  readonly currency: Currency;
  readonly locale: Locale;
  readonly theme: Theme;
  readonly schedulerEnabled: boolean;
  readonly spamFilterEnabled: boolean;
  readonly showHiddenSpamAssets: boolean;
  readonly enabledChainIds: readonly number[];
  readonly customChains: readonly CustomChain[];
  readonly rpcOverrides: readonly ChainRpcOverride[];
  readonly providerRefs: readonly ProviderReference[];
  readonly providerEndpoints: readonly ProviderEndpoint[];
  readonly enabledProviderIds: readonly string[];
  /** Canonical asset identities hidden locally by the user. */
  readonly hiddenAssetIds: readonly string[];
}

export interface PortfolioState {
  readonly schemaVersion: 5;
  readonly settings: Settings;
  readonly positions: readonly Position[];
  readonly wallets: readonly WalletSource[];
  readonly instruments: readonly Instrument[];
  readonly holdings: readonly Holding[];
  readonly sync: SyncState;
  readonly prices: PriceState;
}

export const DEFAULT_SETTINGS: Settings = Object.freeze({
  schemaVersion: 5,
  currency: 'EUR',
  locale: 'de',
  theme: 'dark',
  schedulerEnabled: true,
  spamFilterEnabled: true,
  showHiddenSpamAssets: false,
  enabledChainIds: [],
  customChains: [],
  rpcOverrides: [],
  providerRefs: [],
  providerEndpoints: [],
  enabledProviderIds: [],
  hiddenAssetIds: []
});

export interface IdFactory { next(): string; }
export interface Clock { now(): number; }
export interface WalletInput {
  readonly id?: string;
  readonly label: string;
  readonly family: WalletFamily;
  readonly address: string;
  readonly enabled?: boolean;
  readonly createdAt?: number;
  readonly options?: Partial<EvmWalletOptions> & Partial<BitcoinWalletOptions> & Partial<SolanaWalletOptions> & Partial<CardanoWalletOptions>;
  readonly [key: string]: unknown;
}

export type HoldingErrorCode = 'invalid-input' | 'invalid-instrument' | 'invalid-quantity' | 'duplicate-holding' | 'not-found' | 'secret-input';
export interface HoldingError { readonly ok: false; readonly code: HoldingErrorCode; readonly message: string; }
export type HoldingResult<T> = WalletSuccess<T> | HoldingError;

export type WalletErrorCode = 'invalid-input' | 'invalid-label' | 'invalid-address' | 'ambiguous-address' | 'duplicate-wallet' | 'not-found' | 'secret-input';
export interface WalletError { readonly ok: false; readonly code: WalletErrorCode; readonly message: string; readonly details?: AddressDetection; }
export interface WalletSuccess<T> { readonly ok: true; readonly value: T; }
export type WalletResult<T> = WalletSuccess<T> | WalletError;

export function createEmptyPortfolioState(): PortfolioState {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    settings: { ...DEFAULT_SETTINGS, enabledChainIds: [], customChains: [], rpcOverrides: [], providerRefs: [], providerEndpoints: [], enabledProviderIds: [], hiddenAssetIds: [] },
    positions: [],
    wallets: [],
    instruments: [],
    holdings: [],
    sync: { schemaVersion: 1, statuses: [] },
    prices: { quotes: [], statuses: [], valuations: [], history: [], totalEurScaled: null, totalUsdScaled: null, complete: false, valuedAssets: 0, totalAssets: 0, dayChangeEurScaled: null, dayChangeUsdScaled: null, dayChangePercentScaled: null }
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCurrency(value: unknown): value is Currency { return value === 'EUR' || value === 'USD'; }
function isLocale(value: unknown): value is Locale { return value === 'de' || value === 'en'; }
function isTheme(value: unknown): value is Theme { return value === 'light' || value === 'dark'; }
function isFamily(value: unknown): value is WalletFamily { return value === 'evm' || value === 'bitcoin' || value === 'solana' || value === 'cardano'; }
function isNetwork(value: unknown): value is BitcoinNetwork { return value === 'mainnet' || value === 'testnet'; }
function isPositiveInteger(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value > 0; }
function isTimestamp(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && value >= 0; }
function isBaseUnits(value: unknown): value is string { return typeof value === 'string' && /^(?:0|[1-9]\d*)$/.test(value); }
function isSignedBaseUnits(value: unknown): value is string { return typeof value === 'string' && /^(?:0|-?[1-9]\d*)$/.test(value); }
function formatBaseUnits(baseUnits: string, decimals: number): string {
  if (decimals === 0) return baseUnits;
  const padded = baseUnits.padStart(decimals + 1, '0');
  const split = padded.length - decimals;
  const whole = padded.slice(0, split);
  const fraction = padded.slice(split).replace(/0+$/, '');
  return fraction === '' ? whole : `${whole}.${fraction}`;
}

const MAX_QUANTITY_LENGTH = 24;
const MAX_INSTRUMENT_FIELD_LENGTH = 160;
const PROVIDER_ID_VALUE_PATTERN = /^[a-z][a-z0-9._-]{0,63}$/;
const HIDDEN_ASSET_ID_PATTERN = /^(?:asset|instrument):[A-Za-z0-9._:-]{1,220}$/;
const INSTRUMENT_SYMBOL_PATTERN = /^[A-Za-z0-9._:/-]{1,80}$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const QUANTITY_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/;

export function quantityToHundredths(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_QUANTITY_LENGTH || !QUANTITY_PATTERN.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  const raw = `${whole}${fraction.padEnd(2, '0')}`.replace(/^0+(?=\d)/, '');
  if (raw === '0') return null;
  return raw;
}

function canonicalHundredths(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_QUANTITY_LENGTH + 2 || !/^[1-9]\d*$/.test(value)) return null;
  return value;
}

export function hundredthsToQuantity(value: string): string {
  const whole = value.slice(0, -2) || '0';
  const fraction = value.slice(-2).replace(/0+$/, '');
  return fraction === '' ? whole : `${whole}.${fraction}`;
}

function validText(value: unknown, max = MAX_INSTRUMENT_FIELD_LENGTH): value is string {
  return typeof value === 'string' && value.trim() !== '' && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
}

function parseInstrumentInput(value: unknown): InstrumentInput | null {
  if (!isRecord(value) || containsSecret(value) || !validText(value.providerId, 64) || !PROVIDER_ID_VALUE_PATTERN.test(value.providerId) || !validText(value.providerSymbol, 120) || !validText(value.symbol, 80) || !INSTRUMENT_SYMBOL_PATTERN.test(value.symbol) || !validText(value.name) || !validText(value.exchange, 80) || !CURRENCY_PATTERN.test(typeof value.currency === 'string' ? value.currency : '') || (value.type !== 'stock' && value.type !== 'etf')) return null;
  return { providerId: value.providerId.trim(), providerSymbol: value.providerSymbol.trim(), symbol: value.symbol.trim(), name: value.name.trim(), exchange: value.exchange.trim(), currency: (value.currency as string).trim(), type: value.type };
}

function parseInstrument(value: unknown): Instrument | null {
  if (!isRecord(value)) return null;
  const input = parseInstrumentInput(value);
  if (!input) return null;
  const id = typeof value.id === 'string' && value.id.trim() !== '' ? value.id.trim() : null;
  if (!id) return null;
  return { schemaVersion: 4, id, ...input };
}

function parseHolding(value: unknown, instruments: readonly Instrument[]): Holding | null {
  if (!isRecord(value) || containsSecret(value)) return null;
  const id = typeof value.id === 'string' && value.id.trim() !== '' ? value.id.trim() : null;
  const instrumentId = typeof value.instrumentId === 'string' && value.instrumentId.trim() !== '' ? value.instrumentId.trim() : null;
  const parsedHundredths = value.quantityHundredths === undefined ? null : canonicalHundredths(value.quantityHundredths);
  const parsedQuantity = value.quantity === undefined ? null : quantityToHundredths(value.quantity);
  if (value.quantityHundredths !== undefined && parsedHundredths === null) return null;
  if (value.quantity !== undefined && parsedQuantity === null) return null;
  if (parsedHundredths !== null && parsedQuantity !== null && parsedHundredths !== parsedQuantity) return null;
  const quantityHundredths = parsedHundredths ?? parsedQuantity;
  const updatedAt = isTimestamp(value.updatedAt) ? value.updatedAt : null;
  if (!id || instrumentId === null || quantityHundredths === null || updatedAt === null || !instruments.some(instrument => instrument.id === instrumentId)) return null;
  return { schemaVersion: 4, id, instrumentId, quantityHundredths, quantity: hundredthsToQuantity(quantityHundredths), updatedAt };
}
function decimalToBaseUnits(value: unknown, decimals: number): string | null {
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > decimals) return null;
  const raw = `${whole}${fraction.padEnd(decimals, '0')}`.replace(/^0+(?=\d)/, '');
  return raw;
}
function isSecretKey(key: string): boolean { return /(?:private|secret|seed|mnemonic|passphrase|credential|token|api[_-]?key|access[_-]?key|authorization)/i.test(key); }
function containsSecret(value: unknown, seen = new Set<object>()): boolean {
  if (typeof value !== 'object' || value === null) return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.some(item => containsSecret(item, seen));
  return Object.entries(value).some(([key, item]) => isSecretKey(key) || containsSecret(item, seen));
}

const PROVIDER_ID_PATTERN = /^[a-z][a-z0-9._-]{0,63}$/;
const PROVIDER_REF_VALUE_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
export const PROVIDER_REF_PREFIX = 'ref_';

function isProviderReference(providerId: string, keyId: string): boolean {
  return PROVIDER_ID_PATTERN.test(providerId) && keyId.startsWith(`${PROVIDER_REF_PREFIX}${providerId}_`) && PROVIDER_REF_VALUE_PATTERN.test(keyId.slice(`${PROVIDER_REF_PREFIX}${providerId}_`.length));
}

export function createProviderReference(providerId: string, ids: IdFactory, enabled = true): ProviderReference | null {
  if (!PROVIDER_ID_PATTERN.test(providerId) || typeof enabled !== 'boolean' || ids === undefined || typeof ids.next !== 'function') return null;
  const value = ids.next();
  if (typeof value !== 'string' || !PROVIDER_REF_VALUE_PATTERN.test(value)) return null;
  return { providerId, keyId: `${PROVIDER_REF_PREFIX}${providerId}_${value}`, enabled };
}

function parseCustomChain(value: unknown): CustomChain | null {
  if (!isRecord(value) || !isPositiveInteger(value.chainId) || typeof value.name !== 'string' || value.name.trim() === '' || typeof value.nativeAsset !== 'string' || value.nativeAsset.trim() === '' || typeof value.rpcUrl !== 'string' || typeof value.explorerBaseUrl !== 'string') return null;
  const result = validateCustomChain({ chainId: value.chainId, name: value.name, nativeAsset: value.nativeAsset, nativeDecimals: value.nativeDecimals === undefined ? DEFAULT_NATIVE_DECIMALS : value.nativeDecimals, rpcUrl: value.rpcUrl, explorerBaseUrl: value.explorerBaseUrl });
  return result.ok ? { chainId: result.value.chainId, name: result.value.name, nativeAsset: result.value.nativeAsset, nativeDecimals: result.value.nativeDecimals, rpcUrl: value.rpcUrl, explorerBaseUrl: value.explorerBaseUrl } : null;
}

function parseProviderReference(value: unknown): ProviderReference | null {
  if (!isRecord(value) || typeof value.providerId !== 'string' || !PROVIDER_ID_PATTERN.test(value.providerId) || (value.keyId !== null && (typeof value.keyId !== 'string' || !isProviderReference(value.providerId, value.keyId))) || typeof value.enabled !== 'boolean') return null;
  return { providerId: value.providerId, keyId: value.keyId as string | null, enabled: value.enabled };
}

function parseRpcOverride(value: unknown): ChainRpcOverride | null {
  if (!isRecord(value)) return null;
  if (!isPositiveInteger(value.chainId)) return null;
  if (typeof value.rpcUrl !== 'string') return null;
  if (validateEndpointUrl(value.rpcUrl, false) !== null) return null;
  return { chainId: value.chainId, rpcUrl: value.rpcUrl };
}

function parseProviderEndpoint(value: unknown): ProviderEndpoint | null {
  if (!isRecord(value) || typeof value.providerId !== 'string' || !PROVIDER_ID_PATTERN.test(value.providerId) || typeof value.endpoint !== 'string' || validateEndpointUrl(value.endpoint, false) !== null || typeof value.enabled !== 'boolean') return null;
  return { providerId: value.providerId, endpoint: value.endpoint, enabled: value.enabled };
}

function parseSettings(value: unknown, version: 1 | 2 | 3 | 4 | 5): Settings {
  const input = isRecord(value) ? value : {};
  const customChains = Array.isArray(input.customChains) ? input.customChains.map(parseCustomChain).filter((chain): chain is CustomChain => chain !== null) : [];
  const chainIds = Array.isArray(input.enabledChainIds) ? input.enabledChainIds.filter(isPositiveInteger) : [];
  const rpcOverrides = Array.isArray(input.rpcOverrides) ? input.rpcOverrides.map(parseRpcOverride).filter((override): override is ChainRpcOverride => override !== null) : [];
  const providerRefs = Array.isArray(input.providerRefs) ? input.providerRefs.map(parseProviderReference).filter((ref): ref is ProviderReference => ref !== null) : [];
  const providerEndpoints = Array.isArray(input.providerEndpoints) ? input.providerEndpoints.map(parseProviderEndpoint).filter((endpoint): endpoint is ProviderEndpoint => endpoint !== null) : [];
  const enabledProviderIds = Array.isArray(input.enabledProviderIds) ? input.enabledProviderIds.filter((id): id is string => typeof id === 'string' && PROVIDER_ID_PATTERN.test(id)) : [];
  return {
    schemaVersion: 5,
    currency: isCurrency(input.currency) ? input.currency : DEFAULT_SETTINGS.currency,
    locale: isLocale(input.locale) ? input.locale : DEFAULT_SETTINGS.locale,
    theme: isTheme(input.theme) ? input.theme : DEFAULT_SETTINGS.theme,
    schedulerEnabled: typeof input.schedulerEnabled === 'boolean' ? input.schedulerEnabled : DEFAULT_SETTINGS.schedulerEnabled,
    spamFilterEnabled: version >= 2 && typeof input.spamFilterEnabled === 'boolean' ? input.spamFilterEnabled : DEFAULT_SETTINGS.spamFilterEnabled,
    showHiddenSpamAssets: version >= 2 && typeof input.showHiddenSpamAssets === 'boolean' ? input.showHiddenSpamAssets : DEFAULT_SETTINGS.showHiddenSpamAssets,
    enabledChainIds: [...new Set(chainIds)],
    customChains: [...new Map(customChains.map(chain => [chain.chainId, chain])).values()],
    rpcOverrides: [...new Map(rpcOverrides.map(override => [override.chainId, override])).values()],
    providerRefs: [...new Map(providerRefs.map(ref => [ref.providerId, ref])).values()],
    providerEndpoints: [...new Map(providerEndpoints.map(endpoint => [endpoint.providerId, endpoint])).values()],
    enabledProviderIds: [...new Set(enabledProviderIds)],
    hiddenAssetIds: [...new Set(Array.isArray(input.hiddenAssetIds) ? input.hiddenAssetIds.filter((id): id is string => typeof id === 'string' && HIDDEN_ASSET_ID_PATTERN.test(id)) : [])]
  };
}

function parseOptions(family: WalletFamily, value: unknown, detectedNetwork?: string, detectedKind?: string): WalletSource['options'] {
  const input = isRecord(value) ? value : {};
  if (family === 'evm') {
    const chainIds = Array.isArray(input.chainIds) ? input.chainIds.filter(isPositiveInteger) : [];
    return { autoScanCommonChains: typeof input.autoScanCommonChains === 'boolean' ? input.autoScanCommonChains : true, chainIds: [...new Set(chainIds)] };
  }
  if (family === 'bitcoin') {
    const detectedBitcoinNetwork: BitcoinNetwork = detectedNetwork === 'testnet' ? 'testnet' : 'mainnet';
    const network = isNetwork(input.network) ? input.network : detectedBitcoinNetwork;
    const allowed: readonly BitcoinAddressType[] = ['address', 'xpub', 'ypub', 'zpub', 'tpub', 'upub', 'vpub'];
    const addressType = allowed.includes(input.addressType as BitcoinAddressType) ? input.addressType as BitcoinAddressType : 'address';
    return { network, addressType };
  }
  if (family === 'solana') {
    return { network: 'mainnet-beta' };
  }
  return { network: input.network === 'testnet' ? 'testnet' : detectedNetwork === 'testnet' ? 'testnet' : 'mainnet', kind: detectedKind === 'stake' ? 'stake' : 'payment' };
}

function hasUsableEvmSelection(options: EvmWalletOptions): boolean {
  return options.autoScanCommonChains || options.chainIds.length > 0;
}

function parseWallet(value: unknown, migratedId?: string): WalletSource | null {
  if (!isRecord(value) || containsSecret(value) || !isFamily(value.family) || typeof value.address !== 'string' || typeof value.label !== 'string' || value.label.trim() === '') return null;
  const rawOptions = isRecord(value.options) ? value.options : {};
  const explicitNetwork = value.family === 'bitcoin' || value.family === 'cardano' ? rawOptions.network !== undefined : false;
  if (explicitNetwork && !isNetwork(rawOptions.network)) return null;
  const addressOptions = value.family === 'bitcoin' || value.family === 'cardano' ? { network: explicitNetwork ? rawOptions.network as BitcoinNetwork : undefined, addressType: value.family === 'bitcoin' ? rawOptions.addressType as string : undefined } : {};
  const detection = validateAddressForFamily(value.address, value.family, addressOptions);
  if (!detection.ok) return null;
  const id = typeof value.id === 'string' && value.id.trim() !== '' ? value.id.trim() : migratedId;
  const createdAt = isTimestamp(value.createdAt) ? value.createdAt : migratedId ? 0 : null;
  if (!id || createdAt === null) return null;
  const options = parseOptions(value.family, value.options, detection.network, detection.kind);
  if (value.family === 'evm' && !hasUsableEvmSelection(options as EvmWalletOptions)) return null;
  return { schemaVersion: 3, id, label: value.label.trim(), family: value.family, address: detection.normalized, enabled: typeof value.enabled === 'boolean' ? value.enabled : true, createdAt, options } as WalletSource;
}

function parsePosition(value: unknown): Position | null {
  if (!isRecord(value) || containsSecret(value) || typeof value.id !== 'string' || value.id.trim() === '' || typeof value.walletId !== 'string' || value.walletId.trim() === '' || !isFamily(value.family) || (value.family === 'evm' ? !isPositiveInteger(value.chainId) : value.chainId !== null) || (value.assetKind !== 'native' && value.assetKind !== 'fungible') || typeof value.assetId !== 'string' || value.assetId.trim() === '' || typeof value.symbol !== 'string' || value.symbol.trim() === '' || typeof value.decimals !== 'number' || !Number.isInteger(value.decimals) || value.decimals < 0 || value.decimals > 36 || !isTimestamp(value.updatedAt)) return null;
  const baseUnits = isBaseUnits(value.baseUnits) ? value.baseUnits : decimalToBaseUnits(value.quantity, value.decimals);
  if (baseUnits === null) return null;
  const confirmedBaseUnits = value.confirmedBaseUnits === undefined ? baseUnits : value.confirmedBaseUnits;
  const pendingBaseUnits = value.pendingBaseUnits === undefined ? '0' : value.pendingBaseUnits;
  if (!isBaseUnits(confirmedBaseUnits) || !isSignedBaseUnits(pendingBaseUnits)) return null;
  const total = BigInt(confirmedBaseUnits) + BigInt(pendingBaseUnits);
  if (total < 0n || total !== BigInt(baseUnits)) return null;
  const assetName = typeof value.assetName === 'string' && validText(value.assetName, 160) ? value.assetName.trim() : undefined;
  return { schemaVersion: 3, id: value.id.trim(), walletId: value.walletId.trim(), family: value.family, chainId: value.chainId as number | null, assetKind: value.assetKind, assetId: value.assetId.trim(), symbol: value.symbol.trim(), ...(assetName ? { assetName } : {}), baseUnits, quantity: formatBaseUnits(baseUnits, value.decimals), confirmedBaseUnits, pendingBaseUnits, decimals: value.decimals, updatedAt: value.updatedAt, spam: value.assetKind === 'native' ? null : parseSpam(value.spam) };
}

function parseSpam(value: unknown): SpamAssessment | null {
  if (!isRecord(value) || !Array.isArray(value.riskFlags) || !Array.isArray(value.reasons) || typeof value.hiddenByDefault !== 'boolean') return null;
  const flags = value.riskFlags.filter((flag): flag is SpamRiskFlag => typeof flag === 'string' && ['metadata-missing', 'suspicious-name', 'suspicious-url', 'invalid-decimals', 'implausible-quantity', 'unverified', 'airdrop-signal'].includes(flag));
  const reasons = value.reasons.filter((reason): reason is string => typeof reason === 'string');
  return { riskFlags: [...new Set(flags)], reasons, hiddenByDefault: value.hiddenByDefault };
}

function dedupeWallets(wallets: readonly WalletSource[]): WalletSource[] {
  const seen = new Set<string>();
  return wallets.filter(wallet => {
    const key = `${wallet.family}:${wallet.address.toLowerCase()}`;
    if (seen.has(key) || seen.has(`id:${wallet.id}`)) return false;
    seen.add(key); seen.add(`id:${wallet.id}`); return true;
  });
}

function dedupePositions(positions: readonly Position[]): Position[] {
  const seen = new Set<string>();
  return positions.filter(position => {
    const key = `${position.walletId}:${position.family}:${position.chainId ?? 'none'}:${position.assetKind}:${position.assetId}`;
    if (seen.has(position.id) || seen.has(key)) return false;
    seen.add(position.id); seen.add(key); return true;
  });
}

function dedupeInstruments(instruments: readonly Instrument[]): Instrument[] {
  const seen = new Set<string>();
  return instruments.filter(instrument => {
    const key = `${instrument.providerId}:${instrument.providerSymbol.toLowerCase()}:${instrument.exchange.toLowerCase()}`;
    if (seen.has(instrument.id) || seen.has(key)) return false;
    seen.add(instrument.id); seen.add(key); return true;
  });
}

function dedupeHoldings(holdings: readonly Holding[]): Holding[] {
  const seen = new Set<string>();
  return holdings.filter(holding => {
    if (seen.has(holding.id) || seen.has(holding.instrumentId)) return false;
    seen.add(holding.id); seen.add(holding.instrumentId); return true;
  });
}

const syncStatuses: readonly SyncStatusCode[] = ['ok', 'empty', 'partial', 'unsupported', 'unconfigured', 'rate-limited', 'error', 'aborted'];
function parseSync(value: unknown, wallets: readonly WalletSource[]): SyncState {
  if (!isRecord(value) || !Array.isArray(value.statuses)) return { schemaVersion: 1, statuses: [] };
  const families = new Map(wallets.map(wallet => [wallet.id, wallet.family]));
  const statuses = value.statuses.filter(isRecord).map(item => {
    const family = item.family;
    const status = item.status;
    if (typeof item.walletId !== 'string' || item.walletId.trim() === '' || typeof family !== 'string' || !isFamily(family) || families.get(item.walletId) !== family || typeof item.providerId !== 'string' || !PROVIDER_ID_PATTERN.test(item.providerId) || typeof status !== 'string' || !syncStatuses.includes(status as SyncStatusCode) || (item.lastAttemptAt !== null && !isTimestamp(item.lastAttemptAt)) || (item.lastSuccessAt !== null && !isTimestamp(item.lastSuccessAt)) || (item.errorCode !== null && typeof item.errorCode !== 'string')) return null;
    return { walletId: item.walletId, family, providerId: item.providerId, status: status as SyncStatusCode, lastAttemptAt: item.lastAttemptAt as number | null, lastSuccessAt: item.lastSuccessAt as number | null, errorCode: item.errorCode as string | null };
  }).filter((status): status is WalletSyncStatus => status !== null);
  const deduped = [...new Map(statuses.map(status => [`${status.walletId}:${status.providerId}`, status])).values()];
  return { schemaVersion: 1, statuses: deduped };
}

const priceStatuses: readonly PriceStatusCode[] = ['ok', 'unpriced', 'partial', 'rate-limited', 'error', 'aborted', 'stale'];
const MAX_SCALED_LENGTH = 48;
function scaledInteger(value: unknown, allowZero = false): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_SCALED_LENGTH) return null;
  if (!/^(?:0|[1-9]\d*)$/.test(value) || (!allowZero && value === '0')) return null;
  return value;
}
function signedScaledInteger(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_SCALED_LENGTH || !/^-?(?:0|[1-9]\d*)$/.test(value)) return null;
  return value;
}
function parsePriceQuote(value: unknown): PriceQuote | null {
  if (!isRecord(value) || typeof value.assetId !== 'string' || value.assetId.trim() === '' || value.scale !== PRICE_SCALE) return null;
  const priceEurScaled = scaledInteger(value.priceEurScaled);
  const priceUsdScaled = scaledInteger(value.priceUsdScaled);
  const change = value.change24hPercentScaled === null ? null : signedScaledInteger(value.change24hPercentScaled);
  const changeEur = value.change24hEurPercentScaled === undefined ? change : value.change24hEurPercentScaled === null ? null : signedScaledInteger(value.change24hEurPercentScaled);
  const changeUsd = value.change24hUsdPercentScaled === undefined ? change : value.change24hUsdPercentScaled === null ? null : signedScaledInteger(value.change24hUsdPercentScaled);
  const previousPriceEurScaled = value.previousPriceEurScaled === null ? null : scaledInteger(value.previousPriceEurScaled);
  const previousPriceUsdScaled = value.previousPriceUsdScaled === null ? null : scaledInteger(value.previousPriceUsdScaled);
  if (!priceEurScaled || !priceUsdScaled || (value.change24hPercentScaled !== null && change === null) || changeEur === null && value.change24hEurPercentScaled !== null && value.change24hEurPercentScaled !== undefined || changeUsd === null && value.change24hUsdPercentScaled !== null && value.change24hUsdPercentScaled !== undefined || (value.previousPriceEurScaled !== null && previousPriceEurScaled === null) || (value.previousPriceUsdScaled !== null && previousPriceUsdScaled === null) || typeof value.source !== 'string' || value.source.trim() === '' || (value.sourceTimestamp !== null && !isTimestamp(value.sourceTimestamp)) || !isTimestamp(value.fetchedAt)) return null;
  return { assetId: value.assetId.trim(), priceEurScaled, priceUsdScaled, scale: PRICE_SCALE, change24hPercentScaled: change, change24hEurPercentScaled: changeEur, change24hUsdPercentScaled: changeUsd, previousPriceEurScaled, previousPriceUsdScaled, source: value.source.trim(), sourceTimestamp: value.sourceTimestamp as number | null, fetchedAt: value.fetchedAt };
}
function parsePriceStatus(value: unknown): PriceStatus | null {
  if (!isRecord(value) || typeof value.assetId !== 'string' || value.assetId.trim() === '' || typeof value.providerId !== 'string' || !PROVIDER_ID_PATTERN.test(value.providerId) || typeof value.status !== 'string' || !priceStatuses.includes(value.status as PriceStatusCode) || (value.errorCode !== null && typeof value.errorCode !== 'string') || (value.lastGoodFetchedAt !== null && !isTimestamp(value.lastGoodFetchedAt))) return null;
  return { assetId: value.assetId.trim(), providerId: value.providerId, status: value.status as PriceStatusCode, errorCode: value.errorCode as string | null, lastGoodFetchedAt: value.lastGoodFetchedAt as number | null };
}
function parseValuation(value: unknown): Valuation | null {
  if (!isRecord(value) || typeof value.assetId !== 'string' || value.assetId.trim() === '' || !isBaseUnits(value.quantityBaseUnits) || typeof value.quantityDecimals !== 'number' || !Number.isSafeInteger(value.quantityDecimals) || value.quantityDecimals < 0 || value.quantityDecimals > 36 || !['valued', 'unpriced', 'partial'].includes(String(value.status))) return null;
  const optional = (item: unknown, signed = false): string | null => item === null ? null : signed ? signedScaledInteger(item) : scaledInteger(item, true);
  const priceEurScaled = optional(value.priceEurScaled); const priceUsdScaled = optional(value.priceUsdScaled);
  const valueEurScaled = optional(value.valueEurScaled); const valueUsdScaled = optional(value.valueUsdScaled);
  const dayChangeEurScaled = optional(value.dayChangeEurScaled, true); const dayChangeUsdScaled = optional(value.dayChangeUsdScaled, true); const dayChangePercentScaled = optional(value.dayChangePercentScaled, true);
  if (value.priceEurScaled !== null && priceEurScaled === null || value.priceUsdScaled !== null && priceUsdScaled === null || value.valueEurScaled !== null && valueEurScaled === null || value.valueUsdScaled !== null && valueUsdScaled === null || value.dayChangeEurScaled !== null && dayChangeEurScaled === null || value.dayChangeUsdScaled !== null && dayChangeUsdScaled === null || value.dayChangePercentScaled !== null && dayChangePercentScaled === null) return null;
  return { assetId: value.assetId.trim(), quantityBaseUnits: value.quantityBaseUnits, quantityDecimals: value.quantityDecimals, priceEurScaled, priceUsdScaled, valueEurScaled, valueUsdScaled, dayChangeEurScaled, dayChangeUsdScaled, dayChangePercentScaled, status: value.status as Valuation['status'] };
}
function parseHistoryPoint(value: unknown): HistoryPoint | null {
  if (!isRecord(value) || !isTimestamp(value.timestamp) || !['complete', 'partial'].includes(String(value.coverage))) return null;
  const eur = scaledInteger(value.valueEurScaled, true); const usd = scaledInteger(value.valueUsdScaled, true);
  return eur && usd ? { timestamp: value.timestamp, valueEurScaled: eur, valueUsdScaled: usd, coverage: value.coverage as HistoryCoverage } : null;
}
function parsePrices(value: unknown): PriceState {
  const empty: PriceState = { quotes: [], statuses: [], valuations: [], history: [], totalEurScaled: null, totalUsdScaled: null, complete: false, valuedAssets: 0, totalAssets: 0, dayChangeEurScaled: null, dayChangeUsdScaled: null, dayChangePercentScaled: null };
  if (!isRecord(value)) return empty;
  const quotes = Array.isArray(value.quotes) ? value.quotes.map(parsePriceQuote).filter((item): item is PriceQuote => item !== null) : [];
  const statuses = Array.isArray(value.statuses) ? value.statuses.map(parsePriceStatus).filter((item): item is PriceStatus => item !== null) : [];
  const valuations = Array.isArray(value.valuations) ? value.valuations.map(parseValuation).filter((item): item is Valuation => item !== null) : [];
  const history = Array.isArray(value.history) ? value.history.map(item => {
    if (!isRecord(item) || typeof item.id !== 'string' || item.id.trim() === '' || (item.kind !== 'asset-price' && item.kind !== 'portfolio-value') || !Array.isArray(item.points)) return null;
    const points = item.points.map(parseHistoryPoint).filter((point): point is HistoryPoint => point !== null).sort((a, b) => a.timestamp - b.timestamp);
    return { id: item.id.trim(), kind: item.kind, points: [...new Map(points.map(point => [point.timestamp, point])).values()] } as HistorySeries;
  }).filter((item): item is HistorySeries => item !== null) : [];
  const totalEurScaled = value.totalEurScaled === null ? null : scaledInteger(value.totalEurScaled, true); const totalUsdScaled = value.totalUsdScaled === null ? null : scaledInteger(value.totalUsdScaled, true);
  const dayChangeEurScaled = value.dayChangeEurScaled === null ? null : signedScaledInteger(value.dayChangeEurScaled); const dayChangeUsdScaled = value.dayChangeUsdScaled === null ? null : signedScaledInteger(value.dayChangeUsdScaled); const dayChangePercentScaled = value.dayChangePercentScaled === null ? null : signedScaledInteger(value.dayChangePercentScaled);
  return {
    quotes: [...new Map(quotes.map(item => [item.assetId, item])).values()],
    statuses: [...new Map(statuses.map(item => [item.assetId, item])).values()],
    valuations: [...new Map(valuations.map(item => [item.assetId, item])).values()],
    history: [...new Map(history.map(item => [item.id, item])).values()],
    totalEurScaled, totalUsdScaled, complete: value.complete === true, valuedAssets: typeof value.valuedAssets === 'number' && Number.isSafeInteger(value.valuedAssets) && value.valuedAssets >= 0 ? value.valuedAssets : 0, totalAssets: typeof value.totalAssets === 'number' && Number.isSafeInteger(value.totalAssets) && value.totalAssets >= 0 ? value.totalAssets : 0, dayChangeEurScaled, dayChangeUsdScaled, dayChangePercentScaled
  };
}

export function parsePortfolioState(value: unknown): PortfolioState {
  if (!isRecord(value)) return createEmptyPortfolioState();
  const version = value.schemaVersion === 5 ? 5 : value.schemaVersion === 4 ? 4 : value.schemaVersion === 3 ? 3 : value.schemaVersion === 2 ? 2 : value.schemaVersion === 1 ? 1 : 0;
  if (version === 0) return createEmptyPortfolioState();
  const rawWallets = Array.isArray(value.wallets) ? value.wallets : [];
  const wallets = rawWallets.map((wallet, index) => parseWallet(wallet, version === 1 ? `migrated-wallet-${index + 1}` : undefined)).filter((wallet): wallet is WalletSource => wallet !== null);
  const rawPositions = version >= 2 && Array.isArray(value.positions) ? value.positions : [];
  const normalizedWallets = dedupeWallets(wallets);
  const positions = rawPositions.map(parsePosition).filter((position): position is Position => position !== null).filter(position => {
    const wallet = normalizedWallets.find(item => item.id === position.walletId);
    if (!wallet || wallet.family !== position.family) return false;
    if (position.family === 'evm') return position.chainId !== null && Number.isSafeInteger(position.chainId) && position.chainId > 0;
    return position.chainId === null;
  });
  const rawInstruments = version >= 4 && Array.isArray(value.instruments) ? value.instruments : [];
  const instruments = dedupeInstruments(rawInstruments.map(parseInstrument).filter((instrument): instrument is Instrument => instrument !== null));
  const rawHoldings = version >= 4 && Array.isArray(value.holdings) ? value.holdings : [];
  const holdings = dedupeHoldings(rawHoldings.map(holding => parseHolding(holding, instruments)).filter((holding): holding is Holding => holding !== null));
  const settingsVersion = version === 1 ? 1 : version === 2 ? 2 : version === 3 ? 3 : version === 4 ? 4 : 5;
  return { schemaVersion: CURRENT_SCHEMA_VERSION, settings: parseSettings(value.settings, settingsVersion), wallets: normalizedWallets, positions: dedupePositions(positions), instruments, holdings, sync: parseSync(value.sync, normalizedWallets), prices: version >= 5 ? parsePrices(value.prices) : createEmptyPortfolioState().prices };
}

export function updateSettings(state: PortfolioState, patch: Partial<Omit<Settings, 'schemaVersion'>>): PortfolioState {
  const current = parsePortfolioState(state);
  return parsePortfolioState({ ...current, settings: { ...current.settings, ...patch, schemaVersion: CURRENT_SCHEMA_VERSION } });
}

function secretInput(input: Record<string, unknown>): boolean { return containsSecret(input); }
function prunePriceState(state: PortfolioState, removed: readonly string[]): PriceState {
  if (removed.length === 0) return state.prices;
  const matches = (assetId: string): boolean => removed.includes(assetId);
  return { ...state.prices, quotes: state.prices.quotes.filter(item => !matches(item.assetId)), statuses: state.prices.statuses.filter(item => !matches(item.assetId)), valuations: state.prices.valuations.filter(item => !matches(item.assetId)), history: state.prices.history.filter(item => item.id === 'portfolio' || !matches(item.id)), totalEurScaled: null, totalUsdScaled: null, complete: false, valuedAssets: 0, totalAssets: 0, dayChangeEurScaled: null, dayChangeUsdScaled: null, dayChangePercentScaled: null };
}
function canonicalPositionAsset(wallet: WalletSource | undefined, position: Position): string {
  const network = wallet && 'network' in wallet.options ? wallet.options.network : 'mainnet';
  if (position.family === 'evm') return `asset:evm:${position.chainId}:${position.assetKind}:${position.assetId.toLowerCase()}`;
  return `asset:${position.family}:${network}:${position.assetKind}:${position.assetId}`;
}
function assetsNoLongerHeld(positions: readonly Position[], wallets: readonly WalletSource[], removedWalletId?: string): string[] {
  const remaining = new Set(positions.filter(position => position.walletId !== removedWalletId).map(position => canonicalPositionAsset(wallets.find(wallet => wallet.id === position.walletId), position)));
  return positions.filter(position => position.walletId === removedWalletId).map(position => canonicalPositionAsset(wallets.find(wallet => wallet.id === position.walletId), position)).filter(assetId => !remaining.has(assetId));
}

function validateWalletInput(input: WalletInput, existing: readonly WalletSource[], idFactory?: IdFactory, clock?: Clock): WalletResult<WalletSource> {
  const raw = input as Record<string, unknown>;
  if (secretInput(raw)) return { ok: false, code: 'secret-input', message: 'Secret material is not accepted.' };
  if (!isFamily(input.family) || typeof input.address !== 'string') return { ok: false, code: 'invalid-input', message: 'Wallet family and address are required.' };
  if (typeof input.label !== 'string' || input.label.trim() === '') return { ok: false, code: 'invalid-label', message: 'Wallet label must not be empty.' };
  if (input.enabled !== undefined && typeof input.enabled !== 'boolean') return { ok: false, code: 'invalid-input', message: 'Wallet enabled state is invalid.' };
  if (input.createdAt !== undefined && !isTimestamp(input.createdAt)) return { ok: false, code: 'invalid-input', message: 'Wallet timestamp is invalid.' };
  const requestedOptions = (input.family === 'bitcoin' || input.family === 'cardano') && isRecord(input.options) ? input.options as Partial<BitcoinWalletOptions> & { readonly network?: BitcoinNetwork } : {};
  const explicitNetwork = requestedOptions.network !== undefined;
  if (explicitNetwork && !isNetwork(requestedOptions.network)) return { ok: false, code: 'invalid-address', message: 'Wallet network is invalid.' };
  let detection: AddressDetection;
  if (explicitNetwork) detection = validateAddressForFamily(input.address, input.family, requestedOptions);
  else if (input.family !== 'bitcoin') detection = detectAddress(input.address);
  else if (requestedOptions.addressType === undefined || requestedOptions.addressType === 'address') detection = detectAddress(input.address);
  else detection = validateAddressForFamily(input.address, input.family, requestedOptions);
  if (!detection.ok) {
    const errorCodes: Record<AddressErrorCode, WalletErrorCode> = { invalid: 'invalid-address', ambiguous: 'ambiguous-address' };
    return { ok: false, code: errorCodes[detection.code], message: detection.message, details: detection };
  }
  if (detection.family !== input.family) return { ok: false, code: 'invalid-address', message: 'Address family does not match the selected family.', details: detection };
  const options = parseOptions(input.family, input.options, detection.network, detection.kind);
  if (input.family === 'evm' && !hasUsableEvmSelection(options as EvmWalletOptions)) return { ok: false, code: 'invalid-input', message: 'Select at least one EVM chain or enable common chains.' };
  const id = typeof input.id === 'string' && input.id.trim() !== '' ? input.id.trim() : idFactory?.next() ?? '';
  if (typeof id !== 'string' || id.trim() === '') return { ok: false, code: 'invalid-input', message: 'Wallet id must not be empty.' };
  const address = detection.normalized;
  if (existing.some(wallet => wallet.id === id || (wallet.family === input.family && wallet.address.toLowerCase() === address.toLowerCase()))) return { ok: false, code: 'duplicate-wallet', message: 'A wallet with this id or address already exists.' };
  const createdAt = input.createdAt ?? clock?.now() ?? -1;
  if (!isTimestamp(createdAt)) return { ok: false, code: 'invalid-input', message: 'Wallet timestamp is invalid.' };
  return { ok: true, value: { schemaVersion: 3, id, label: input.label.trim(), family: input.family, address, enabled: input.enabled ?? true, createdAt, options } as WalletSource };
}

export function addWallet(state: PortfolioState, input: WalletInput, deps: { readonly ids: IdFactory; readonly clock: Clock }): WalletResult<PortfolioState> {
  const current = parsePortfolioState(state);
  const result = validateWalletInput(input, current.wallets, deps.ids, deps.clock);
  if (!result.ok) return result;
  return { ok: true, value: { ...current, wallets: [...current.wallets, result.value] } };
}

export function updateWallet(state: PortfolioState, id: string, input: Partial<WalletInput>): WalletResult<PortfolioState> {
  const current = parsePortfolioState(state);
  const existing = current.wallets.find(wallet => wallet.id === id);
  if (!existing) return { ok: false, code: 'not-found', message: 'Wallet was not found.' };
  const candidate = { ...existing, ...input, id, createdAt: existing.createdAt } as WalletInput;
  const others = current.wallets.filter(wallet => wallet.id !== id);
  const result = validateWalletInput(candidate, others);
  if (!result.ok) return result;
  const changedScanIdentity = existing.family !== result.value.family || existing.address !== result.value.address || JSON.stringify(existing.options) !== JSON.stringify(result.value.options);
  const removed = changedScanIdentity ? assetsNoLongerHeld(current.positions, current.wallets, id) : [];
  return { ok: true, value: { ...current, wallets: current.wallets.map(wallet => wallet.id === id ? result.value : wallet), positions: changedScanIdentity ? current.positions.filter(position => position.walletId !== id) : current.positions, sync: changedScanIdentity ? { schemaVersion: 1, statuses: current.sync.statuses.filter(status => status.walletId !== id) } : current.sync, prices: prunePriceState(current, removed) } };
}

export function deleteWallet(state: PortfolioState, id: string): WalletResult<PortfolioState> {
  const current = parsePortfolioState(state);
  if (!current.wallets.some(wallet => wallet.id === id)) return { ok: false, code: 'not-found', message: 'Wallet was not found.' };
  const removed = assetsNoLongerHeld(current.positions, current.wallets, id);
  return { ok: true, value: { ...current, wallets: current.wallets.filter(wallet => wallet.id !== id), positions: current.positions.filter(position => position.walletId !== id), sync: { schemaVersion: 1, statuses: current.sync.statuses.filter(status => status.walletId !== id) }, prices: prunePriceState(current, removed) } };
}

function instrumentKey(input: InstrumentInput): string {
  return `${input.providerId}:${input.providerSymbol.toLowerCase()}:${input.exchange.toLowerCase()}`;
}

function validateHoldingQuantity(value: unknown): string | null {
  return quantityToHundredths(value);
}

function pruneUnusedInstruments(state: PortfolioState): PortfolioState {
  const used = new Set(state.holdings.map(holding => holding.instrumentId));
  return { ...state, instruments: state.instruments.filter(instrument => used.has(instrument.id)) };
}

export function addHolding(state: PortfolioState, input: HoldingInput, deps: { readonly ids: IdFactory; readonly clock: Clock }): HoldingResult<PortfolioState> {
  const current = parsePortfolioState(state);
  if (containsSecret(input)) return { ok: false, code: 'secret-input', message: 'Secret material is not accepted.' };
  const instrument = parseInstrumentInput(input?.instrument);
  if (!instrument) return { ok: false, code: 'invalid-instrument', message: 'Instrument metadata is invalid.' };
  const quantityHundredths = validateHoldingQuantity(input?.quantity);
  if (quantityHundredths === null) return { ok: false, code: 'invalid-quantity', message: 'Quantity must be positive with at most two decimals.' };
  const existingInstrument = current.instruments.find(item => instrumentKey(item) === instrumentKey(instrument));
  const instrumentValue: Instrument = existingInstrument ?? { schemaVersion: 4, id: deps.ids.next(), ...instrument };
  if (typeof instrumentValue.id !== 'string' || instrumentValue.id.trim() === '') return { ok: false, code: 'invalid-input', message: 'Instrument id is invalid.' };
  if (current.holdings.some(holding => holding.instrumentId === instrumentValue.id)) return { ok: false, code: 'duplicate-holding', message: 'This instrument is already held.' };
  const id = deps.ids.next();
  const updatedAt = deps.clock.now();
  if (typeof id !== 'string' || id.trim() === '' || !isTimestamp(updatedAt)) return { ok: false, code: 'invalid-input', message: 'Holding identity is invalid.' };
  const holding: Holding = { schemaVersion: 4, id, instrumentId: instrumentValue.id, quantityHundredths, quantity: hundredthsToQuantity(quantityHundredths), updatedAt };
  return { ok: true, value: { ...current, instruments: existingInstrument ? current.instruments : [...current.instruments, instrumentValue], holdings: [...current.holdings, holding] } };
}

export function updateHolding(state: PortfolioState, id: string, input: HoldingEditInput, deps: { readonly ids: IdFactory; readonly clock: Clock }): HoldingResult<PortfolioState> {
  const current = parsePortfolioState(state);
  const existingHolding = current.holdings.find(holding => holding.id === id);
  if (!existingHolding) return { ok: false, code: 'not-found', message: 'Holding was not found.' };
  if (containsSecret(input)) return { ok: false, code: 'secret-input', message: 'Secret material is not accepted.' };
  const quantityHundredths = input.quantity === undefined ? existingHolding.quantityHundredths : validateHoldingQuantity(input.quantity);
  if (quantityHundredths === null) return { ok: false, code: 'invalid-quantity', message: 'Quantity must be positive with at most two decimals.' };
  let instruments = [...current.instruments];
  let instrumentId = existingHolding.instrumentId;
  if (input.instrument !== undefined) {
    const nextInstrument = parseInstrumentInput(input.instrument);
    if (!nextInstrument) return { ok: false, code: 'invalid-instrument', message: 'Instrument metadata is invalid.' };
    const matching = instruments.find(item => instrumentKey(item) === instrumentKey(nextInstrument));
    if (matching) instrumentId = matching.id;
    else {
      const nextId = deps.ids.next();
      if (typeof nextId !== 'string' || nextId.trim() === '') return { ok: false, code: 'invalid-input', message: 'Instrument id is invalid.' };
      instrumentId = nextId;
      instruments = [...instruments, { schemaVersion: 4, id: nextId, ...nextInstrument }];
    }
    if (current.holdings.some(holding => holding.id !== id && holding.instrumentId === instrumentId)) return { ok: false, code: 'duplicate-holding', message: 'This instrument is already held.' };
  }
  const updatedAt = deps.clock.now();
  if (!isTimestamp(updatedAt)) return { ok: false, code: 'invalid-input', message: 'Holding timestamp is invalid.' };
  const holdings = current.holdings.map(holding => holding.id === id ? { ...holding, instrumentId, quantityHundredths, quantity: hundredthsToQuantity(quantityHundredths), updatedAt } : holding);
  const priceState = instrumentId === existingHolding.instrumentId ? current.prices : prunePriceState(current, [`instrument:${existingHolding.instrumentId}`]);
  return { ok: true, value: pruneUnusedInstruments({ ...current, instruments, holdings, prices: priceState }) };
}

export function deleteHolding(state: PortfolioState, id: string): HoldingResult<PortfolioState> {
  const current = parsePortfolioState(state);
  const existing = current.holdings.find(holding => holding.id === id);
  if (!existing) return { ok: false, code: 'not-found', message: 'Holding was not found.' };
  const instrumentId = existing.instrumentId;
  return { ok: true, value: pruneUnusedInstruments({ ...current, holdings: current.holdings.filter(holding => holding.id !== id), prices: prunePriceState(current, [`instrument:${instrumentId}`]) }) };
}
