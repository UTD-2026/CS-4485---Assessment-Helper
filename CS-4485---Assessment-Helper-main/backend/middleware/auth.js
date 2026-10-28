// JWT login.   POST /api/auth/login -> token;  send it as   Authorization: Bearer <token>
// Passwords are stored by the seed script as  scrypt$<salt>$<hex>  (salt used as the UTF-8 string, 32-byte key).
const { randomBytes, scryptSync, timingSafeEqual } = require('node:crypto');
const { env } = require('../config/env');
const { Professor } = require('../models');
const jwt = require('../services/jwt');
const { forbidden, unauthorized } = require('./errors');

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return `scrypt$${salt}$${scryptSync(password, salt, 32).toString('hex')}`;
}

// A fixed, valid-looking hash so unknown emails cost the same time as wrong passwords.
const DUMMY_HASH = hashPassword('not-a-real-password');

function verifyPassword(password, stored) {
  const parts = typeof stored === 'string' ? stored.split('$') : [];
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, hex] = parts;
  const expected = Buffer.from(hex, 'hex');
  if (expected.length !== 32) return false;
  const actual = scryptSync(String(password), salt, 32);
  return timingSafeEqual(actual, expected);
}

function verifyLogin(password, professor) {
  const ok = verifyPassword(password, professor ? professor.password_hash : DUMMY_HASH);
  return Boolean(professor) && ok;
}

const signToken = (professor) =>
  jwt.sign({ ac: Boolean(professor.is_ac_member) }, env.jwtSecret, {
    subject: professor.email,
    expiresIn: env.jwtExpiresIn,
  });

const HIRE_LEVEL_LABELS = { assistant: 'Assistant', associate: 'Associate', full: 'Full' };

/** The fields the API ever reveals about a professor. Never includes password_hash. */
const publicProfessor = (p) => ({
  email: p.email,
  netId: String(p.email).split('@')[0], // the part before the @ (the seed uses NetID@domain), for "log in as ..." displays
  name: p.name,
  department: p.department,
  hireLevel: p.hire_level,
  hireLevelLabel: HIRE_LEVEL_LABELS[p.hire_level] || p.hire_level, // 'Assistant' - the capitalisation the frontend shows
  isAcMember: Boolean(p.is_ac_member),
  lastObserved: p.last_observed || null,
});

/** Requires a valid Bearer token. Loads the professor fresh, so removing someone's AC status takes effect immediately. */
async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization || req.headers.Authorization || '';
    const [scheme, token] = String(header).split(' ');
    if (scheme !== 'Bearer' || !token) throw unauthorized('Send an "Authorization: Bearer <token>" header (get a token from POST /api/auth/login).');
    let payload;
    try {
      payload = jwt.verify(token, env.jwtSecret);
    } catch (err) {
      throw unauthorized(err && err.name === 'TokenExpiredError' ? 'Your session expired. Please log in again.' : 'Invalid token.');
    }
    if (typeof payload.sub !== 'string' || !payload.sub) throw unauthorized('Invalid token.');
    const professor = await Professor.findOne({ email: payload.sub }).lean();
    if (!professor) throw unauthorized('This account no longer exists.');
    req.user = professor;
    next();
  } catch (err) {
    next(err);
  }
}

function requireAc(req, res, next) {
  if (!req.user || !req.user.is_ac_member) return next(forbidden('Only Assessment Committee members may do that.'));
  return next();
}

module.exports = {
  hashPassword, verifyPassword, verifyLogin, signToken, publicProfessor, authenticate, requireAc,
};
