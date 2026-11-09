#!/usr/bin/env node
'use strict';

/**
 * Smoke test: avvia l'app, aspetta che la pagina sia caricata e resta in
 * ascolto ancora qualche secondo, perché alcune eccezioni del processo
 * principale (handler di eventi, watchdog GPU) arrivano dopo il caricamento.
 * Serve rete: senza connessione il caricamento non arriva e il test fallisce.
 */

const { spawn } = require('child_process');
const path = require('path');

const electron = require('electron');
const { platformFlags } = require('./flags');

const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT || 45000);
const GRACE_MS = Number(process.env.SMOKE_GRACE || 15000);

const ERROR_PATTERNS = [
  /Uncaught Exception/i,
  /ReferenceError/,
  /TypeError:/,
  /is not defined/,
  /Cannot find module/
];

const child = spawn(electron, [path.join(__dirname, '..'), ...platformFlags()], {
  env: { ...process.env, OUTLINUX_DEBUG: '1' },
  stdio: ['ignore', 'pipe', 'pipe']
});

let output = '';
let done = false;
const collect = (chunk) => {
  output += chunk;
  process.stdout.write(chunk);
};
child.stdout.on('data', collect);
child.stderr.on('data', collect);

function evaluate() {
  if (done) return;
  done = true;

  const failure = ERROR_PATTERNS.find((pattern) => pattern.test(output));
  const started = output.includes('[outlinux] avvio completato');
  const loaded = output.includes('[outlinux] caricato');

  let code = 0;
  if (failure) {
    console.log(`\n✖ smoke test: eccezione nel processo principale (${failure})`);
    code = 1;
  } else if (!started) {
    console.log('\n✖ smoke test: la finestra non è mai stata creata');
    code = 1;
  } else if (!loaded) {
    console.log('\n✖ smoke test: nessuna pagina caricata (rete assente?)');
    code = 1;
  } else {
    console.log('\n✔ smoke test superato: avvio, caricamento e nessuna eccezione');
  }

  child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 500);
}

const timeout = setTimeout(evaluate, TIMEOUT_MS);
let grace = null;

const poll = setInterval(() => {
  if (ERROR_PATTERNS.some((pattern) => pattern.test(output))) {
    clearInterval(poll);
    clearTimeout(timeout);
    if (grace) clearTimeout(grace);
    evaluate();
    return;
  }
  // Dopo il caricamento restiamo in ascolto ancora qualche secondo.
  if (!grace && output.includes('[outlinux] caricato')) {
    grace = setTimeout(() => {
      clearInterval(poll);
      clearTimeout(timeout);
      evaluate();
    }, GRACE_MS);
  }
}, 250);

// L'app può riavviarsi da sola (watchdog GPU): in quel caso il figlio esce.
child.on('close', () => {
  clearInterval(poll);
  clearTimeout(timeout);
  if (grace) clearTimeout(grace);
  evaluate();
});
