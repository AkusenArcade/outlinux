'use strict';

const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');

/**
 * Credenziali HTTP (NTLM/Negotiate/Basic) ricordate per host.
 *
 * La password viene cifrata con `safeStorage`, che su Linux usa il portachiavi
 * di sistema tramite libsecret. Se il portachiavi non è disponibile Electron
 * ripiegherebbe su una cifratura fittizia (`basic_text`): in quel caso non
 * salviamo nulla e l'app continua a chiedere le credenziali.
 */

const FILE_NAME = 'credentials.enc';

let cache = null;

function file() {
  return path.join(app.getPath('userData'), FILE_NAME);
}

function available() {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

function load() {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(file(), 'utf8'));
  } catch {
    cache = {};
  }
  return cache;
}

function persist() {
  try {
    fs.writeFileSync(file(), JSON.stringify(load(), null, 2), { encoding: 'utf8', mode: 0o600 });
  } catch (err) {
    console.error('[outlinux] impossibile salvare le credenziali:', err.message);
  }
}

function get(host) {
  if (!available()) return null;
  const entry = load()[host];
  if (!entry) return null;
  try {
    return {
      username: entry.username,
      password: safeStorage.decryptString(Buffer.from(entry.password, 'base64'))
    };
  } catch (err) {
    console.warn(`[outlinux] credenziali per ${host} non decifrabili: ${err.message}`);
    forget(host);
    return null;
  }
}

function save(host, { username, password }) {
  if (!available()) return false;
  try {
    load()[host] = {
      username,
      password: safeStorage.encryptString(password).toString('base64')
    };
    persist();
    return true;
  } catch (err) {
    console.error('[outlinux] impossibile cifrare le credenziali:', err.message);
    return false;
  }
}

function forget(host) {
  const store = load();
  if (host) delete store[host];
  else cache = {};
  persist();
}

function hosts() {
  return Object.keys(load());
}

module.exports = { available, get, save, forget, hosts };
