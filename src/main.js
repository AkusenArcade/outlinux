'use strict';

const path = require('path');
const { spawn } = require('child_process');
const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  shell,
  nativeImage,
  ipcMain,
  dialog,
  screen,
  session
} = require('electron');

const settings = require('./settings');
const buildMenu = require('./menu');
const attachContextMenu = require('./context-menu');
const credentialsStore = require('./credentials-store');
const {
  hostOf,
  isOpenerControlledUrl,
  canOpenExternally,
  shouldOpenInApp
} = require('./url-policy');

const ASSETS = path.join(__dirname, '..', 'assets');
const APP_ICON = path.join(ASSETS, 'icon.png');

// User agent "pulito": Outlook Web rifiuta o degrada l'interfaccia se rileva Electron.
const CHROME_VERSION = process.versions.chrome.split('.')[0];
const USER_AGENT =
  `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) ` +
  `Chrome/${CHROME_VERSION}.0.0.0 Safari/537.36`;

/**
 * Iniettato nel contesto della pagina: intercetta il click sulle notifiche
 * di Outlook per riportare in primo piano la finestra anche quando è nascosta
 * nella tray. `window.outlinux` è il ponte esposto da preload.js.
 */
const NOTIFICATION_PATCH = `(() => {
  if (window.__outlinuxNotificationPatch) return;
  const Native = window.Notification;
  if (!Native || !window.outlinux) return;
  function Patched(title, options) {
    const notification = new Native(title, options);
    notification.addEventListener('click', () => {
      try { window.outlinux.notificationClicked(); } catch (e) {}
    });
    return notification;
  }
  Patched.prototype = Native.prototype;
  Patched.requestPermission = (...args) => Native.requestPermission(...args);
  Object.defineProperty(Patched, 'permission', { get: () => Native.permission });
  window.Notification = Patched;
  window.__outlinuxNotificationPatch = true;
})();`;

// Numero di crash del processo GPU oltre il quale si disattiva il compositing.
const GPU_CRASH_LIMIT = 3;

let mainWindow = null;
let tray = null;
let gpuCrashes = 0;
const triedSavedCredentials = new Set();
let unreadCount = 0;
let isQuitting = false;
let pendingMailto = null;

const isDev = process.argv.includes('--dev');

/* ------------------------------------------------------------------ utils */

function composeUrlFromMailto(mailto) {
  let parsed;
  try {
    parsed = new URL(mailto);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'mailto:') return null;

  const params = new URLSearchParams();
  const to = decodeURIComponent(parsed.pathname || '');
  if (to) params.set('to', to);
  for (const [key, value] of parsed.searchParams) {
    const name = key.toLowerCase();
    if (['subject', 'body', 'cc', 'bcc'].includes(name)) params.set(name, value);
  }
  return `${settings.baseUrl()}/mail/deeplink/compose?${params.toString()}`;
}

function extractMailto(argv) {
  return argv.find((arg) => typeof arg === 'string' && arg.startsWith('mailto:')) || null;
}


/* --------------------------------------------------- autenticazione HTTP */

/**
 * Finestra modale per le credenziali. Serve per le sfide HTTP (NTLM, Negotiate,
 * Basic) degli ADFS e dei proxy aziendali: senza un handler `login` Electron
 * annulla la richiesta e la pagina resta bianca.
 */
function askCredentials(authInfo) {
  return new Promise((resolve) => {
    // Una finestra modale figlia di un genitore nascosto resta invisibile:
    // se la finestra principale non è a schermo, la mostriamo prima.
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) showWindow();
    const parent = mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() ? mainWindow : undefined;
    const win = new BrowserWindow({
      parent,
      modal: Boolean(parent),
      width: 420,
      height: 420,
      show: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      title: 'Autenticazione richiesta',
      icon: APP_ICON,
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, 'credentials-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });

    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      ipcMain.removeListener('outlinux:credentials', onCredentials);
      if (!win.isDestroyed()) win.destroy();
      resolve(value);
    };

    function onCredentials(event, credentials) {
      if (event.sender !== win.webContents) return;
      finish(credentials);
    }

    ipcMain.on('outlinux:credentials', onCredentials);
    win.on('closed', () => finish(null));

    // La finestra si adatta al contenuto: con zoom o caratteri diversi il
    // pulsante "Accedi" resterebbe altrimenti sotto il bordo inferiore.
    win.once('ready-to-show', async () => {
      try {
        const height = await win.webContents.executeJavaScript(
          'Math.ceil(document.documentElement.getBoundingClientRect().height)'
        );
        const [width] = win.getContentSize();
        win.setContentSize(width, Math.min(640, Math.max(300, height)));
      } catch {
        /* se la misura fallisce restano le dimensioni predefinite */
      }
      win.center();
      win.show();
    });

    win.loadFile(path.join(ASSETS, 'credentials.html'), {
      query: {
        host: `${authInfo.host}${authInfo.port ? ':' + authInfo.port : ''}`,
        scheme: authInfo.scheme || '',
        canRemember: credentialsStore.available() ? '1' : '0'
      }
    });
  });
}

/**
 * Un 401 con `WWW-Authenticate: Negotiate/NTLM` resta senza risposta se il
 * dominio non è nell'allowlist di Chromium: la pagina appare bianca. Quando
 * succede lo proponiamo all'utente, salviamo il dominio e riavviamo.
 */
function watchIntegratedAuthChallenges(ses) {
  let asking = false;

  ses.webRequest.onHeadersReceived((details, callback) => {
    callback({});
    if (details.statusCode !== 401 || asking) return;

    const headers = details.responseHeaders || {};
    const challenge = Object.entries(headers)
      .filter(([name]) => name.toLowerCase() === 'www-authenticate')
      .flatMap(([, values]) => values)
      .join(' ')
      .toLowerCase();
    if (!challenge.includes('negotiate') && !challenge.includes('ntlm')) return;

    const host = hostOf(details.url);
    const allowlist = settings.get('authServerAllowlist');
    if (!host || (allowlist && allowlist.split(',').some((entry) => entry.trim().endsWith(host)))) return;

    asking = true;
    dialog
      .showMessageBox(mainWindow, {
        type: 'question',
        title: 'Autenticazione integrata',
        message: `${host} richiede l'autenticazione integrata Windows`,
        detail:
          "È il meccanismo usato dagli ADFS aziendali (Kerberos/NTLM). Chromium non risponde a " +
          "questa richiesta finché il dominio non è autorizzato, e la pagina resta bianca.\n\n" +
          "Autorizzando il dominio, Outlinux si riavvia e chiede nome utente e password.",
        buttons: ['Autorizza e riavvia', 'Annulla'],
        defaultId: 0,
        cancelId: 1
      })
      .then(({ response }) => {
        if (response !== 0) {
          asking = false;
          return;
        }
        const updated = [settings.get('authServerAllowlist'), host].filter(Boolean).join(',');
        settings.set('authServerAllowlist', updated);
        restartApp();
      });
  });
}

/* ------------------------------------------------- politica di navigazione */

/**
 * Opzioni delle finestre figlie. Di proposito non tocchiamo `webPreferences`:
 * un popup che eredita quelle di chi lo apre resta nello stesso processo e
 * nella stessa origine, condizione necessaria perché Outlook possa scrivere
 * dentro la finestra appena aperta.
 */
const POPUP_OPTIONS = {
  width: 1024,
  height: 760,
  icon: APP_ICON,
  autoHideMenuBar: true,
  backgroundColor: '#f3f2f1'
};

/** Apre la finestra di composizione a partire da un indirizzo mailto:. */
function openCompose(mailto) {
  const composeUrl = composeUrlFromMailto(mailto);
  if (!composeUrl || !mainWindow || mainWindow.isDestroyed()) return false;
  mainWindow.loadURL(composeUrl, { userAgent: USER_AGENT });
  return true;
}

/**
 * Regole su dove aprire link e popup. Si aggancia in `web-contents-created`,
 * quindi vale anche per le finestre figlie: una risposta aperta a parte si
 * comporta come la finestra principale, invece di restare senza regole.
 */
function attachNavigationPolicy(contents) {
  contents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('mailto:')) {
      openCompose(url);
      return { action: 'deny' };
    }
    if (shouldOpenInApp(url, contents.getURL())) {
      if (process.env.OUTLINUX_DEBUG) {
        console.log(`[outlinux] popup nell'app: ${isOpenerControlledUrl(url) ? url + ' (riempito da Outlook)' : url}`);
      }
      return { action: 'allow', outlivesOpener: false, overrideBrowserWindowOptions: { ...POPUP_OPTIONS } };
    }
    if (canOpenExternally(url)) {
      console.log(`[outlinux] popup aperto nel browser di sistema: ${url}`);
      shell.openExternal(url);
      return { action: 'deny' };
    }
    // Al browser questo schema non direbbe nulla: aprirebbe una scheda vuota.
    console.warn(`[outlinux] popup ignorato, schema non gestito: ${url}`);
    return { action: 'deny' };
  });

  contents.on('will-navigate', (event, url) => {
    if (shouldOpenInApp(url, contents.getURL())) return;
    event.preventDefault();
    if (!canOpenExternally(url)) {
      console.warn(`[outlinux] navigazione ignorata, schema non gestito: ${url}`);
      return;
    }
    console.log(`[outlinux] navigazione aperta nel browser di sistema: ${url}`);
    shell.openExternal(url);
  });

  // Una finestra figlia che non carica resta bianca senza dire perché:
  // almeno il motivo finisce nel log.
  contents.on('did-create-window', (win, { url }) => {
    win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame || errorCode === -3) return;
      console.error(
        `[outlinux] finestra figlia non caricata (${errorCode}): ${errorDescription} – ${validatedURL || url}`
      );
    });
  });
}

/* -------------------------------------------------------------- finestra */

function createWindow() {
  const conf = settings.get();
  const bounds = conf.window || {};

  mainWindow = new BrowserWindow({
    width: bounds.width || 1280,
    height: bounds.height || 860,
    x: Number.isInteger(bounds.x) ? bounds.x : undefined,
    y: Number.isInteger(bounds.y) ? bounds.y : undefined,
    minWidth: 480,
    minHeight: 420,
    show: false,
    icon: APP_ICON,
    title: 'Outlinux',
    autoHideMenuBar: conf.autoHideMenuBar,
    backgroundColor: '#f3f2f1',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: conf.spellCheck,
      backgroundThrottling: false
    }
  });

  if (bounds.maximized) mainWindow.maximize();

  const contents = mainWindow.webContents;
  contents.setUserAgent(USER_AGENT);
  contents.setZoomFactor(conf.zoomFactor || 1);

  if (conf.spellCheck) {
    try {
      const available = session.defaultSession.availableSpellCheckerLanguages;
      const wanted = (conf.spellCheckLanguages || []).filter((lang) => available.includes(lang));
      if (wanted.length) session.defaultSession.setSpellCheckerLanguages(wanted);
    } catch (err) {
      console.warn('[outlinux] correttore ortografico non configurato:', err.message);
    }
  }

  mainWindow.loadURL(pendingMailto ? composeUrlFromMailto(pendingMailto) || settings.startUrl() : settings.startUrl(), {
    userAgent: USER_AGENT
  });
  pendingMailto = null;

  // `ready-to-show` arriva al primo disegno: se il caricamento passa per redirect
  // o pagine senza contenuto (tipico dei flussi di accesso) può tardare parecchio,
  // e l'app sembrerebbe partita solo nella tray.
  if (!settings.get('startMinimized')) {
    const showFallback = setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) mainWindow.show();
    }, 2500);
    mainWindow.once('ready-to-show', () => {
      clearTimeout(showFallback);
      mainWindow.show();
    });
    mainWindow.once('closed', () => clearTimeout(showFallback));
  }

  contents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return; // -3 = richiesta annullata
    console.error(`[outlinux] caricamento fallito (${errorCode}): ${errorDescription} – ${validatedURL}`);
    const fallback = path.join(ASSETS, 'offline.html');
    mainWindow.loadFile(fallback, {
      query: { error: errorDescription || String(errorCode), home: settings.startUrl() }
    });
  });

  contents.on('did-finish-load', () => {
    if (process.env.OUTLINUX_DEBUG) console.log(`[outlinux] caricato: ${contents.getURL()}`);
    contents.executeJavaScript(NOTIFICATION_PATCH, true).catch(() => {
      /* la patch è best-effort: un fallimento non deve rompere il caricamento */
    });
  });

  contents.on('render-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit') return;
    console.error('[outlinux] renderer terminato:', details.reason);
    contents.reload();
  });

  contents.on('page-title-updated', (event) => {
    event.preventDefault();
    mainWindow.setTitle(unreadCount > 0 ? `Outlinux (${unreadCount})` : 'Outlinux');
  });

  // Diagnostica: con OUTLINUX_DEBUG=1 si segue tutta la catena di redirect,
  // utile quando un accesso aziendale si ferma su una pagina vuota.
  if (process.env.OUTLINUX_DEBUG) {
    contents.on('will-redirect', (_event, url) => console.log(`[outlinux] redirect: ${url}`));
    contents.on('did-navigate', (_event, url, httpCode, httpStatus) =>
      console.log(`[outlinux] navigato: ${url} (${httpCode} ${httpStatus})`)
    );
    contents.on('did-frame-navigate', (_event, url, httpCode, _status, isMainFrame) => {
      if (!isMainFrame) console.log(`[outlinux] iframe: ${url} (${httpCode})`);
    });
    // Electron decide in base al numero di parametri se passare l'API vecchia:
    // con i rest args riceviamo sempre quella nuova, dove disponibile.
    contents.on('console-message', (...args) => {
      const [event, legacyLevel, legacyMessage, legacyLine, legacySource] = args;
      // Da Electron 35 l'handler riceve un oggetto evento; prima erano argomenti
      // separati con il livello numerico. L'app funziona con entrambe le versioni.
      const modern = event && typeof event === 'object' && 'message' in event;
      const level = modern ? event.level : legacyLevel >= 3 ? 'error' : 'warning';
      if (level !== 'error' && level !== 'warning') return;

      const message = modern ? event.message : legacyMessage;
      const source = modern ? event.sourceId : legacySource;
      const line = modern ? event.lineNumber : legacyLine;
      console.log(`[outlinux] console(${level}): ${message} — ${source}:${line}`);
    });
  }

  mainWindow.on('close', (event) => {
    if (!isQuitting && settings.get('closeToTray') && settings.get('showTrayIcon')) {
      event.preventDefault();
      mainWindow.hide();
      return;
    }
    persistWindowState();
  });

  mainWindow.on('minimize', (event) => {
    if (settings.get('minimizeToTray') && settings.get('showTrayIcon')) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('resize', persistWindowStateDebounced);
  mainWindow.on('move', persistWindowStateDebounced);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (isDev) contents.openDevTools({ mode: 'detach' });
}

let persistTimer = null;
function persistWindowStateDebounced() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(persistWindowState, 500);
}

function persistWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const maximized = mainWindow.isMaximized();
  const bounds = maximized ? mainWindow.getNormalBounds() : mainWindow.getBounds();
  settings.set('window', { ...bounds, maximized });
}

function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (!mainWindow.isVisible()) mainWindow.show();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}

function navigateTo(section) {
  if (!mainWindow) return;
  const url = settings.baseUrl() + (settings.PATHS[section] || settings.PATHS.mail);
  mainWindow.loadURL(url, { userAgent: USER_AGENT });
  showWindow();
}

/* ------------------------------------------------------------------ tray */

function trayIcon(hasUnread) {
  const file = path.join(ASSETS, hasUnread ? 'tray-unread.png' : 'tray.png');
  const image = nativeImage.createFromPath(file);
  return image.isEmpty() ? nativeImage.createFromPath(APP_ICON) : image;
}

function createTray() {
  if (tray || !settings.get('showTrayIcon')) return;
  tray = new Tray(trayIcon(false));
  tray.setToolTip('Outlinux');
  tray.on('click', () => {
    if (mainWindow && mainWindow.isVisible() && !mainWindow.isMinimized()) mainWindow.hide();
    else showWindow();
  });
  refreshTrayMenu();
}

function refreshTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: unreadCount > 0 ? `Outlinux – ${unreadCount} non letti` : 'Outlinux',
        enabled: false
      },
      { type: 'separator' },
      { label: 'Mostra/Nascondi finestra', click: showWindow },
      { label: 'Posta', click: () => navigateTo('mail') },
      { label: 'Calendario', click: () => navigateTo('calendar') },
      { label: 'Contatti', click: () => navigateTo('people') },
      { type: 'separator' },
      { label: 'Ricarica', click: () => mainWindow && mainWindow.webContents.reload() },
      { type: 'separator' },
      {
        label: 'Esci',
        click: () => {
          isQuitting = true;
          app.quit();
        }
      }
    ])
  );
}

function destroyTray() {
  if (!tray) return;
  tray.destroy();
  tray = null;
}

function setUnread(count) {
  const next = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
  if (next === unreadCount) return;
  unreadCount = next;

  try {
    // Funziona sui desktop che implementano com.canonical.Unity.LauncherEntry.
    app.setBadgeCount(unreadCount);
  } catch {
    /* non supportato su alcuni ambienti desktop: ignorato */
  }

  if (tray) {
    tray.setImage(trayIcon(unreadCount > 0));
    tray.setToolTip(unreadCount > 0 ? `Outlinux – ${unreadCount} messaggi non letti` : 'Outlinux');
    refreshTrayMenu();
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setTitle(unreadCount > 0 ? `Outlinux (${unreadCount})` : 'Outlinux');
  }
}

/* ------------------------------------------------------- ciclo di vita app */

if (!settings.get('hardwareAcceleration')) app.disableHardwareAcceleration();

/**
 * Sotto XWayland Chromium non conosce il fattore di scala del compositor: su uno
 * schermo HiDPI con scaling frazionario (es. 1.5) l'interfaccia di Outlook viene
 * disegnata a 1x e risulta minuscola. Con il backend Wayland nativo la scala del
 * monitor viene applicata correttamente (anche quella frazionaria) e il testo
 * resta nitido.
 *
 * `--ozone-platform` viene letto da Chromium prima che lo script principale possa
 * chiamare `app.commandLine.appendSwitch`, quindi l'unico modo affidabile è
 * riavviare il processo con il flag sulla riga di comando.
 */
function ensureNativeWayland() {
  const backend = settings.get('displayBackend');
  if (backend === 'x11') return false;
  if (!process.env.WAYLAND_DISPLAY) return false;
  if (process.argv.some((arg) => arg.startsWith('--ozone-platform'))) return false;

  restartApp(['--ozone-platform=wayland']);
  return true;
}

/**
 * Riavvia l'applicazione con argomenti aggiuntivi.
 *
 * Non si usa `app.relaunch()`: dentro un AppImage rilancia l'eseguibile estratto
 * in /tmp, il cui punto di mount sparisce all'uscita del processo. Serve invece
 * rilanciare il file .AppImage ripulendo le variabili impostate da AppRun.
 */
function restartApp(extraArgs = []) {
  const execPath = process.env.APPIMAGE || process.execPath;
  const args = [...process.argv.slice(1), ...extraArgs];
  const env = { ...process.env };
  for (const key of ['APPIMAGE', 'APPDIR', 'OWD', 'ARGV0']) delete env[key];

  spawn(execPath, args, { detached: true, stdio: 'ignore', env }).unref();
  isQuitting = true;
  app.exit(0);
}

function configureCommandLine() {
  // Decorazioni lato client e scala frazionaria sotto Wayland.
  app.commandLine.appendSwitch('enable-features', 'WaylandWindowDecorations,WaylandFractionalScaleV1');

  if (!settings.get('gpuCompositing')) app.commandLine.appendSwitch('disable-gpu-compositing');

  const scale = Number(settings.get('forceScaleFactor'));
  if (scale > 0) app.commandLine.appendSwitch('force-device-scale-factor', String(scale));

  // Autenticazione integrata (Kerberos/NTLM) verso ADFS o proxy aziendali:
  // senza questa lista Chromium non invia le credenziali e la pagina di accesso
  // può restare bianca o girare in tondo. Esempio: "*.azienda.it,*.intra.it".
  // Su desktop non-GNOME Electron sceglie una cifratura fittizia per safeStorage:
  // indicando libsecret usa il portachiavi di sistema, se è in esecuzione.
  if (process.platform === 'linux' && !app.commandLine.hasSwitch('password-store')) {
    app.commandLine.appendSwitch('password-store', 'gnome-libsecret');
  }

  const authAllowlist = settings.get('authServerAllowlist');
  if (authAllowlist) {
    app.commandLine.appendSwitch('auth-server-allowlist', authAllowlist);
    app.commandLine.appendSwitch('auth-negotiate-delegate-allowlist', authAllowlist);
  }
}

if (ensureNativeWayland()) return;
configureCommandLine();
app.setAppUserModelId('dev.outlinux.app');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const mailto = extractMailto(argv);
    if (mailto) openCompose(mailto);
    showWindow();
  });

  app.on('open-url', (event, url) => {
    event.preventDefault();
    if (!url.startsWith('mailto:')) return;
    if (mainWindow) {
      openCompose(url);
      showWindow();
    } else {
      pendingMailto = url;
    }
  });

  /**
   * Alcune combinazioni driver/compositor (portatili ibridi AMD+NVIDIA sotto
   * Wayland) fanno crashare in continuazione il processo GPU, fino all'uscita
   * forzata di Chromium. Dopo qualche crash disattiviamo il compositing GPU e
   * riavviamo: l'app resta utilizzabile senza intervento dell'utente.
   */
  app.on('child-process-gone', (_event, details) => {
    if (process.env.OUTLINUX_DEBUG) console.log('[outlinux] child-process-gone:', JSON.stringify(details));
    if (details.type !== 'GPU') return;
    gpuCrashes += 1;
    console.warn(`[outlinux] processo GPU terminato (${details.reason}) – crash n. ${gpuCrashes}`);

    if (gpuCrashes < GPU_CRASH_LIMIT || !settings.get('gpuCompositing')) return;
    console.warn('[outlinux] compositing GPU disattivato per instabilità: riavvio in corso');
    settings.set('gpuCompositing', false);
    restartApp();
  });

  app.whenReady().then(() => {
    pendingMailto = extractMailto(process.argv);

    if (!app.isDefaultProtocolClient('mailto')) {
      try {
        app.setAsDefaultProtocolClient('mailto');
      } catch {
        /* alcune distribuzioni gestiscono i protocolli solo via .desktop */
      }
    }

    const ses = session.defaultSession;
    ses.setUserAgent(USER_AGENT);

    watchIntegratedAuthChallenges(ses);

    // Sfide HTTP (NTLM/Negotiate/Basic) di ADFS e proxy aziendali.
    app.on('login', (event, _webContents, _request, authInfo, callback) => {
      event.preventDefault();
      const host = authInfo.host;
      console.log(`[outlinux] autenticazione richiesta da ${host} (${authInfo.scheme})`);

      // Le credenziali salvate si usano una volta per sessione e per host: se il
      // server le rifiuta l'evento si ripete, e a quel punto vanno dimenticate.
      const saved = triedSavedCredentials.has(host) ? null : credentialsStore.get(host);
      if (saved) {
        triedSavedCredentials.add(host);
        console.log(`[outlinux] uso le credenziali salvate per ${host}`);
        callback(saved.username, saved.password);
        return;
      }
      if (triedSavedCredentials.has(host) && credentialsStore.get(host)) {
        console.warn(`[outlinux] credenziali salvate per ${host} rifiutate: le dimentico`);
        credentialsStore.forget(host);
      }

      askCredentials(authInfo).then((credentials) => {
        if (!credentials || !credentials.username) {
          callback();
          return;
        }
        if (credentials.remember) {
          const stored = credentialsStore.save(host, credentials);
          console.log(`[outlinux] credenziali per ${host} ${stored ? 'salvate' : 'non salvate'}`);
        }
        // Quelle appena inserite valgono come tentativo: se il server le rifiuta
        // si torna subito alla finestra, senza riprovare le stesse dal portachiavi.
        triedSavedCredentials.add(host);
        callback(credentials.username, credentials.password);
      });
    });

    ses.setPermissionRequestHandler((_wc, permission, callback) => {
      const allowed = ['notifications', 'clipboard-read', 'clipboard-sanitized-write', 'media', 'fullscreen', 'idle-detection'];
      callback(allowed.includes(permission));
    });
    ses.setPermissionCheckHandler((_wc, permission) =>
      ['notifications', 'clipboard-read', 'clipboard-sanitized-write', 'media', 'fullscreen', 'idle-detection'].includes(permission)
    );

    // Alcune risorse Microsoft controllano l'header User-Agent lato server.
    ses.webRequest.onBeforeSendHeaders((details, callback) => {
      details.requestHeaders['User-Agent'] = USER_AGENT;
      callback({ requestHeaders: details.requestHeaders });
    });

    app.on('web-contents-created', (_event, contents) => {
      attachContextMenu(contents);
      attachNavigationPolicy(contents);
      contents.setUserAgent(USER_AGENT);
    });

    if (process.env.OUTLINUX_DEBUG) {
      const display = screen.getPrimaryDisplay();
      console.log(
        `[outlinux] avvio completato — argv: ${process.argv.slice(1).join(' ')} | ` +
          `scaleFactor: ${display.scaleFactor} | display: ${display.size.width}x${display.size.height}`
      );
    }

    createWindow();
    createTray();
    Menu.setApplicationMenu(buildMenu({ getWindow: () => mainWindow, navigateTo, settings, onQuit: () => { isQuitting = true; app.quit(); }, onTrayToggle: (enabled) => (enabled ? createTray() : destroyTray()), userAgent: USER_AGENT }));

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
      else showWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (!settings.get('showTrayIcon') || isQuitting) app.quit();
  });

  app.on('before-quit', () => {
    isQuitting = true;
    persistWindowState();
  });
}

/* -------------------------------------------------------------------- IPC */

// Il preload gira anche nelle finestre figlie (una risposta aperta a parte):
// il loro titolo non contiene il conteggio, e senza questo filtro azzererebbero
// il badge della posta in arrivo.
ipcMain.on('outlinux:unread', (event, count) => {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) return;
  setUnread(count);
});

// Click su una notifica desktop: riporta in primo piano la finestra.
ipcMain.on('outlinux:notification-click', () => showWindow());
