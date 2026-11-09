'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const DEFAULTS = {
  // Regione / tipo di account: "office" (lavoro o scuola) oppure "live" (personale)
  service: 'office',
  // URL personalizzato: se valorizzato ha la precedenza su `service`
  customUrl: '',
  // Sezione iniziale: mail | calendar | people
  startPage: 'mail',
  minimizeToTray: true,
  closeToTray: true,
  startMinimized: false,
  showTrayIcon: true,
  notifications: true,
  spellCheck: true,
  spellCheckLanguages: ['it', 'en-US'],
  hardwareAcceleration: true,
  // Compositing GPU. Su alcune combinazioni driver/compositor (es. portatili
  // ibridi AMD+NVIDIA sotto Wayland) il processo GPU crasha di continuo:
  // in quel caso Outlinux lo disattiva da solo dopo alcuni crash.
  gpuCompositing: true,
  // Backend grafico: 'auto' usa Wayland nativo quando disponibile (necessario per
  // rispettare lo scaling frazionario HiDPI), 'x11' forza XWayland.
  displayBackend: 'auto',
  // Scala forzata dell'interfaccia (0 = automatica). Utile solo sotto X11/XWayland,
  // dove Chromium non conosce il fattore di scala del compositor.
  forceScaleFactor: 0,
  // Domini per l'autenticazione integrata Kerberos/NTLM (ADFS on-premise,
  // proxy aziendali). Esempio: "*.azienda.it,*.intra.azienda.it".
  authServerAllowlist: '',
  zoomFactor: 1,
  autoHideMenuBar: true,
  window: { width: 1280, height: 860, x: null, y: null, maximized: false }
};

let cachedPath = null;
let data = null;

function file() {
  if (!cachedPath) cachedPath = path.join(app.getPath('userData'), 'settings.json');
  return cachedPath;
}

function merge(base, override) {
  const out = { ...base };
  for (const [key, value] of Object.entries(override || {})) {
    if (value && typeof value === 'object' && !Array.isArray(value) && base[key] && typeof base[key] === 'object' && !Array.isArray(base[key])) {
      out[key] = merge(base[key], value);
    } else if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

function load() {
  if (data) return data;
  try {
    data = merge(DEFAULTS, JSON.parse(fs.readFileSync(file(), 'utf8')));
  } catch {
    data = { ...DEFAULTS };
  }
  return data;
}

/**
 * Scrive le impostazioni rileggendo prima il file su disco: senza questa
 * rilettura una modifica fatta a mano (o da un'altra istanza) mentre l'app è
 * aperta verrebbe cancellata al primo salvataggio, perché in memoria abbiamo
 * la copia caricata all'avvio.
 */
function save(changed = null) {
  try {
    let onDisk = {};
    try {
      onDisk = JSON.parse(fs.readFileSync(file(), 'utf8'));
    } catch {
      onDisk = {};
    }

    // Del file su disco teniamo tutto, tranne le chiavi cambiate ora.
    const merged = changed
      ? { ...load(), ...onDisk, ...changed }
      : { ...load(), ...onDisk };

    data = merge(DEFAULTS, merged);
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(file(), JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('[outlinux] impossibile salvare le impostazioni:', err.message);
  }
}

function get(key) {
  return key === undefined ? load() : load()[key];
}

function set(key, value) {
  load()[key] = value;
  save({ [key]: value });
}

const BASE_URLS = {
  office: 'https://outlook.office.com',
  live: 'https://outlook.live.com'
};

const PATHS = {
  mail: '/mail/',
  calendar: '/calendar/',
  people: '/people/'
};

function baseUrl() {
  const conf = load();
  if (conf.customUrl) return conf.customUrl.replace(/\/+$/, '');
  return BASE_URLS[conf.service] || BASE_URLS.office;
}

function startUrl() {
  const conf = load();
  if (conf.customUrl) return conf.customUrl;
  return baseUrl() + (PATHS[conf.startPage] || PATHS.mail);
}

module.exports = { DEFAULTS, BASE_URLS, PATHS, get, set, save, baseUrl, startUrl, settingsFile: file };
