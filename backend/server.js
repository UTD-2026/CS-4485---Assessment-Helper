// Entry point: npm start (or npm run dev). From the mikael_backend_db branch; routes now live in app.js.
const mongoose = require("mongoose");
const { env } = require("./config/env");
const { createApp } = require("./app");

let server;

async function startServer() {
  if (!env.mongodbUri) {
    throw new Error("MONGODB_URI is missing. Check backend/.env.");
  }

  await mongoose.connect(env.mongodbUri, {
    serverSelectionTimeoutMS: 10000,
  });

  if (!process.env.JWT_SECRET) {
    console.warn("JWT_SECRET is not set in backend/.env; using a development-only secret.");
  }

  server = createApp().listen(env.port, env.host, () => {
    console.log(`Assessment Helper API listening on http://${env.host}:${env.port}.`);
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
