#!/usr/bin/env node
/**
 * Arranque do Sisoft (site + painel próprios — sem Isoft).
 */
const { start } = require('./sisoft/server');

start().catch((error) => {
  console.error('Falha ao iniciar o Sisoft:', error.message || error);
  process.exit(1);
});
