'use strict';

// Configurazione minima: serve soprattutto `no-undef`, che intercetta i
// riferimenti a costanti o funzioni inesistenti — errori che altrimenti
// emergono solo a runtime, in un flusso magari raro.

const nodeGlobals = {
  require: 'readonly',
  module: 'writable',
  exports: 'writable',
  process: 'readonly',
  console: 'readonly',
  __dirname: 'readonly',
  __filename: 'readonly',
  Buffer: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  Response: 'readonly'
};

const domGlobals = {
  window: 'readonly',
  document: 'readonly',
  MutationObserver: 'readonly'
};

module.exports = [
  {
    files: ['src/**/*.js', 'scripts/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: nodeGlobals
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-redeclare': 'error'
    }
  },
  {
    files: ['src/preload.js'],
    languageOptions: { globals: { ...nodeGlobals, ...domGlobals } }
  }
];
