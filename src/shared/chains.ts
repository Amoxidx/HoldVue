import { isLocalHost, isPrivateHost } from './network-safety.ts';

export interface ChainCapabilities {
  readonly nativeBalance: boolean;
  readonly erc20Enumeration: 'unsupported' | 'configured';
  readonly tokenMetadata: 'unsupported' | 'configured';
}

export interface EvmChain {
  readonly family: 'evm';
  readonly chainId: number;
  readonly name: string;
  readonly nativeAsset: string;
  readonly nativeDecimals: number;
  readonly rpcUrl: string | null;
  readonly explorerBaseUrl: string;
  readonly capabilities: ChainCapabilities;
  readonly builtin: boolean;
}

export interface CustomChainInput {
  readonly chainId: unknown;
  readonly name: unknown;
  readonly nativeAsset: unknown;
  readonly nativeDecimals?: unknown;
  readonly rpcUrl: unknown;
  readonly explorerBaseUrl: unknown;
}

export type ChainErrorCode = 'invalid-chain' | 'invalid-url' | 'credential-url' | 'duplicate-chain-id' | 'builtin-protected' | 'not-found';
export interface ChainError { readonly ok: false; readonly code: ChainErrorCode; readonly message: string; }
export interface ChainSuccess<T> { readonly ok: true; readonly value: T; }
export type ChainResult<T> = ChainSuccess<T> | ChainError;

const capabilities: ChainCapabilities = Object.freeze({ nativeBalance: true, erc20Enumeration: 'unsupported', tokenMetadata: 'unsupported' });
export const DEFAULT_NATIVE_DECIMALS = 18;
export function isNativeDecimals(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 36;
}
const chain = (chainId: number, name: string, nativeAsset: string, rpcUrl: string, explorerBaseUrl: string, nativeDecimals: number): EvmChain => ({ family: 'evm', chainId, name, nativeAsset, nativeDecimals, rpcUrl, explorerBaseUrl, capabilities, builtin: true });

export const COMMON_EVM_CHAINS: readonly EvmChain[] = Object.freeze([
  chain(1, 'Ethereum', 'ETH', 'https://ethereum-rpc.publicnode.com', 'https://etherscan.io', 18),
  chain(8453, 'Base', 'ETH', 'https://base-rpc.publicnode.com', 'https://basescan.org', 18),
  chain(42161, 'Arbitrum One', 'ETH', 'https://arbitrum-one-rpc.publicnode.com', 'https://arbiscan.io', 18),
  chain(10, 'Optimism', 'ETH', 'https://optimism-rpc.publicnode.com', 'https://optimistic.etherscan.io', 18),
  chain(137, 'Polygon PoS', 'POL', 'https://polygon-bor-rpc.publicnode.com', 'https://polygonscan.com', 18),
  chain(56, 'BNB Smart Chain', 'BNB', 'https://bsc-rpc.publicnode.com', 'https://bscscan.com', 18),
  chain(43114, 'Avalanche C-Chain', 'AVAX', 'https://avalanche-c-chain-rpc.publicnode.com/ext/bc/C/rpc', 'https://subnets.avax.network/c-chain', 18),
  chain(100, 'Gnosis', 'xDAI', 'https://gnosis-rpc.publicnode.com', 'https://gnosisscan.io', 18),
  chain(59144, 'Linea', 'ETH', 'https://linea-rpc.publicnode.com', 'https://lineascan.build', 18),
  chain(534352, 'Scroll', 'ETH', 'https://scroll-rpc.publicnode.com', 'https://scrollscan.com', 18),
  chain(324, 'zkSync Era', 'ETH', 'https://mainnet.era.zksync.io', 'https://era.zksync.network', 18),
  chain(42220, 'Celo', 'CELO', 'https://forno.celo.org', 'https://celoscan.io', 18),
  chain(5000, 'Mantle', 'MNT', 'https://rpc.mantle.xyz', 'https://mantlescan.xyz', 18)
]);

function credentialPath(parsed: URL): boolean {
  const segments = parsed.pathname.split('/').filter(Boolean);
  return segments.some((segment, index) => {
    const previous = segments[index - 1]?.toLowerCase();
    const versionSecret = (previous === 'v2' || previous === 'v3') && segment.length >= 8;
    const highEntropy = segment.length >= 20 && /[a-z]/i.test(segment) && /[0-9]/.test(segment);
    const longCredential = segment.length >= 24 && /^[A-Za-z0-9_-]+$/.test(segment);
    return versionSecret || highEntropy || longCredential;
  });
}

export function validateEndpointUrl(value: unknown, development: boolean): ChainError | null {
  if (typeof value !== 'string' || value.trim() === '') return { ok: false, code: 'invalid-url', message: 'Chain URLs must be non-empty strings.' };
  let parsed: URL;
  try { parsed = new URL(value); } catch { return { ok: false, code: 'invalid-url', message: 'Chain URL is not valid.' }; }
  if (parsed.username !== '' || parsed.password !== '' || credentialPath(parsed) || [...parsed.searchParams.keys()].some(key => /(?:key|token|secret|credential|auth)/i.test(key))) return { ok: false, code: 'credential-url', message: 'Credentials are not allowed in chain URLs.' };
  if (isPrivateHost(parsed.hostname) && !(development && isLocalHost(parsed.hostname))) return { ok: false, code: 'invalid-url', message: 'Private network URLs are not allowed.' };
  if (parsed.protocol !== 'https:' && !(development && isLocalHost(parsed.hostname) && parsed.protocol === 'http:')) return { ok: false, code: 'invalid-url', message: 'Chain URLs must use HTTPS; HTTP is limited to localhost development.' };
  return null;
}

function normalizeInput(input: CustomChainInput, development: boolean): ChainResult<Omit<EvmChain, 'builtin' | 'family' | 'capabilities'>> {
  const nativeDecimals = input.nativeDecimals === undefined ? DEFAULT_NATIVE_DECIMALS : input.nativeDecimals;
  if (typeof input.chainId !== 'number' || !Number.isSafeInteger(input.chainId) || input.chainId <= 0 || typeof input.name !== 'string' || input.name.trim() === '' || typeof input.nativeAsset !== 'string' || input.nativeAsset.trim() === '' || !isNativeDecimals(nativeDecimals) || typeof input.rpcUrl !== 'string' || typeof input.explorerBaseUrl !== 'string') return { ok: false, code: 'invalid-chain', message: 'Custom chain fields are invalid.' };
  const rpcError = validateEndpointUrl(input.rpcUrl, development);
  if (rpcError) return rpcError;
  const explorerError = validateEndpointUrl(input.explorerBaseUrl, development);
  if (explorerError) return explorerError;
  return { ok: true, value: { chainId: input.chainId, name: input.name.trim(), nativeAsset: input.nativeAsset.trim(), nativeDecimals, rpcUrl: input.rpcUrl, explorerBaseUrl: input.explorerBaseUrl } };
}

export function validateCustomChain(input: CustomChainInput, existingIds: readonly number[] = [], development = false): ChainResult<EvmChain> {
  const normalized = normalizeInput(input, development);
  if (!normalized.ok) return normalized;
  if (COMMON_EVM_CHAINS.some(item => item.chainId === normalized.value.chainId) || existingIds.includes(normalized.value.chainId)) return { ok: false, code: 'duplicate-chain-id', message: 'Chain id is already registered.' };
  return { ok: true, value: { ...normalized.value, family: 'evm', capabilities: { ...capabilities }, builtin: false } };
}

export interface ChainRegistry {
  list(): readonly EvmChain[];
  add(input: CustomChainInput): ChainResult<EvmChain>;
  update(chainId: number, input: CustomChainInput): ChainResult<EvmChain>;
  remove(chainId: number): ChainResult<void>;
}

export function createChainRegistry(development = false): ChainRegistry {
  let custom: EvmChain[] = [];
  const list = (): readonly EvmChain[] => [...COMMON_EVM_CHAINS, ...custom];
  const add = (input: CustomChainInput): ChainResult<EvmChain> => {
    const result = validateCustomChain(input, custom.map(item => item.chainId), development);
    if (!result.ok) return result;
    custom = [...custom, result.value];
    return result;
  };
  const update = (chainId: number, input: CustomChainInput): ChainResult<EvmChain> => {
    if (COMMON_EVM_CHAINS.some(item => item.chainId === chainId)) return { ok: false, code: 'builtin-protected', message: 'Built-in chains cannot be overwritten.' };
    if (!custom.some(item => item.chainId === chainId)) return { ok: false, code: 'not-found', message: 'Custom chain was not found.' };
    const result = normalizeInput(input, development);
    if (!result.ok) return result;
    if (result.value.chainId !== chainId && (COMMON_EVM_CHAINS.some(item => item.chainId === result.value.chainId) || custom.some(item => item.chainId === result.value.chainId))) return { ok: false, code: 'duplicate-chain-id', message: 'Chain id is already registered.' };
    const updated = { ...result.value, family: 'evm' as const, capabilities: { ...capabilities }, builtin: false };
    custom = custom.map(item => item.chainId === chainId ? updated : item);
    return { ok: true, value: updated };
  };
  const remove = (chainId: number): ChainResult<void> => {
    if (COMMON_EVM_CHAINS.some(item => item.chainId === chainId)) return { ok: false, code: 'builtin-protected', message: 'Built-in chains cannot be deleted.' };
    if (!custom.some(item => item.chainId === chainId)) return { ok: false, code: 'not-found', message: 'Custom chain was not found.' };
    custom = custom.filter(item => item.chainId !== chainId);
    return { ok: true, value: undefined };
  };
  return { list, add, update, remove };
}

export interface ChainResolutionSettings {
  readonly customChains: readonly CustomChainLike[];
  readonly rpcOverrides: readonly ChainRpcOverrideLike[];
  readonly enabledChainIds: readonly number[];
}

export interface CustomChainLike {
  readonly chainId: number;
  readonly name: string;
  readonly nativeAsset: string;
  readonly nativeDecimals?: number;
  readonly rpcUrl: string;
  readonly explorerBaseUrl: string;
}

export interface ChainRpcOverrideLike {
  readonly chainId: number;
  readonly rpcUrl: string;
}

export function resolveChains(settings: ChainResolutionSettings, development = false): readonly EvmChain[] {
  const customs: EvmChain[] = [];
  for (const item of settings.customChains) {
    const result = validateCustomChain({ ...item, nativeDecimals: item.nativeDecimals === undefined ? DEFAULT_NATIVE_DECIMALS : item.nativeDecimals }, [...customs.map(chainItem => chainItem.chainId)], development);
    if (result.ok) customs.push(result.value);
  }
  const overrides = new Map<number, string>();
  for (const override of settings.rpcOverrides) {
    if (validateEndpointUrl(override.rpcUrl, development) === null) overrides.set(override.chainId, override.rpcUrl);
  }
  const all = [...COMMON_EVM_CHAINS, ...customs].map(item => overrides.has(item.chainId) ? { ...item, rpcUrl: overrides.get(item.chainId)! } : item);
  return settings.enabledChainIds.length === 0 ? all : all.filter(item => settings.enabledChainIds.includes(item.chainId));
}
