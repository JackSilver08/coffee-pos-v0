import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('pos', {
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  printReceipt: (receipt) => ipcRenderer.invoke('app:printReceipt', receipt)
});
