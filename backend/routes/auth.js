const crypto = require("node:crypto");
const { promisify } = require("node:util");
const express = require("express");
const { Professor } = require("../models");
const { ApiError, asyncRoute, sendData, requireObject, rejectUnknownFields, requireString } = require("./apiHelpers");

const router = express.Router();
const scrypt = promisify(crypto.scrypt);

function nameWords(name) {
  return name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[-']/g, "").replace(/[^a-zA-Z\s]/g, " ").trim().split(/\s+/).filter(Boolean)
    .filter((word, index) => !(index === 0 && /^(dr|prof|professor)$/i.test(word)));
}

function baseUsername(name) {
  const words = nameWords(name);
  if (words.length < 2) throw new Error(`Cannot derive a login username for ${name}.`);
  return `${words[0][0]}${words.at(-1)}`.toLowerCase();
}

function makeUsernameMap(professors) {
  const grouped = new Map();
  for (const professor of professors) {
    const base = baseUsername(professor.name);
    grouped.set(base, [...(grouped.get(base) || []), professor]);
  }

  const result = new Map();
  for (const [base, members] of grouped) {
    if (members.length === 1) {
      result.set(base, members[0]);
      continue;
    }
    for (const professor of members) {
      const words = nameWords(professor.name);
      const middleInitial = words.length > 2 ? words[1][0].toLowerCase() : "";
      const username = `${words[0][0]}${middleInitial}${words.at(-1)}`.toLowerCase();
      result.set(username, professor);
    }
  }
  return result;
}

async function verifyPassword(password, encodedHash) {
  const [algorithm, saltHex, keyHex] = String(encodedHash || "").split("$");
  if (algorithm !== "scrypt" || !/^[a-f\d]+$/i.test(saltHex || "") || !/^[a-f\d]+$/i.test(keyHex || "")) {
    return false;
  }
  const expected = Buffer.from(keyHex, "hex");
  const actual = await scrypt(password, Buffer.from(saltHex, "hex"), expected.length);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

router.post("/login", asyncRoute(async (request, response) => {
  requireObject(request.body);
  rejectUnknownFields(request.body, ["username", "password"]);
  const username = requireString(request.body.username, "username").toLowerCase();
  const password = requireString(request.body.password, "password");
  const professors = await Professor.find({}).select("+password_hash").lean();
  const professor = makeUsernameMap(professors).get(username);
  if (!professor || !(await verifyPassword(password, professor.password_hash))) {
    throw new ApiError(401, "Invalid username or password.");
  }

  const loginName = baseUsername(professor.name);
  const hasCollision = professors.filter(item => baseUsername(item.name) === loginName).length > 1;
  const words = nameWords(professor.name);
  const resolvedUsername = hasCollision
    ? `${words[0][0]}${words.length > 2 ? words[1][0] : ""}${words.at(-1)}`.toLowerCase()
    : loginName;
  return sendData(response, {
    professor_id: professor.email,
    email: professor.email,
    name: professor.name,
    department: professor.department,
    hire_level: professor.hire_level,
    last_observed: professor.last_observed,
    is_ac_member: professor.is_ac_member,
    username: resolvedUsername,
    role: professor.is_ac_member ? "admin" : "professor",
  });
}));

module.exports = { router, baseUsername, makeUsernameMap, verifyPassword };
