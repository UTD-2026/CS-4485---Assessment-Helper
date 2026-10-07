// Applies schema.sql to the configured PostgreSQL database.
// Usage: npm run db:migrate

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

async function main() {
    const pool = new Pool({
        host: process.env.PGHOST || 'localhost',
        port: Number(process.env.PGPORT || 5432),
        database: process.env.PGDATABASE || 'assessment_helper',
        user: process.env.PGUSER || 'assessment_helper_app',
        password: process.env.PGPASSWORD || '',
    });

    const sqlPath = path.join(__dirname, 'schema.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    console.log(`[migrate] applying ${sqlPath} to ${process.env.PGDATABASE}...`);
    try {
        await pool.query(sql);
        console.log('[migrate] schema applied successfully.');
    } catch (err) {
        console.error('[migrate] failed to apply schema:', err.message);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
}

main();
