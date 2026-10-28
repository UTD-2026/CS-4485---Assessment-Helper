// CLI: `npm run jobs` - run the sweeps once against the configured MongoDB, then exit. Handy for cron.
const { connectDb, disconnectDb } = require('../config/db');
const { runAllSweeps } = require('./sweeps');

(async () => {
  try {
    await connectDb();
    const summary = await runAllSweeps();
    console.log('[jobs] done:', { expiredRequests: summary.expiredRequests, missedObservations: summary.missedObservations });
    await disconnectDb();
    process.exit(0);
  } catch (err) {
    console.error('[jobs] failed:', err);
    process.exit(1);
  }
})();
