const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('aztecDesktop', {
  isElectron: true,
  onToggleDictation: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('aztec:toggle-dictation', handler);
    return () => ipcRenderer.removeListener('aztec:toggle-dictation', handler);
  },
  getShortcutStatus: () => ipcRenderer.invoke('aztec:get-shortcut-status'),
  setShortcut: (accelerator) => ipcRenderer.invoke('aztec:set-shortcut', accelerator),
  transcribeWav: (wavBuffer, lang) =>
    ipcRenderer.invoke('aztec:transcribe-wav', { wavBuffer, lang }),
});
