'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Ponte della finestra di autenticazione: nessun accesso alla rete o al disco.
contextBridge.exposeInMainWorld('outlinuxAuth', {
  submit: (credentials) => ipcRenderer.send('outlinux:credentials', credentials),
  cancel: () => ipcRenderer.send('outlinux:credentials', null)
});
