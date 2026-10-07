require('dotenv').config();
const { createApp } = require('./app');
const { connectMongo, closeMongo } = require('./config/mongo');
const { pool } = require('./config/db');

const PORT = process.env.PORT || 4000;

async function main() {
    await connectMongo();

    const app = createApp();
    const server = app.listen(PORT, () => {
        console.log(`[server] Assessment Helper API listening on port ${PORT}`);
        console.log(`[server] Health check: http://localhost:${PORT}/health`);
    });

    async function shutdown(signal) {
        console.log(`\n[server] received ${signal}, shutting down gracefully...`);
        server.close(async () => {
            await pool.end();
            await closeMongo();
            console.log('[server] shutdown complete.');
            process.exit(0);
        });
    }

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
    console.error('[server] fatal startup error:', err);
    process.exit(1);
});
