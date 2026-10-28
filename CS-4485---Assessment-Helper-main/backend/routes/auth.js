const express = require('express');
const { authenticate, publicProfessor, signToken, verifyLogin } = require('../middleware/auth');
const { asyncHandler, badRequest, unauthorized } = require('../middleware/errors');
const { audit } = require('../services/audit');
const identity = require('../services/identity');

const router = express.Router();

/** The name the person typed: the frontend's sign-in screen has a "username" box; email / netId / identifier also work. */
const identifierOf = (body) =>
  [body.username, body.netId, body.netid, body.email, body.identifier].find((v) => typeof v === 'string' && v.trim() !== '');

/**
 * POST /api/auth/login   { "username": "abc123456", "password": "..." }      (or "email": "abc123456@utdallas.edu")
 * -> { token, professor }.  Send the token on every other request:  Authorization: Bearer <token>
 * "username" is a NetID or a full email; `email`, `netId` and `identifier` are accepted as the same thing.
 * (Seeded accounts all use the dev password printed by `npm run seed`. Replace with UTD NetID/SSO later.)
 */
router.post('/login', asyncHandler(async (req, res) => {
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  const typed = identifierOf(body);
  const { password } = body;
  if (!typed || typeof password !== 'string' || !password) {
    throw badRequest('A username (NetID or email) and a password are required.');
  }
  if (typed.length > 254) throw unauthorized('Invalid username or password.');
  const professor = await identity.findProfessorByIdentifier(typed);
  if (!verifyLogin(password, professor)) throw unauthorized('Invalid username or password.');
  await audit(professor, 'auth.login', { type: 'professor', id: professor.email, detail: { provider: 'password' } });
  res.json({ token: signToken(professor), professor: publicProfessor(professor) });
}));

/** GET /api/auth/providers -> which sign-in methods this server offers (public) */
router.get('/providers', (req, res) => {
  res.json(identity.providers());
});

/**
 * POST /api/auth/netid/mock/ticket   { "netId": "ejg104485" }      (only when NETID_MODE=mock)
 * The MOCK identity provider's login page: returns a one-time ticket. Exchange it at /netid/callback. It does not ask for a
 * password - that is the point of a stand-in - so it is switched off in production unless explicitly allowed.
 */
router.post('/netid/mock/ticket', asyncHandler(async (req, res) => {
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  res.status(201).json(await identity.issueMockTicket(body.netId));
}));

/** POST /api/auth/netid/callback   { "ticket": "..." } -> { token, professor, provider } (the same token as the password login) */
router.post('/netid/callback', asyncHandler(async (req, res) => {
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  const professor = await identity.redeemTicket(body.ticket);
  await audit(professor, 'auth.login', { type: 'professor', id: professor.email, detail: { provider: 'netid-mock' } });
  res.json({ token: signToken(professor), professor: publicProfessor(professor), provider: 'netid-mock', mock: true });
}));

/** GET /api/auth/me -> the logged-in professor (a quick "who am I / am I AC?" for the frontend). */
router.get('/me', authenticate, (req, res) => {
  res.json({ professor: publicProfessor(req.user) });
});

module.exports = router;
