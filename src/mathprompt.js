import { autoCorrect } from "./autocorrect"
import { codeJar, selectedText, textBeforeCursor, textAfterCursor } from "./codejar"
import { findWordAtClickPos, positionOfDefinition } from "./findDefinition"
import hurmet from "./hurmet"
import temml from "./temml.js"
import { TextSelection } from "prosemirror-state"

const commaRegEx = /"[^"]*"|[0-9]+,[0-9]+|[A-Za-zıȷ\u0391-\u03D5\uD835][A-Za-z0-9_ıȷ\u0391-\u03D5\uD835\uDC00-\uDFFF]/g
const dotRegEx = /"[^"]*"|[0-9]+\.[0-9]+|[A-Za-zıȷ\u0391-\u03D5\uD835][A-Za-z0-9_ıȷ\u0391-\u03D5\uD835\uDC00-\uDFFF]/g
const functionRegEx = /^function (?:[A-Za-zıȷ\u0391-\u03C9\u03D5\u210B\u210F\u2110\u2112\u2113\u211B\u212C\u2130\u2131\u2133]|(?:\uD835[\uDC00-\udc33\udc9c-\udcb5]))(?:[A-Za-z0-9\u0391-\u03C9\u03D5]+|[\u0300-\u0308\u030A\u030C\u0332\u20d0\u20d1\u20d6\u20d7\u20e1])?(?:(?:_(?:[A-Za-z0-9\u0391-\u03C9\u03D5]+|\([A-Za-z0-9\u0391-\u03C9\u03D5,]+\))){1,2}|[₀-₉]+)?′*\(/

const dotFromCommaForStorage = (str) => {
  // Lex for strings, numbers, and identifiers
  let match
  while ((match = commaRegEx.exec(str)) != null) {
    if ("0123456789".indexOf(match[0].charAt(0)) > -1) {
      // Change comma decimal to dot decimal.
      const pos = match.index + match[0].indexOf(",")
      str = str.slice(0, pos) + "." + str.slice(pos + 1)
    }
  }
  return str
}

const commaFromDotForDisplay = (str) => {
  let match
  while ((match = dotRegEx.exec(str)) !== null) {
    if ("0123456789".indexOf(match[0].charAt(0)) > -1) {
      // Change dot decimal to comma decimal.
      const pos = match.index + match[0].indexOf(".")
      str = str.slice(0, pos) + "," + str.slice(pos + 1)
    }
  }
  return str
}

export function openMathPrompt(options) {
  if (options.dom.querySelector(".math-code")) { return }
  const wrapper = options.dom.appendChild(document.createElement("div"))
  wrapper.className = "math-code math-editor"
  wrapper.setAttribute("role", "group")
  options.dom.classList.add("math-editing")
  wrapper.parentNode.firstChild.style.display = "none"

  const close = (focus = false) => {
    jar.destroy()
    if (wrapper.parentNode) {
      wrapper.parentNode.firstChild.removeAttribute("style")
      wrapper.parentNode.removeChild(wrapper)
    }
    options.dom.classList.remove("math-editing")
    if (focus) {
      const view = options.outerView
      view.dispatch(view.state.tr.setSelection(
        TextSelection.near(view.state.doc.resolve(view.state.selection.to))))
      view.focus()
    }
  }

  const isCalculation = (options.encoding === "HurmetMath")
  const isTex = !isCalculation
  const decimalSymbol = isCalculation
    ? options.outerView.state.doc.attrs.decimalFormat.slice(-1)
    : ""

  const header = wrapper.appendChild(document.createElement("div"))
  header.className = "math-editor-header"
  const title = header.appendChild(document.createElement("strong"))
  title.textContent = isCalculation ? "Calculation" : "LaTeX equation"
  wrapper.setAttribute("aria-label", title.textContent)
  const description = header.appendChild(document.createElement("p"))
  description.textContent = isCalculation
    ? "Use ?? for unit conversions, e.g. 14 'm' + 4 'ft' = ?? m"
    : "Typesets math without calculating values."
  const sourceLabel = wrapper.appendChild(document.createElement("label"))
  sourceLabel.id = "math-source-label"
  sourceLabel.textContent = isCalculation ? "Expression" : "LaTeX source"
  sourceLabel.className = "math-editor-label"
  const editor = wrapper.appendChild(document.createElement("div"))
  editor.className = "math-source"
  editor.id = "math-source"
  sourceLabel.htmlFor = editor.id
  editor.setAttribute("role", "textbox")
  editor.setAttribute("aria-labelledby", sourceLabel.id)
  editor.setAttribute("aria-multiline", "true")
  const jar = codeJar(editor, true)
  jar.updateOptions({ catchTab: false })
  editor.tabIndex = 0
  // CodeJar suppresses the outline; the editing surface supplies its focus ring.
  editor.style.removeProperty("outline")
  sourceLabel.addEventListener("click", () => editor.focus())

  // Populate the editor.
  if (options.attrs) {
    if (isCalculation && options.attrs.entry) {
      let math = options.attrs.entry
      if (decimalSymbol === ",") { math = commaFromDotForDisplay(math) }
      jar.updateCode(math)
    } else if (options.attrs.tex) {
      jar.updateCode(options.attrs.tex)
    }
  }
  // Place the cursor at the end of the editor.
  const L = jar.toString().length
  jar.restore({ start: L, end: L, dir: undefined })

  const guidance = wrapper.appendChild(document.createElement("p"))
  guidance.id = "math-editor-guidance"
  guidance.className = "math-editor-guidance"
  guidance.setAttribute("role", "status")
  editor.setAttribute("aria-describedby", guidance.id)
  const previewLabel = wrapper.appendChild(document.createElement("div"))
  previewLabel.className = "math-editor-label"
  previewLabel.textContent = "Preview"
  const mathDisplay = wrapper.appendChild(document.createElement("div"))
  mathDisplay.setAttribute("class", "math-display")
  mathDisplay.setAttribute("aria-label", "Equation preview")

  const renderMath = function(code) {
    // eslint-disable-next-line no-useless-assignment
    let tex = ""
    let isUDF = false
    editor.removeAttribute("aria-invalid")
    guidance.textContent = isCalculation && /\n\s*[^\n=]+\s*=/.test(code) &&
      !/^\s*(function|module|draw)\b/.test(code)
      ? "For successive calculations, put each expression in a separate calculation cell."
      : ""
    if (!code.trim()) {
      mathDisplay.textContent = "Your equation will appear here."
      mathDisplay.classList.add("math-preview-empty")
      return
    }
    mathDisplay.classList.remove("math-preview-empty")
    if (isCalculation) {
      // Check if an auto-correct is needed (after a user types a space.)
      const selText = selectedText(editor)
      if (selText.length === 0) {
        autoCorrect(jar, textBeforeCursor(editor), textAfterCursor(editor))
      }
      tex = jar.toString()
      if (decimalSymbol === ",") { tex = dotFromCommaForStorage(tex) }
      isUDF = functionRegEx.test(tex)
      if (!isUDF) {
        const formats = {
          decimalFormat: options.outerView.state.doc.attrs.decimalFormat,
          dateFormat: options.outerView.state.doc.attrs.dateFormat
        }
        tex = hurmet.parse(tex, formats, false, true)
      }
    } else {
      tex = code
    }
    if (!isUDF) {
      try {
        temml.render(tex, mathDisplay, {
          displayMode: options.attrs.displayMode,
          wrap: "=",
          throwOnError: true,
          errorColor: "#b42318"
        })
      } catch (err) {
        while (mathDisplay.lastChild) {
          mathDisplay.removeChild(mathDisplay.lastChild)
        }
        mathDisplay.textContent = "Preview unavailable."
        editor.setAttribute("aria-invalid", "true")
        guidance.textContent = String(err.message || "Check the equation source.")
      }
    } else {
      mathDisplay.textContent = "Function definition — evaluated when applied."
    }
  }
  renderMath(jar.toString())

  editor.addEventListener("input", e => {
    renderMath(jar.toString())
  })

  const submit = _ => {
    // Get the string that the user typed into the prompt box.
    let mathString = jar.toString()
    // Strip leading spaces and trailing spaces
    mathString = mathString.replace(/^[\s\u200b]+/, "")
    mathString = mathString.replace(/[\s\u200b]+$/, "")
    mathString = mathString.replace(/\r?\n/g, "\n")
    // Save all number strings with no thousands separator and with a
    // dot for a decimal separator. Later functions will display numbers
    // in the reader's preference for decimal separator.
    if (isCalculation && decimalSymbol === ",") {
      mathString = dotFromCommaForStorage(mathString)
    }
    const formats = {
      decimalFormat: options.outerView.state.doc.attrs.decimalFormat,
      dateFormat: options.outerView.state.doc.attrs.dateFormat
    }
    const params = (isTex)
      ? { tex: mathString }
      : hurmet.compile(mathString, formats)
    params.displayMode = options.attrs.displayMode
    close()
    options.callback(params)
  }

  const footer = wrapper.appendChild(document.createElement("div"))
  footer.className = "math-editor-footer"
  const shortcuts = footer.appendChild(document.createElement("span"))
  shortcuts.textContent = "Enter to apply · Shift Enter for a new line"
  const actions = footer.appendChild(document.createElement("div"))
  actions.className = "math-editor-actions"
  const cancel = actions.appendChild(document.createElement("button"))
  cancel.type = "button"
  cancel.textContent = "Cancel"
  cancel.addEventListener("click", () => close(true))
  const apply = actions.appendChild(document.createElement("button"))
  apply.type = "button"
  apply.className = "math-editor-apply"
  apply.textContent = "Apply"
  apply.addEventListener("click", submit)

  editor.addEventListener("submit", e => {
    e.preventDefault()
    submit()
  })

  editor.addEventListener("keydown", e => {
    if (e.isComposing || e.keyCode === 229) { return }
    if (e.keyCode === 27) {
      // Esc. Close without updating.
      e.preventDefault()
      close(true)
    } else if (e.keyCode === 13 && e.shiftKey && !e.defaultPrevented) {
      // Keep a real newline in the source instead of a browser-generated <br>.
      e.preventDefault()
      const { start, end } = jar.save()
      const text = jar.toString()
      const before = text.slice(0, start)
      const indent = /(?:^|\n)([ \t]*)[^\n]*$/.exec(before)?.[1] || ""
      const newline = "\n" + indent
      jar.updateCode(before + newline + text.slice(end))
      const next = start + newline.length
      jar.restore({ start: next, end: next })
      renderMath(jar.toString())
    } else if (e.keyCode === 13 && !e.shiftKey) {
      // Submit upon Enter. (Shift-Enter creates a newline.)
      e.preventDefault()
      submit()
    }
  })

  wrapper.addEventListener("keydown", event => {
    if (event.key === "Escape" && !event.defaultPrevented) {
      event.preventDefault()
      close(true)
    }
  })

  editor.addEventListener("pointerup", e => {
    if (e.ctrlKey || e.metaKey) {
      // Check if the clicked-on word is a previously defined variable
      const word = findWordAtClickPos(jar.toString(), jar.pos())
      if (word) {
        const defPos = positionOfDefinition(word, options.outerView.state.doc, options.pos)
        if (defPos > -1) {
          // Hand control to the callback, which will scroll to the definition.
          e.preventDefault()
          if (wrapper.parentNode) {
            wrapper.parentNode.classList.remove("ProseMirror-selectednode")
          }
          options.callback2(defPos)
          close()
        }
      }
    }
  })

  return close
}
