'use strict';

const { ipcRenderer, contextBridge } = require('electron');

// Ponte minimo verso il processo principale, usato dalla patch sulle notifiche
// iniettata nel contesto della pagina (vedi NOTIFICATION_PATCH in main.js).
contextBridge.exposeInMainWorld('outlinux', {
  notificationClicked: () => ipcRenderer.send('outlinux:notification-click')
});

/**
 * Outlook Web espone il numero di messaggi non letti nel titolo della pagina,
 * nel formato "(12) Posta in arrivo - utente@dominio - Outlook".
 * Lo leggiamo da lì e lo inoltriamo al processo principale per badge e tray.
 */

const TITLE_UNREAD = /^\s*\((\d+)\)/;
let lastReported = -1;

function readUnreadFromTitle() {
  const match = TITLE_UNREAD.exec(document.title || '');
  return match ? parseInt(match[1], 10) : 0;
}

function readUnreadFromDom() {
  // Fallback: il nodo della cartella selezionata espone il conteggio via aria-label.
  const node = document.querySelector('[data-folder-name="Inbox"] [aria-label*="non lett"], [title*="Posta in arrivo"] .unreadCount');
  if (!node) return null;
  const value = parseInt((node.textContent || '').replace(/\D+/g, ''), 10);
  return Number.isFinite(value) ? value : null;
}

function report() {
  let count = readUnreadFromTitle();
  if (!count) {
    const fromDom = readUnreadFromDom();
    if (fromDom !== null) count = fromDom;
  }
  if (count === lastReported) return;
  lastReported = count;
  ipcRenderer.send('outlinux:unread', count);
}

function observeTitle() {
  const titleEl = document.querySelector('head > title');
  if (!titleEl) return false;
  new MutationObserver(report).observe(titleEl, { childList: true, characterData: true, subtree: true });
  return true;
}

function boot() {
  report();
  if (!observeTitle()) {
    // Il <title> può non esistere ancora: riproviamo finché non compare.
    const headObserver = new MutationObserver(() => {
      if (observeTitle()) headObserver.disconnect();
      report();
    });
    if (document.head) headObserver.observe(document.head, { childList: true, subtree: true });
  }
  // Rete di sicurezza: Outlook a volte aggiorna il titolo senza mutazioni osservabili.
  setInterval(report, 10000);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}

window.addEventListener('focus', () => {
  // Alla riapertura della finestra forziamo una rilettura del conteggio.
  lastReported = -1;
  report();
});
