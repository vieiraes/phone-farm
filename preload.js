const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('farm', {
  getState: () => ipcRenderer.invoke('get-state'),
  sync: (entries) => ipcRenderer.send('sync', entries),
  openApp: (phoneId, url) => ipcRenderer.invoke('open-app', phoneId, url),
  addApp: (url) => ipcRenderer.invoke('add-app', url),
  addPhone: (deviceId) => ipcRenderer.invoke('add-phone', deviceId),
  setPrefs: (prefs) => ipcRenderer.invoke('set-prefs', prefs),
  navBack: (phoneId, url) => ipcRenderer.send('nav-back', phoneId, url),
  phoneMenu: (phoneId, activeUrl) => ipcRenderer.send('phone-menu', phoneId, activeUrl),
  iconMenu: (phoneId, url) => ipcRenderer.send('icon-menu', phoneId, url),
  memory: () => ipcRenderer.invoke('memory'),
  about: () => ipcRenderer.send('about'),
  removeAllPhones: () => ipcRenderer.invoke('remove-all-phones'),
  onConfig: (fn) => ipcRenderer.on('config', (_e, cfg) => fn(cfg)),
  onAppClosed: (fn) => ipcRenderer.on('app-closed', (_e, phoneId, url) => fn(phoneId, url)),
});
