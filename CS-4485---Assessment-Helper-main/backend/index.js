// Entry point:  npm start  (or  npm run dev  for auto-restart)
const { connectDb } = require('./config/db');
const { assertProductionSafe, env } = require('./config/env');
const { createApp } = require('./app');
const { startSweepTimer } = require('./jobs/sweeps');

async function main() {
  assertProductionSafe();
  await connectDb();
  console.log('[db] connected to MongoDB');

  const app = createApp();
  const server = app.listen(env.port, () => {
    console.log(`[server] Assessment Helper API listening on http://localhost:${env.port}  (try /health)`);
  });
  const stopSweeps = startSweepTimer();
  if (env.jobsIntervalMinutes) console.log(`[jobs] sweeping stale requests / missed observations every ${env.jobsIntervalMinutes} min`);

  const shutdown = () => {
    stopSweeps();
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[server] failed to start:', err.message);
  process.exit(1);
});
