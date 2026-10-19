// Smoke test for the Hurmet Desktop shell. Not part of the app.
// Enabled by setting HURMET_DESKTOP_SMOKE=1. Loads a real document through
// the shell's open pipeline, checks the editor state, verifies autosave,
// captures screenshots, and writes results to .amp/in/artifacts/.
const fs = require('fs')
const path = require('path')

module.exports = async function smoke({ win, loadFile, wss }) {
  const outDir = path.join(__dirname, '..', '.amp', 'in', 'artifacts')
  fs.mkdirSync(outDir, { recursive: true })
  const results = {}
  const fail = (msg) => {
    fs.writeFileSync(path.join(outDir, 'smoke-results.json'), JSON.stringify({ ...results, failed: msg }, null, 2))
    process.exitCode = 1
    appQuit()
  }

  const appQuit = () => {
    const { app } = require('electron')
    app.exit(process.exitCode || 0)
  }

  try {
    // Wait for the page's module bundle to create the editor and connect to
    // the file feed.
    await win.webContents.executeJavaScript(
      'new Promise((resolve, reject) => { const t0 = Date.now(); const check = () => window.view ? resolve(true) : Date.now() - t0 > 15000 ? reject(new Error("view never appeared")) : setTimeout(check, 100); check() })',
      true
    )
    const waitConnected = () => new Promise((resolve, reject) => {
      const t0 = Date.now()
      const check = () => wss.clients.size > 0
        ? resolve(true)
        : Date.now() - t0 > 5000 ? reject(new Error('page never connected to file feed')) : setTimeout(check, 100)
      check()
    })
    await waitConnected()
    results.pageConnected = true

    // Collect renderer console errors (parse/render failures surface here).
    const consoleErrors = []
    win.webContents.on('console-message', (_e, level, message) => {
      if (level >= 2) consoleErrors.push(message.slice(0, 300))
    })
    results._consoleErrors = consoleErrors

    results.showSaveFilePicker = await win.webContents.executeJavaScript(
      'typeof window.showSaveFilePicker', true)
    results.serviceWorkerBlocked = await win.webContents.executeJavaScript(
      '!("serviceWorker" in navigator) || navigator.serviceWorker.controller === null', true)

    // Open a real document through the shell pipeline, unless asked to
    // capture the empty launch state. Always use a scratch copy: autosave
    // writes back to the opened path, and repo files must not be modified.
    if (!process.env.HURMET_SMOKE_EMPTY) {
      const doc = process.env.HURMET_SMOKE_DOC ||
        path.join(__dirname, '..', 'test', 'Trial.md')
      const scratch = path.join(outDir, 'scratch-open.md')
      fs.copyFileSync(doc, scratch)
      await loadFile(scratch)
      await new Promise((r) => setTimeout(r, 2500))
    }

    results.windowTitle = await win.webContents.executeJavaScript('document.title', true)
    results.docContentSize = await win.webContents.executeJavaScript(
      'window.view.state.doc.content.size', true)
    results.mathRendered = await win.webContents.executeJavaScript(
      'document.querySelectorAll("#editor-content math").length', true)
    results.fileHandleInstalled = await win.webContents.executeJavaScript(
      '!!window.view.state.doc.attrs.fileHandle && window.view.state.doc.attrs.saveIsValid === true', true)
    results.webChromeHidden = await win.webContents.executeJavaScript(
      'getComputedStyle(document.querySelector("nav")).display === "none"', true)

    const image = await win.webContents.capturePage()
    fs.writeFileSync(path.join(outDir, 'smoke-screenshot.png'), image.toPNG())

    // Open the File dropdown and capture the menu panel styling.
    const opened = await win.webContents.executeJavaScript(
      `(() => {
        const btn = [...document.querySelectorAll('.ProseMirror-menubar button.ProseMirror-menu-dropdown')]
          .find(b => b.textContent.trim().startsWith('File'))
        if (!btn) return false
        btn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        return true
      })()`,
      true
    )
    results.fileDropdownOpened = opened
    if (opened) {
      await new Promise((r) => setTimeout(r, 400))
      const menuImage = await win.webContents.capturePage()
      fs.writeFileSync(path.join(outDir, 'dropdown-open.png'), menuImage.toPNG())
    }

    // Autosave regression test: edit the doc, then wait for the change to
    // reach disk through the shell's save pipeline.
    const scratch = path.join(outDir, 'scratch-autosave.md')
    fs.copyFileSync(path.join(__dirname, '..', 'test', 'Trial.md'), scratch)
    await loadFile(scratch)
    await new Promise((r) => setTimeout(r, 1200))
    await win.webContents.executeJavaScript(
      "window.view.dispatch(window.view.state.tr.insertText('AUTOSAVE_MARKER ', 1))",
      true
    )
    const t0 = Date.now()
    results.autosavePersisted = false
    while (Date.now() - t0 < 12000) {
      await new Promise((r) => setTimeout(r, 700))
      // The serializer escapes underscores ("AUTOSAVE\_MARKER").
      if (fs.readFileSync(scratch, 'utf8').includes('AUTOSAVE')) {
        results.autosavePersisted = true
        results.autosaveSeconds = Math.round((Date.now() - t0) / 100) / 10
        results.dirtyAfterAutosave = await win.webContents.executeJavaScript(
          'window.view.state.doc !== window.__hurmetBaseline', true)
        break
      }
    }

    fs.writeFileSync(path.join(outDir, 'smoke-results.json'), JSON.stringify(results, null, 2))
    appQuit()
  } catch (err) {
    fail(err.message)
  }
}
