// HS256 JSON Web Tokens with nothing but node:crypto, so the API needs no extra npm package.
//
//   const token = sign({ ac: true }, secret, { subject: 'abc123456@utdallas.edu', expiresIn: '8h' });
//   const payload = verify(token, secret);     // throws JsonWebTokenError / TokenExpiredError
//
// verify() is strict: exactly three parts, the header must say HS256 (so an "alg":"none" token is refused), the signature
// must be the canonical encoding and match (compared in constant time), and "exp" / "nbf" are honoured.
const { createHmac, timingSafeEqual } = require('node:crypto');

const MAX_TOKEN_LENGTH = 4096;
const b64 = (value) => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');

function jwtError(name, message) {
  const err = new Error(message);
  err.name = name;
  return err;
}

/** 3600 | '3600' | '30s' | '15m' | '8h' | '7d'  ->  seconds. */
function parseDuration(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.floor(value);
  const m = /^(\d+)\s*(s|m|h|d)?$/.exec(String(value).trim());
  if (!m || Number(m[1]) <= 0) throw new Error(`Unsupported token lifetime "${value}" (use e.g. 30m, 8h, 7d).`);
  return Number(m[1]) * ({ s: 1, m: 60, h: 3600, d: 86400 }[m[2] || 's']);
}

const signature = (data, secret) => createHmac('sha256', secret).update(data).digest('base64url');

function sign(payload, secret, { subject, expiresIn } = {}) {
  if (typeof secret !== 'string' || !secret) throw new Error('A JWT secret is required.');
  const iat = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat };
  if (subject) body.sub = subject;
  if (expiresIn !== undefined) body.exp = iat + parseDuration(expiresIn);
  const data = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(body)}`;
  return `${data}.${signature(data, secret)}`;
}

function verify(token, secret) {
  if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LENGTH) throw jwtError('JsonWebTokenError', 'jwt malformed');
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some((p) => p === '' || !/^[A-Za-z0-9_-]+$/.test(p))) throw jwtError('JsonWebTokenError', 'jwt malformed');

  let header;
  let payload;
  try {
    header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    throw jwtError('JsonWebTokenError', 'invalid token');
  }
  if (!header || typeof header !== 'object' || header.alg !== 'HS256') throw jwtError('JsonWebTokenError', 'invalid algorithm');
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw jwtError('JsonWebTokenError', 'invalid token');

  const expected = Buffer.from(signature(`${parts[0]}.${parts[1]}`, secret), 'base64url');
  const actual = Buffer.from(parts[2], 'base64url');
  // Only the one canonical encoding of a signature is accepted (base64url has spare bits that decode to the same bytes).
  if (actual.toString('base64url') !== parts[2] || expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw jwtError('JsonWebTokenError', 'invalid signature');
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (payload.exp !== undefined) {
    if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) throw jwtError('JsonWebTokenError', 'invalid exp');
    if (nowSeconds >= payload.exp) throw jwtError('TokenExpiredError', 'jwt expired');
  }
  if (payload.nbf !== undefined) {
    if (typeof payload.nbf !== 'number' || !Number.isFinite(payload.nbf)) throw jwtError('JsonWebTokenError', 'invalid nbf');
    if (nowSeconds < payload.nbf) throw jwtError('JsonWebTokenError', 'jwt not active');
  }
  return payload;
}

module.exports = { sign, verify, parseDuration };
