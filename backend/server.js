require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const professorRoutes = require("./routes/professors").router;
const courseSectionRoutes = require("./routes/courseSections");
const evaluationCycleRoutes = require("./routes/evaluationCycles");
const observationRoutes = require("./routes/observations");
const { errorHandler } = require("./routes/apiHelpers");

const app = express();
const port = Number(process.env.PORT) || 5000;

app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (request, response) => {
  const databaseConnected = mongoose.connection.readyState === 1;

  response.status(databaseConnected ? 200 : 503).json({
    status: databaseConnected ? "ok" : "unavailable",
    database: databaseConnected ? "connected" : "disconnected",
  });
});

app.use("/api/professors", professorRoutes);
app.use("/api/course-sections", courseSectionRoutes);
app.use("/api/evaluation-cycles", evaluationCycleRoutes);
app.use("/api/observations", observationRoutes);

app.use("/api", (request, response) => {
  response.status(404).json({ error: "API endpoint not found." });
});

app.use(errorHandler);

let server;

async function startServer() {
  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI is missing. Check backend/.env.");
  }

  await mongoose.connect(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 10000,
  });

  server = app.listen(port, "127.0.0.1", () => {
    console.log(`Assessment Helper API listening on http://127.0.0.1:${port}.`);
  });
}

async function stopServer(signal) {
  console.log(`${signal} received. Shutting down API server.`);

  if (server) {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  await mongoose.disconnect();
  process.exit(0);
}

process.once("SIGINT", () => stopServer("SIGINT"));
process.once("SIGTERM", () => stopServer("SIGTERM"));

startServer().catch(async (error) => {
  console.error("API server failed to start:", error.message);
  await mongoose.disconnect();
  process.exitCode = 1;
});
