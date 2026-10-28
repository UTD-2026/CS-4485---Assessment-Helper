// The Express app, built without starting a server or connecting to a database
// (so tests and demos can import it). index.js is what actually runs it.
const express = require('express');
const mongoose = require('mongoose');
const { env } = require('./config/env');
const { authenticate, requireAc } = require('./middleware/auth');
const { corsMiddleware } = require('./middleware/cors');
const { errorHandler, notFoundHandler } = require('./middleware/errors');
const { presentResponses } = require('./middleware/present');
const { now } = require('./services/clock');
const { openApiDocument } = require('./docs/openapi');

const adminRouter = require('./routes/admin');
const analyticsRouter = require('./routes/analytics');
const authRouter = require('./routes/auth');
const cyclesRouter = require('./routes/cycles');
const dashboardRouter = require('./routes/dashboard');
const formsRouter = require('./routes/forms');
const matchingRouter = require('./routes/matching');
const meRouter = require('./routes/me');
const notificationsRouter = require('./routes/notifications');
const observationsRouter = require('./routes/observations');
const offeringsRouter = require('./routes/offerings');
const overviewRouter = require('./routes/overview');
const professorsRouter = require('./routes/professors');
const reportsRouter = require('./routes/reports');
const requestsRouter = require('./routes/requests');
const sectionsRouter = require('./routes/sections');
const signupsRouter = require('./routes/signups');
const surveysRouter = require('./routes/surveys');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  // Content-Disposition is exposed so the frontend can read the file name of a download (PDF, CSV, calendar).
  app.use(corsMiddleware({ origins: env.corsOrigins, exposedHeaders: ['Content-Disposition'] }));
  // The API contract (OpenAPI 3.0). Public on purpose: it describes the API and contains no data.
  app.get('/api/docs/openapi.json', (req, res) => {
    res.json(openApiDocument());
  });
  // Database documents are snake_case; every JSON response leaves as camelCase (see middleware/present.js).
  app.use(presentResponses);
  app.use(express.json({ limit: '1mb' }));

  // Public
  app.get('/health', (req, res) => {
    res.json({
      ok: true,
      database: mongoose.connection.readyState === 1 ? 'connected' : 'not connected',
      time: now().toISOString(),
      confirmationMode: env.confirmationMode,
      netid: env.netidMode,
      courseBook: env.courseBookMode,
    });
  });
  app.use('/api/auth', authRouter); // /login is public; /me authenticates itself

  // Everything below needs a logged-in professor (Authorization: Bearer <token>)
  app.use('/api/me', authenticate, meRouter);
  app.use('/api/professors', authenticate, professorsRouter);
  app.use('/api/course-offerings', authenticate, offeringsRouter);
  app.use('/api/sections', authenticate, sectionsRouter);
  app.use('/api/cycles', authenticate, cyclesRouter);
  app.use('/api/signups', authenticate, signupsRouter);
  app.use('/api/matching', authenticate, matchingRouter);
  app.use('/api/observation-requests', authenticate, requestsRouter);
  app.use('/api/observations', authenticate, observationsRouter);
  app.use('/api/forms', authenticate, formsRouter);
  app.use('/api/surveys', authenticate, surveysRouter);
  app.use('/api/notifications', authenticate, notificationsRouter);
  app.use('/api/overview', authenticate, overviewRouter);
  // Assessment Committee only
  app.use('/api/admin/dashboard-stats', authenticate, requireAc, dashboardRouter);
  app.use('/api/admin/analytics', authenticate, requireAc, analyticsRouter);
  app.use('/api/reports', authenticate, requireAc, reportsRouter);
  app.use('/api/admin', authenticate, requireAc, adminRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
