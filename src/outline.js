import { TextSelection } from "prosemirror-state"

let dismissOutline

export function openDocumentOutline(view) {
  if (dismissOutline) { dismissOutline(); return }
  const trigger = document.querySelector('[aria-label="Document outline"]')
  const panel = document.body.appendChild(document.createElement("div"))
  panel.className = "document-outline"
  panel.id = "document-outline"
  panel.setAttribute("role", "dialog")
  panel.setAttribute("aria-label", "Document outline")
  trigger?.setAttribute("aria-expanded", "true")
  trigger?.setAttribute("aria-controls", panel.id)

  const close = (restoreFocus = true) => {
    panel.remove()
    trigger?.setAttribute("aria-expanded", "false")
    document.removeEventListener("pointerdown", outside)
    window.removeEventListener("resize", position)
    dismissOutline = null
    if (restoreFocus) { (trigger || view.dom).focus() }
  }
  dismissOutline = close
  const outside = event => {
    if (!panel.contains(event.target) && !trigger?.contains(event.target)) { close(false) }
  }
  const position = () => {
    const anchor = trigger?.getBoundingClientRect()
    const toolbar = trigger?.closest(".ProseMirror-menubar")?.getBoundingClientRect()
    const top = (toolbar?.bottom || anchor?.bottom || 56) + 8
    panel.style.top = `${top}px`
    panel.style.left = `${Math.max(8, Math.min(anchor?.left || 16,
      window.innerWidth - panel.offsetWidth - 8))}px`
    panel.style.maxHeight = `${Math.max(120, window.innerHeight - top - 12)}px`
  }
  const header = panel.appendChild(document.createElement("div"))
  header.className = "editing-panel-header"
  header.appendChild(document.createElement("strong")).textContent = "Outline"
  const dismiss = header.appendChild(document.createElement("button"))
  dismiss.type = "button"
  dismiss.className = "editing-panel-close"
  dismiss.textContent = "×"
  dismiss.setAttribute("aria-label", "Close document outline")
  dismiss.addEventListener("click", () => close())

  const headings = []
  view.state.doc.descendants((node, pos) => {
    if (node.type.name === "heading") {
      headings.push({ text: node.textContent || "Untitled heading", pos,
        level: node.attrs.level })
    }
  })
  const current = headings.filter(heading => heading.pos <= view.state.selection.from).pop()
  const list = panel.appendChild(document.createElement("div"))
  list.className = "outline-headings"
  const jump = (pos, edge) => {
    close(false)
    view.dispatch(view.state.tr.setSelection(
      TextSelection.near(view.state.doc.resolve(pos))))
    view.focus()
    const top = edge === "start" ? 0 : edge === "end"
      ? document.documentElement.scrollHeight
      : window.scrollY + view.coordsAtPos(pos).top -
        (document.querySelector(".ProseMirror-menubar")?.offsetHeight || 56) - 24
    window.scrollTo({ top })
  }
  for (const heading of headings) {
    const button = list.appendChild(document.createElement("button"))
    button.type = "button"
    button.textContent = heading.text
    button.style.paddingInlineStart = `${12 + (heading.level - 1) * 12}px`
    if (heading === current) { button.setAttribute("aria-current", "location") }
    button.addEventListener("click", () => jump(heading.pos))
  }
  if (!headings.length) {
    const empty = list.appendChild(document.createElement("p"))
    empty.textContent = "Add headings to navigate your notes."
  }
  const edges = panel.appendChild(document.createElement("div"))
  edges.className = "outline-edges"
  for (const [text, pos, edge] of [
    ["Document start", 0, "start"], ["Document end", view.state.doc.content.size, "end"]
  ]) {
    const button = edges.appendChild(document.createElement("button"))
    button.type = "button"
    button.textContent = text
    button.addEventListener("click", () => jump(pos, edge))
  }
  panel.addEventListener("keydown", event => {
    if (event.key === "Escape") { event.preventDefault(); close(); return }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) { return }
    const buttons = [...panel.querySelectorAll("button")]
    const index = buttons.indexOf(document.activeElement)
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 :
      (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length
    event.preventDefault()
    buttons[next].focus()
  })
  document.addEventListener("pointerdown", outside)
  window.addEventListener("resize", position)
  position()
  ;(list.querySelector('[aria-current]') || list.querySelector("button") ||
    edges.firstChild).focus()
}
