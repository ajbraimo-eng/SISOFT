#!/usr/bin/env node
/**
 * Arranque do Sisoft com abertura automática do browser.
 */
const { startServer } = require('./server');

startServer({ openBrowser: true }).catch((error) => {
  console.error('Falha ao iniciar o Sisoft:', error.message || error);
  process.exit(1);
});
