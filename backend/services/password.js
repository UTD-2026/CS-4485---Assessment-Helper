// Password hashes are stored as "scrypt$<salt>$<hex key>" (32-byte key).
// Two salt encodings exist in the shared database, and both are accepted:
//   - the seed data passes the salt string to scrypt as-is (ui-overhaul, seed-data.json);
//   - main's seed.mjs / setup-demo-logins.js hex-decoded the salt into bytes first.
const { randomBytes, scryptSync, timingSafeEqual } = require("node:crypto");

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  return `scrypt$${salt}$${scryptSync(String(password), salt, 32).toString("hex")}`;
}

function matches(password, salt, expected) {
  const actual = scryptSync(String(password), salt, expected.length);
  return actual.length === expected.length && timingSafeEqual(expected, actual);
}

function verifyPassword(password, stored) {
  const [scheme, salt, hash] = String(stored || "").split("$");
  if (scheme !== "scrypt" || !salt || !/^[a-f\d]+$/i.test(hash || "")) return false;
  const expected = Buffer.from(hash, "hex");
  if (matches(password, salt, expected)) return true;
  return /^[a-f\d]+$/i.test(salt) && salt.length % 2 === 0 && matches(password, Buffer.from(salt, "hex"), expected);
}

module.exports = { hashPassword, verifyPassword };
