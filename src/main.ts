import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMainComposition, type MainComposition, type MainCompositionOptions } from './main-app.ts';
import { LocalMinuteScheduler } from './shared/scheduler.ts';
import { JsonFileStateStorage } from './shared/storage.ts';
import type { Clock, IdFactory } from './shared/state.ts';
import { createEvmAdapter, createBitcoinAdapter, createSolanaAdapter, createCardanoAdapter, createEtherscanRateLimiter } from './shared/adapters.ts';
import { resolveChains } from './shared/chains.ts';
import { createJsonRpcPort, createScanCoordinator } from './shared/scanner.ts';
import { createFetchTransport } from './shared/transport.ts';
import { createSyncCoordinator } from './shared/sync.ts';
import { createSafeStorageSecretStore, JsonEncryptedBlobStore, type SafeStorageLike } from './shared/secrets.ts';
import { createCombinedSearchAdapter, createFmpSearchAdapter, createLocalCatalogSearchAdapter, createYahooSearchAdapter } from './shared/market.ts';
import { createCoinGeckoPriceAdapter, createFmpQuoteAdapter, createPricingCoordinator, createYahooQuoteAdapter } from './shared/pricing.ts';
import type { StateStorage } from './shared/storage.ts';
import type { SecretStore } from './shared/secrets.ts';

type ElectronLoader = (name: string) => Record<string, unknown>;
type CompositionFactory = (options: MainCompositionOptions) => MainComposition;

export function createProductionIdFactory(): IdFactory {
  return { next: () => randomUUID() };
}

export function createSystemClock(): Clock {
  return { now: () => Date.now() };
}

export function createFmpKeyGetter(storage: StateStorage, secrets: SecretStore): () => Promise<string | null> {
  return async () => {
    const state = await storage.load();
    const keyId = state.settings.providerRefs.find(item => item.providerId === 'fmp.market' && item.enabled)?.keyId;
    if (!keyId) return null;
    const result = secrets.get(keyId);
    return result.ok ? result.value : null;
  };
}

export function buildRuntimePaths(moduleUrl: string): { preload: string; renderer: string; icon: string } {
  const moduleDirectory = dirname(fileURLToPath(moduleUrl));
  return {
    preload: join(moduleDirectory, 'preload.cjs'),
    renderer: join(moduleDirectory, 'renderer', 'index.html'),
    icon: join(moduleDirectory, 'renderer', 'holdvue-window-icon.png')
  };
}

export function loadRuntimeModule(name: string): Record<string, unknown> {
  return createRequire(import.meta.url)(name) as Record<string, unknown>;
}

export function startMain(load: ElectronLoader = loadRuntimeModule, factory: CompositionFactory = createMainComposition): MainComposition {
  const electron = load('electron') as {
    app: MainCompositionOptions['app'];
    BrowserWindow: MainCompositionOptions['BrowserWindow'];
    ipcMain: MainCompositionOptions['ipcMain'];
    clipboard: { writeText(value: string): void };
    shell: { openExternal(url: string): void | Promise<void> };
    safeStorage?: SafeStorageLike;
  };
  let composition: MainComposition;
  const scheduler = new LocalMinuteScheduler({ onMinute: () => composition.emitMinute() });
  const transport = createFetchTransport();
  const rpc = createJsonRpcPort(transport);
  const storage = new JsonFileStateStorage(join(electron.app.getPath('userData'), 'holdvue-state.json'));
  const secrets = createSafeStorageSecretStore(electron.safeStorage, new JsonEncryptedBlobStore(join(electron.app.getPath('userData'), 'holdvue-secrets.json')));
  const getFmpKey = createFmpKeyGetter(storage, secrets);
  const instrumentSearch = createCombinedSearchAdapter([
    createLocalCatalogSearchAdapter(),
    createYahooSearchAdapter({ http: transport }),
    createFmpSearchAdapter({ http: transport, getApiKey: getFmpKey })
  ]);
  const nativeCoordinator = createScanCoordinator(4);
  const etherscanRateLimiter = createEtherscanRateLimiter();
  const pricingCoordinator = createPricingCoordinator({
    now: Date.now,
    providers: [
      createCoinGeckoPriceAdapter({ http: transport }),
      createYahooQuoteAdapter({ http: transport }),
      createFmpQuoteAdapter({
        http: transport,
        getApiKey: getFmpKey
      })
    ]
  });
  const syncCoordinator = createSyncCoordinator({
    adapters: [],
    ids: createProductionIdFactory(),
    now: () => Date.now(),
    adapterFactory: state => {
      const providerEndpoints = new Map(state.settings.providerEndpoints.filter(item => item.enabled).map(item => [item.providerId, item.endpoint]));
      const endpoint = (providerId: string): string | undefined => providerEndpoints.get(providerId);
      const keyId = state.settings.providerRefs.find(item => item.providerId === 'evm.erc20' && item.enabled)?.keyId;
      const chains = resolveChains(state.settings);
      return [
        createEvmAdapter({ chains, rpc: chains.some(chain => chain.rpcUrl !== null) ? rpc : undefined, scanCoordinator: nativeCoordinator, etherscanRateLimiter, erc20: { endpoint: 'https://api.etherscan.io/v2/api', keyId } }),
        createBitcoinAdapter(),
        createSolanaAdapter({ endpoint: endpoint('solana.rpc') }),
        createCardanoAdapter({ mainnetEndpoint: endpoint('cardano.koios'), testnetEndpoint: endpoint('cardano.koios.testnet') })
      ];
    },
    pricing: pricingCoordinator
  });
  composition = factory({
    app: electron.app,
    BrowserWindow: electron.BrowserWindow,
    ipcMain: electron.ipcMain,
    storage,
    scheduler,
    clipboard: electron.clipboard,
    shell: electron.shell,
    secrets,
    instrumentSearch,
    ids: createProductionIdFactory(),
    clock: createSystemClock(),
    paths: buildRuntimePaths(import.meta.url),
    platform: process.platform,
    sync: { coordinator: syncCoordinator, context: { http: transport, rpc, secrets } }
  });
  void composition.start();
  return composition;
}

export function runEntry(isElectron: boolean, launch: () => unknown = startMain): unknown {
  if (isElectron) return launch();
  return null;
}

runEntry(Boolean(process.versions.electron));
