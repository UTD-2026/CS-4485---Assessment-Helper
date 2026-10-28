// Central place for every environment variable the backend reads.
// Defaults are chosen so `npm run dev` works on a laptop with a local MongoDB.
require('dotenv').config();

const num = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
const list = (value, fallback) => {
  if (value === undefined || value === '') return fallback;
  const items = value.split(',').map((s) => s.trim()).filter(Boolean);
  return items.length ? items : fallback;
};

const DEFAULT_JWT_SECRET = 'change-me';
const oneOf = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);
const nonNegative = (value, fallback) => {
  const n = Number(value);
  return value !== undefined && value !== '' && Number.isFinite(n) && n >= 0 ? n : fallback;
};

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: num(process.env.PORT, 5000),

  // The same variable the team's setup-database.js / test-database.js / seed.mjs read.
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/assessment_helper',
  // Some networks cannot resolve mongodb+srv:// records with the default DNS; set DNS_SERVERS=8.8.8.8,1.1.1.1 for that.
  dnsServers: list(process.env.DNS_SERVERS, []),

  jwtSecret: process.env.JWT_SECRET || DEFAULT_JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',

  // Browser origins allowed to call the API (the frontend dev servers by default). "*" allows any origin.
  corsOrigins: list(process.env.CORS_ORIGINS, ['http://localhost:3000', 'http://localhost:5173']),

  // TA Q&A: "invitations should expire after 48 hours".
  requestExpiryHours: num(process.env.REQUEST_EXPIRY_HOURS, 48),

  // The team's seed data has two terms a year. Add Summer here if that ever changes:
  // ACADEMIC_TERMS=Spring,Summer,Fall
  academicTerms: list(process.env.ACADEMIC_TERMS, ['Spring', 'Fall']),

  // Which course levels may observe each other. The committee's rule is "a 1000-level prof can only observe another
  // 1000-level prof" = exact. LEVEL_MATCHING=band groups levels (1-2, 3-4, 5+) instead.
  levelMatching: process.env.LEVEL_MATCHING === 'band' ? 'band' : 'exact',

  // Set ENFORCE_SIGNUP_DEADLINE=false to let people sign up after the cycle's signup deadline (testing).
  enforceSignupDeadline: process.env.ENFORCE_SIGNUP_DEADLINE !== 'false',

  // Background sweeps (expire stale requests, mark missed observations) run inside the server
  // every N minutes. Set to 0 to turn off and run `npm run jobs` from cron instead.
  jobsIntervalMinutes: Number.isFinite(Number(process.env.JOBS_INTERVAL_MINUTES))
    && process.env.JOBS_INTERVAL_MINUTES !== undefined && process.env.JOBS_INTERVAL_MINUTES !== ''
    ? Math.max(0, Number(process.env.JOBS_INTERVAL_MINUTES))
    : 15,

  // Signed observation form uploads (PDF). The file is kept in MongoDB (base64 text), so the cap stays small:
  // a MongoDB document may not exceed 16 MB, and base64 adds a third. Clamped to 1-10 MB.
  uploadMaxMb: Math.min(10, Math.max(1, num(process.env.UPLOAD_MAX_MB, 5))),

  // Calendar (.ics) files use "floating" local times (10:00 stays 10:00 wherever the reader is); this names the
  // zone the university is in so calendar apps show the right wall-clock time.
  calendarTimezone: process.env.CALENDAR_TIMEZONE || 'America/Chicago',

  // How an observer's "yes" works.
  //   first_wins     (default) the first observer to CONFIRM is the observer; everyone else is told politely.
  //   observee_final the observer's yes is only "accepted"; the observee then picks one (POST .../finalize) and the
  //                  rest are stood down. This is the two-step flow the current frontend shows.
  confirmationMode: oneOf(process.env.CONFIRMATION_MODE, ['first_wins', 'observee_final'], 'first_wins'),

  // UTD NetID sign-in. Production access (CAS / SAML) is not approved yet, so the proof of concept uses a mock identity
  // provider (services/identity.js). NETID_MODE=mock turns the mock on (default outside production), off turns it off.
  netidMode: oneOf(process.env.NETID_MODE, ['mock', 'off'], (process.env.NODE_ENV === 'production') ? 'off' : 'mock'),
  netidTicketSeconds: num(process.env.NETID_TICKET_SECONDS, 120),
  // The mock IdP asks for no password. Production refuses to run with it on unless this is set on purpose (a public demo).
  allowMockNetidInProduction: process.env.ALLOW_MOCK_NETID_IN_PRODUCTION === 'true',

  // Course Book (UTD course data). Access is pending, so by default the adapter serves the local course_sections
  // collection. COURSEBOOK_MODE=remote calls COURSEBOOK_URL with a timeout and retries and falls back to local data.
  courseBookMode: oneOf(process.env.COURSEBOOK_MODE, ['local', 'remote'], 'local'),
  courseBookUrl: process.env.COURSEBOOK_URL || '',
  courseBookApiKey: process.env.COURSEBOOK_API_KEY || '',
  courseBookTimeoutMs: num(process.env.COURSEBOOK_TIMEOUT_MS, 3000),
  courseBookRetries: Math.min(5, nonNegative(process.env.COURSEBOOK_RETRIES, 2)),
  courseBookCacheSeconds: nonNegative(process.env.COURSEBOOK_CACHE_SECONDS, 600),
  courseBookBackoffMs: nonNegative(process.env.COURSEBOOK_BACKOFF_MS, 250),

  // Survey answers are anonymous. Below this many responses for a term the committee sees counts only, because one or
  // two answers can be traced to a person by elimination. Set to 1 to always show answers.
  surveyMinResponses: Math.max(1, Math.floor(num(process.env.SURVEY_MIN_RESPONSES, 3))),
};

// TA Q&A: fewer than 5 eligible observers -> show all; 5 or more -> random 5.
const CANDIDATE_LIST_SIZE = 5;

function assertProductionSafe() {
  if (env.nodeEnv === 'production' && env.jwtSecret === DEFAULT_JWT_SECRET) {
    throw new Error('Refusing to start: JWT_SECRET is still the default "change-me". Set a long random value.');
  }
  if (env.nodeEnv === 'production' && env.netidMode === 'mock' && !env.allowMockNetidInProduction) {
    throw new Error('Refusing to start: NETID_MODE=mock lets anyone sign in as anyone. Use NETID_MODE=off, or set ALLOW_MOCK_NETID_IN_PRODUCTION=true for a throwaway demo.');
  }
}

module.exports = { DEFAULT_JWT_SECRET, env, CANDIDATE_LIST_SIZE, assertProductionSafe };
