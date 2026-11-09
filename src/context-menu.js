'use strict';

const { Menu, MenuItem, clipboard, shell } = require('electron');

/** Menu contestuale con suggerimenti ortografici, azioni sui link e sulle immagini. */
function attachContextMenu(contents) {
  contents.on('context-menu', (_event, params) => {
    const menu = new Menu();
    const add = (options) => menu.append(new MenuItem(options));

    for (const suggestion of params.dictionarySuggestions.slice(0, 5)) {
      add({ label: suggestion, click: () => contents.replaceMisspelling(suggestion) });
    }
    if (params.dictionarySuggestions.length) add({ type: 'separator' });

    if (params.misspelledWord) {
      add({
        label: 'Aggiungi al dizionario',
        click: () => contents.session.addWordToSpellCheckerDictionary(params.misspelledWord)
      });
      add({ type: 'separator' });
    }

    if (params.linkURL) {
      add({ label: 'Apri il link nel browser', click: () => shell.openExternal(params.linkURL) });
      add({ label: 'Copia indirizzo del link', click: () => clipboard.writeText(params.linkURL) });
      add({ type: 'separator' });
    }

    if (params.hasImageContents) {
      add({ label: 'Copia immagine', click: () => contents.copyImageAt(params.x, params.y) });
      add({ type: 'separator' });
    }

    if (params.isEditable) {
      add({ role: 'undo', label: 'Annulla' });
      add({ role: 'redo', label: 'Ripeti' });
      add({ type: 'separator' });
      add({ role: 'cut', label: 'Taglia' });
    }
    if (params.selectionText || params.isEditable) add({ role: 'copy', label: 'Copia' });
    if (params.isEditable) {
      add({ role: 'paste', label: 'Incolla' });
      add({ role: 'pasteAndMatchStyle', label: 'Incolla senza formattazione' });
      add({ role: 'selectAll', label: 'Seleziona tutto' });
    }

    if (menu.items.length) menu.popup();
  });
}

module.exports = attachContextMenu;
