// Smoke test for the Hurmet Desktop shell. Not part of the app.
// Enabled by setting HURMET_DESKTOP_SMOKE=1. Loads a real document through
// the shell's open pipeline, checks the editor state, captures a screenshot,
// and writes results to .amp/in/artifacts/.
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
    // capture the empty launch state.
    if (!process.env.HURMET_SMOKE_EMPTY) {
      const doc = process.env.HURMET_SMOKE_DOC ||
        path.join(__dirname, '..', 'test', 'Trial.md')
      await loadFile(doc)
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

    // Diagnose any failed images (drawings render to <img> data URLs).
    results.images = await win.webContents.executeJavaScript(
      `[...document.querySelectorAll('#editor-content img')].slice(0, 5).map(img => ({
        alt: img.alt, srcType: (img.src || '').slice(0, 30),
        complete: img.complete, w: img.naturalWidth, h: img.naturalHeight
      }))`, true)

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

    fs.writeFileSync(path.join(outDir, 'smoke-results.json'), JSON.stringify(results, null, 2))
    appQuit()
  } catch (err) {
    fail(err.message)
  }
}
