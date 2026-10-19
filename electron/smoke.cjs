// Smoke test for the Hurmet Desktop shell. Not part of the app.
// Enabled by setting HURMET_DESKTOP_SMOKE=1. Loads a real document through
// the shell's open pipeline, checks the editor state, verifies autosave,
// captures screenshots, and writes results to .amp/in/artifacts/.
const fs = require('fs')
const path = require('path')
const assert = require('node:assert/strict')
const { Menu, dialog } = require('electron')

module.exports = async function smoke({ win, loadFile, wss }) {
  // Keep renderer checks responsive while another app has keyboard focus.
  win.webContents.setBackgroundThrottling(false)
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

    results.startingDocument = await win.webContents.executeJavaScript(`(() => {
      const doc = window.view.state.doc
      return {
        paragraphs: doc.childCount,
        firstNode: doc.firstChild.type.name,
        text: doc.textContent,
        style: document.querySelector('.desktop-text-style').value
      }
    })()`, true)
    assert.deepEqual(results.startingDocument, {
      paragraphs: 1, firstNode: 'paragraph', text: '', style: 'makeParagraph'
    }, 'New documents start with a single empty paragraph')
    fs.writeFileSync(path.join(outDir, 'empty-startup.png'),
      (await win.webContents.capturePage()).toPNG())

    results.selectionStyles = await win.webContents.executeJavaScript(`(() => {
      const view = window.view
      const original = view.state.doc
      const { paragraph, heading } = view.state.schema.nodes
      const readStyle = nodes => {
        const tr = view.state.tr.replaceWith(0, view.state.doc.content.size, nodes)
        tr.setSelection(view.state.selection.constructor.create(tr.doc, 1, tr.doc.content.size - 1))
        view.dispatch(tr)
        return document.querySelector('.desktop-text-style').value
      }
      const styles = [
        readStyle([paragraph.create(), paragraph.create()]),
        readStyle([heading.create({ level: 2 }), heading.create({ level: 2 })]),
        readStyle([paragraph.create(), heading.create({ level: 2 })])
      ]
      const tr = view.state.tr.replaceWith(0, view.state.doc.content.size, original.content)
      tr.setSelection(view.state.selection.constructor.create(tr.doc, 1))
      view.dispatch(tr)
      window.__hurmetBaseline = view.state.doc
      return styles
    })()`, true)
    assert.deepEqual(results.selectionStyles, ['makeParagraph', 'makeHead2', 'mixed'])

    // Outline navigation uses document positions, including on long notes.
    results.outline = await win.webContents.executeJavaScript(`(() => {
      const view = window.view
      const original = view.state.doc
      const { paragraph, heading } = view.state.schema.nodes
      const trigger = document.querySelector('[aria-label="Document outline"]')
      trigger.click()
      const empty = document.querySelector('.document-outline').textContent
        .includes('Add headings')
      document.querySelector('.editing-panel-close').click()
      const nodes = [heading.create({ level: 1 }, view.state.schema.text('Circuit analysis')),
        ...Array.from({ length: 60 }, () => paragraph.create(null,
          view.state.schema.text('Measurements and calculations'))),
        heading.create({ level: 3 }, view.state.schema.text('Results'))]
      view.dispatch(view.state.tr.replaceWith(0, original.content.size, nodes))
      trigger.click()
      const panel = document.querySelector('.document-outline')
      const toolbar = document.querySelector('.ProseMirror-menubar').getBoundingClientRect()
      const anchored = panel.getBoundingClientRect().top >= toolbar.bottom
      const headings = [...panel.querySelectorAll('.outline-headings button')]
        .map(button => button.textContent)
      panel.querySelector('button').dispatchEvent(new KeyboardEvent('keydown',
        { key: 'End', bubbles: true }))
      const keyboard = document.activeElement.textContent === 'Document end'
      document.activeElement.click()
      const atEnd = view.state.selection.to >= view.state.doc.content.size - 1
      const scrolled = window.scrollY > 500
      trigger.click()
      document.querySelector('.outline-edges button').click()
      const atStart = view.state.selection.from === 1 && window.scrollY === 0
      trigger.click()
      document.querySelector('.document-outline').dispatchEvent(new KeyboardEvent('keydown',
        { key: 'Escape', bubbles: true }))
      const dismissed = !document.querySelector('.document-outline') &&
        document.activeElement === trigger && trigger.getAttribute('aria-expanded') === 'false'
      const tr = view.state.tr.replaceWith(0, view.state.doc.content.size, original.content)
      tr.setSelection(view.state.selection.constructor.near(tr.doc.resolve(1)))
      view.dispatch(tr)
      window.__hurmetBaseline = view.state.doc
      return { empty, anchored, headings, keyboard, atEnd, scrolled, atStart, dismissed }
    })()`, true)
    assert.deepEqual(results.outline, {
      empty: true, anchored: true, headings: ['Circuit analysis', 'Results'],
      keyboard: true, atEnd: true, scrolled: true, atStart: true, dismissed: true
    })
    await win.webContents.executeJavaScript(
      'document.querySelector(\'[aria-label="Document outline"]\').click()', true)
    fs.writeFileSync(path.join(outDir, 'outline-empty.png'),
      (await win.webContents.capturePage()).toPNG())
    await win.webContents.executeJavaScript(
      'document.querySelector(".editing-panel-close").click()', true)

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
    // Capture the actual native menu generated by a real right-click, without
    // leaving a modal OS menu open during the rest of the smoke test.
    const originalPopup = Menu.prototype.popup
    let capturedContext = null
    Menu.prototype.popup = function() { capturedContext = this }
    const rightClick = async point => {
      capturedContext = null
      win.webContents.sendInputEvent({ type: 'mouseDown', button: 'right', ...point })
      win.webContents.sendInputEvent({ type: 'mouseUp', button: 'right', ...point })
      for (let i = 0; i < 30 && !capturedContext; i++) {
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      assert.ok(capturedContext, 'A right-click opens a native context menu')
      return capturedContext
    }
    const point = await win.webContents.executeJavaScript(`(() => {
      const view = window.view
      document.addEventListener('contextmenu', event => {
        window.__smokeContextTarget = { tag: event.target.tagName,
          className: event.target.className, insideEditor: view.dom.contains(event.target),
          x: event.clientX, y: event.clientY, zoom: devicePixelRatio }
      }, true)
      view.dispatch(view.state.tr.setSelection(view.state.selection.constructor.create(
        view.state.doc, 1, 5)))
      view.focus()
      const rect = view.coordsAtPos(3)
      return { x: Math.round(rect.left + 1), y: Math.round((rect.top + rect.bottom) / 2) }
    })()`, true)
    const context = await rightClick(point)
    results.contextTarget = await win.webContents.executeJavaScript(
      'window.__smokeContextTarget', true)
    assert.ok(context.items.some(item => item.label === 'Format'))
    assert.ok(context.items.some(item => item.label === 'Paragraph'))
    assert.ok(context.items.some(item => item.label === 'Insert'))
    assert.ok(context.items.some(item => item.role?.toLowerCase() === 'pasteandmatchstyle'))
    assert.equal(await win.webContents.executeJavaScript(
      'window.view.state.selection.from === 1 && window.view.state.selection.to === 5', true), true)
    context.getMenuItemById('toggleStrong').click()
    await new Promise(resolve => setTimeout(resolve, 150))
    assert.equal(await win.webContents.executeJavaScript(
      'window.view.state.doc.rangeHasMark(1, 5, window.view.state.schema.marks.strong)', true), true)
    context.getMenuItemById('toggleStrong').click()
    await new Promise(resolve => setTimeout(resolve, 150))
    assert.ok(context.items.some(item => item.label === 'Engineering'))
    const engineering = context.items.find(item => item.label === 'Engineering').submenu
    const mechanicalSymbols = engineering.items.find(item => item.label === 'Mechanical Symbols')
    mechanicalSymbols.submenu.items.find(item => item.label.startsWith('σ —')).click()
    await new Promise(resolve => setTimeout(resolve, 150))
    assert.equal(await win.webContents.executeJavaScript(
      'window.view.state.doc.textContent.startsWith("σ")', true), true)
    const mechanicalUnits = engineering.items.find(item => item.label === 'Mechanical Unit Notation')
    mechanicalUnits.submenu.items.find(item => item.label === 'Moment / Torque — N·m').click()
    await new Promise(resolve => setTimeout(resolve, 150))
    assert.equal(await win.webContents.executeJavaScript(
      'window.view.state.doc.textContent.startsWith("σN·m")', true), true)

    const sourcePoint = async text => win.webContents.executeJavaScript(`(() => {
      const editor = document.querySelector('.math-code [contenteditable]')
      editor.focus()
      document.execCommand('insertText', false, ${JSON.stringify(text)})
      const rect = editor.getBoundingClientRect()
      return { x: Math.round(rect.right - 8), y: Math.round((rect.top + rect.bottom) / 2) }
    })()`, true)
    native('insertCalculation').click()
    await new Promise(resolve => setTimeout(resolve, 150))
    const calculationContext = await rightClick(await sourcePoint('r = 1'))
    assert.equal(calculationContext.items.some(item => item.label === 'Format'), false)
    const electricalUnits = calculationContext.items.find(item => item.label === 'Engineering')
      .submenu.items.find(item => item.label === 'Electrical Unit Notation')
    electricalUnits.submenu.items.find(item => item.label === 'Resistance — Ω').click()
    await new Promise(resolve => setTimeout(resolve, 150))
    assert.equal(await win.webContents.executeJavaScript(
      'document.querySelector(".math-code [contenteditable]").textContent', true), "r = 1 'ohm'")
    await win.webContents.executeJavaScript(`(() => {
      const editor = document.querySelector('.math-code [contenteditable]')
      document.execCommand('insertText', false, ' = ?? ohm')
      editor.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })()`, true)
    assert.equal(await win.webContents.executeJavaScript(`(() => {
      let valid = false
      window.view.state.doc.descendants(node => {
        if (node.type.name === 'calculation' && node.attrs.name === 'r') {
          valid = !node.attrs.error && !!node.attrs.value
        }
      })
      return valid
    })()`, true), true)

    native('insertTeX').click()
    await new Promise(resolve => setTimeout(resolve, 150))
    const texContext = await rightClick(await sourcePoint('x = 1'))
    const texUnits = texContext.items.find(item => item.label === 'Engineering')
      .submenu.items.find(item => item.label === 'Mechanical Unit Notation')
    texUnits.submenu.items.find(item => item.label === 'Stress / Pressure — MPa').click()
    await new Promise(resolve => setTimeout(resolve, 150))
    assert.equal(await win.webContents.executeJavaScript(
      'document.querySelector(".math-code [contenteditable]").textContent', true),
      'x = 1\\,\\text{MPa}')
    await win.webContents.executeJavaScript(
      'document.querySelector(".math-code [contenteditable]").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))', true)

    // Equation editing: visible source/preview, real Apply/Cancel clicks,
    // keyboard access, and the multi-expression mistake from the user report.
    const click = async selector => {
      const point = await win.webContents.executeJavaScript(`(() => {
        const target = document.querySelector(${JSON.stringify(selector)})
        target.scrollIntoView({ block: 'center' })
        const rect = target.getBoundingClientRect()
        return { x: Math.round(rect.left + rect.width / 2),
          y: Math.round(rect.top + rect.height / 2) }
      })()`, true)
      win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point })
      win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point })
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    await win.webContents.executeJavaScript(`(() => {
      const view = window.view
      const tr = view.state.tr.replaceWith(0, view.state.doc.content.size,
        view.state.schema.nodes.paragraph.create())
      tr.setSelection(view.state.selection.constructor.near(tr.doc.resolve(1)))
      view.dispatch(tr)
    })()`, true)
    native('insertCalculation').click()
    await new Promise(resolve => setTimeout(resolve, 100))
    const setSource = async text => {
      await win.webContents.executeJavaScript(`(() => {
      const editor = document.querySelector('.math-source')
      editor.focus()
      editor.textContent = ${JSON.stringify(text)}
      const range = document.createRange()
      range.selectNodeContents(editor)
      range.collapse(false)
      getSelection().removeAllRanges()
      getSelection().addRange(range)
      editor.dispatchEvent(new Event('input', { bubbles: true }))
      })()`, true)
      await new Promise(resolve => setTimeout(resolve, 80))
    }
    assert.equal(await win.webContents.executeJavaScript(
      'document.querySelector(".math-preview-empty").textContent', true),
      'Your equation will appear here.')
    await setSource("E=14'm'\nE+4'ft'=?")
    assert.equal(await win.webContents.executeJavaScript(
      'document.querySelector(".math-editor-guidance").textContent.includes("separate")', true),
      true)
    fs.writeFileSync(path.join(outDir, 'math-multiline-guidance.png'),
      (await win.webContents.capturePage()).toPNG())
    await setSource("14 'm' + 4 'ft' = ?? m")
    results.mathEditor = await win.webContents.executeJavaScript(`(() => {
      const panel = document.querySelector('.math-editor')
      return {
        label: panel.getAttribute('aria-label'),
        sourceLabel: document.querySelector('#math-source-label').textContent,
        previewStatic: getComputedStyle(panel.querySelector('.math-display')).position === 'static',
        width: panel.getBoundingClientRect().width,
        hasMath: !!panel.querySelector('.math-display math'),
        warningCleared: !panel.querySelector('.math-editor-guidance').textContent
      }
    })()`, true)
    assert.equal(results.mathEditor.label, 'Calculation')
    assert.equal(results.mathEditor.sourceLabel, 'Expression')
    assert.equal(results.mathEditor.previewStatic, true)
    assert.ok(results.mathEditor.width >= 400)
    assert.equal(results.mathEditor.hasMath, true)
    assert.equal(results.mathEditor.warningCleared, true)
    fs.writeFileSync(path.join(outDir, 'math-calculation-editor.png'),
      (await win.webContents.capturePage()).toPNG())
    win.webContents.debugger.attach('1.3')
    const accessibility = await win.webContents.debugger.sendCommand('Accessibility.getFullAXTree')
    results.mathAccessibleSource = accessibility.nodes.some(node =>
      node.role?.value === 'textbox' && node.name?.value === 'Expression')
    win.webContents.debugger.detach()
    assert.equal(results.mathAccessibleSource, true)
    // Tab leaves the source, rather than inserting an invisible tab character.
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' })
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' })
    await new Promise(resolve => setTimeout(resolve, 100))
    assert.equal(await win.webContents.executeJavaScript(
      'document.activeElement.textContent', true), 'Cancel')
    await click('.math-editor-apply')
    assert.equal(await win.webContents.executeJavaScript(
      'document.querySelector("#editor-content").textContent.includes("15.2192") && ' +
      '!document.querySelector(".math-editor")', true), true)
    await click('.hurmet-calc')
    await setSource('999 = ?')
    await click('.math-editor-actions button')
    assert.equal(await win.webContents.executeJavaScript(
      'document.querySelector("#editor-content").textContent.includes("15.2192") && ' +
      '!document.querySelector(".math-editor")', true), true)
    await click('.hurmet-calc')
    assert.equal(await win.webContents.executeJavaScript(
      'document.querySelector(".math-source").textContent', true), "14 'm' + 4 'ft' = ?? m")
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
    await new Promise(resolve => setTimeout(resolve, 100))
    assert.equal(await win.webContents.executeJavaScript(
      '!document.querySelector(".math-editor") && document.activeElement === window.view.dom',
      true), true)

    native('insertTeX').click()
    await new Promise(resolve => setTimeout(resolve, 100))
    await setSource('\\unknownHurmetCommand')
    assert.equal(await win.webContents.executeJavaScript(
      'document.querySelector(".math-source").getAttribute("aria-invalid") === "true" && ' +
      '!!document.querySelector(".math-editor-guidance").textContent', true), true)
    await setSource('\\sigma = \\frac{M y}{I}')
    fs.writeFileSync(path.join(outDir, 'math-latex-editor.png'),
      (await win.webContents.capturePage()).toPNG())
    assert.equal(await win.webContents.executeJavaScript(
      'document.querySelector(".math-editor").getAttribute("aria-label")', true),
      'LaTeX equation')
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter', modifiers: ['shift'] })
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter', modifiers: ['shift'] })
    await new Promise(resolve => setTimeout(resolve, 100))
    assert.equal(await win.webContents.executeJavaScript(
      'document.querySelector(".math-source").textContent.includes("\\n")', true), true)
    await setSource('\\sigma = \\frac{M y}{I}')
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' })
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' })
    await new Promise(resolve => setTimeout(resolve, 100))
    assert.equal(await win.webContents.executeJavaScript(
      '!!document.querySelector(".hurmet-tex mfrac")', true), true)
    results.mathEditorWorks = true

    await win.webContents.executeJavaScript(`(() => {
      const view = window.view
      const tr = view.state.tr.replaceWith(0, view.state.doc.content.size,
        window.__hurmetSmokeInitialDoc.content)
      tr.setSelection(view.state.selection.constructor.near(tr.doc.resolve(1)))
      view.dispatch(tr)
    })()`, true)
    native('worked-problem').click()
    await new Promise(resolve => setTimeout(resolve, 150))
    assert.deepEqual(await win.webContents.executeJavaScript(
      '[...document.querySelectorAll("#editor-content h3")].slice(0, 5).map(node => node.textContent)',
      true), ['Given', 'Find', 'Assumptions', 'Working', 'Result'])
    assert.equal(await win.webContents.executeJavaScript(
      'window.view.state.selection.$from.parent.type.name', true), 'paragraph')
    results.engineeringContextWorks = true
    await win.webContents.executeJavaScript(`(() => {
      const view = window.view
      const tr = view.state.tr.replaceWith(0, view.state.doc.content.size,
        window.__hurmetSmokeInitialDoc.content)
      tr.setSelection(view.state.selection.constructor.create(tr.doc, 1, 5))
      view.dispatch(tr)
    })()`, true)
    const outsideSelection = await win.webContents.executeJavaScript(`(() => {
      const rect = window.view.coordsAtPos(window.view.state.doc.firstChild.nodeSize + 1)
      return { x: Math.round(rect.left + 1), y: Math.round((rect.top + rect.bottom) / 2) }
    })()`, true)
    await rightClick(outsideSelection)
    assert.equal(await win.webContents.executeJavaScript(
      'window.view.state.selection.from > 5', true), true)
    const fieldPoint = await win.webContents.executeJavaScript(`(() => {
      const input = document.createElement('input')
      input.id = 'context-smoke-field'
      input.value = 'Field text'
      input.style.cssText = 'position:fixed;left:20px;top:120px;width:160px;height:40px;z-index:100'
      document.body.appendChild(input)
      input.focus()
      input.select()
      return { x: 60, y: 140 }
    })()`, true)
    const fieldContext = await rightClick(fieldPoint)
    assert.equal(fieldContext.items.some(item => item.label === 'Format'), false)
    assert.ok(fieldContext.items.some(item => item.role?.toLowerCase() === 'copy'))
    await win.webContents.executeJavaScript(
      'document.getElementById("context-smoke-field").remove(); window.view.focus()', true)
    results.contextMenuWorks = true
    Menu.prototype.popup = originalPopup

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
    for (const [width, zoom] of [[540, 1], [1100, 2], [640, 2], [1440, 1]]) {
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
      await win.webContents.executeJavaScript(`(() => {
        const view = window.view
        const tr = view.state.tr.replaceWith(0, view.state.doc.content.size,
          view.state.schema.nodes.paragraph.create())
        tr.setSelection(view.state.selection.constructor.near(tr.doc.resolve(1)))
        view.dispatch(tr)
      })()`, true)
      native('insertCalculation').click()
      await setSource("14 'm' + 4 'ft' = ?? m")
      const editorFits = await win.webContents.executeJavaScript(`(() => {
        const panel = document.querySelector('.math-editor')
        const fits = () => [...panel.querySelectorAll('.math-source, button')].every(node => {
          const rect = node.getBoundingClientRect()
          return rect.left >= 0 && rect.right <= innerWidth && rect.width >= 24 &&
            rect.height >= 24
        })
        const ltr = fits()
        document.documentElement.dir = 'rtl'
        const rtl = fits()
        document.documentElement.removeAttribute('dir')
        panel.scrollIntoView({ block: 'center' })
        return { ltr, rtl }
      })()`, true)
      assert.deepEqual(editorFits, { ltr: true, rtl: true },
        'Equation editor fits at ' + width + 'px / ' + zoom + 'x')
      fs.writeFileSync(path.join(outDir, `math-editor-${width}-${zoom}x.png`),
        (await win.webContents.capturePage()).toPNG())
      await win.webContents.executeJavaScript(
        'document.querySelector(".math-editor-actions button").click(); window.scrollTo(0, 0)',
        true)
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
    fail(err.stack || err.message)
  }
}
