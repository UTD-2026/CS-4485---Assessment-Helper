// Evaluation criteria templates. Per the API Endpoints doc, each term has its own JSON file
// (backend/templates/<term-slug>.json, e.g. fall-2026.json); the backend reads the file when the
// front end asks for it. Terms without a file use templates/default.json.
const fs = require("node:fs/promises");
const path = require("node:path");
const { termSlug } = require("./terms");
const { badRequest } = require("../middleware/errors");

const DIR = path.join(__dirname, "..", "templates");
const RATING_SCALES = ["1 to 5 (Poor to Excellent)", "Yes / No / N/A", "Text Feedback Only"];

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function getTemplate(term) {
  const own = await readJson(path.join(DIR, `${termSlug(term)}.json`));
  if (own) return { ...own, term, source: `${termSlug(term)}.json` };
  const fallback = (await readJson(path.join(DIR, "default.json"))) || { criteria: [] };
  return { ...fallback, term, source: "default.json" };
}

function validateCriteria(criteria) {
  if (!Array.isArray(criteria)) throw badRequest("criteria must be an array.");
  const ids = new Set();
  return criteria.map((c, i) => {
    const id = String(c.id ?? "").trim() || `criterion-${Date.now()}-${i}`;
    if (ids.has(id)) throw badRequest(`Duplicate criterion id "${id}".`);
    ids.add(id);
    if (!String(c.criteria || "").trim()) throw badRequest(`Criterion ${i + 1} needs a description.`);
    if (!RATING_SCALES.includes(c.ratingScale)) throw badRequest(`Criterion ${i + 1} has an unknown rating scale.`);
    return { id, criteria: String(c.criteria).trim(), ratingScale: c.ratingScale };
  });
}

/** Writes templates/<term>.json (used by the committee's Template Editor). */
async function saveTemplate(term, criteria, editorEmail) {
  const doc = { term, updated_at: new Date().toISOString(), updated_by: editorEmail, criteria: validateCriteria(criteria) };
  await fs.mkdir(DIR, { recursive: true });
  await fs.writeFile(path.join(DIR, `${termSlug(term)}.json`), `${JSON.stringify(doc, null, 2)}\n`, "utf8");
  return { ...doc, source: `${termSlug(term)}.json` };
}

/**
 * From main: a new cycle starts with a copy of the most recent earlier term's template file, so the
 * committee edits last term's form instead of the default. Does nothing if the term already has a file
 * or no earlier term has one (getTemplate then falls back to default.json).
 */
async function copyLatestTemplate(term, knownTerms) {
  const { termOrdinal } = require("./terms");
  const target = path.join(DIR, `${termSlug(term)}.json`);
  if (await readJson(target)) return null;
  const earlier = knownTerms.filter((t) => t !== term && termOrdinal(t) < termOrdinal(term)).sort((a, b) => termOrdinal(b) - termOrdinal(a));
  for (const source of earlier) {
    const doc = await readJson(path.join(DIR, `${termSlug(source)}.json`));
    if (!doc) continue;
    const copy = { term, copied_from: source, updated_at: new Date().toISOString(), criteria: doc.criteria || [] };
    await fs.writeFile(target, `${JSON.stringify(copy, null, 2)}\n`, { encoding: "utf8", flag: "wx" }).catch((e) => { if (e.code !== "EEXIST") throw e; });
    return source;
  }
  return null;
}

module.exports = { getTemplate, saveTemplate, copyLatestTemplate, RATING_SCALES };
