// PostgreSQL connection pool (Step 1)
// Every query in the app goes through this single pool so connections are
// reused and we get one place to add query logging / metrics later.

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    host: process.env.PGHOST || 'localhost',
    port: Number(process.env.PGPORT || 5432),
    database: process.env.PGDATABASE || 'assessment_helper',
    user: process.env.PGUSER || 'assessment_helper_app',
    password: process.env.PGPASSWORD || '',
    max: 10,
    idleTimeoutMillis: 30000,
});

pool.on('error', (err) => {
    // Idle client errors should never crash the whole process.
    console.error('[postgres] Unexpected error on idle client', err);
});

/**
 * Run a query against the pool.
 * @param {string} text - SQL text with $1, $2... placeholders
 * @param {Array} params
 */
async function query(text, params) {
    const start = Date.now();
    const res = await pool.query(text, params);
    if (process.env.NODE_ENV !== 'production') {
        console.debug('[postgres] query', { text, ms: Date.now() - start, rows: res.rowCount });
    }
    return res;
}

/**
 * Acquire a dedicated client for multi-statement transactions.
 * Caller is responsible for calling client.release().
 */
async function getClient() {
    return pool.connect();
}

module.exports = { pool, query, getClient };
