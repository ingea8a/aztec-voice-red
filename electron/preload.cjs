const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('aztecDesktop', {
  onToggleDictation: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('aztec:toggle-dictation', handler);
    return () => ipcRenderer.removeListener('aztec:toggle-dictation', handler);
  },
});
