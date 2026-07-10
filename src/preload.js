const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getDefaultFolder: () => ipcRenderer.invoke('get-default-folder'),
  setTheme: (theme) => ipcRenderer.invoke('set-theme', theme),
  pickFolder: (currentFolder, title) => ipcRenderer.invoke('pick-folder', currentFolder, title),
  getThumbnail: (path) => ipcRenderer.invoke('get-thumbnail', path),
  openFile: (path) => ipcRenderer.invoke('open-file', path),
  showInFolder: (path) => ipcRenderer.invoke('show-in-folder', path),
  startSearch: (options) => ipcRenderer.send('search-start', options),
  cancelSearch: () => ipcRenderer.send('search-cancel'),
  onResults: (fn) => ipcRenderer.on('search-results', (e, batch) => fn(batch)),
  onDone: (fn) => ipcRenderer.on('search-done', (e, stats) => fn(stats)),
  onError: (fn) => ipcRenderer.on('search-error', (e, message) => fn(message)),
});
