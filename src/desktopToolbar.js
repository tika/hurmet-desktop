import { Dropdown, MenuItem } from "prosemirror-menu"
import { isInTable } from "prosemirror-tables"

function button(item, label, text = false) {
  const command = new MenuItem({
    ...item.spec,
    title: label,
    ...(text ? { icon: undefined, label, class: "desktop-text-button" } : {})
  })
  return {
    render(view) {
      const rendered = command.render(view)
      rendered.dom.setAttribute("aria-label", label)
      return rendered
    }
  }
}

function textStyle(items) {
  const styles = [
    ["makeParagraph", "Paragraph"],
    ...Array.from({ length: 6 }, (_, i) => [`makeHead${i + 1}`, `Heading ${i + 1}`]),
    ["makeCodeBlock", "Code Block"]
  ]
  return {
    render(view) {
      const select = document.createElement("select")
      select.className = "desktop-text-style"
      select.setAttribute("aria-label", "Text style")
      for (const [value, label] of styles) {
        select.add(new Option(label, value))
      }
      select.add(new Option("Mixed styles", "mixed"))
      select.lastChild.disabled = true
      select.addEventListener("change", () => {
        items[select.value].spec.run(view.state, view.dispatch, view)
        view.focus()
      })
      // Keep arrow keys in the platform select instead of moving along the toolbar.
      select.addEventListener("keydown", event => event.stopPropagation())
      return { dom: select, update(state) {
        const selected = new Set()
        state.doc.nodesBetween(state.selection.from, state.selection.to, node => {
          if (node.isTextblock) {
            const name = node.type.name
            selected.add(name === "heading" ? `makeHead${node.attrs.level}` :
              name === "paragraph" ? "makeParagraph" :
                name === "code_block" ? "makeCodeBlock" : "mixed")
            return false
          }
        })
        const current = selected.size === 1 ? selected.values().next().value : "mixed"
        select.value = current
        for (const option of select.options) {
          const spec = items[option.value]?.spec
          option.disabled = !spec ||
            (option.value !== current && !!(spec.enable && !spec.enable(state)))
        }
        return true
      } }
    }
  }
}

export function desktopToolbar(r) {
  const table = new Dropdown([
    button(r.addRowBefore, "Insert row above", true),
    button(r.addColumnBefore, "Insert column before", true),
    button(r.toggleCellMerge, "Merge / split cells", true),
    button(r.toggleTableCaption, "Table caption…", true),
    button(r.alignColLeft, "Align column left", true),
    button(r.alignColCenter, "Align column center", true),
    button(r.alignColRight, "Align column right", true),
    button(r.toggleSpreadsheet, "Toggle spreadsheet", true),
    button(r.deleteRow, "Delete row", true),
    button(r.deleteColumn, "Delete column", true),
    button(r.deleteTable, "Delete table", true)
  ], { label: "Table", title: "Table tools", class: "desktop-table-menu" })
  const contextualTable = {
    render(view) {
      const rendered = table.render(view)
      return { ...rendered, update(state) {
        const visible = isInTable(state)
        rendered.dom.style.display = visible ? "" : "none"
        if (visible) { rendered.update(state) }
        return visible
      } }
    }
  }
  const insert = new Dropdown([
    button(r.insertTeX, "TeX equation", true),
    button(r.insertTable, "Table", true),
    button(r.imageUpload, "Image from file…", true),
    button(r.imageLink, "Image from URL…", true),
    button(r.wrapBulletList, "Bullet list", true),
    button(r.wrapOrderedList, "Numbered list", true),
    button(r.wrapBlockQuote, "Block quote", true),
    button(r.toggleComment, "Comment", true),
    button(r.footnote, "Footnote", true),
    button(r.toc, "Table of contents…", true),
    button(r.insertHorizontalRule, "Horizontal rule", true),
    button(r.pageBreak, "Page break", true)
  ], { label: "Insert", title: "Insert into document", class: "desktop-insert-menu" })

  return [
    [button(r.navigate, "Document outline")],
    [textStyle(r)],
    [button(r.toggleStrong, "Bold"), button(r.toggleEm, "Italic"),
      button(r.toggleUnderline, "Underline"), button(r.toggleLink, "Add or remove link")],
    [button(r.insertCalclation, "+ Calculation", true), insert],
    [contextualTable]
  ]
}
