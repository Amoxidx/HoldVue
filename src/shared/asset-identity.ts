const EVM_NATIVE_COIN_IDS: Readonly<Record<number, string>> = Object.freeze({
  1: 'ethereum',
  10: 'ethereum',
  56: 'binancecoin',
  100: 'xdai',
  137: 'matic-network',
  324: 'ethereum',
  5000: 'mantle',
  8453: 'ethereum',
  42161: 'ethereum',
  42220: 'celo',
  43114: 'avalanche-2',
  59144: 'ethereum',
  534352: 'ethereum'
});

export function knownEvmNativeCoinId(chainId: number | null): string | undefined {
  return chainId === null ? undefined : EVM_NATIVE_COIN_IDS[chainId];
}

export function canonicalEvmNativeAssetId(chainId: number | null, positionAssetId: string): string {
  const normalizedAssetId = positionAssetId.toLowerCase();
  const coinId = knownEvmNativeCoinId(chainId);
  if (chainId !== null && coinId && normalizedAssetId === `native:${chainId}`) return `asset:evm:native:${coinId}`;
  return `asset:evm:${chainId ?? 'unknown'}:native:${normalizedAssetId}`;
}

export function canonicalizePersistedAssetId(assetId: string): string {
  const match = /^asset:evm:(\d+):native:native:(\d+)$/.exec(assetId);
  if (!match || match[1] !== match[2]) return assetId;
  const chainId = Number(match[1]);
  const coinId = knownEvmNativeCoinId(chainId);
  return coinId ? `asset:evm:native:${coinId}` : assetId;
}
