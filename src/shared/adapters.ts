import type { HttpJsonPort, HttpRequest } from './transport.ts';
import { TransportError } from './transport.ts';
import { validateBitcoinAddress } from './addresses.ts';
import type { CardanoWalletSource, EvmWalletSource, Position, SolanaWalletSource, WalletSource, BitcoinWalletSource, Settings } from './state.ts';
import type { EvmChain } from './chains.ts';
import { formatUnits, scanEvmNativeBalances, type JsonRpcPort, type ScanCoordinator } from './scanner.ts';
import type { SecretStore } from './secrets.ts';

export type AdapterStatus = 'ok' | 'empty' | 'partial' | 'unsupported' | 'unconfigured' | 'rate-limited' | 'error' | 'aborted';
export type AdapterCapability = 'native-complete' | 'known-tokens' | 'token-discovery-unavailable';

export interface PositionDraft {
  readonly family: WalletSource['family'];
  readonly chainId: number | null;
  readonly assetKind: 'native' | 'fungible';
  readonly assetId: string;
  readonly symbol: string;
  readonly baseUnits: string;
  readonly confirmedBaseUnits?: string;
  readonly pendingBaseUnits?: string;
  readonly decimals: number;
  readonly spam?: Position['spam'];
}

export interface AdapterScanResult {
  readonly family: WalletSource['family'];
  readonly providerId: string;
  readonly status: AdapterStatus;
  readonly capability: AdapterCapability;
  readonly positions: readonly PositionDraft[];
  readonly errorCode: string | null;
}

export interface AdapterContext {
  readonly now: number;
  readonly signal?: AbortSignal;
  readonly http?: HttpJsonPort;
  readonly rpc?: JsonRpcPort;
  readonly secrets?: SecretStore;
  readonly settings?: Pick<Settings, 'enabledChainIds'>;
}

export interface WalletAdapter {
  readonly family: WalletSource['family'];
  readonly providerId: string;
  scan(wallet: WalletSource, context: AdapterContext): Promise<AdapterScanResult>;
}

export interface EvmAdapterOptions {
  readonly chains: readonly EvmChain[];
  readonly rpc?: JsonRpcPort;
  readonly etherscanRateLimiter?: EtherscanRateLimiter;
  readonly erc20?: {
    readonly endpoint?: string;
    readonly keyId?: string | null;
    readonly apiKeyProviderId?: string;
    readonly freeFallback?: boolean;
    readonly maxPages?: number;
    readonly maxContracts?: number;
    readonly rateLimit?: EtherscanRateLimitOptions;
  };
  readonly scanCoordinator?: ScanCoordinator;
  readonly concurrency?: number;
}

export interface EtherscanRateLimitOptions {
  readonly maxPerSecond?: number;
  readonly maxPerDay?: number;
  readonly now?: () => number;
  readonly wait?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}

interface EtherscanRateLimiter {
  take(signal?: AbortSignal): Promise<void>;
}

function result(family: WalletSource['family'], providerId: string, status: AdapterStatus, capability: AdapterCapability, positions: readonly PositionDraft[] = [], errorCode: string | null = null): AdapterScanResult {
  return { family, providerId, status, capability, positions, errorCode };
}

function transportCode(error: unknown): string {
  if (error instanceof TransportError) return error.code === 'aborted' ? 'aborted' : error.code === 'timeout' ? 'timeout' : error.code === 'http' && error.status === 429 ? 'rate-limited' : error.code;
  return 'network';
}

function statusFor(errorCode: string): AdapterStatus {
  if (errorCode === 'aborted') return 'aborted';
  if (errorCode === 'rate-limited') return 'rate-limited';
  return 'error';
}

function isExactInteger(value: unknown): value is string { return typeof value === 'string' && /^(?:0|[1-9]\d*)$/.test(value); }
function isDecimal(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 36; }
function asBigInt(value: unknown): bigint | null {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : null;
  return isExactInteger(value) ? BigInt(value) : null;
}
function asDecimal(value: unknown): number | null {
  if (isDecimal(value)) return value;
  if (typeof value === 'string' && /^(?:0|[1-9]\d*)$/.test(value)) {
    const parsed = Number(value);
    return isDecimal(parsed) ? parsed : null;
  }
  return null;
}

function nativeDraft(family: WalletSource['family'], chainId: number | null, assetId: string, symbol: string, baseUnits: string, decimals: number, confirmedBaseUnits = baseUnits, pendingBaseUnits = '0'): PositionDraft {
  return { family, chainId, assetKind: 'native', assetId, symbol, baseUnits, confirmedBaseUnits, pendingBaseUnits, decimals, spam: null };
}

function fungibleDraft(family: WalletSource['family'], chainId: number | null, assetId: string, symbol: string, baseUnits: string, decimals: number): PositionDraft {
  return { family, chainId, assetKind: 'fungible', assetId, symbol, baseUnits, decimals };
}

function parseErc20Rows(value: unknown, chainId: number): { readonly positions: readonly PositionDraft[]; readonly malformed: boolean } {
  if (!Array.isArray(value)) return { positions: [], malformed: true };
  const balances = new Map<string, { symbol: string; decimals: number; units: bigint }>();
  let malformed = false;
  for (const row of value) {
    if (typeof row !== 'object' || row === null || Array.isArray(row)) { malformed = true; continue; }
    const item = row as Record<string, unknown>;
    const address = typeof item.TokenAddress === 'string' ? item.TokenAddress : '';
    const symbol = typeof item.TokenSymbol === 'string' ? item.TokenSymbol.trim() : '';
    const decimals = asDecimal(item.TokenDivisor);
    const quantity = asBigInt(item.TokenQuantity);
    if (!/^0x[0-9a-fA-F]{40}$/.test(address) || symbol === '' || decimals === null || quantity === null) { malformed = true; continue; }
    const key = address.toLowerCase();
    const prior = balances.get(key);
    balances.set(key, { symbol, decimals, units: (prior?.units ?? 0n) + quantity });
  }
  return { positions: [...balances.entries()].filter(([, item]) => item.units > 0n).map(([assetId, item]) => fungibleDraft('evm', chainId, assetId, item.symbol, item.units.toString(), item.decimals)), malformed };
}

function selectedEvmChains(wallet: EvmWalletSource, chains: readonly EvmChain[], settings?: Pick<Settings, 'enabledChainIds'>): readonly EvmChain[] {
  return chains.filter(chain => (settings === undefined || settings.enabledChainIds.length === 0 || settings.enabledChainIds.includes(chain.chainId)) && (wallet.options.chainIds.includes(chain.chainId) || (wallet.options.autoScanCommonChains && chain.builtin)));
}

function pageUrl(endpoint: string, chainId: number, address: string, page: number, offset: number): string {
  const url = new URL(endpoint);
  url.searchParams.set('chainid', String(chainId));
  url.searchParams.set('module', 'account');
  url.searchParams.set('action', 'addresstokenbalance');
  url.searchParams.set('address', address);
  url.searchParams.set('page', String(page));
  url.searchParams.set('offset', String(offset));
  return url.toString();
}

export function createEtherscanRateLimiter(options: EtherscanRateLimitOptions = {}): EtherscanRateLimiter {
  const perSecond = Number.isSafeInteger(options.maxPerSecond) && options.maxPerSecond! > 0 && options.maxPerSecond! <= 100 ? options.maxPerSecond! : 3;
  const perDay = Number.isSafeInteger(options.maxPerDay) && options.maxPerDay! > 0 && options.maxPerDay! <= 100_000 ? options.maxPerDay! : 100_000;
  const now = options.now ?? Date.now;
  const wait = options.wait ?? (async (milliseconds: number, signal?: AbortSignal) => {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, milliseconds);
      signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new TransportError('aborted', 'Request was aborted.')); }, { once: true });
    });
  });
  const recent: number[] = [];
  let dayStart: number | null = null;
  let dayCalls = 0;
  return {
    async take(signal) {
      if (signal?.aborted) throw new TransportError('aborted', 'Request was aborted.');
      let current = now();
      if (dayStart === null || current - dayStart >= 86_400_000 || current < dayStart) { dayStart = current; dayCalls = 0; }
      if (dayCalls >= perDay) throw new TransportError('http', 'Provider daily limit reached.', 429);
      while (true) {
        while (recent.length > 0 && current - recent[0]! >= 1_000) recent.shift();
        if (recent.length < perSecond) { recent.push(current); dayCalls++; return; }
        const delay = Math.max(1, 1_000 - (current - recent[0]!));
        await wait(delay, signal);
        if (signal?.aborted) throw new TransportError('aborted', 'Request was aborted.');
        const next = now();
        if (next <= current) throw new TransportError('http', 'Provider rate limit reached.', 429);
        current = next;
        if (dayStart !== null && current - dayStart >= 86_400_000) { dayStart = current; dayCalls = 0; }
        if (dayCalls >= perDay) throw new TransportError('http', 'Provider daily limit reached.', 429);
      }
    }
  };
}

async function etherscanRequest(http: HttpJsonPort, limiter: EtherscanRateLimiter, request: HttpRequest, signal?: AbortSignal): Promise<unknown> {
  await limiter.take(signal);
  return http.requestJson<unknown>(request, signal);
}

function etherscanMessage(response: unknown, allowEmptyTransfer = false): { readonly ok: true; readonly result: unknown } | { readonly ok: false; readonly status: AdapterStatus; readonly code: string } {
  if (typeof response !== 'object' || response === null || Array.isArray(response)) return { ok: false, status: 'error', code: 'invalid-response' };
  const envelope = response as Record<string, unknown>;
  if (String(envelope.status) === '1') return { ok: true, result: envelope.result };
  const message = typeof envelope.message === 'string' ? envelope.message.toLowerCase() : '';
  if (allowEmptyTransfer && message.includes('no transactions found') && Array.isArray(envelope.result) && envelope.result.length === 0) return { ok: true, result: [] };
  const limited = message.includes('rate') || message.includes('limit');
  const unavailable = message.includes('chain') && (message.includes('not supported') || message.includes('unsupported') || message.includes('unavailable'));
  const tier = message === '' || message.includes('pro') || message.includes('upgrade') || message.includes('plan') || message.includes('free api') || message.includes('not supported');
  return { ok: false, status: limited ? 'rate-limited' : tier ? 'unsupported' : 'error', code: limited ? 'rate-limited' : unavailable ? 'chain-unavailable' : tier ? 'provider-tier' : 'provider-error' };
}

function canContinueEtherscanChain(failure: { readonly status: AdapterStatus; readonly code: string }): boolean {
  return failure.status === 'unsupported' || failure.code === 'provider-tier' || failure.code === 'chain-unavailable';
}

interface TransferContract { readonly address: string; readonly symbol: string; readonly decimals: number; }
function parseTransferRows(value: unknown, maxContracts: number): { readonly contracts: readonly TransferContract[]; readonly malformed: boolean; readonly capped: boolean } {
  if (!Array.isArray(value)) return { contracts: [], malformed: true, capped: false };
  const contracts = new Map<string, TransferContract>();
  const invalid = new Set<string>();
  let malformed = false;
  let capped = false;
  for (const row of value) {
    if (typeof row !== 'object' || row === null || Array.isArray(row)) { malformed = true; continue; }
    const item = row as Record<string, unknown>;
    if (item.tokenID !== undefined) continue;
    const address = typeof item.contractAddress === 'string' ? item.contractAddress : '';
    const symbol = typeof item.tokenSymbol === 'string' ? item.tokenSymbol.trim() : '';
    const decimals = asDecimal(item.tokenDecimal);
    if (!/^0x[0-9a-fA-F]{40}$/.test(address) || symbol === '' || decimals === null) { malformed = true; continue; }
    const key = address.toLowerCase();
    const prior = contracts.get(key);
    if (prior && (prior.decimals !== decimals || prior.symbol !== symbol)) { invalid.add(key); contracts.delete(key); malformed = true; continue; }
    if (!prior && !invalid.has(key)) {
      if (contracts.size >= maxContracts) { capped = true; continue; }
      contracts.set(key, { address, symbol, decimals });
    }
  }
  return { contracts: [...contracts.values()], malformed, capped };
}

function configuredEtherscan(options: NonNullable<EvmAdapterOptions['erc20']>, context: AdapterContext): { readonly key: string } | AdapterScanResult {
  if (!options.endpoint || !options.keyId || !context.http || !context.secrets) return result('evm', 'evm.erc20', 'unconfigured', 'token-discovery-unavailable', [], 'unconfigured');
  const secret = context.secrets.get(options.keyId);
  if (!secret.ok) return result('evm', 'evm.erc20', 'unconfigured', 'token-discovery-unavailable', [], secret.code);
  if (secret.value === null) return result('evm', 'evm.erc20', 'unconfigured', 'token-discovery-unavailable', [], 'unconfigured');
  return { key: secret.value };
}

async function scanErc20Fast(wallet: EvmWalletSource, options: NonNullable<EvmAdapterOptions['erc20']>, key: string, context: AdapterContext, chains: readonly EvmChain[], limiter: EtherscanRateLimiter): Promise<AdapterScanResult> {
  const selected = selectedEvmChains(wallet, chains, context.settings);
  if (selected.length === 0) return result('evm', 'evm.erc20', 'unconfigured', 'token-discovery-unavailable', [], 'no-enabled-chain');
  const positions: PositionDraft[] = [];
  let malformed = false;
  let failure: AdapterScanResult | null = null;
  let successfulChain = false;
  let recoverableFailure = false;
  let stopAfterFailure = false;
  const offset = 100;
  const maxPages = Number.isSafeInteger(options.maxPages) && options.maxPages! > 0 && options.maxPages! <= 100 ? options.maxPages! : 5;
  try {
    for (const chain of selected) {
      let page = 1;
      while (page <= maxPages) {
        const response = await etherscanRequest(context.http!, limiter, { url: pageUrl(options.endpoint!, chain.chainId, wallet.address, page, offset), method: 'GET', secretQuery: { apikey: key } }, context.signal);
        const parsedEnvelope = etherscanMessage(response);
        if (!parsedEnvelope.ok) {
          failure ??= result('evm', 'evm.erc20', parsedEnvelope.status, 'token-discovery-unavailable', positions, parsedEnvelope.code);
          const canContinue = canContinueEtherscanChain(parsedEnvelope);
          recoverableFailure ||= canContinue;
          stopAfterFailure ||= !canContinue;
          break;
        }
        successfulChain = true;
        const parsed = parseErc20Rows(parsedEnvelope.result, chain.chainId);
        positions.push(...parsed.positions);
        malformed ||= parsed.malformed;
        if (!Array.isArray(parsedEnvelope.result) || parsedEnvelope.result.length < offset) break;
        page++;
      }
      if (page > maxPages && !failure) failure = result('evm', 'evm.erc20', 'partial', 'known-tokens', positions, 'max-page');
      if (stopAfterFailure) break;
    }
  } catch (error) {
    const code = transportCode(error);
    return result('evm', 'evm.erc20', statusFor(code), 'token-discovery-unavailable', positions, code);
  }
  if (failure) {
    if (recoverableFailure && successfulChain) return result('evm', 'evm.erc20', 'partial', 'known-tokens', positions, 'partial-response');
    return failure;
  }
  if (malformed && positions.length === 0) return result('evm', 'evm.erc20', 'error', 'token-discovery-unavailable', [], 'invalid-response');
  return result('evm', 'evm.erc20', malformed ? 'partial' : positions.length === 0 ? 'empty' : 'ok', 'known-tokens', positions, malformed ? 'partial-response' : null);
}

async function scanErc20Free(wallet: EvmWalletSource, options: NonNullable<EvmAdapterOptions['erc20']>, key: string, context: AdapterContext, chains: readonly EvmChain[], limiter: EtherscanRateLimiter): Promise<AdapterScanResult> {
  const selected = selectedEvmChains(wallet, chains, context.settings);
  const positions: PositionDraft[] = [];
  let malformed = false;
  let capped = false;
  let failure: AdapterScanResult | null = null;
  let successfulChain = false;
  let recoverableFailure = false;
  let stopAfterFailure = false;
  const offset = 1_000;
  const maxPages = Number.isSafeInteger(options.maxPages) && options.maxPages! > 0 && options.maxPages! <= 100 ? options.maxPages! : 5;
  const maxContracts = Number.isSafeInteger(options.maxContracts) && options.maxContracts! > 0 && options.maxContracts! <= 1_000 ? options.maxContracts! : 100;
  try {
    for (const chain of selected) {
      const contracts = new Map<string, TransferContract>();
      let chainFailed = false;
      let page = 1;
      while (page <= maxPages) {
        const url = new URL(options.endpoint!);
        url.searchParams.set('chainid', String(chain.chainId)); url.searchParams.set('module', 'account'); url.searchParams.set('action', 'tokentx'); url.searchParams.set('address', wallet.address); url.searchParams.set('page', String(page)); url.searchParams.set('offset', String(offset)); url.searchParams.set('sort', 'asc');
        const response = await etherscanRequest(context.http!, limiter, { url: url.toString(), method: 'GET', secretQuery: { apikey: key } }, context.signal);
        const parsedEnvelope = etherscanMessage(response, true);
        if (!parsedEnvelope.ok) {
          failure ??= result('evm', 'evm.erc20', parsedEnvelope.status, 'token-discovery-unavailable', positions, parsedEnvelope.code);
          const canContinue = canContinueEtherscanChain(parsedEnvelope);
          recoverableFailure ||= canContinue;
          stopAfterFailure ||= !canContinue;
          chainFailed = true;
          break;
        }
        successfulChain = true;
        const parsed = parseTransferRows(parsedEnvelope.result, Math.max(0, maxContracts - contracts.size));
        malformed ||= parsed.malformed; capped ||= parsed.capped;
        for (const contract of parsed.contracts) if (!contracts.has(contract.address.toLowerCase())) contracts.set(contract.address.toLowerCase(), contract);
        if (!Array.isArray(parsedEnvelope.result) || parsedEnvelope.result.length < offset) break;
        page++;
      }
      if (page > maxPages && !failure) capped = true;
      if (chainFailed) {
        if (stopAfterFailure) break;
        continue;
      }
      for (const contract of contracts.values()) {
        const url = new URL(options.endpoint!);
        url.searchParams.set('chainid', String(chain.chainId)); url.searchParams.set('module', 'account'); url.searchParams.set('action', 'tokenbalance'); url.searchParams.set('contractaddress', contract.address); url.searchParams.set('address', wallet.address); url.searchParams.set('tag', 'latest');
        const response = await etherscanRequest(context.http!, limiter, { url: url.toString(), method: 'GET', secretQuery: { apikey: key } }, context.signal);
        const parsedEnvelope = etherscanMessage(response);
        if (!parsedEnvelope.ok) {
          failure ??= result('evm', 'evm.erc20', parsedEnvelope.status, 'token-discovery-unavailable', positions, parsedEnvelope.code);
          const canContinue = canContinueEtherscanChain(parsedEnvelope);
          recoverableFailure ||= canContinue;
          stopAfterFailure ||= !canContinue;
          chainFailed = true;
          break;
        }
        const units = asBigInt(parsedEnvelope.result);
        if (units === null) { malformed = true; continue; }
        if (units > 0n) positions.push(fungibleDraft('evm', chain.chainId, contract.address, contract.symbol, units.toString(), contract.decimals));
      }
      if (chainFailed) {
        if (stopAfterFailure) break;
        continue;
      }
    }
  } catch (error) {
    const code = transportCode(error);
    return result('evm', 'evm.erc20', statusFor(code), 'token-discovery-unavailable', positions, code);
  }
  if (failure) {
    if (recoverableFailure && successfulChain) return result('evm', 'evm.erc20', 'partial', 'known-tokens', positions, 'partial-response');
    return failure;
  }
  if (malformed && positions.length === 0) return result('evm', 'evm.erc20', 'error', 'token-discovery-unavailable', [], 'invalid-response');
  if (capped || malformed) return result('evm', 'evm.erc20', 'partial', positions.length > 0 ? 'known-tokens' : 'token-discovery-unavailable', positions, capped ? 'cap-reached' : 'partial-response');
  return result('evm', 'evm.erc20', positions.length === 0 ? 'empty' : 'ok', 'known-tokens', positions);
}

async function scanErc20(wallet: EvmWalletSource, options: NonNullable<EvmAdapterOptions['erc20']>, context: AdapterContext, chains: readonly EvmChain[], limiter: EtherscanRateLimiter): Promise<AdapterScanResult> {
  const configured = configuredEtherscan(options, context);
  if ('status' in configured) return configured;
  const fast = await scanErc20Fast(wallet, options, configured.key, context, chains, limiter);
  if (fast.status === 'unsupported' && options.freeFallback !== false) return scanErc20Free(wallet, options, configured.key, context, chains, limiter);
  return fast;
}

async function scanEtherscanNative(wallet: EvmWalletSource, options: NonNullable<EvmAdapterOptions['erc20']>, context: AdapterContext, chains: readonly EvmChain[], limiter: EtherscanRateLimiter): Promise<{ readonly status: AdapterStatus; readonly positions: readonly PositionDraft[]; readonly errorCode: string | null }> {
  const configured = configuredEtherscan(options, context);
  if ('status' in configured) return { status: configured.status, positions: [], errorCode: configured.errorCode };
  const selected = selectedEvmChains(wallet, chains, context.settings);
  const positions: PositionDraft[] = [];
  let failure: { status: AdapterStatus; code: string } | null = null;
  let successfulChain = false;
  let recoverableFailure = false;
  let stopAfterFailure = false;
  try {
    for (const chain of selected) {
      let chainFailed = false;
      const url = new URL(options.endpoint!);
      url.searchParams.set('chainid', String(chain.chainId)); url.searchParams.set('module', 'account'); url.searchParams.set('action', 'balance'); url.searchParams.set('address', wallet.address); url.searchParams.set('tag', 'latest');
      const response = await etherscanRequest(context.http!, limiter, { url: url.toString(), method: 'GET', secretQuery: { apikey: configured.key } }, context.signal);
      const parsedEnvelope = etherscanMessage(response);
      if (!parsedEnvelope.ok) {
        failure ??= { status: parsedEnvelope.status, code: parsedEnvelope.code };
        const canContinue = canContinueEtherscanChain(parsedEnvelope);
        recoverableFailure ||= canContinue;
        stopAfterFailure ||= !canContinue;
        chainFailed = true;
        if (canContinue) continue;
        break;
      }
      successfulChain = true;
      const units = asBigInt(parsedEnvelope.result);
      if (units === null) { failure = { status: 'error', code: 'invalid-response' }; break; }
      if (units > 0n) positions.push(nativeDraft('evm', chain.chainId, `native:${chain.chainId}`, chain.nativeAsset, units.toString(), chain.nativeDecimals));
    }
  } catch (error) {
    const code = transportCode(error); return { status: statusFor(code), positions, errorCode: code };
  }
  if (failure) {
    if (recoverableFailure && successfulChain) return { status: 'partial', positions, errorCode: 'partial-response' };
    return { status: failure.status, positions, errorCode: failure.code };
  }
  return { status: positions.length === 0 ? 'empty' : 'ok', positions, errorCode: null };
}

export function createEvmAdapter(options: EvmAdapterOptions): WalletAdapter {
  const rpc = options.rpc;
  const etherscanLimiter = options.erc20 ? options.etherscanRateLimiter ?? createEtherscanRateLimiter(options.erc20.rateLimit) : null;
  return {
    family: 'evm', providerId: 'evm',
    async scan(wallet, context) {
      if (wallet.family !== 'evm') return result('evm', 'evm', 'error', 'native-complete', [], 'family-mismatch');
      // The injected RPC port is the explicit configuration signal.  Production
      // only supplies it when at least one resolved chain has an endpoint; test
      // and embedding callers may still use it to exercise unconfigured-chain
      // results from the scanner.
      const selected = selectedEvmChains(wallet, options.chains, context.settings);
      const hasConfiguredChain = options.chains.some(chain => chain.rpcUrl !== null);
      const rpcChains = rpc !== undefined ? hasConfiguredChain ? selected.filter(chain => chain.rpcUrl !== null) : selected : [];
      const fallbackChains = rpc === undefined ? selected : hasConfiguredChain ? selected.filter(chain => chain.rpcUrl === null) : [];
      const native = rpc !== undefined && rpcChains.length > 0 ? options.scanCoordinator ? await options.scanCoordinator.scan(wallet, rpcChains, rpc, context.signal, context.settings) : await scanEvmNativeBalances(wallet, rpcChains, rpc, context.signal, context.settings, undefined) : [];
      const etherscanNative = options.erc20 && etherscanLimiter && fallbackChains.length > 0 ? await scanEtherscanNative(wallet, options.erc20, context, fallbackChains, etherscanLimiter) : null;
      const rpcPositions = native.filter(item => item.status === 'ok' && item.balanceWei !== null && item.balanceWei !== '0').map(item => nativeDraft('evm', item.chainId, `native:${item.chainId}`, item.asset, item.balanceWei!, item.decimals));
      const nativePositions = [...rpcPositions, ...(etherscanNative?.positions ?? [])];
      const rpcError = native.find(item => item.status === 'error');
      const etherscanError = etherscanNative && (etherscanNative.status === 'error' || etherscanNative.status === 'rate-limited' || etherscanNative.status === 'unsupported' || etherscanNative.status === 'aborted' || etherscanNative.status === 'partial') ? { errorCode: etherscanNative.errorCode } : undefined;
      const nativeErrors = etherscanError ?? (rpcError ? { errorCode: rpcError.errorCode } : undefined);
      const nativeUnconfigured = (native.length > 0 && native.every(item => item.status === 'unconfigured')) || etherscanNative?.status === 'unconfigured';
      const token = options.erc20 && etherscanLimiter ? await scanErc20(wallet, options.erc20, context, options.chains, etherscanLimiter) : result('evm', 'evm.erc20', 'unconfigured', 'token-discovery-unavailable', [], 'unconfigured');
      const tokenUnavailable = token.status === 'unconfigured' || token.status === 'unsupported' || token.status === 'rate-limited' || token.status === 'error' || token.status === 'aborted';
      const nativeAvailable = native.some(item => item.status === 'ok' || item.status === 'error') || (etherscanNative !== null && etherscanNative.status !== 'unconfigured');
      const nativeConfigured = native.some(item => item.status !== 'unconfigured') || (etherscanNative !== null && etherscanNative.status !== 'unconfigured');
      const tokenConfigured = token.status !== 'unconfigured';
      const nativeSuccess = native.some(item => item.status === 'ok') || etherscanNative?.status === 'ok' || (etherscanNative?.status === 'partial' && etherscanNative.positions.length > 0);
      const tokenCoverage = token.status === 'ok' || token.status === 'empty' || token.status === 'partial';
      const noCoverageFailure = !nativeSuccess && !tokenCoverage && (nativeErrors !== undefined || tokenUnavailable);
      const noNativeCoverage = nativeUnconfigured && !nativeAvailable;
      const status: AdapterStatus = !nativeConfigured && !tokenConfigured ? 'unconfigured' : noCoverageFailure ? token.status === 'rate-limited' ? 'rate-limited' : 'error' : nativeErrors || token.status === 'partial' || tokenUnavailable || noNativeCoverage ? 'partial' : nativePositions.length === 0 && token.positions.length === 0 ? 'empty' : 'ok';
      return result('evm', 'evm', status, token.status === 'ok' || token.status === 'empty' || token.status === 'partial' ? 'known-tokens' : 'token-discovery-unavailable', [...nativePositions, ...token.positions], nativeErrors?.errorCode ?? token.errorCode ?? etherscanNative?.errorCode ?? null);
    }
  };
}

export interface BitcoinAdapterOptions { readonly endpoint?: string; }

export function createBitcoinAdapter(options: BitcoinAdapterOptions = {}): WalletAdapter {
  return {
    family: 'bitcoin', providerId: 'bitcoin.mempool',
    async scan(wallet, context) {
      if (wallet.family !== 'bitcoin') return result('bitcoin', 'bitcoin.mempool', 'error', 'native-complete', [], 'family-mismatch');
      if (wallet.options.addressType !== 'address') return result('bitcoin', 'bitcoin.mempool', 'unsupported', 'native-complete', [], 'xpub-unsupported');
      if (!validateBitcoinAddress(wallet.address, wallet.options.network, 'address').ok) return result('bitcoin', 'bitcoin.mempool', 'error', 'native-complete', [], 'invalid-address');
      if (!context.http) return result('bitcoin', 'bitcoin.mempool', 'unconfigured', 'native-complete', [], 'unconfigured');
      const base = options.endpoint ?? (wallet.options.network === 'testnet' ? 'https://mempool.space/testnet/api' : 'https://mempool.space/api');
      try {
        const response = await context.http.requestJson<unknown>({ url: `${base}/address/${wallet.address}`, method: 'GET', allowPublicPath: true }, context.signal);
        if (typeof response !== 'object' || response === null || Array.isArray(response)) return result('bitcoin', 'bitcoin.mempool', 'error', 'native-complete', [], 'invalid-response');
        const item = response as Record<string, unknown>;
        const confirmedStats = item.chain_stats;
        const mempoolStats = item.mempool_stats;
        if (typeof confirmedStats !== 'object' || confirmedStats === null || typeof mempoolStats !== 'object' || mempoolStats === null) return result('bitcoin', 'bitcoin.mempool', 'error', 'native-complete', [], 'invalid-response');
        const confirmed = confirmedStats as Record<string, unknown>;
        const pending = mempoolStats as Record<string, unknown>;
        const confirmedFunded = asBigInt(confirmed.funded_txo_sum);
        const confirmedSpent = asBigInt(confirmed.spent_txo_sum);
        const pendingFunded = asBigInt(pending.funded_txo_sum);
        const pendingSpent = asBigInt(pending.spent_txo_sum);
        if (confirmedFunded === null || confirmedSpent === null || pendingFunded === null || pendingSpent === null) return result('bitcoin', 'bitcoin.mempool', 'error', 'native-complete', [], 'invalid-response');
        const confirmedUnits = confirmedFunded - confirmedSpent;
        const pendingUnits = pendingFunded - pendingSpent;
        if (confirmedUnits < 0n) return result('bitcoin', 'bitcoin.mempool', 'error', 'native-complete', [], 'invalid-response');
        const total = confirmedUnits + pendingUnits;
        if (total < 0n) return result('bitcoin', 'bitcoin.mempool', 'error', 'native-complete', [], 'invalid-response');
        const positions = total === 0n ? [] : [nativeDraft('bitcoin', null, 'native:btc', 'BTC', total.toString(), 8, confirmedUnits.toString(), pendingUnits === 0n ? '0' : pendingUnits.toString())];
        return result('bitcoin', 'bitcoin.mempool', positions.length === 0 ? 'empty' : 'ok', 'native-complete', positions);
      } catch (error) {
        const code = transportCode(error);
        return result('bitcoin', 'bitcoin.mempool', statusFor(code), 'native-complete', [], code);
      }
    }
  };
}

export interface SolanaAdapterOptions { readonly endpoint?: string; }
const SPL_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

function solanaTokenRows(value: unknown, balances: Map<string, { units: bigint; decimals: number }>): boolean {
  if (!Array.isArray(value)) return false;
  for (const account of value) {
    if (typeof account !== 'object' || account === null || Array.isArray(account)) return false;
    const info = (account as Record<string, unknown>).account;
    const data = typeof info === 'object' && info !== null && !Array.isArray(info) ? (info as Record<string, unknown>).data : null;
    const parsed = typeof data === 'object' && data !== null && !Array.isArray(data) ? (data as Record<string, unknown>).parsed : null;
    const parsedInfo = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>).info : null;
    const tokenAmount = typeof parsedInfo === 'object' && parsedInfo !== null && !Array.isArray(parsedInfo) ? (parsedInfo as Record<string, unknown>).tokenAmount : null;
    const row = typeof tokenAmount === 'object' && tokenAmount !== null && !Array.isArray(tokenAmount) ? tokenAmount as Record<string, unknown> : null;
    const mint = typeof parsedInfo === 'object' && parsedInfo !== null && !Array.isArray(parsedInfo) && typeof (parsedInfo as Record<string, unknown>).mint === 'string' ? (parsedInfo as Record<string, unknown>).mint as string : '';
    const units = row ? asBigInt(row.amount) : null;
    const decimals = row?.decimals;
    if (mint === '' || units === null || !isDecimal(decimals)) return false;
    if (units === 0n || decimals === 0) continue;
    const prior = balances.get(mint);
    if (prior && prior.decimals !== decimals) return false;
    balances.set(mint, { units: (prior?.units ?? 0n) + units, decimals });
  }
  return true;
}

export function createSolanaAdapter(options: SolanaAdapterOptions = {}): WalletAdapter {
  return {
    family: 'solana', providerId: 'solana.rpc',
    async scan(wallet, context) {
      if (wallet.family !== 'solana') return result('solana', 'solana.rpc', 'error', 'native-complete', [], 'family-mismatch');
      const endpoint = options.endpoint ?? ({ 'mainnet-beta': 'https://api.mainnet.solana.com', devnet: 'https://api.devnet.solana.com', testnet: 'https://api.testnet.solana.com' } as const)[wallet.options.network];
      if (!context.rpc) return result('solana', 'solana.rpc', 'unconfigured', 'native-complete', [], 'unconfigured');
      try {
        const native = await context.rpc.call<unknown>(endpoint, 'getBalance', [wallet.address, { commitment: 'finalized' }], context.signal);
        const nativeValue = typeof native === 'object' && native !== null && !Array.isArray(native) ? (native as Record<string, unknown>).value : null;
        const lamports = asBigInt(nativeValue);
        if (lamports === null) return result('solana', 'solana.rpc', 'error', 'native-complete', [], 'invalid-response');
        const balances = new Map<string, { units: bigint; decimals: number }>();
        let partial = false;
        for (const programId of [SPL_PROGRAM, TOKEN_2022_PROGRAM]) {
          try {
            const tokenResponse = await context.rpc.call<unknown>(endpoint, 'getTokenAccountsByOwner', [wallet.address, { programId }, { encoding: 'jsonParsed', commitment: 'finalized' }], context.signal);
            const rows = typeof tokenResponse === 'object' && tokenResponse !== null && !Array.isArray(tokenResponse) ? (tokenResponse as Record<string, unknown>).value : null;
            if (!solanaTokenRows(rows, balances)) return result('solana', 'solana.rpc', 'error', 'native-complete', [], 'invalid-response');
          } catch (error) { partial = true; if (transportCode(error) === 'aborted') return result('solana', 'solana.rpc', 'aborted', 'native-complete', [], 'aborted'); }
        }
        const positions: PositionDraft[] = lamports === 0n ? [] : [nativeDraft('solana', null, 'native:sol', 'SOL', lamports.toString(), 9)];
        for (const [mint, item] of balances) positions.push(fungibleDraft('solana', null, mint, mint.slice(0, 8), item.units.toString(), item.decimals));
        const status: AdapterStatus = partial ? 'partial' : positions.length === 0 ? 'empty' : 'ok';
        return result('solana', 'solana.rpc', status, 'native-complete', positions, partial ? 'token-provider-error' : null);
      } catch (error) {
        const code = transportCode(error);
        return result('solana', 'solana.rpc', statusFor(code), 'native-complete', [], code);
      }
    }
  };
}

export interface CardanoAdapterOptions { readonly mainnetEndpoint?: string; readonly testnetEndpoint?: string; }

function cardanoRecords(value: unknown): readonly Record<string, unknown>[] | null {
  if (!Array.isArray(value)) return null;
  if (value.some(item => typeof item !== 'object' || item === null || Array.isArray(item))) return null;
  return value as Record<string, unknown>[];
}

export function createCardanoAdapter(options: CardanoAdapterOptions = {}): WalletAdapter {
  return {
    family: 'cardano', providerId: 'cardano.koios',
    async scan(wallet, context) {
      if (wallet.family !== 'cardano') return result('cardano', 'cardano.koios', 'error', 'native-complete', [], 'family-mismatch');
      if (!context.http) return result('cardano', 'cardano.koios', 'unconfigured', 'native-complete', [], 'unconfigured');
      const endpoint = wallet.options.network === 'testnet' ? options.testnetEndpoint ?? 'https://preprod.koios.rest/api/v1' : options.mainnetEndpoint ?? 'https://api.koios.rest/api/v1';
      const stake = wallet.options.kind === 'stake';
      const infoPath = stake ? 'account_info' : 'address_info';
      const assetsPath = stake ? 'account_assets' : 'address_assets';
      const requestBody = stake ? { _stake_addresses: [wallet.address] } : { _addresses: [wallet.address] };
      try {
        const infoResponse = await context.http.requestJson<unknown>({ url: `${endpoint}/${infoPath}`, method: 'POST', body: requestBody }, context.signal);
        const info = cardanoRecords(infoResponse);
        const first = info?.[0];
        const balance = first === undefined ? null : asBigInt(stake ? first.total_balance : first.balance);
        if (balance === null) return result('cardano', 'cardano.koios', 'error', 'native-complete', [], 'invalid-response');
        const positions: PositionDraft[] = balance === 0n ? [] : [nativeDraft('cardano', null, 'native:ada', 'ADA', balance.toString(), 6)];
        const assetsResponse = await context.http.requestJson<unknown>({ url: `${endpoint}/${assetsPath}`, method: 'POST', body: requestBody }, context.signal);
        const assets = cardanoRecords(assetsResponse);
        if (assets === null) return result('cardano', 'cardano.koios', 'partial', 'native-complete', positions, 'invalid-assets-response');
        for (const asset of assets) {
          const policy = typeof asset.policy_id === 'string' ? asset.policy_id : '';
          const name = typeof asset.asset_name === 'string' ? asset.asset_name : '';
          const fingerprint = typeof asset.fingerprint === 'string' ? asset.fingerprint : '';
          const units = asBigInt(asset.quantity);
          const decimals = asDecimal(asset.decimals);
          if (policy === '' || fingerprint === '' || units === null || units === 0n || decimals === null || decimals === 0) continue;
          positions.push(fungibleDraft('cardano', null, fingerprint, name === '' ? fingerprint.slice(0, 8) : name.slice(0, 8), units.toString(), decimals));
        }
        return result('cardano', 'cardano.koios', positions.length === 0 ? 'empty' : 'ok', 'native-complete', positions);
      } catch (error) {
        const code = transportCode(error);
        return result('cardano', 'cardano.koios', statusFor(code), 'native-complete', [], code);
      }
    }
  };
}

export function positionFromDraft(walletId: string, draft: PositionDraft, now: number, id: string): Position {
  const confirmed = draft.confirmedBaseUnits ?? draft.baseUnits;
  const pending = draft.pendingBaseUnits ?? '0';
  return { schemaVersion: 3, id, walletId, family: draft.family, chainId: draft.chainId, assetKind: draft.assetKind, assetId: draft.assetId, symbol: draft.symbol, baseUnits: draft.baseUnits, quantity: formatUnits(BigInt(draft.baseUnits), draft.decimals), confirmedBaseUnits: confirmed, pendingBaseUnits: pending, decimals: draft.decimals, updatedAt: now, spam: draft.assetKind === 'native' ? null : draft.spam ?? null };
}
