// Central place for environment settings (backend/.env).
require("dotenv").config();

const DEV_SECRET = "dev-only-change-me";

const env = {
  port: Number(process.env.PORT) || 5000,
  host: process.env.HOST || "127.0.0.1",
  mongodbUri: process.env.MONGODB_URI || "",
  jwtSecret: process.env.JWT_SECRET || DEV_SECRET,
  tokenLifetime: process.env.TOKEN_LIFETIME || "8h",
  // Force the "current" evaluation term (e.g. "Spring 2027"). Empty = derive from cycles.
  currentTerm: process.env.CURRENT_TERM || "",
  // Who can appear on an observer list:
  //   signed_up = only professors who signed up this cycle (the "observer pool", per the process doc)
  //   all       = any professor who teaches this term
  observerPool: process.env.OBSERVER_POOL || "signed_up",
  maxObserversPerList: Number(process.env.MAX_OBSERVERS_PER_LIST) || 5,
};

if (env.jwtSecret === DEV_SECRET && process.env.NODE_ENV === "production") {
  throw new Error("Set JWT_SECRET in backend/.env before running in production.");
}

module.exports = { env };
