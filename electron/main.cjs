// Hurmet Desktop — an Electron shell around the built Hurmet web app.
//
// This shell makes no changes to the upstream Hurmet sources. It loads the
// built assets in `site/` over a custom protocol, and uses two upstream
// pathways for file I/O:
//
// - Open:  a native dialog picks a file; its markdown is pushed into the
//          editor over a loopback WebSocket, which the page already listens
//          for on startup (src/index.js connects to ws://localhost:<port>
//          when the URL hash is a port number).
// - Save:  Cmd-S is already bound in the page to save via the File System
//          Access API. After a file is opened here, we install a file handle
//          that routes writes back to this process, so Cmd-S saves in place
//          with no dialog.

const { app, BrowserWindow, Menu, dialog, ipcMain, protocol, net, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const fsp = require('fs/promises')
const { pathToFileURL } = require('url')
const { WebSocketServer } = require('ws')

const siteDir = path.join(__dirname, '..', 'site')

let win = null
let currentFile = null
let wss = null
let wsPort = 0

// The site uses absolute asset paths and ES modules, so serve it over a
// standard scheme rather than file://.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'hurmet',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  }
])

// ---------------------------------------------------------------
// Loopback file feed: the page connects at startup (via the URL
// hash) and receives markdown documents as `{type: "update"}`.
// ---------------------------------------------------------------
function startFileFeedServer() {
  wss = new WebSocketServer({ port: 0, host: '127.0.0.1' })
  return new Promise((resolve, reject) => {
    wss.once('error', reject)
    wss.once('listening', () => {
      wsPort = wss.address().port
      resolve(wsPort)
    })
  })
}

function broadcastContent(content) {
  const message = JSON.stringify({ type: 'update', content })
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) client.send(message)
  }
}

// ---------------------------------------------------------------
// File open / save plumbing
// ---------------------------------------------------------------
async function loadFile(filePath) {
  const content = await fsp.readFile(filePath, 'utf8')
  currentFile = filePath
  const fileName = path.basename(filePath)
  broadcastContent(content)
  // Install an in-page file handle so Cmd-S saves back to this path, and
  // show the file name in the window title.
  await win.webContents.executeJavaScript(
    `(${installFileHandle.toString()})(${JSON.stringify(fileName)})`,
    true
  )
}

// Runs in the renderer. Gives the page a FileSystem-like handle whose
// writable stream forwards the serialized markdown to the main process.
function installFileHandle(fileName) {
  const attrs = window.view.state.doc.attrs
  attrs.fileHandle = {
    name: fileName,
    createWritable: async () => {
      let data = ''
      return {
        async write(chunk) { data = chunk },
        async close() { await window.hurmetDesktop.writeFile(data) }
      }
    }
  }
  attrs.saveIsValid = true
  document.title = fileName.replace(/\.md$/, '')
  // The just-loaded document is the new "saved" baseline.
  window.__hurmetBaseline = window.view.state.doc
}

async function openFileViaDialog() {
  const result = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [
      { name: 'Hurmet Markdown', extensions: ['md'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  })
  if (!result.canceled && result.filePaths[0]) await loadFile(result.filePaths[0])
}

ipcMain.handle('hurmet:write-file', async (_event, content) => {
  if (!currentFile) throw new Error('No file is open.')
  await fsp.writeFile(currentFile, content, 'utf8')
  // Saved: the current document becomes the new baseline.
  if (win && !win.isDestroyed()) {
    await win.webContents.executeJavaScript(
      'window.__hurmetBaseline = window.view.state.doc', true
    ).catch(() => {})
  }
})

// ---------------------------------------------------------------
// Window
// ---------------------------------------------------------------
function openChildWindow(url) {
  if (/^https?:/.test(url)) {
    shell.openExternal(url)
    return
  }
  const child = new BrowserWindow({ width: 900, height: 900, backgroundColor: '#ffffff' })
  child.webContents.setWindowOpenHandler(({ url: next }) => {
    openChildWindow(next)
    return { action: 'deny' }
  })
  child.loadURL(url)
}

function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 820,
    minWidth: 540,
    minHeight: 400,
    show: false,
    backgroundColor: '#ffffff',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs')
    }
  })

  win.webContents.on('will-prevent-unload', (event) => {
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question',
      buttons: ['Leave', 'Stay'],
      defaultId: 1,
      message: 'Leave without saving?',
      detail: 'Changes you made may not be saved.'
    })
    if (choice === 0) event.preventDefault()
  })

  // Open external links in the system browser; open in-site pages (manual,
  // guides, samples) in a separate window so the editor stays put.
  win.webContents.setWindowOpenHandler(({ url }) => {
    openChildWindow(url)
    return { action: 'deny' }
  })

  // Hide web-only chrome and apply the shell's chrome styling.
  const shellCss = fs.readFileSync(path.join(__dirname, 'shell.css'), 'utf8')
  win.webContents.on('did-finish-load', () => {
    win.webContents.insertCSS(shellCss)
    win.webContents.executeJavaScript(
      "if (document.title === 'Hurmet.org') document.title = 'Untitled';" +
      'if (window.view) window.__hurmetBaseline = window.view.state.doc',
      true
    ).catch(() => {})
  })

  // Mirror the document's unsaved-changes state onto the native window:
  // the close-button dot and the proxy icon for the open file. The page's
  // doc is immutable, so a changed identity means unsaved edits.
  const dirtyPoll = setInterval(async () => {
    if (!win || win.isDestroyed()) { clearInterval(dirtyPoll); return }
    try {
      const dirty = await win.webContents.executeJavaScript(
        '!!(window.view && window.__hurmetBaseline) && window.view.state.doc !== window.__hurmetBaseline',
        true
      )
      win.setDocumentEdited(dirty)
      if (currentFile) win.setRepresentedFilename(currentFile)
    } catch { /* page mid-reload; ignore */ }
  }, 600)

  win.once('ready-to-show', () => win.show())
  win.loadURL(`hurmet://site/index.html#${wsPort}`)
  return win
}

// ---------------------------------------------------------------
// Native application menu
// ---------------------------------------------------------------
function buildMenu() {
  const template = [
    ...(process.platform === 'darwin'
      ? [{
          label: app.name,
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' }
          ]
        }]
      : []),
    {
      label: 'File',
      submenu: [
        { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: openFileViaDialog },
        { type: 'separator' },
        process.platform === 'darwin' ? { role: 'close' } : { role: 'quit' }
      ]
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(process.platform === 'darwin'
          ? [{ type: 'separator' }, { role: 'front' }]
          : [])
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Hurmet Documentation',
          click: () => openChildWindow('hurmet://site/manual.html')
        },
        {
          label: 'Calculation Tutorial',
          click: () => openChildWindow('hurmet://site/manual.html#calculation-tutorial')
        }
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// ---------------------------------------------------------------
// Startup
// ---------------------------------------------------------------
app.whenReady().then(async () => {
  protocol.handle('hurmet', async (request) => {
    const pathname = decodeURIComponent(new URL(request.url).pathname)
    if (pathname === '/sw.js') {
      // Keep the site's service worker (a web-app offline cache) out of the
      // desktop app.
      return new Response('', { status: 404 })
    }
    const filePath = path.join(siteDir, pathname)
    if (!filePath.startsWith(siteDir + path.sep)) {
      return new Response('Forbidden', { status: 403 })
    }
    try {
      return await net.fetch(pathToFileURL(filePath).toString())
    } catch {
      // Missing assets (e.g. the automatic /favicon.ico request) get a 404
      // rather than an unhandled loader error.
      return new Response('Not found', { status: 404 })
    }
  })

  await startFileFeedServer()
  buildMenu()

  // Accept a document path on launch: `electron . path/to/doc.md`
  const launchArg = process.argv.find(
    (arg, i) => i >= 1 && !arg.startsWith('-') && !arg.includes(path.join('electron', 'main')) && /\.md$/i.test(arg)
  )

  createWindow()

  if (launchArg) {
    win.webContents.once('did-finish-load', () => {
      loadFile(path.resolve(launchArg)).catch((err) => {
        dialog.showErrorBox('Hurmet', `Could not open ${launchArg}: ${err.message}`)
      })
    })
  }

  if (process.env.HURMET_DESKTOP_SMOKE) {
    require('./smoke.cjs')({ win, loadFile, wss })
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  app.quit()
})
