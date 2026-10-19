import { Plugin, TextSelection } from "prosemirror-state"
import { isInTable } from "prosemirror-tables"
import { undoItem, redoItem, joinUpItem } from "prosemirror-menu"
import { engineeringMenu } from "./engineeringMenu"

// Reuse the editor's commands for both the native menus and the toolbar.
// Only serializable menu descriptions cross the isolated preload bridge.
export function desktopMenu(r) {
  const commands = new Map()
  const item = (id, label, command, accelerator) => {
    const spec = id === "saveFile" ? { ...command.spec, enable: () => true } : command.spec
    commands.set(id, spec)
    return {
      id,
      label,
      ...(accelerator ? { accelerator } : {}),
      ...(command.spec.active ? { type: "checkbox", checked: false } : {})
    }
  }
  const separator = { type: "separator" }
  const submenu = (label, dropdown, prefix) => ({
    label,
    submenu: dropdown.content.map((command, index) =>
      item(`${prefix}-${index}`, command.spec.label || command.spec.title, command))
  })
  const engineering = engineeringMenu(item)
  const menus = [
    { label: "File", submenu: [
      { id: "open", label: "Open…", accelerator: "CmdOrCtrl+O" },
      item("saveFile", "Save", r.saveFile, "CmdOrCtrl+S"),
      item("saveFileAs", "Save As…", r.saveFileAs, "CmdOrCtrl+Shift+S"),
      separator,
      { label: "Snapshots", submenu: [
        item("takeSnapshot", "Take Snapshot…", r.takeSnapshot),
        item("showDiff", "Show Changes…", r.showDiffMenuItem),
        item("revertToSnapshot", "Revert to Snapshot…", r.revertToSnapshot),
        item("deleteSnapshots", "Delete Snapshots…", r.deleteSnapshots)
      ] },
      separator,
      item("print", "Print…", r.print, "CmdOrCtrl+P"),
      separator,
      { role: "close" }
    ] },
    { label: "Edit", submenu: [
      item("undo", "Undo", undoItem, "CmdOrCtrl+Z"),
      item("redo", "Redo", redoItem, "CmdOrCtrl+Shift+Z"),
      separator,
      { role: "cut" }, { role: "copy" }, { role: "paste" },
      { role: "pasteAndMatchStyle" }, { role: "selectAll" },
      separator,
      item("copyAsMarkdown", "Copy as Markdown", r.copyAsMarkdown),
      item("copyAsGFM", "Copy as GitHub Markdown", r.copyAsGFM)
    ] },
    { label: "Format", submenu: [
      item("toggleStrong", "Bold", r.toggleStrong, "CmdOrCtrl+B"),
      item("toggleEm", "Italic", r.toggleEm, "CmdOrCtrl+I"),
      item("toggleUnderline", "Underline", r.toggleUnderline, "CmdOrCtrl+U"),
      item("toggleStrikethru", "Strikethrough", r.toggleStrikethru),
      item("toggleHighlight", "Highlight", r.toggleHighlight),
      item("toggleCode", "Inline Code", r.toggleCode, "CmdOrCtrl+`"),
      item("toggleSubscript", "Subscript", r.toggleSubscript, "CmdOrCtrl+,"),
      item("toggleSuperscript", "Superscript", r.toggleSuperscript, "CmdOrCtrl+."),
      separator,
      { label: "Text Style", submenu: [
        item("makeParagraph", "Paragraph", r.makeParagraph),
        ...Array.from({ length: 6 }, (_, i) =>
          item(`makeHead${i + 1}`, `Heading ${i + 1}`, r[`makeHead${i + 1}`])),
        item("makeCodeBlock", "Code Block", r.makeCodeBlock)
      ] },
      item("wrapBulletList", "Bullet List", r.wrapBulletList),
      item("wrapOrderedList", "Numbered List", r.wrapOrderedList),
      item("tighten", "Tighten List", r.tighten),
      item("wrapBlockQuote", "Block Quote", r.wrapBlockQuote),
      submenu("Block", r.blockDropDown, "block"),
      separator,
      item("joinUp", "Join with Previous Block", joinUpItem),
      ...r.blockMenu[0].slice(-2).map((command, index) =>
        item(`block-action-${index}`, command.spec.title, command))
    ] },
    { label: "Insert", submenu: [
      item("insertCalculation", "Calculation", r.insertCalclation, "Alt+C"),
      item("insertTeX", "TeX Equation", r.insertTeX),
      engineering,
      separator,
      item("toggleLink", "Link…", r.toggleLink),
      item("imageUpload", "Image from File…", r.imageUpload),
      item("imageLink", "Image from URL…", r.imageLink),
      item("insertTable", "Table", r.insertTable),
      item("toggleComment", "Comment", r.toggleComment),
      item("footnote", "Footnote", r.footnote),
      item("toc", "Table of Contents…", r.toc),
      separator,
      item("insertHorizontalRule", "Horizontal Rule", r.insertHorizontalRule),
      item("pageBreak", "Page Break", r.pageBreak)
    ] },
    { label: "Calculation", submenu: [
      item("recalcAll", "Recalculate All", r.recalcAll),
      item("toggleDisplayMode", "Display as Block", r.toggleDisplayMode),
      item("rounding", "Rounding…", r.rounding),
      item("convertTex2Calc", "Convert TeX to Calculation", r.convertTex2Calc),
      item("convertCalc2Tex", "Convert Calculation to TeX", r.convertCalc2Tex),
      separator,
      item("letters", "Letters…", r.letters),
      item("symbols", "Symbols…", r.symbols),
      item("accents", "Accents…", r.accents),
      item("display", "Display Selectors…", r.display),
      { label: "Functions", submenu: r.functionsDropDown.content.map((command, index) =>
        item(`function-${index}`, command.spec.title, command)) },
      { label: "Quick Reference", submenu: r.hintDropDown.content.map((command, index) =>
        item(`reference-${index}`, command.spec.title, command)) }
    ] },
    { label: "Table", submenu: [
      item("addRowBefore", "Insert Row Above", r.addRowBefore),
      item("addColumnBefore", "Insert Column Before", r.addColumnBefore),
      item("toggleCellMerge", "Merge / Split Cells", r.toggleCellMerge),
      item("toggleTableCaption", "Toggle Caption", r.toggleTableCaption),
      separator,
      item("alignColLeft", "Align Column Left", r.alignColLeft),
      item("alignColCenter", "Align Column Center", r.alignColCenter),
      item("alignColRight", "Align Column Right", r.alignColRight),
      submenu("Style", r.tableStyle, "table-style"),
      item("toggleSpreadsheet", "Toggle Spreadsheet", r.toggleSpreadsheet),
      separator,
      item("deleteRow", "Delete Row", r.deleteRow),
      item("deleteColumn", "Delete Column", r.deleteColumn),
      item("deleteTable", "Delete Table", r.deleteTable)
    ] },
    { label: "Document", submenu: [
      submenu("Font Size", r.fontsize, "font-size"),
      submenu("Page Size", r.pagesize, "page-size"),
      submenu("Decimal Format", r.separators, "decimal-format"),
      item("dateFormat", "Date Format…", r.dateFormat),
      item("toggleDraftMode", "Draft Mode", r.toggleDraftMode),
      separator,
      item("insertHeader", "Insert Print Header…", r.insertHeader),
      item("removeHeader", "Remove Print Header", r.removeHeader),
      item("deleteComments", "Delete All Comments", r.deleteComments)
    ] }
  ]

  const findMenu = label => menus.find(menu => menu.label === label).submenu
  const findItem = id => {
    const find = items => {
      for (const item of items) {
        if (item.id === id) { return item }
        if (item.submenu) {
          const found = find(item.submenu)
          if (found) { return found }
        }
      }
    }
    return find(menus)
  }
  const contextItems = [
    { ...findItem("toggleLink"), label: "Add or Remove Link…" },
    separator,
    { label: "Format", submenu: findMenu("Format").slice(0, 8) },
    { label: "Paragraph", submenu: [
      ...findMenu("Format").find(item => item.label === "Text Style").submenu,
      separator,
      findItem("wrapBulletList"), findItem("wrapOrderedList"), findItem("wrapBlockQuote"),
      findMenu("Format").find(item => item.label === "Block")
    ] },
    { label: "Insert", submenu: findMenu("Insert").filter(item => item !== engineering) },
    { label: "Calculation", submenu: findMenu("Calculation") },
    engineering,
    { label: "Table", submenu: findMenu("Table") },
    separator,
    findItem("undo"), findItem("redo"),
    separator,
    findItem("copyAsMarkdown"), findItem("copyAsGFM")
  ]

  return new Plugin({
    view(view) {
      const bridge = window.hurmetDesktop
      bridge.setMenus(menus)
      const editingField = () => {
        const active = document.activeElement
        return active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement ||
          (active?.isContentEditable && active !== view.dom)
      }
      let contextEvent = null
      const rememberContext = event => { contextEvent = event }
      document.addEventListener("contextmenu", rememberContext, true)
      const describe = items => items.map(item => {
        if (item.submenu) { return { ...item, submenu: describe(item.submenu) } }
        const spec = commands.get(item.id)
        if (!spec) { return item }
        return {
          ...item,
          enabled: (!spec.select || !!spec.select(view.state)) &&
            (!spec.enable || !!spec.enable(view.state)),
          checked: !!(spec.active && spec.active(view.state))
        }
      })
      const unsubscribeContext = bridge.onContextMenu(request => {
        const event = contextEvent
        contextEvent = null
        const target = event?.target || (request.source === "keyboard"
          ? document.activeElement : document.elementFromPoint(request.x, request.y))
        const field = target?.closest(
          'input, textarea, [contenteditable="true"], [contenteditable="plaintext-only"]')
        if (field?.closest(".math-code")) {
          bridge.showContextMenu(request.id, [
            { ...engineering, submenu: describe(engineering.submenu.slice(0, 5)) }
          ])
          return
        }
        if (!target || !view.dom.contains(target) || (field && field !== view.dom)) {
          bridge.showContextMenu(request.id, [])
          return
        }
        if (request.source !== "keyboard") {
          const hit = view.posAtCoords({
            left: event?.clientX ?? request.x, top: event?.clientY ?? request.y
          })
          const { from, to, empty } = view.state.selection
          if (hit && (empty || hit.pos < from || hit.pos > to)) {
            view.dispatch(view.state.tr.setSelection(
              TextSelection.near(view.state.doc.resolve(hit.pos))))
          }
        }
        const items = contextItems.filter(item =>
          item.label !== "Table" || isInTable(view.state))
        bridge.showContextMenu(request.id, describe(items))
      })
      const unsubscribe = bridge.onMenuCommand(id => {
        if ((id === "undo" || id === "redo") && editingField()) {
          document.execCommand(id)
          return
        }
        const spec = commands.get(id)
        if (!spec) { return }
        if (spec.insertText !== undefined && editingField()) {
          const field = document.activeElement
          const text = field.closest(".hurmet-calc") ? spec.calculationText :
            field.closest(".hurmet-tex") ? spec.texText : spec.insertText
          document.execCommand("insertText", false, text)
          return
        }
        const { state } = view
        if (spec.select && !spec.select(state)) { return }
        if (spec.enable && !spec.enable(state)) { return }
        view.focus()
        spec.run(state, view.dispatch, view)
      })
      let previous = ""
      const update = () => {
        const states = Array.from(commands, ([id, spec]) => ({
          id,
          enabled: ((id === "undo" || id === "redo") && editingField()) ||
            ((!spec.select || !!spec.select(view.state)) &&
            (!spec.enable || !!spec.enable(view.state))),
          checked: !!(spec.active && spec.active(view.state))
        }))
        const next = JSON.stringify(states)
        if (next !== previous) {
          bridge.updateMenus(states)
          previous = next
        }
      }
      document.addEventListener("focusin", update)
      document.addEventListener("focusout", update)
      update()
      return { update, destroy() {
        unsubscribe()
        unsubscribeContext()
        document.removeEventListener("contextmenu", rememberContext, true)
        document.removeEventListener("focusin", update)
        document.removeEventListener("focusout", update)
      } }
    }
  })
}
