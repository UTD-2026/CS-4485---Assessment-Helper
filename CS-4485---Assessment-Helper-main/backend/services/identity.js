// Who is signing in.
//
// Two ways in, both ending in the same session token:
//   1. password   POST /api/auth/login        the team's accounts (seeded dev password) - works everywhere
//   2. NetID      POST /api/auth/netid/...    a stand-in for UTD's single sign-on
//
// UTD NetID (CAS / SAML) is not approved for this project yet, so there is NO real single sign-on here. The TA asked for
// "a mock identity provider for the proof of concept" and that is what NETID_MODE=mock gives: it plays the part of UTD's
// login page. It follows the same two-step shape as CAS, so only the two functions marked REAL SSO need to change later:
//
//     browser -> app: "log me in with NetID"
//     app -> IdP:     (mock) POST /api/auth/netid/mock/ticket { netId }    <- the mock IdP's "login page"; REAL SSO: redirect to UTD
//     IdP -> app:     a one-time ticket                                      <- REAL SSO: UTD redirects back with ?ticket=ST-...
//     app -> app:     POST /api/auth/netid/callback { ticket }               <- validates the ticket (REAL SSO: asks UTD's validate URL)
//     app -> browser: { token, professor }                                   same session token as the password login
//
// The mock does NOT check a password, so anyone who can reach it can sign in as anyone. It is therefore off by default in
// production (see assertProductionSafe in config/env.js) and every response from it says "mock": true.
const { randomUUID } = require('node:crypto');
const { env } = require('../config/env');
const { Professor } = require('../models');
const jwt = require('./jwt');
const { forbidden, notFound, unauthorized, badRequest } = require('../middleware/errors');
const { normalizeEmail } = require('./lookup');

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const NETID_PATTERN = /^[a-z0-9._-]{1,64}$/;

/**
 * Find the account for what was typed. A full email must match exactly. A bare NetID (no @) matches the one professor
 * whose email starts with "<netid>@" - if that is ambiguous or nobody matches, the answer is "no account".
 */
async function findProfessorByIdentifier(typed) {
  const id = normalizeEmail(typed);
  if (id.includes('@')) return Professor.findOne({ email: id }).lean();
  if (!NETID_PATTERN.test(id)) return null;
  const matches = await Professor.find({ email: { $regex: `^${escapeRegex(id)}@` } }).limit(2).lean();
  return matches.length === 1 ? matches[0] : null;
}

const netidEnabled = () => env.netidMode === 'mock';
const ticketSecret = () => `${env.jwtSecret}|netid-ticket`; // a ticket can never be used as a session token, or the reverse
const usedTickets = new Map(); // jti -> exp (seconds). One server process; see docs/DEPLOYMENT.md for what changes with several.

function requireMockEnabled() {
  if (!netidEnabled()) throw notFound('NetID sign-in is not enabled on this server (NETID_MODE=off).', { code: 'NETID_DISABLED' });
}

/** What sign-in methods this server offers (public; the login screen uses it to decide which buttons to show). */
const providers = () => ({
  providers: [
    { id: 'password', label: 'Email or NetID and password', enabled: true, mock: false },
    {
      id: 'netid', label: 'UTD NetID', enabled: netidEnabled(), mock: true,
      note: 'Proof-of-concept stand-in for UTD single sign-on. Real CAS/SAML access has not been approved.',
    },
  ],
});

/** MOCK IdP "login page": hands out a short-lived one-time ticket for a NetID that belongs to a professor. */
async function issueMockTicket(netId) {
  requireMockEnabled();
  const id = normalizeEmail(netId);
  if (!NETID_PATTERN.test(id)) throw badRequest('netId must be letters and digits only, like "abc123456".');
  const professor = await findProfessorByIdentifier(id);
  if (!professor) throw unauthorized('That NetID has no account here.', { code: 'UNKNOWN_NETID' });
  const ticket = jwt.sign({ typ: 'netid-ticket', net: id, jti: randomUUID() }, ticketSecret(), { expiresIn: env.netidTicketSeconds });
  return { ticket, expiresInSeconds: env.netidTicketSeconds, mock: true };
}

/** Validates a ticket and returns the professor. REAL SSO: replace the body with a call to UTD's ticket-validation URL. */
async function redeemTicket(ticket) {
  requireMockEnabled();
  if (typeof ticket !== 'string' || !ticket) throw badRequest('ticket is required.');
  let payload;
  try {
    payload = jwt.verify(ticket, ticketSecret());
  } catch (err) {
    throw unauthorized(err && err.name === 'TokenExpiredError' ? 'That sign-in ticket expired. Start again.' : 'Invalid sign-in ticket.', { code: 'BAD_TICKET' });
  }
  if (payload.typ !== 'netid-ticket' || typeof payload.net !== 'string' || typeof payload.jti !== 'string') throw unauthorized('Invalid sign-in ticket.', { code: 'BAD_TICKET' });

  const nowSeconds = Math.floor(Date.now() / 1000);
  for (const [jti, exp] of usedTickets) if (exp <= nowSeconds) usedTickets.delete(jti);
  if (usedTickets.has(payload.jti)) throw unauthorized('That sign-in ticket was already used.', { code: 'TICKET_USED' });
  usedTickets.set(payload.jti, payload.exp);

  const professor = await findProfessorByIdentifier(payload.net);
  if (!professor) throw forbidden('That NetID is not a faculty account in this system.', { code: 'NOT_A_FACULTY_ACCOUNT' });
  return professor;
}

module.exports = {
  findProfessorByIdentifier, netidEnabled, providers, issueMockTicket, redeemTicket,
};
