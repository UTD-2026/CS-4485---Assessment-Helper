#!/usr/bin/env node
// Writes docs/openapi.json from docs/openapi.js (the single source of truth). Import it into Swagger UI or Postman.
//   npm run docs          write the file
//   npm run docs -- --check   exit 1 if the committed file is stale (used by CI and by test/contract.test.mjs)
const { readFileSync, writeFileSync, existsSync } = require('node:fs');
const path = require('node:path');
const { openApiDocument } = require('./openapi');

const file = path.join(__dirname, 'openapi.json');
const fresh = `${JSON.stringify(openApiDocument(), null, 2)}\n`;

if (process.argv.includes('--check')) {
  const same = existsSync(file) && readFileSync(file, 'utf8') === fresh;
  console.log(same ? 'docs/openapi.json is up to date.' : 'docs/openapi.json is STALE: run `npm run docs`.');
  process.exit(same ? 0 : 1);
}
writeFileSync(file, fresh);
console.log(`Wrote ${path.relative(process.cwd(), file) || file}`);
