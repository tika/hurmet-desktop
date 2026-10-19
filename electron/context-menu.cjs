const { Menu, clipboard } = require('electron')

function editorItems(items, win) {
  return items.map(item => {
    if (item.type === 'separator') return { type: 'separator' }
    if (item.submenu) return { label: item.label, submenu: editorItems(item.submenu, win) }
    return {
      id: item.id,
      label: item.label,
      type: item.type || 'normal',
      enabled: item.enabled !== false,
      checked: !!item.checked,
      click: () => {
        if (!win.isDestroyed()) win.webContents.send('hurmet:menu-command', item.id)
      }
    }
  })
}

module.exports = function contextMenu(win, params, items) {
  const separator = { type: 'separator' }
  const template = []
  if (params.misspelledWord) {
    for (const suggestion of params.dictionarySuggestions.slice(0, 5)) {
      template.push({ label: suggestion, click: () => win.webContents.replaceMisspelling(suggestion) })
    }
    template.push({ label: 'Add to Dictionary', click: () => {
      win.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord)
    } }, separator)
  }
  if (process.platform === 'darwin' && params.selectionText.trim()) {
    template.push({ label: 'Look Up Selection', click: () => {
      win.webContents.showDefinitionForSelection()
    } }, separator)
  }
  if (params.linkURL) {
    template.push({ label: 'Copy Link Address', click: () => clipboard.writeText(params.linkURL) },
      separator)
  }
  if (items?.length) template.push(...editorItems(items, win), separator)
  const flags = params.editFlags
  template.push(
    { role: 'cut', enabled: params.isEditable && flags.canCut },
    { role: 'copy', enabled: flags.canCopy },
    { role: 'paste', enabled: params.isEditable && flags.canPaste },
    { role: 'pasteAndMatchStyle', label: 'Paste as Plain Text',
      enabled: params.isEditable && flags.canPaste },
    { role: 'selectAll', enabled: flags.canSelectAll }
  )
  return Menu.buildFromTemplate(template)
}
