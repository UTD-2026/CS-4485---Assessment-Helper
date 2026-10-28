// Test/demo world: loads the team's seed-data.json into the in-memory database EXACTLY the way seed/seed.mjs loads
// it into MongoDB (raw inserts into the six collections; the date strings become Dates), pins the clock to the seed's
// "today", and gives a tiny HTTP-style client with logins.
const { readFileSync } = require('node:fs');
const path = require('node:path');
const mongoose = require('./fakeMongoose');
const { request } = require('./fakeExpress');
const { resetClock, setClock } = require('../../services/clock');

const DEV_PASSWORD = 'Password123!';       // the seed script's dev password for every account
const SEED_TODAY = '2026-10-12T15:00:00Z'; // the seed script pins "today" to 2026-10-12

// seed key in seed-data.json -> collection name (copied from seed/seed.mjs)
const COLLECTIONS = {
  professors: 'professors',
  courseSections: 'coursesections',
  evaluationCycles: 'evaluationcycles',
  observations: 'observations',
  observerMatches: 'observermatches',
  surveys: 'surveys',
};
// copied from seed/seed.mjs
const DATE_FIELDS = new Set([
  'last_observed', 'signup_deadline', 'observation_deadline', 'feedback_deadline', 'signup_date', 'observation_date',
  'observer_signed_date', 'observee_signed_date', 'requested_date', 'submitted_date',
]);
const castDates = (doc) => {
  const out = { ...doc };
  for (const field of DATE_FIELDS) {
    if (typeof out[field] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(out[field])) out[field] = new Date(`${out[field]}T00:00:00.000Z`);
  }
  return out;
};

const readSeedFile = () => JSON.parse(readFileSync(path.join(__dirname, '..', '..', 'seed', 'seed-data.json'), 'utf8'));

/** Empty the database, load the seed data, pin the clock. Returns the raw (unconverted) seed data. */
async function loadSeedWorld({ clock = SEED_TODAY } = {}) {
  mongoose.__reset();
  const data = readSeedFile();
  for (const [key, name] of Object.entries(COLLECTIONS)) {
    const col = mongoose.connection.collection(name);
    await col.deleteMany({});
    await col.insertMany(data[key].map(castDates));
  }
  if (clock) setClock(clock); else resetClock();
  return data;
}

async function emptyWorld() {
  mongoose.__reset();
  resetClock();
}

/** An in-process HTTP client with per-user logins. */
function makeClient(app) {
  const tokens = new Map();
  async function login(email, password = DEV_PASSWORD) {
    const res = await request(app, 'POST', '/api/auth/login', { body: { email, password } });
    if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
    tokens.set(email, res.body.token);
    return res.body;
  }
  function as(email) {
    const call = async (method, url, body) => {
      if (!tokens.has(email)) await login(email);
      return request(app, method, url, { body, headers: { Authorization: `Bearer ${tokens.get(email)}` } });
    };
    return {
      email,
      get: (url) => call('GET', url),
      post: (url, body) => call('POST', url, body ?? {}),
      put: (url, body) => call('PUT', url, body ?? {}),
      patch: (url, body) => call('PATCH', url, body ?? {}),
      /** Any request with full control: send('PUT', url, { raw: <Buffer>, headers: { 'Content-Type': 'application/pdf' } }) */
      send: async (method, url, { body, raw, headers = {} } = {}) => {
        if (!tokens.has(email)) await login(email);
        return request(app, method, url, { body, raw, headers: { Authorization: `Bearer ${tokens.get(email)}`, ...headers } });
      },
    };
  }
  const anonymous = {
    get: (url) => request(app, 'GET', url),
    post: (url, body) => request(app, 'POST', url, { body: body ?? {} }),
    /** Any request with no login: send('OPTIONS', url, { headers: { Origin: ... } }) */
    send: (method, url, { body, raw, headers = {} } = {}) => request(app, method, url, { body, raw, headers }),
  };
  return { as, login, anonymous };
}

module.exports = {
  DEV_PASSWORD, SEED_TODAY, readSeedFile, loadSeedWorld, emptyWorld, makeClient, COLLECTIONS,
};
