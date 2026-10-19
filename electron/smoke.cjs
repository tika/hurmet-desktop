// Smoke test for the Hurmet Desktop shell. Not part of the app.
// Enabled by setting HURMET_DESKTOP_SMOKE=1. Loads a real document through
// the shell's open pipeline, checks the editor state, verifies autosave,
// captures screenshots, and writes results to .amp/in/artifacts/.
const fs = require('fs')
const path = require('path')
const assert = require('node:assert/strict')
const { Menu, dialog } = require('electron')

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

    await win.webContents.executeJavaScript(
      'void (window.__hurmetSmokeInitialDoc = window.view.state.doc)', true)
    const native = id => Menu.getApplicationMenu().getMenuItemById(id)
    assert.ok(native('saveFileAs'), 'Save As is available in the native File menu')
    assert.ok(native('insertCalculation'), 'Calculations are available in the native Insert menu')
    assert.equal(native('table-style-0').label, 'Grid')
    assert.equal(native('saveFile').enabled, true)
    await win.webContents.executeJavaScript(`(() => {
      const view = window.view
      view.dispatch(view.state.tr.setSelection(view.state.selection.constructor.near(
        view.state.doc.resolve(1))))
    })()`, true)
    native('toggleStrong').click()
    await new Promise(resolve => setTimeout(resolve, 150))
    assert.equal(await win.webContents.executeJavaScript(
      'window.view.state.storedMarks.some(mark => mark.type.name === "strong")', true), true)
    assert.equal(native('toggleStrong').checked, true)
    native('toggleStrong').click()
    await new Promise(resolve => setTimeout(resolve, 150))
    assert.equal(native('toggleStrong').checked, false)

    await win.webContents.executeJavaScript(
      'window.view.dispatch(window.view.state.tr.insertText("NATIVE_UNDO_TEST ", 1))', true)
    await new Promise(resolve => setTimeout(resolve, 150))
    assert.equal(native('undo').enabled, true)
    native('undo').click()
    await new Promise(resolve => setTimeout(resolve, 150))
    assert.equal(await win.webContents.executeJavaScript(
      'window.view.state.doc.textContent.includes("NATIVE_UNDO_TEST")', true), false)
    assert.equal(native('redo').enabled, true)
    native('redo').click()
    await new Promise(resolve => setTimeout(resolve, 150))
    assert.equal(await win.webContents.executeJavaScript(
      'window.view.state.doc.textContent.includes("NATIVE_UNDO_TEST")', true), true)
    native('undo').click()
    await new Promise(resolve => setTimeout(resolve, 150))
    results.nativeMenusWork = true

    results.toolbar = await win.webContents.executeJavaScript(`(() => {
      const toolbar = document.querySelector('.ProseMirror-menubar')
      const controls = [...toolbar.querySelectorAll('button, select')]
        .filter(element => element.getClientRects().length)
      return {
        count: controls.length,
        height: toolbar.getBoundingClientRect().height,
        labels: controls.map(element => element.getAttribute('aria-label') || element.textContent),
        rows: new Set(controls.map(element => Math.round(element.getBoundingClientRect().top))).size
      }
    })()`, true)
    assert.equal(results.toolbar.rows, 1, 'Everyday tools fit in one row')
    assert.ok(results.toolbar.count <= 8, 'Toolbar only shows everyday tools')
    assert.ok(!results.toolbar.labels.some(label => ['File', 'Doc'].includes(label)))

    // The style picker changes the document and tracks native menu changes.
    await win.webContents.executeJavaScript(`(() => {
      const select = document.querySelector('.desktop-text-style')
      select.value = 'makeHead2'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })()`, true)
    assert.equal(await win.webContents.executeJavaScript(
      'window.view.state.selection.$from.parent.attrs.level', true), 2)
    native('makeParagraph').click()
    await new Promise(resolve => setTimeout(resolve, 150))
    assert.equal(await win.webContents.executeJavaScript(
      'document.querySelector(".desktop-text-style").value', true), 'makeParagraph')

    assert.equal(native('addRowBefore').enabled, false)
    native('insertTable').click()
    await new Promise(resolve => setTimeout(resolve, 150))
    await win.webContents.executeJavaScript(`(() => {
      const view = window.view
      let tablePos = null
      view.state.doc.descendants((node, pos) => {
        if (node.type.name === 'table' && tablePos === null) tablePos = pos
      })
      view.dispatch(view.state.tr.setSelection(view.state.selection.constructor.near(
        view.state.doc.resolve(tablePos + 4))))
    })()`, true)
    await new Promise(resolve => setTimeout(resolve, 150))
    assert.equal(native('addRowBefore').enabled, true)
    assert.equal(await win.webContents.executeJavaScript(
      '!!document.querySelector("button.desktop-table-menu").getClientRects().length', true), true)
    native('addRowBefore').click()
    await new Promise(resolve => setTimeout(resolve, 150))
    assert.equal(await win.webContents.executeJavaScript(
      'document.querySelector("#editor-content table").rows.length', true), 4)
    results.contextualTableWorks = true

    // Restore the original document for the visual checks.
    await win.webContents.executeJavaScript(`(() => {
      const view = window.view
      const tr = view.state.tr.replaceWith(0, view.state.doc.content.size,
        window.__hurmetSmokeInitialDoc.content)
      tr.setSelection(view.state.selection.constructor.near(tr.doc.resolve(1)))
      view.dispatch(tr)
      delete window.__hurmetSmokeInitialDoc
    })()`, true)
    assert.equal(await win.webContents.executeJavaScript(
      '!!document.querySelector("button.desktop-table-menu").getClientRects().length', true), false)

    const image = await win.webContents.capturePage()
    fs.writeFileSync(path.join(outDir, 'smoke-screenshot.png'), image.toPNG())
    fs.writeFileSync(path.join(outDir, 'toolbar-preview.png'),
      (await win.webContents.capturePage({ x: 0, y: 0, width: 1100, height: 56 })).toPNG())

    // Open the compact Insert dropdown and capture its panel styling.
    const opened = await win.webContents.executeJavaScript(
      `(() => {
        const btn = [...document.querySelectorAll('.ProseMirror-menubar button.ProseMirror-menu-dropdown')]
          .find(b => b.textContent.trim() === 'Insert')
        if (!btn) return false
        btn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        return true
      })()`,
      true
    )
    results.insertDropdownOpened = opened
    assert.equal(opened, true)
    if (opened) {
      await new Promise((r) => setTimeout(r, 400))
      const menuImage = await win.webContents.capturePage()
      fs.writeFileSync(path.join(outDir, 'dropdown-open.png'), menuImage.toPNG())
    }

    await win.webContents.executeJavaScript(
      'document.querySelector("button.desktop-insert-menu").click()', true)
    results.layoutChecks = []
    for (const [width, zoom] of [[540, 1], [1100, 2], [1440, 1]]) {
      win.setSize(width, 820)
      win.webContents.setZoomFactor(zoom)
      await new Promise(resolve => setTimeout(resolve, 200))
      for (let attempt = 0; attempt < 10; attempt++) {
        const viewport = await win.webContents.executeJavaScript('innerWidth', true)
        if (Math.abs(viewport - win.getContentBounds().width / zoom) < 2) break
        win.webContents.setZoomFactor(zoom)
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      assert.equal(win.webContents.getZoomFactor(), zoom)
      const layout = await win.webContents.executeJavaScript(`(() => {
        const toolbar = document.querySelector('.ProseMirror-menubar')
        const controls = [...toolbar.querySelectorAll('button, select')]
          .filter(element => element.getClientRects().length)
        return {
          width: innerWidth,
          height: toolbar.getBoundingClientRect().height,
          controlsFit: controls.every(element => {
            const rect = element.getBoundingClientRect()
            return rect.left >= 0 && rect.right <= innerWidth
          }),
          targetsSized: controls.every(element => {
            const rect = element.getBoundingClientRect()
            return rect.width >= 24 && rect.height >= 24
          })
        }
      })()`, true)
      assert.equal(layout.controlsFit, true, `Toolbar fits at ${width}px / ${zoom}x`)
      assert.ok(Math.abs(layout.width - win.getContentBounds().width / zoom) < 2,
        'Zoom changed the effective viewport')
      assert.equal(layout.targetsSized, true)
      results.layoutChecks.push({ windowWidth: width, zoom, ...layout })
      const dropdownFits = await win.webContents.executeJavaScript(`(() => {
        document.querySelector('button.desktop-insert-menu').click()
        const rect = document.querySelector('.ProseMirror-menu-dropdown-menu')
          .getBoundingClientRect()
        const fits = rect.left >= 0 && rect.right <= innerWidth
        document.querySelector('button.desktop-insert-menu').click()
        return fits
      })()`, true)
      assert.equal(dropdownFits, true, `Insert menu fits at ${width}px / ${zoom}x`)
      fs.writeFileSync(path.join(outDir, `toolbar-${width}-${zoom}x.png`),
        (await win.webContents.capturePage()).toPNG())
    }
    win.setSize(1100, 820)
    win.webContents.setZoomFactor(1)

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

    assert.equal(results.autosavePersisted, true, 'Autosave reaches the opened file')
    const saveAsPath = path.join(outDir, 'scratch-save-as.md')
    fs.rmSync(saveAsPath, { force: true })
    const original = fs.readFileSync(scratch, 'utf8')
    const originalDialog = dialog.showSaveDialog
    dialog.showSaveDialog = async () => ({ canceled: true })
    native('saveFileAs').click()
    await new Promise(resolve => setTimeout(resolve, 200))
    assert.equal(fs.readFileSync(scratch, 'utf8'), original)
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: saveAsPath })
    native('saveFileAs').click()
    for (let i = 0; i < 30 && !fs.existsSync(saveAsPath); i++) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    assert.ok(fs.existsSync(saveAsPath), 'Save As writes to the native dialog destination')
    await new Promise(resolve => setTimeout(resolve, 200))
    await win.webContents.executeJavaScript(
      'window.view.dispatch(window.view.state.tr.insertText("SAVE_AS_TARGET ", 1))', true)
    native('saveFile').click()
    for (let i = 0; i < 30; i++) {
      if (fs.readFileSync(saveAsPath, 'utf8').includes('SAVE')) break
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    assert.ok(fs.readFileSync(saveAsPath, 'utf8').includes('SAVE'))
    assert.equal(fs.readFileSync(scratch, 'utf8'), original, 'Save uses the new destination')
    await win.webContents.executeJavaScript(
      'new Promise(resolve => { const check = () => window.__hurmetBaseline === window.view.state.doc ? resolve() : setTimeout(check, 50); check() })', true)
    dialog.showSaveDialog = originalDialog
    results.nativeSaveAsWorks = true

    fs.writeFileSync(path.join(outDir, 'smoke-results.json'), JSON.stringify(results, null, 2))
    appQuit()
  } catch (err) {
    fail(err.message)
  }
}
