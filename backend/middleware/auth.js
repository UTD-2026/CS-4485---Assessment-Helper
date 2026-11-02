// Bearer-token authentication. Tokens are issued by POST /api/auth/login (routes/auth.js).
const { env } = require("../config/env");
const { verify } = require("../services/jwt");
const { Professor } = require("../models");
const { unauthorized, forbidden } = require("./errors");

async function authenticate(req, res, next) {
  const header = req.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return next(unauthorized());
  let payload;
  try {
    payload = verify(token, env.jwtSecret);
  } catch (error) {
    return next(unauthorized(error.name === "TokenExpiredError" ? "Your session expired. Please sign in again." : "Invalid token."));
  }
  const user = await Professor.findOne({ email: payload.sub }).select("-password_hash").lean();
  if (!user) return next(unauthorized("Account no longer exists."));
  req.user = user;
  return next();
}

function requireAc(req, res, next) {
  if (!req.user?.is_ac_member) return next(forbidden("Only Assessment Committee members can do this."));
  return next();
}

const isAc = (req) => Boolean(req.user?.is_ac_member);

module.exports = { authenticate, requireAc, isAc };
