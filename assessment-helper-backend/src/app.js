// Express app wiring: JSON body parsing, CORS, route mounting,
// centralized error handling. Kept separate from server.js so it can be
// imported directly in tests without opening a real network port.

const express = require('express');
const cors = require('cors');

const matchmakingRoutes = require('./routes/matchmaking');
const observationRoutes = require('./routes/observations');
const dashboardRoutes = require('./routes/dashboard');
const assessmentCycleRoutes = require('./routes/assessmentCycles');
const teacherRoutes = require('./routes/teachers');
const signupRoutes = require('./routes/signups');
const observationRequestRoutes = require('./routes/observationRequests');
const evaluationFormRoutes = require('./routes/evaluationForms');

function createApp() {
    const app = express();

    // CORS: the frontend almost always runs on a different origin/port in
    // dev (e.g. http://localhost:3000 or 5173 talking to this server on
    // :4000), and browsers block that by default without this. Set
    // CORS_ORIGIN in .env to a comma-separated list of allowed origins in
    // production; unset/development defaults to allowing any origin so
    // the frontend team doesn't have to configure anything to get started.
    const allowedOrigins = process.env.CORS_ORIGIN
        ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim())
        : true; // true => reflect any request origin (dev-friendly default)
    app.use(cors({ origin: allowedOrigins }));

    app.use(express.json());

    app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

    app.use('/api/matchmaking', matchmakingRoutes);
    app.use('/api/observations', observationRoutes);
    app.use('/api/admin/dashboard-stats', dashboardRoutes);
    app.use('/api/assessment-cycles', assessmentCycleRoutes);
    app.use('/api/teachers', teacherRoutes);
    app.use('/api/signups', signupRoutes);
    app.use('/api/observation-requests', observationRequestRoutes);
    app.use('/api/admin/evaluation-forms', evaluationFormRoutes);

    app.use((req, res) => {
        res.status(404).json({ error: `No route for ${req.method} ${req.originalUrl}` });
    });

    // Centralized error handler — every route's `next(err)` lands here.
    // eslint-disable-next-line no-unused-vars
    app.use((err, req, res, next) => {
        console.error('[error]', err);
        const statusCode = err.statusCode || 500;
        res.status(statusCode).json({
            error: err.message || 'Internal server error',
        });
    });

    return app;
}

module.exports = { createApp };
