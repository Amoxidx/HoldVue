import type { ContextBridgeLike, HoldVueApi, IpcRendererLike } from './preload-api.d.ts';

function createPreloadApi(ipcRenderer: IpcRendererLike): HoldVueApi {
  return {
    getState: () => ipcRenderer.invoke('holdvue:state') as ReturnType<HoldVueApi['getState']>,
    detectWalletAddress: address => ipcRenderer.invoke('holdvue:detect-wallet', address) as ReturnType<HoldVueApi['detectWalletAddress']>,
    addWallet: input => ipcRenderer.invoke('holdvue:add-wallet', input) as ReturnType<HoldVueApi['addWallet']>,
    updateWallet: (id, input) => ipcRenderer.invoke('holdvue:update-wallet', { id, wallet: input }) as ReturnType<HoldVueApi['updateWallet']>,
    deleteWallet: id => ipcRenderer.invoke('holdvue:delete-wallet', id) as ReturnType<HoldVueApi['deleteWallet']>,
    copyWalletAddress: id => ipcRenderer.invoke('holdvue:copy-wallet-address', id) as ReturnType<HoldVueApi['copyWalletAddress']>,
    searchInstruments: query => ipcRenderer.invoke('holdvue:search-instruments', query) as ReturnType<HoldVueApi['searchInstruments']>,
    addHolding: input => ipcRenderer.invoke('holdvue:add-holding', input) as ReturnType<HoldVueApi['addHolding']>,
    updateHolding: (id, input) => ipcRenderer.invoke('holdvue:update-holding', { id, holding: input }) as ReturnType<HoldVueApi['updateHolding']>,
    deleteHolding: id => ipcRenderer.invoke('holdvue:delete-holding', id) as ReturnType<HoldVueApi['deleteHolding']>,
    setEtherscanKey: value => ipcRenderer.invoke('holdvue:set-etherscan-key', value) as ReturnType<HoldVueApi['setEtherscanKey']>,
    deleteEtherscanKey: () => ipcRenderer.invoke('holdvue:delete-etherscan-key') as ReturnType<HoldVueApi['deleteEtherscanKey']>,
    setFmpKey: value => ipcRenderer.invoke('holdvue:set-fmp-key', value) as ReturnType<HoldVueApi['setFmpKey']>,
    deleteFmpKey: () => ipcRenderer.invoke('holdvue:delete-fmp-key') as ReturnType<HoldVueApi['deleteFmpKey']>,
    updateSettings: settings => ipcRenderer.invoke('holdvue:update-settings', settings) as ReturnType<HoldVueApi['updateSettings']>,
    refresh: () => ipcRenderer.invoke('holdvue:refresh') as ReturnType<HoldVueApi['refresh']>,
    onMinute(callback) {
      ipcRenderer.on('holdvue:minute', callback);
      return () => ipcRenderer.removeListener('holdvue:minute', callback);
    }
  };
}

function installPreloadBridge(contextBridge: ContextBridgeLike, ipcRenderer: IpcRendererLike): HoldVueApi {
  const api = createPreloadApi(ipcRenderer);
  contextBridge.exposeInMainWorld('holdvue', api);
  return api;
}

function loadRuntimeModule(name: string): Record<string, unknown> {
  return require(name) as Record<string, unknown>;
}

function startPreload(load: (name: string) => Record<string, unknown> = loadRuntimeModule): HoldVueApi {
  const electron = load('electron') as { contextBridge: ContextBridgeLike; ipcRenderer: IpcRendererLike };
  return installPreloadBridge(electron.contextBridge, electron.ipcRenderer);
}

function runPreload(isElectron: boolean, launch: () => unknown = startPreload): unknown {
  if (isElectron) return launch();
  return null;
}

runPreload(Boolean(process.versions.electron));

module.exports = { createPreloadApi, installPreloadBridge, loadRuntimeModule, startPreload, runPreload };
