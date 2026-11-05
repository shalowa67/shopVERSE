// Exposes one safe function to the bundled offline page; the website itself gets no extra powers.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('shopverseDesktop', {
  retry: (target) => ipcRenderer.send('shopverse:retry', String(target || ''))
});
