// Sign-in. Not in the endpoint doc's tables, but the doc's 401 status ("A user has not yet been
// authenticated") needs it. Accepts a NetID (part of the email before @), the full email, or main's
// name-based username (first initial + last name, e.g. "jsmith"; see services/usernames.js).
const express = require("express");
const { env } = require("../config/env");
const { Professor } = require("../models");
const { sign } = require("../services/jwt");
const { verifyPassword } = require("../services/password");
const { presentProfessor } = require("../services/context");
const { makeUsernameMap } = require("../services/usernames");
const { authenticate } = require("../middleware/auth");
const { badRequest, unauthorized, notFound } = require("../middleware/errors");

const router = express.Router();

router.post("/login", async (req, res) => {
  const login = String(req.body?.username || req.body?.netid || req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  if (!login || !password) throw badRequest("Username and password are required.");

  const email = login.includes("@") ? login : null;
  let professor = email
    ? await Professor.findOne({ email }).lean()
    : await Professor.findOne({ email: { $regex: `^${login.replace(/[^a-z0-9._-]/g, "")}@` } }).lean();
  if (!professor && !email) {
    // Not a NetID: try the name-based username from main (e.g. "jsmith")
    professor = makeUsernameMap(await Professor.find({}).lean()).get(login) || null;
  }
  if (!professor) throw unauthorized("Professor not found.");
  if (!verifyPassword(password, professor.password_hash)) throw unauthorized("Incorrect password.");

  const token = sign({ ac: professor.is_ac_member }, env.jwtSecret, { subject: professor.email, expiresIn: env.tokenLifetime });
  res.json({ data: { token, professor: presentProfessor(professor) } });
});

// GET /api/auth/test-accounts  (public, development/demo only)
// Backs the login page's "Need more test accounts?" list: every professor's NetID, name and role.
// Disabled when NODE_ENV=production so a real deployment never publishes the faculty list.
// NOW a real deployment can enable it with ENABLE_TEST_ACCOUNTS=true, e.g. for a demo or testing.
router.get("/test-accounts", async (req, res) => {
  const enabled =
    process.env.NODE_ENV !== "production" || process.env.ENABLE_TEST_ACCOUNTS === "true";
  if (!enabled) throw notFound();
  const rows = await Professor.find({}).select("email name department is_ac_member").lean();
  const data = rows
    .map((p) => ({
      netid: p.email.split("@")[0],
      name: p.name,
      department: p.department,
      role: p.is_ac_member ? "Committee" : "Professor",
    }))
    .sort((a, b) => (a.role === b.role ? a.name.localeCompare(b.name) : a.role === "Committee" ? -1 : 1));
  res.json({ data });
});

router.get("/me", authenticate, (req, res) => {
  res.json({ data: presentProfessor(req.user) });
});

module.exports = router;
