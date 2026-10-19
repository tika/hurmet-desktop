// Hurmet Desktop — an Electron shell around the built Hurmet web app.
//
// Loads the built assets in `site/` over a custom protocol and bridges the
// editor's commands to native application menus and file dialogs.
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
const os = require('os')
const fs = require('fs')
const fsp = require('fs/promises')
const { pathToFileURL } = require('url')
const { WebSocketServer } = require('ws')

const siteDir = path.join(__dirname, '..', 'site')

let win = null
let currentFile = null
let wss = null
let wsPort = 0

// ---------------------------------------------------------------
// Font configuration
// ---------------------------------------------------------------
// Optional per-user font overrides, read once at startup from
// ~/.hurmet-desktop.json:
//
//   { "fonts": { "body": "Literata", "code": "Maple Mono" } }
//
// "body" sets the document and heading typeface; "code" sets code
// blocks and calculation source zones. Absent keys, a missing file,
// or malformed JSON all fall back to the app's defaults.
function loadFontConfig() {
  try {
    const file = path.join(os.homedir(), '.hurmet-desktop.json')
    const fonts = JSON.parse(fs.readFileSync(file, 'utf8')).fonts || {}
    // Font names end up inside a CSS string, so drop quote characters.
    const safe = (name) =>
      typeof name === 'string' ? name.replace(/[\\"']/g, '').trim() : ''
    return { body: safe(fonts.body), code: safe(fonts.code) }
  } catch {
    return {}
  }
}

function fontOverrideCss({ body, code }) {
  let css = ''
  if (body) {
    css += `.ProseMirror, .ProseMirror p, .ProseMirror h1, .ProseMirror h2, .ProseMirror h3, .ProseMirror h4, .ProseMirror h5, .ProseMirror h6 { ` +
      `font-family: "${body}", Calibri, 'Helvetica Neue', Arial, Cambria, sans-serif; }\n`
  }
  if (code) {
    css += `.ProseMirror code, .ProseMirror pre, .ProseMirror pre code, .hmt-code { ` +
      `font-family: "${code}", Consolas, "Liberation Mono", Courier, monospace; }\n`
  }
  return css
}

const fontCss = fontOverrideCss(loadFontConfig())

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

ipcMain.handle('hurmet:save-file', async (event, content, saveAs) => {
  if (!win || event.sender !== win.webContents) return null
  try {
    let destination = currentFile
    if (saveAs || !destination) {
      const result = await dialog.showSaveDialog(win, {
        defaultPath: currentFile || 'Untitled.md',
        filters: [{ name: 'Hurmet Markdown', extensions: ['md'] }]
      })
      if (result.canceled || !result.filePath) return null
      destination = result.filePath
    }
    await fsp.writeFile(destination, content, 'utf8')
    currentFile = destination
    const fileName = path.basename(destination)
    await win.webContents.executeJavaScript(
      `(${installFileHandle.toString()})(${JSON.stringify(fileName)})`, true
    )
    return fileName
  } catch (error) {
    dialog.showErrorBox('Could Not Save', error.message)
    return null
  }
})

// Triggers the page's own save. Its keymap binds save to Ctrl-s (the plain
// control key, even on macOS), so send a control+S key event.
function triggerInPageSave() {
  if (!win || win.isDestroyed()) return
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 's', modifiers: ['ctrl'] })
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 's', modifiers: ['ctrl'] })
}

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
    if (fontCss) win.webContents.insertCSS(fontCss)
    win.webContents.executeJavaScript(
      "if (document.title === 'Hurmet.org') document.title = 'Untitled';" +
      'if (window.view) window.__hurmetBaseline = window.view.state.doc;' +
      `(${installChangeTimestamp.toString()})()`,
      true
    ).catch(() => {})
  })

// Runs in the renderer. Records when the document last changed, so the main
// process can debounce autosave.
function installChangeTimestamp() {
  if (window.__hurmetTimestampInstalled) return
  window.__hurmetTimestampInstalled = true
  window.__hurmetLastChangeAt = Date.now()
  const view = window.view
  const origDispatch = view.dispatch.bind(view)
  view.dispatch = (tr) => {
    window.__hurmetLastChangeAt = Date.now()
    origDispatch(tr)
  }
}

  // Mirror the document's unsaved-changes state onto the native window:
  // the close-button dot and the proxy icon for the open file. The page's
  // doc is immutable, so a changed identity means unsaved edits. When
  // changes have sat unsaved for a moment and a file is open, autosave by
  // triggering the page's own save (synthetic Cmd-S, which its keymap binds
  // to the in-place save path).
  let saving = false
  const AUTOSAVE_IDLE_MS = 2000
  const dirtyPoll = setInterval(async () => {
    if (!win || win.isDestroyed()) { clearInterval(dirtyPoll); return }
    try {
      const state = await win.webContents.executeJavaScript(
        `({
          dirty: !!(window.view && window.__hurmetBaseline) &&
            window.view.state.doc !== window.__hurmetBaseline,
          lastChangeAt: window.__hurmetLastChangeAt || 0
        })`,
        true
      )
      win.setDocumentEdited(state.dirty)
      if (currentFile) win.setRepresentedFilename(currentFile)
      if (state.dirty && currentFile && !saving &&
          Date.now() - state.lastChangeAt > AUTOSAVE_IDLE_MS) {
        saving = true
        triggerInPageSave()
        setTimeout(() => { saving = false }, 1000)
      }
    } catch { /* page mid-reload; ignore */ }
  }, 600)

  win.once('ready-to-show', () => win.show())
  win.loadURL(`hurmet://site/index.html#${wsPort}`)
  return win
}

// ---------------------------------------------------------------
// Native application menu
// ---------------------------------------------------------------
function buildMenu(editorMenus) {
  const nativeItems = (items) => items.map((item) => {
    if (item.submenu) return { label: item.label, submenu: nativeItems(item.submenu) }
    if (item.role) return { role: item.role }
    if (item.type === 'separator') return { type: 'separator' }
    return {
      id: item.id,
      label: item.label,
      accelerator: item.accelerator,
      type: item.type || 'normal',
      checked: !!item.checked,
      click: item.id === 'open' ? openFileViaDialog : () => {
        if (win && !win.isDestroyed()) win.webContents.send('hurmet:menu-command', item.id)
      }
    }
  })
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
    ...(editorMenus ? nativeItems(editorMenus) : [{
      label: 'File',
      submenu: [
        { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: openFileViaDialog },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: triggerInPageSave },
        { type: 'separator' },
        process.platform === 'darwin' ? { role: 'close' } : { role: 'quit' }
      ]
    },
    { role: 'editMenu' }]),
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

ipcMain.on('hurmet:set-menus', (event, menus) => {
  if (win && event.sender === win.webContents) buildMenu(menus)
})

ipcMain.on('hurmet:update-menus', (event, states) => {
  if (!win || event.sender !== win.webContents) return
  const menu = Menu.getApplicationMenu()
  for (const state of states) {
    const item = menu?.getMenuItemById(state.id)
    if (item) {
      item.enabled = state.enabled
      if (item.type === 'checkbox') item.checked = state.checked
    }
  }
})

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
