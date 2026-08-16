const { contextBridge } = require('electron');
const previewState = require('../test/fixtures/portfolio-preview.json');

const success = () => ({ ok: true, value: previewState });
const api = {
  getState: async () => success(),
  detectWalletAddress: async () => ({ ok: false, code: 'unsupported', message: 'Preview only.' }),
  addWallet: async () => success(),
  updateWallet: async () => success(),
  deleteWallet: async () => success(),
  copyWalletAddress: async () => ({ ok: false, code: 'unsupported', message: 'Preview only.' }),
  searchInstruments: async () => ({ ok: true, value: [] }),
  addHolding: async () => success(),
  updateHolding: async () => success(),
  deleteHolding: async () => success(),
  setEtherscanKey: async () => ({ ok: false, code: 'unsupported', message: 'Preview only.' }),
  deleteEtherscanKey: async () => success(),
  setFmpKey: async () => ({ ok: false, code: 'unsupported', message: 'Preview only.' }),
  deleteFmpKey: async () => success(),
  updateSettings: async () => success(),
  refresh: async () => success(),
  onMinute: () => () => {}
};

contextBridge.exposeInMainWorld('holdvue', api);
