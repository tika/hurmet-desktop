// Bridges the page's in-memory file handle to the main process, so that
// saving routes to the file the user opened in the native dialog.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('hurmetDesktop', {
  writeFile: (content) => ipcRenderer.invoke('hurmet:write-file', content),
  saveFile: (content, saveAs) => ipcRenderer.invoke('hurmet:save-file', content, saveAs),
  setMenus: (menus) => ipcRenderer.send('hurmet:set-menus', menus),
  updateMenus: (states) => ipcRenderer.send('hurmet:update-menus', states),
  showContextMenu: (id, items) => ipcRenderer.send('hurmet:show-context-menu', id, items),
  onContextMenu: (callback) => {
    const listener = (_event, request) => callback(request)
    ipcRenderer.on('hurmet:context-menu', listener)
    return () => ipcRenderer.removeListener('hurmet:context-menu', listener)
  },
  onMenuCommand: (callback) => {
    const listener = (_event, id) => callback(id)
    ipcRenderer.on('hurmet:menu-command', listener)
    return () => ipcRenderer.removeListener('hurmet:menu-command', listener)
  }
})
