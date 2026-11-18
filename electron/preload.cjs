const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('voice8aDesktop', {
  isElectron: true,
  onToggleDictation: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('voice8a:toggle-dictation', handler);
    return () => ipcRenderer.removeListener('voice8a:toggle-dictation', handler);
  },
  getShortcutStatus: () => ipcRenderer.invoke('voice8a:get-shortcut-status'),
  setShortcut: (accelerator) => ipcRenderer.invoke('voice8a:set-shortcut', accelerator),
  transcribeWav: (wavBuffer, lang) =>
    ipcRenderer.invoke('voice8a:transcribe-wav', { wavBuffer, lang }),
});
