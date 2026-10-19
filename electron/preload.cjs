// Bridges the page's in-memory file handle to the main process, so that
// saving routes to the file the user opened in the native dialog.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('hurmetDesktop', {
  writeFile: (content) => ipcRenderer.invoke('hurmet:write-file', content)
})
