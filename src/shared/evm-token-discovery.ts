import type { AdapterContext, AdapterScanResult, PositionDraft } from './adapters.ts';
import type { EvmChain } from './chains.ts';
import { createRpcWorkLimiter } from './scanner.ts';
import type { EvmWalletSource, SpamAssessment } from './state.ts';
import { isEvmNativeSystemContract } from './asset-identity.ts';
import { classifyFungibleToken } from './spam.ts';
import type { HttpJsonPort } from './transport.ts';
import { TransportError } from './transport.ts';

export const COINGECKO_TOKEN_CATALOG_URL = 'https://api.coingecko.com/api/v3/coins/list?include_platform=true';

const BALANCE_OF_SELECTOR = '0x70a08231';
const DECIMALS_SELECTOR = '0x313ce567';
const PLATFORM_BY_CHAIN_ID: Readonly<Record<number, string>> = Object.freeze({
  1: 'ethereum', 10: 'optimistic-ethereum', 56: 'binance-smart-chain', 100: 'xdai', 137: 'polygon-pos', 324: 'zksync', 5000: 'mantle', 8453: 'base', 42161: 'arbitrum-one', 42220: 'celo', 43114: 'avalanche', 59144: 'linea', 534352: 'scroll'
});

interface CatalogToken {
  readonly chainId: number;
  readonly contract: string;
  readonly symbol: string;
  readonly name: string;
}

interface CachedChain {
  readonly fullScanAt: number;
  readonly tokens: readonly CatalogToken[];
  readonly positions: readonly PositionDraft[];
  readonly retryOffset: number;
  readonly remainingCatalogTokens: number;
}

export interface EvmTokenDiscovery {
  scan(wallet: EvmWalletSource, chains: readonly EvmChain[], context: AdapterContext): Promise<AdapterScanResult>;
}

export interface CoinGeckoEvmTokenDiscoveryOptions {
  readonly http: HttpJsonPort;
  readonly now?: () => number;
  readonly catalogTtlMs?: number;
  readonly fullScanTtlMs?: number;
  readonly batchSize?: number;
  readonly batchSizesByChainId?: Readonly<Record<number, number>>;
  readonly concurrency?: number;
  readonly maxCatalogBytes?: number;
  readonly wait?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  readonly rpcFallbacks?: Readonly<Record<number, readonly string[]>>;
  readonly rpcDelayMs?: number;
  readonly rpcAttempts?: number;
  readonly rpcTimeoutMs?: number;
  readonly catalogScanLimitPerChain?: number;
}

function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function boundedText(value: unknown, max: number): string | null { return typeof value === 'string' && value.trim() !== '' && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value) ? value.trim() : null; }
function positiveOption(value: number | undefined, fallback: number, maximum: number): number { return Number.isSafeInteger(value) && value! > 0 && value! <= maximum ? value! : fallback; }
function transportCode(error: unknown): string {
  if (error instanceof TransportError) return error.code === 'http' && error.status === 429 ? 'rate-limited' : error.code;
  return 'network';
}
function statusForCode(code: string): AdapterScanResult['status'] { return code === 'aborted' ? 'aborted' : code === 'rate-limited' ? 'rate-limited' : 'error'; }
function selectedChains(wallet: EvmWalletSource, chains: readonly EvmChain[], context: AdapterContext): readonly EvmChain[] {
  const enabled = context.settings?.enabledChainIds ?? [];
  return chains.filter(chain => chain.rpcUrl !== null && (enabled.length === 0 || enabled.includes(chain.chainId)) && (wallet.options.chainIds.includes(chain.chainId) || (wallet.options.autoScanCommonChains && chain.builtin)));
}

export function parseCoinGeckoTokenCatalog(value: unknown, chainIds: readonly number[]): readonly CatalogToken[] {
  if (!Array.isArray(value)) throw new Error('invalid-catalog');
  const selected = new Set(chainIds);
  const tokens = new Map<string, CatalogToken>();
  for (const item of value) {
    if (!record(item) || !record(item.platforms)) continue;
    const symbol = boundedText(item.symbol, 40);
    const name = boundedText(item.name, 160);
    if (!symbol || !name) continue;
    for (const chainId of selected) {
      const platform = PLATFORM_BY_CHAIN_ID[chainId];
      const contractValue = platform ? item.platforms[platform] : undefined;
      if (typeof contractValue !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(contractValue)) continue;
      const contract = contractValue.toLowerCase();
      if (isEvmNativeSystemContract(chainId, contract)) continue;
      const key = `${chainId}:${contract}`;
      if (!tokens.has(key)) tokens.set(key, { chainId, contract, symbol: symbol.toUpperCase(), name });
    }
  }
  return [...tokens.values()];
}

function callData(address: string): string { return `${BALANCE_OF_SELECTOR}${address.slice(2).toLowerCase().padStart(64, '0')}`; }
function rpcQuantity(value: unknown): bigint | null {
  if (typeof value !== 'string' || !/^0x(?:0|[0-9a-fA-F]{1,64})$/.test(value)) return null;
  return BigInt(value);
}
function responseMap(value: unknown): Map<number, unknown> {
  const rows = Array.isArray(value) ? value : [];
  return new Map(rows.flatMap(row => record(row) && Number.isSafeInteger(row.id) && !('error' in row) ? [[row.id as number, row.result] as const] : []));
}
function rpcBody(tokens: readonly CatalogToken[], walletAddress: string, method: 'balance' | 'decimals'): readonly Record<string, unknown>[] {
  return tokens.map((token, index) => ({ jsonrpc: '2.0', id: index + 1, method: 'eth_call', params: [{ to: token.contract, data: method === 'balance' ? callData(walletAddress) : DECIMALS_SELECTOR }, 'latest'] }));
}
function spamFor(token: CatalogToken, quantity: string, decimals: number): SpamAssessment {
  return classifyFungibleToken({ assetKind: 'fungible', symbol: token.symbol, name: token.name, decimals, quantity, verified: true, airdrop: false });
}
function position(token: CatalogToken, units: bigint, decimals: number): PositionDraft {
  const baseUnits = units.toString();
  return { family: 'evm', chainId: token.chainId, assetKind: 'fungible', assetId: token.contract, symbol: token.symbol, assetName: token.name, baseUnits, decimals, spam: spamFor(token, baseUnits, decimals) };
}

export function createCoinGeckoEvmTokenDiscovery(options: CoinGeckoEvmTokenDiscoveryOptions): EvmTokenDiscovery {
  const now = options.now ?? Date.now;
  const catalogTtlMs = positiveOption(options.catalogTtlMs, 86_400_000, 604_800_000);
  const fullScanTtlMs = positiveOption(options.fullScanTtlMs, 900_000, 86_400_000);
  const batchSize = positiveOption(options.batchSize, 100, 250);
  const concurrency = positiveOption(options.concurrency, 1, 8);
  const maxCatalogBytes = positiveOption(options.maxCatalogBytes, 5_000_000, 20_000_000);
  const rpcDelayMs = Number.isSafeInteger(options.rpcDelayMs) && options.rpcDelayMs! >= 0 && options.rpcDelayMs! <= 5_000 ? options.rpcDelayMs! : 0;
  const rpcAttempts = positiveOption(options.rpcAttempts, 1, 3);
  const rpcTimeoutMs = positiveOption(options.rpcTimeoutMs, 10_000, 30_000);
  const catalogScanLimitPerChain = positiveOption(options.catalogScanLimitPerChain, 5_000, 10_000);
  const wait = options.wait ?? (async (milliseconds: number, signal?: AbortSignal) => {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, milliseconds);
      signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new TransportError('aborted', 'Request was aborted.')); }, { once: true });
    });
  });
  let catalogValue: unknown = null;
  let catalogFetchedAt = -1;
  let catalogPromise: Promise<unknown> | null = null;
  const cache = new Map<string, CachedChain>();
  const rpcLimiter = createRpcWorkLimiter(concurrency);

  const requestJson = async (requestValue: Parameters<HttpJsonPort['requestJson']>[0], signal?: AbortSignal, maxAttempts = 3): Promise<unknown> => {
    let attempt = 0;
    while (true) {
      try { return await options.http.requestJson<unknown>(requestValue, signal); } catch (error) {
        const retryable = error instanceof TransportError && error.code === 'http' && (error.status === 429 || (error.status !== null && error.status >= 500));
        if (!retryable || attempt + 1 >= maxAttempts) throw error;
        attempt++;
        await wait(attempt * 1_000, signal);
      }
    }
  };

  const catalog = async (signal?: AbortSignal): Promise<unknown> => {
    const current = now();
    if (catalogValue !== null && current - catalogFetchedAt < catalogTtlMs) return catalogValue;
    if (catalogPromise) return catalogPromise;
    catalogPromise = requestJson({ url: COINGECKO_TOKEN_CATALOG_URL, maxBytes: maxCatalogBytes }, signal).then(value => { catalogValue = value; catalogFetchedAt = now(); return value; }).finally(() => { catalogPromise = null; });
    return catalogPromise;
  };

  const request = (chain: EvmChain, tokens: readonly CatalogToken[], walletAddress: string, method: 'balance' | 'decimals', signal?: AbortSignal): Promise<Map<number, unknown>> => rpcLimiter.run(async () => {
    const body = rpcBody(tokens, walletAddress, method);
    const endpoints = [chain.rpcUrl!, ...(options.rpcFallbacks?.[chain.chainId] ?? [])];
    let lastResponse = new Map<number, unknown>();
    let lastError: unknown = null;
    for (let round = 0; round < rpcAttempts; round++) {
      for (const endpoint of endpoints) {
        try {
          const mapped = responseMap(await requestJson({ url: endpoint, method: 'POST', body, maxBytes: 1_000_000, timeoutMs: rpcTimeoutMs }, signal, 1));
          if (mapped.size > lastResponse.size) lastResponse = mapped;
          if (mapped.size === tokens.length) { if (rpcDelayMs > 0) await wait(rpcDelayMs, signal); return mapped; }
        } catch (error) { lastError = error; }
      }
      if (lastResponse.size > 0) { if (rpcDelayMs > 0) await wait(rpcDelayMs, signal); return lastResponse; }
      if (round + 1 < rpcAttempts) await wait((round + 1) * 1_000, signal);
    }
    if (lastError !== null) throw lastError;
    return lastResponse;
  }, signal);

  const recoverMissing = async (chain: EvmChain, tokens: readonly CatalogToken[], current: Map<number, unknown>, walletAddress: string, method: 'balance' | 'decimals', signal?: AbortSignal): Promise<Map<number, unknown>> => {
    const recovered = new Map(current);
    const missing = tokens.flatMap((token, index) => recovered.has(index + 1) ? [] : [{ token, index }]);
    const rows = await Promise.all(missing.map(async item => {
      try {
        const response = await request(chain, [item.token], walletAddress, method, signal);
        return response.has(1) ? [item.index + 1, response.get(1)] as const : null;
      } catch (error) {
        if (transportCode(error) === 'aborted') throw error;
        return null;
      }
    }));
    for (const row of rows) if (row) recovered.set(row[0], row[1]);
    return recovered;
  };

  const balancesFor = async (chain: EvmChain, tokens: readonly CatalogToken[], walletAddress: string, signal?: AbortSignal): Promise<{ readonly positions: readonly PositionDraft[]; readonly hadError: boolean; readonly retryOffset: number | null }> => {
    const groups: { readonly tokens: readonly CatalogToken[]; readonly offset: number }[] = [];
    const chainBatchSize = positiveOption(options.batchSizesByChainId?.[chain.chainId], batchSize, 250);
    for (let offset = 0; offset < tokens.length; offset += chainBatchSize) groups.push({ tokens: tokens.slice(offset, offset + chainBatchSize), offset });
    let cursor = 0;
    let hadError = false;
    let retryOffset: number | null = null;
    const positions: PositionDraft[] = [];
    const markError = (offset: number): void => { hadError = true; retryOffset = retryOffset === null ? offset : Math.min(retryOffset, offset); };
    const worker = async (): Promise<void> => {
      while (cursor < groups.length) {
        const item = groups[cursor++]!;
        const group = item.tokens;
        let balanceRequestFailed = false;
        let balances: Map<number, unknown>;
        try { balances = await request(chain, group, walletAddress, 'balance', signal); } catch (error) {
          if (transportCode(error) === 'aborted') throw error;
          balanceRequestFailed = true;
          balances = new Map();
        }
        const priorityPartial = item.offset === 0 && balances.size < group.length;
        if (balanceRequestFailed || balances.size === 0 || priorityPartial) balances = await recoverMissing(chain, group, balances, walletAddress, 'balance', signal);
        if (balances.size < group.length) markError(item.offset);
        const held = group.flatMap((token, index) => {
          const units = rpcQuantity(balances.get(index + 1));
          return units !== null && units > 0n ? [{ token, units }] : [];
        });
        if (held.length === 0) continue;
        const heldTokens = held.map(item => item.token);
        let decimals: Map<number, unknown>;
        try { decimals = await request(chain, heldTokens, walletAddress, 'decimals', signal); } catch (error) {
          if (transportCode(error) === 'aborted') throw error;
          decimals = new Map();
        }
        if (decimals.size < heldTokens.length) decimals = await recoverMissing(chain, heldTokens, decimals, walletAddress, 'decimals', signal);
        if (decimals.size < heldTokens.length) markError(item.offset);
        for (let index = 0; index < held.length; index++) {
          const decimalValue = rpcQuantity(decimals.get(index + 1));
          if (decimalValue !== null && decimalValue <= 36n) positions.push(position(held[index]!.token, held[index]!.units, Number(decimalValue)));
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, groups.length)) }, worker));
    return { positions, hadError, retryOffset };
  };

  return {
    async scan(wallet, chains, context) {
      const selected = selectedChains(wallet, chains, context);
      if (selected.length === 0) return { family: 'evm', providerId: 'evm.catalog', status: 'unconfigured', capability: 'token-discovery-unavailable', positions: [], errorCode: 'no-enabled-chain' };
      try {
        const value = await catalog(context.signal);
        const allTokens = parseCoinGeckoTokenCatalog(value, selected.map(chain => chain.chainId));
        const positions: PositionDraft[] = [];
        let hadError = false;
        for (const chain of selected) {
          const key = `${wallet.address.toLowerCase()}:${chain.chainId}`;
          const prior = cache.get(key);
          const fullScan = prior === undefined || now() - prior.fullScanAt >= fullScanTtlMs;
          const chainTokens = allTokens.filter(token => token.chainId === chain.chainId);
          const knownContracts = new Set([
            ...(prior?.tokens.map(token => token.contract) ?? []),
            ...(context.positions ?? []).filter(position => position.family === 'evm' && position.assetKind === 'fungible' && position.chainId === chain.chainId && /^0x[0-9a-fA-F]{40}$/.test(position.assetId)).map(position => position.assetId.toLowerCase())
          ]);
          const priorityTokens = chainTokens.filter(token => knownContracts.has(token.contract));
          const discoveryTokens = chainTokens.filter(token => !knownContracts.has(token.contract));
          const rotation = fullScan && discoveryTokens.length > 0 ? (prior?.retryOffset ?? 0) % discoveryTokens.length : 0;
          const rotated = rotation > 0 ? [...discoveryTokens.slice(rotation), ...discoveryTokens.slice(0, rotation)] : discoveryTokens;
          const remainingBefore = fullScan ? prior && prior.remainingCatalogTokens > 0 ? Math.min(prior.remainingCatalogTokens, discoveryTokens.length) : discoveryTokens.length : 0;
          const discoverySlice = fullScan ? rotated.slice(0, Math.min(catalogScanLimitPerChain, remainingBefore)) : [];
          const tokens = [...priorityTokens, ...discoverySlice];
          const current = await balancesFor(chain, tokens, wallet.address, context.signal);
          hadError ||= current.hadError;
          const positionMap = new Map((current.hadError ? [...(prior?.positions ?? []), ...current.positions] : current.positions).map(item => [item.assetId.toLowerCase(), item]));
          const currentPositions = [...positionMap.values()];
          const heldContracts = new Set(currentPositions.map(item => item.assetId.toLowerCase()));
          const tokenMap = new Map([...(current.hadError ? prior?.tokens ?? [] : []), ...tokens.filter(token => heldContracts.has(token.contract))].map(token => [token.contract, token]));
          const heldTokens = [...tokenMap.values()];
          const checkedDiscoveryTokens = current.hadError ? Math.min(discoverySlice.length, Math.max(0, current.retryOffset! - priorityTokens.length)) : discoverySlice.length;
          const fullCatalogCovered = fullScan && !current.hadError && checkedDiscoveryTokens === remainingBefore;
          const fullScanAt = fullScan && fullCatalogCovered && !current.hadError ? now() : prior?.fullScanAt ?? -fullScanTtlMs;
          const retryOffset = !fullScan || discoveryTokens.length === 0 || fullCatalogCovered && !current.hadError
            ? 0
            : (rotation + checkedDiscoveryTokens) % discoveryTokens.length;
          const remainingCatalogTokens = !fullScan || fullCatalogCovered ? 0 : Math.max(0, remainingBefore - checkedDiscoveryTokens);
          cache.set(key, { fullScanAt, tokens: heldTokens, positions: currentPositions, retryOffset, remainingCatalogTokens });
          positions.push(...currentPositions);
        }
        return { family: 'evm', providerId: 'evm.catalog', status: 'partial', capability: 'known-tokens', positions, errorCode: hadError ? 'catalog-rpc-partial' : 'catalog-coverage' };
      } catch (error) {
        const code = transportCode(error);
        const retained = selected.flatMap(chain => cache.get(`${wallet.address.toLowerCase()}:${chain.chainId}`)?.positions ?? []);
        return { family: 'evm', providerId: 'evm.catalog', status: retained.length > 0 ? 'partial' : statusForCode(code), capability: retained.length > 0 ? 'known-tokens' : 'token-discovery-unavailable', positions: retained, errorCode: retained.length > 0 ? 'stale-catalog' : code };
      }
    }
  };
}
