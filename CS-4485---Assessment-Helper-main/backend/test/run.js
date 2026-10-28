// `npm test`: runs every test/*.test.mjs with the in-memory stand-ins for mongoose / express / dotenv loaded
// (see test/support/register.js), so no database and no npm install are needed.
const { spawnSync } = require('node:child_process');
const { readdirSync } = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const files = readdirSync(__dirname).filter((f) => f.endsWith('.test.mjs')).sort().map((f) => path.join('test', f));
const r = spawnSync(process.execPath, ['--require', './test/support/register.js', '--test', ...process.argv.slice(2), ...files], { cwd: root, stdio: 'inherit' });
process.exit(r.status === null ? 1 : r.status);
