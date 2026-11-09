#!/usr/bin/env node
'use strict';

/**
 * Prova dei popup.
 *
 * Outlook apre "Rispondi", "Rispondi a tutti" e i pop-out del calendario con
 * `window.open('about:blank')` e solo dopo ci scrive dentro da JavaScript.
 * Finestre così non hanno host: se la politica di navigazione le scambia per
 * link esterni finiscono al browser — che apre una scheda vuota — e in Outlook
 * `window.open` restituisce `null`, quindi la risposta non compare proprio.
 * Questo test tiene ferma quella regola, insieme alle due opposte: i link veri
 * al browser di sistema, i pop-out di Outlook dentro l'app.
 *
 * Non servono né rete né account: le richieste https sono intercettate e
 * servite da una pagina finta. Le impostazioni dell'utente non vengono toccate,
 * perché l'app gira su una cartella `userData` temporanea.
 *
 * Lo stesso file fa da lanciatore (sotto node) e da processo principale (sotto
 * electron): `npm run popup-test`.
 */

const path = require('path');

/* ---------------------------------------------------------- lanciatore */

if (!process.versions.electron) {
  const { spawn } = require('child_process');
  const electron = require('electron');
  const { platformFlags } = require('./flags');

  const child = spawn(electron, [__filename, ...platformFlags()], { stdio: 'inherit' });
  child.on('close', (code, signal) => process.exit(signal ? 1 : code ?? 0));
  return;
}

/* ----------------------------------------------- processo principale */

const fs = require('fs');
const os = require('os');
const { app, session, shell, BrowserWindow } = require('electron');

const TIMEOUT_MS = Number(process.env.POPUP_TEST_TIMEOUT || 60000);

// Cartella dati tutta del test: l'app non deve leggere né riscrivere le
// impostazioni vere, e il lock di istanza singola non deve scontrarsi con
// un'Outlinux già aperta.
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'outlinux-popup-test-'));
app.setPath('userData', userData);
fs.writeFileSync(
  path.join(userData, 'settings.json'),
  JSON.stringify({ service: 'office', startPage: 'mail', startMinimized: true, showTrayIcon: false }, null, 2)
);

// Al posto del browser di sistema teniamo un elenco: è metà del verdetto.
const external = [];
shell.openExternal = async (url) => {
  external.push(url);
  return undefined;
};

// Pagina finta servita per qualsiasi indirizzo https: imita i tre modi in cui
// Outlook apre una finestra.
const PAGE = `<!doctype html><meta charset="utf-8"><title>Outlook (finto)</title>
<body><h1>evento del calendario</h1><script>
window.rispondiATutti = function () {
  const esito = {};
  const w = window.open('about:blank', '_blank', 'width=900,height=700');
  esito.handle = Boolean(w);
  if (w) {
    try {
      w.document.write('<!doctype html><title>Rispondi a tutti</title><p id="bozza">bozza</p>');
      w.document.close();
      esito.scritta = true;
    } catch (e) {
      esito.scritta = false;
      esito.errore = String(e);
    }
  }
  return JSON.stringify(esito);
};
window.apriLinkEsterno = function () { window.open('https://esempio-esterno.test/pagina', '_blank'); };
window.apriPopoutOutlook = function () { window.open('https://outlook.office.com/mail/deeplink/compose?popout=1', '_blank'); };
</script></body>`;

app.whenReady().then(() => {
  session.defaultSession.protocol.handle('https', () => new Response(PAGE, { headers: { 'content-type': 'text/html' } }));
});

// L'app vera: la politica di navigazione sotto esame è la sua.
require(path.join(__dirname, '..', 'src', 'main.js'));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const checks = [];
function check(nome, superato, dettaglio = '') {
  checks.push({ nome, superato, dettaglio });
}

function report(code) {
  console.log('\n=== prova dei popup ===');
  for (const { nome, superato, dettaglio } of checks) {
    console.log(` ${superato ? '✔' : '✖'} ${nome}${dettaglio ? ` — ${dettaglio}` : ''}`);
  }
  console.log(code === 0 ? '\n✔ popup test superato' : '\n✖ popup test fallito');
  try {
    fs.rmSync(userData, { recursive: true, force: true });
  } catch {
    /* la cartella temporanea resta: non è un errore del test */
  }
  process.exit(code);
}

const timeout = setTimeout(() => {
  check('il test è arrivato in fondo', false, `scaduto dopo ${TIMEOUT_MS} ms`);
  report(1);
}, TIMEOUT_MS);

/** Attende che la pagina finta sia pronta nella finestra principale. */
async function waitForMainWindow() {
  for (let i = 0; i < 60; i += 1) {
    const [win] = BrowserWindow.getAllWindows();
    if (win && !win.isDestroyed() && !win.webContents.isLoading() && win.webContents.getURL().startsWith('https://')) {
      return win;
    }
    await sleep(250);
  }
  return null;
}

app.whenReady().then(async () => {
  const win = await waitForMainWindow();
  if (!win) {
    check('la finestra principale ha caricato la pagina', false);
    report(1);
    return;
  }
  const figlie = () => BrowserWindow.getAllWindows().filter((other) => other !== win && !other.isDestroyed());

  // 1. "Rispondi a tutti": finestra aperta vuota e riempita da chi la apre.
  const esito = JSON.parse(await win.webContents.executeJavaScript('rispondiATutti()', true));
  await sleep(800);
  check('window.open restituisce la finestra', esito.handle === true);
  check("chi apre può scrivere nel popup", esito.scritta === true, esito.errore || '');
  check('il popup è una finestra di Outlinux', figlie().length === 1, `finestre figlie: ${figlie().length}`);
  check('niente browser di sistema', external.length === 0, external.join(' '));

  const [popup] = figlie();
  if (popup) {
    const testo = await popup.webContents.executeJavaScript(
      'document.getElementById("bozza") && document.getElementById("bozza").textContent'
    );
    check('il contenuto scritto è visibile', testo === 'bozza', `testo: ${JSON.stringify(testo)}`);
    popup.destroy();
    await sleep(200);
  }

  // 2. Un link vero verso l'esterno resta compito del browser.
  await win.webContents.executeJavaScript('apriLinkEsterno()', true);
  await sleep(500);
  check(
    'il link esterno va al browser di sistema',
    external.length === 1 && external[0].includes('esempio-esterno.test'),
    external.join(' ')
  );
  check('il link esterno non apre finestre', figlie().length === 0, `finestre figlie: ${figlie().length}`);

  // 3. Un pop-out di Outlook con indirizzo vero resta invece nell'app.
  await win.webContents.executeJavaScript('apriPopoutOutlook()', true);
  await sleep(1500);
  check(
    "il pop-out di Outlook resta nell'app",
    figlie().length === 1 && external.length === 1,
    `finestre figlie: ${figlie().length}, aperture nel browser: ${external.length}`
  );

  clearTimeout(timeout);
  report(checks.every(({ superato }) => superato) ? 0 : 1);
});
