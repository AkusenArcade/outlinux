#!/usr/bin/env node
'use strict';

/** Avvio in sviluppo con i flag di piattaforma già sulla riga di comando. */

const { spawn } = require('child_process');
const path = require('path');

const electron = require('electron');
const { platformFlags } = require('./flags');

const args = [path.join(__dirname, '..'), ...platformFlags(), ...process.argv.slice(2)];
const child = spawn(electron, args, { stdio: 'inherit' });
child.on('close', (code, signal) => process.exit(signal ? 1 : code ?? 0));
