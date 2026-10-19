import { MenuItem } from "prosemirror-menu"
import { Fragment, Slice } from "prosemirror-model"
import { TextSelection } from "prosemirror-state"

// Display notation in prose; insert Hurmet unit literals or TeX markup when
// the same command is used inside an equation's source editor.
const electricalUnits = [
  ["Voltage", "V"], ["Voltage", "mV"], ["Voltage", "kV"],
  ["Current", "A"], ["Current", "mA"], ["Current", "µA"],
  ["Resistance", "Ω", "ohm"], ["Resistance", "kΩ", "kΩ"],
  ["Resistance", "MΩ", "MΩ"],
  ["Capacitance", "µF"], ["Capacitance", "nF"], ["Capacitance", "pF"],
  ["Inductance", "mH"], ["Inductance", "µH"],
  ["Frequency", "Hz"], ["Frequency", "kHz"], ["Frequency", "MHz"],
  ["Power", "W"], ["Charge", "C"]
]
const mechanicalUnits = [
  ["Length", "m"], ["Length", "mm"], ["Area", "mm²", "mm^2"],
  ["Second Moment of Area", "mm⁴", "mm^4"],
  ["Force", "N"], ["Force", "kN"], ["Moment / Torque", "N·m", "N*m"],
  ["Stress / Pressure", "MPa"], ["Elastic Modulus", "GPa"],
  ["Mass", "kg"], ["Density", "kg/m³", "kg/m^3"],
  ["Velocity", "m/s"], ["Acceleration", "m/s²", "m/s^2"],
  ["Angular Speed", "rad/s"], ["Temperature", "°C"], ["Temperature", "K"],
  ["Energy", "J"]
]

function insertText(text, calculationText = text, texText = text) {
  return new MenuItem({
    label: text,
    insertText: text,
    calculationText,
    texText,
    enable: state => state.selection.$from.parent.inlineContent,
    run(state, dispatch) {
      dispatch(state.tr.insertText(text).scrollIntoView())
    }
  })
}

function noteTemplate(sections) {
  return new MenuItem({
    label: "Note template",
    enable: state => state.selection.$from.depth <= 1,
    run(state, dispatch) {
      const { heading, paragraph } = state.schema.nodes
      const nodes = sections.flatMap(label => [
        heading.create({ level: 3 }, state.schema.text(label)), paragraph.create()
      ])
      const from = state.selection.from
      const tr = state.tr.replaceSelection(new Slice(Fragment.fromArray(nodes), 0, 0))
      let firstEntry = null
      const start = Math.min(from, tr.doc.content.size)
      tr.doc.nodesBetween(start, tr.selection.to, (node, pos) => {
        if (firstEntry === null && node.type === paragraph && node.content.size === 0) {
          firstEntry = pos + 1
        }
      })
      if (firstEntry !== null) {
        tr.setSelection(TextSelection.create(tr.doc, firstEntry))
      }
      dispatch(tr.scrollIntoView())
    }
  })
}

export function engineeringMenu(register) {
  const symbols = (id, label, entries) => ({
    label,
    submenu: entries.map(([symbol, name, tex], index) => register(
      `${id}-${index}`, `${symbol} — ${name}`, insertText(symbol, symbol, tex)))
  })
  const units = (id, label, entries) => ({
    label,
    submenu: entries.map(([quantity, notation, code = notation], index) => register(
      `${id}-${index}`, `${quantity} — ${notation}`,
      insertText(notation, ` '${code}'`, `\\,\\text{${notation}}`)))
  })
  return { label: "Engineering", submenu: [
    symbols("electrical-symbol", "Electrical Symbols", [
      ["Ω", "Omega", "\\Omega"], ["φ", "Phi", "\\phi"],
      ["ω", "Omega (lowercase)", "\\omega"], ["μ", "Mu", "\\mu"],
      ["θ", "Theta", "\\theta"], ["∠", "Phase Angle", "\\angle"]
    ]),
    symbols("mechanical-symbol", "Mechanical Symbols", [
      ["σ", "Sigma", "\\sigma"], ["ε", "Epsilon", "\\varepsilon"],
      ["τ", "Tau", "\\tau"], ["ρ", "Rho", "\\rho"], ["ν", "Nu", "\\nu"],
      ["θ", "Theta", "\\theta"], ["Δ", "Delta", "\\Delta"],
      ["ω", "Omega", "\\omega"], ["α", "Alpha", "\\alpha"], ["β", "Beta", "\\beta"]
    ]),
    symbols("math-symbol", "Math Symbols", [
      ["±", "Plus or Minus", "\\pm"], ["×", "Multiply", "\\times"],
      ["·", "Dot Product / Multiply", "\\cdot"], ["≈", "Approximately Equal", "\\approx"],
      ["≠", "Not Equal", "\\ne"], ["≤", "Less Than or Equal", "\\le"],
      ["≥", "Greater Than or Equal", "\\ge"], ["∑", "Sum", "\\sum"],
      ["∫", "Integral", "\\int"], ["∂", "Partial Derivative", "\\partial"],
      ["∇", "Nabla", "\\nabla"], ["π", "Pi", "\\pi"], ["°", "Degree", "{}^{\\circ}"]
    ]),
    units("electrical-unit", "Electrical Unit Notation", electricalUnits),
    units("mechanical-unit", "Mechanical Unit Notation", mechanicalUnits),
    { type: "separator" },
    register("worked-problem", "Worked Problem Template",
      noteTemplate(["Given", "Find", "Assumptions", "Working", "Result"])),
    register("lab-notes", "Lab Notes Template",
      noteTemplate(["Objective", "Setup", "Measurements", "Analysis", "Conclusion"]))
  ] }
}
