#!/usr/bin/env node
/**
 * Arranque do Isoft com abertura automática do browser.
 */
const { startServer } = require('./server');

startServer({ openBrowser: true }).catch((error) => {
  console.error('Falha ao iniciar o Isoft:', error.message || error);
  process.exit(1);
});
