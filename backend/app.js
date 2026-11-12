// Express app (no network port, no database connection) so tests can import it.
// Built on the server.js from the mikael_backend_db branch: same /api/health check, JSON error
// shape and { data: ... } response envelope; the endpoints follow the team's "API Endpoints" doc.
const express = require("express");
const mongoose = require("mongoose");
const { authenticate, requireAc } = require("./middleware/auth");
const { errorHandler, notFoundHandler } = require("./middleware/errors");

function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/health", (request, response) => {
    const databaseConnected = mongoose.connection.readyState === 1;
    response.status(databaseConnected ? 200 : 503).json({
      status: databaseConnected ? "ok" : "unavailable",
      database: databaseConnected ? "connected" : "disconnected",
    });
  });

  // Public
  app.use("/api/auth", require("./routes/auth"));

  // Everything below needs "Authorization: Bearer <token>"
  app.use("/api/professors", authenticate, require("./routes/professors"));
  app.use("/api/course-sections", authenticate, require("./routes/courseSections"));
  app.use("/api/evaluation-cycles", authenticate, require("./routes/evaluationCycles"));
  app.use("/api/observations", authenticate, require("./routes/observations"));
  app.use("/api/observer-matches", authenticate, require("./routes/observerMatches"));
  app.use("/api/surveys", authenticate, require("./routes/surveys"));
  app.use("/api/reports", authenticate, requireAc, require("./routes/reports"));
  app.use("/api/notifications", authenticate, require("./routes/notifications"));

  app.use("/api", notFoundHandler);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
