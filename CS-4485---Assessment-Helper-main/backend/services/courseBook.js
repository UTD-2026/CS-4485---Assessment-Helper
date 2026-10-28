// Course data. UTD's Course Book API key is still pending (TA feedback: "define a backend adapter, timeout/retry behavior,
// error handling, caching policy, and mock/local course data fallback"). This file is that adapter.
//
//   COURSEBOOK_MODE=local   (default) the answer is the local course_sections collection (the seed / what the committee loaded).
//   COURSEBOOK_MODE=remote  ask COURSEBOOK_URL, and fall back to the local data if that fails.
//
// Remote behaviour:
//   timeout   every attempt is cut off after COURSEBOOK_TIMEOUT_MS (3 s)
//   retries   network errors, timeouts, HTTP 429 and 5xx are retried COURSEBOOK_RETRIES times (2) with doubling back-off
//             (250 ms, 500 ms ...); other 4xx answers (wrong key, bad request) are NOT retried
//   caching   a good answer is kept COURSEBOOK_CACHE_SECONDS (600) per term; if a later call fails, the last good answer is
//             served as `stale` rather than failing; with nothing cached the local data is served, marked `local-fallback`
//   errors    never reach the caller as a 5xx: the response says where the data came from (`source`) and why (`warning`)
//
// ASSUMPTION: the real Course Book response format is not known. The remote call is expected to answer
//     GET {COURSEBOOK_URL}/sections?term=Fall%202026    ->   { "sections": [ { course_code, section_number, term, timing, instructor_email } ] }
// (camelCase names are accepted too). When the real format is known, change only normalizeRemote().
const { env } = require('../config/env');
const { CourseSection } = require('../models');
const { levelOf, meetingOf, departmentOf } = require('./eligibility');
const { now } = require('./clock');
const { sectionKey } = require('./lookup');

let fetchImpl = (...args) => globalThis.fetch(...args);
let sleepImpl = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const cache = new Map(); // term -> { at: ms, offerings }
const state = { lastError: null, lastErrorAt: null, lastSuccessAt: null };

/** Test hook: swap the HTTP call and the waiting. */
function configure({ fetch, sleep } = {}) {
  if (fetch) fetchImpl = fetch;
  if (sleep) sleepImpl = sleep;
}
function reset() {
  fetchImpl = (...args) => globalThis.fetch(...args);
  sleepImpl = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
  cache.clear();
  Object.assign(state, { lastError: null, lastErrorAt: null, lastSuccessAt: null });
}

const text = (v) => (typeof v === 'string' ? v.trim() : '');
const first = (obj, ...names) => names.map((n) => obj[n]).find((v) => v !== undefined);

/** One row from Course Book -> the shape the local collection uses. Returns null for a row that cannot be used. */
function normalizeRemote(row, term) {
  if (!row || typeof row !== 'object') return null;
  const section = {
    course_code: text(first(row, 'course_code', 'courseCode')),
    section_number: text(String(first(row, 'section_number', 'sectionNumber') ?? '')),
    term: text(first(row, 'term')) || term,
    timing: text(first(row, 'timing', 'meeting')),
    instructor_email: text(first(row, 'instructor_email', 'instructorEmail')).toLowerCase(),
  };
  if (!section.course_code || !section.section_number || section.term !== term || !section.timing || !section.instructor_email) return null;
  if (/[~\u0000-\u001F]/.test(section.course_code + section.section_number + section.term)) return null;
  return section;
}

/** The shape the API returns for one offering. */
function describe(section, source) {
  const meeting = meetingOf(section);
  return {
    sectionId: sectionKey(section),
    courseCode: section.course_code,
    sectionNumber: section.section_number,
    term: section.term,
    department: departmentOf(section),
    courseLevel: levelOf(section),
    timing: section.timing,
    days: meeting.days,
    startTime: meeting.startTime,
    endTime: meeting.endTime,
    instructorEmail: section.instructor_email,
    source,
  };
}

async function fetchRemoteOnce(term) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.courseBookTimeoutMs);
  try {
    const url = `${env.courseBookUrl.replace(/\/+$/, '')}/sections?term=${encodeURIComponent(term)}`;
    const headers = { Accept: 'application/json' };
    if (env.courseBookApiKey) headers.Authorization = `Bearer ${env.courseBookApiKey}`;
    const response = await fetchImpl(url, { headers, signal: controller.signal });
    if (!response.ok) {
      const err = new Error(`Course Book answered HTTP ${response.status}`);
      err.status = response.status;
      err.retryable = response.status === 429 || response.status >= 500;
      throw err;
    }
    let body;
    try { body = await response.json(); } catch { const e = new Error('Course Book did not answer with JSON'); e.retryable = false; throw e; }
    const rows = Array.isArray(body) ? body : body && Array.isArray(body.sections) ? body.sections : null;
    if (!rows) { const e = new Error('Course Book answered in a shape this adapter does not know'); e.retryable = false; throw e; }
    const good = rows.map((r) => normalizeRemote(r, term)).filter(Boolean);
    return { sections: good, skipped: rows.length - good.length };
  } catch (err) {
    if (err && err.name === 'AbortError') { const e = new Error(`Course Book did not answer within ${env.courseBookTimeoutMs} ms`); e.retryable = true; throw e; }
    if (err && err.retryable === undefined) err.retryable = true; // network failures are worth another try
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchRemote(term) {
  let lastErr;
  for (let attempt = 0; attempt <= env.courseBookRetries; attempt += 1) {
    try {
      return await fetchRemoteOnce(term);
    } catch (err) {
      lastErr = err;
      if (!err.retryable || attempt === env.courseBookRetries) break;
      await sleepImpl(env.courseBookBackoffMs * (2 ** attempt));
    }
  }
  throw lastErr;
}

const fromLocal = async (term) => (await CourseSection.find({ term }).lean());

/**
 * @returns {{source:'local'|'coursebook'|'cache'|'stale-cache'|'local-fallback', warning:string|null, offerings:object[], skippedRows:number}}
 */
async function loadOfferings(term) {
  if (env.courseBookMode !== 'remote' || !env.courseBookUrl) {
    const warning = env.courseBookMode === 'remote' ? 'COURSEBOOK_MODE=remote but COURSEBOOK_URL is empty, so local data is used.' : null;
    return { source: 'local', warning, offerings: (await fromLocal(term)).map((s) => describe(s, 'local')), skippedRows: 0 };
  }
  const ageMs = (entry) => now().getTime() - entry.at;
  const cached = cache.get(term);
  if (cached && ageMs(cached) < env.courseBookCacheSeconds * 1000) {
    return { source: 'cache', warning: null, offerings: cached.offerings, skippedRows: cached.skipped };
  }
  try {
    const { sections, skipped } = await fetchRemote(term);
    const offerings = sections.map((s) => describe(s, 'coursebook'));
    cache.set(term, { at: now().getTime(), offerings, skipped });
    state.lastSuccessAt = now();
    return { source: 'coursebook', warning: skipped ? `${skipped} Course Book row(s) were unusable and skipped.` : null, offerings, skippedRows: skipped };
  } catch (err) {
    state.lastError = err.message;
    state.lastErrorAt = now();
    if (cached) {
      return { source: 'stale-cache', warning: `Course Book is unavailable (${err.message}); showing the last good answer.`, offerings: cached.offerings, skippedRows: cached.skipped };
    }
    return {
      source: 'local-fallback',
      warning: `Course Book is unavailable (${err.message}); showing the local course data.`,
      offerings: (await fromLocal(term)).map((s) => describe(s, 'local')),
      skippedRows: 0,
    };
  }
}

/** Filters shared by the endpoint and tests. */
function filterOfferings(offerings, { department, level, instructorEmail, q }) {
  const needle = q ? q.toLowerCase() : null;
  return offerings.filter((o) => (!department || o.department === department.toUpperCase())
    && (level === undefined || o.courseLevel === level)
    && (!instructorEmail || o.instructorEmail === instructorEmail)
    && (!needle || `${o.courseCode} ${o.sectionNumber}`.toLowerCase().includes(needle)));
}

const status = () => ({
  mode: env.courseBookMode,
  configured: env.courseBookMode === 'remote' && Boolean(env.courseBookUrl),
  hasApiKey: Boolean(env.courseBookApiKey),
  timeoutMs: env.courseBookTimeoutMs,
  retries: env.courseBookRetries,
  cacheSeconds: env.courseBookCacheSeconds,
  cachedTerms: [...cache.keys()],
  lastError: state.lastError,
  lastErrorAt: state.lastErrorAt,
  lastSuccessAt: state.lastSuccessAt,
});

const clearCache = (term) => { if (term) cache.delete(term); else cache.clear(); };

module.exports = {
  configure, reset, loadOfferings, filterOfferings, normalizeRemote, status, clearCache,
};
