// Sign-in. Not in the endpoint doc's tables, but the doc's 401 status ("A user has not yet been
// authenticated") needs it. Accepts a NetID (part of the email before @) or the full email.
const express = require("express");
const { env } = require("../config/env");
const { Professor } = require("../models");
const { sign } = require("../services/jwt");
const { verifyPassword } = require("../services/password");
const { presentProfessor } = require("../services/context");
const { authenticate } = require("../middleware/auth");
const { badRequest, unauthorized } = require("../middleware/errors");

const router = express.Router();

router.post("/login", async (req, res) => {
  const login = String(req.body?.username || req.body?.netid || req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  if (!login || !password) throw badRequest("Username and password are required.");

  const email = login.includes("@") ? login : null;
  const professor = email
    ? await Professor.findOne({ email }).lean()
    : await Professor.findOne({ email: { $regex: `^${login.replace(/[^a-z0-9._-]/g, "")}@` } }).lean();
  if (!professor) throw unauthorized("Professor not found.");
  if (!verifyPassword(password, professor.password_hash)) throw unauthorized("Incorrect password.");

  const token = sign({ ac: professor.is_ac_member }, env.jwtSecret, { subject: professor.email, expiresIn: env.tokenLifetime });
  res.json({ data: { token, professor: presentProfessor(professor) } });
});

router.get("/me", authenticate, (req, res) => {
  res.json({ data: presentProfessor(req.user) });
});

module.exports = router;
