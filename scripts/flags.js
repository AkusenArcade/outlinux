'use strict';

/**
 * Flag di piattaforma da passare a Electron sulla riga di comando.
 * `--ozone-platform` viene letto da Chromium all'avvio, quindi non può essere
 * impostato dal processo principale: lo calcolano start.js e smoke.js.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

function readSettings() {
  const file = path.join(
    process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'),
    'Outlinux',
    'settings.json'
  );
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

function platformFlags(settings = readSettings()) {
  const flags = [];
  if (settings.displayBackend !== 'x11' && process.env.WAYLAND_DISPLAY) {
    flags.push('--ozone-platform=wayland');
  }
  if (Number(settings.forceScaleFactor) > 0) {
    flags.push(`--force-device-scale-factor=${settings.forceScaleFactor}`);
  }
  return flags;
}

module.exports = { readSettings, platformFlags };
