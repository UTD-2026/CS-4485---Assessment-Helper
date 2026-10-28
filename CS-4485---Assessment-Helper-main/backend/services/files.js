// The signed observation form ("My Duties" in the frontend): the observer uploads a PDF, the observee and the
// Assessment Committee can download it. One file per observation; uploading again replaces it.
//
// The PDF is stored in MongoDB as base64 text (see models/index.js). We check that it really starts like a PDF and
// is not too big; we do NOT scan it for viruses or read what is inside it.
const { createHash } = require('node:crypto');
const { env } = require('../config/env');
const { ObservationFile } = require('../models');
const { badRequest, conflict, forbidden, unsupportedMedia } = require('../middleware/errors');
const { now } = require('./clock');
const { findForSections, loadObservation, sectionKey } = require('./lookup');
const { notify } = require('./notifications');

const SIGNED_TEMPLATE = 'signed_template';
const PDF_TYPE = 'application/pdf';

/** What the API shows about a stored file (never the bytes). */
const publicFile = (f) => ({
  kind: f.kind,
  filename: f.filename,
  contentType: f.content_type,
  size: f.size,
  sha256: f.sha256,
  uploadedBy: f.uploaded_by,
  uploadedAt: f.uploaded_at,
  version: f.version || 1,
});

/**
 * A safe file name: no folders, no odd characters, ends with .pdf, at most 100 characters.
 * Anything the client sent (query string or header) is cleaned; if nothing usable is left, a default is used.
 */
function cleanFilename(raw, fallback) {
  let name = typeof raw === 'string' ? raw : '';
  name = name.split(/[\\/]/).pop() || '';
  name = name.replace(/[^A-Za-z0-9._() -]/g, '_').replace(/\s+/g, ' ').trim().replace(/^\.+/, '');
  name = name.replace(/\.pdf$/i, '');
  if (!name || /^_+$/.test(name)) return fallback;
  return `${name.slice(0, 96)}.pdf`;
}

/** A real PDF starts with "%PDF-" (the PDF spec allows it anywhere in the first 1024 bytes). */
function looksLikePdf(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length >= 8 && buffer.subarray(0, 1024).includes('%PDF-');
}

async function saveSignedTemplate(user, sectionId, body, rawName) {
  const ctx = await loadObservation(sectionId);
  const {
    observation, section, observee, filter: sectionOnly,
  } = ctx;
  if (user.email !== observation.observer_email) {
    throw forbidden('Only the confirmed observer can upload the signed observation form.');
  }
  if (!['scheduled', 'completed'].includes(observation.status)) {
    throw conflict(`The observation is "${observation.status}"; the signed form can be uploaded once it is scheduled.`, { code: 'BAD_STATUS' });
  }
  if (!Buffer.isBuffer(body)) {
    throw unsupportedMedia('Send the PDF itself as the request body, with the header Content-Type: application/pdf.', { code: 'NOT_A_PDF_BODY' });
  }
  if (body.length === 0) throw badRequest('The uploaded file is empty.', { code: 'EMPTY_FILE' });
  if (!looksLikePdf(body)) throw badRequest('That file is not a PDF (it does not start with %PDF-).', { code: 'NOT_A_PDF' });

  const at = now();
  const filename = cleanFilename(rawName, `signed-observation-${sectionKey(section).replace(/[^A-Za-z0-9]+/g, '-')}.pdf`);
  const fields = {
    filename,
    content_type: PDF_TYPE,
    size: body.length,
    sha256: createHash('sha256').update(body).digest('hex'),
    data_base64: body.toString('base64'),
    uploaded_by: user.email,
    uploaded_at: at,
  };
  const filter = { ...sectionOnly, kind: SIGNED_TEMPLATE };
  const update = { $set: fields, $setOnInsert: { first_uploaded_at: at }, $inc: { version: 1 } };

  let saved;
  try {
    saved = await ObservationFile.findOneAndUpdate(filter, update, { upsert: true, returnDocument: 'after' }).select('-data_base64').lean();
  } catch (err) {
    // Two uploads racing to create the very first copy: the loser retries and simply replaces it.
    if (!(err && err.code === 11000)) throw err;
    saved = await ObservationFile.findOneAndUpdate(filter, update, { upsert: true, returnDocument: 'after' }).select('-data_base64').lean();
  }

  await notify({
    recipientEmail: observee.email,
    type: 'SIGNED_TEMPLATE_UPLOADED',
    message: `${ctx.observer ? ctx.observer.name : 'Your observer'} uploaded the signed observation form for ${section.course_code} sec ${section.section_number}.`,
    section,
  });
  return publicFile(saved);
}

/** Metadata of every file on an observation (no bytes). */
async function listFiles(sectionFilter) {
  const files = await ObservationFile.find(sectionFilter).select('-data_base64').lean();
  return files.map(publicFile);
}

/** Metadata for many observations at once: Map(sectionId string -> publicFile) for the signed template.
 *  `docs` is anything keyed by a section (observations, sections). */
async function signedTemplatesFor(docs) {
  const files = await findForSections(ObservationFile, docs, { kind: SIGNED_TEMPLATE }, '-data_base64');
  return new Map(files.map((f) => [sectionKey(f), publicFile(f)]));
}

/** The bytes + metadata, for a download. */
async function loadFileBytes(sectionFilter, kind = SIGNED_TEMPLATE) {
  const f = await ObservationFile.findOne({ ...sectionFilter, kind }).lean();
  if (!f) return null;
  return { ...publicFile(f), bytes: Buffer.from(f.data_base64, 'base64') };
}

const maxUploadBytes = () => env.uploadMaxMb * 1024 * 1024;

module.exports = {
  cleanFilename,
  looksLikePdf,
  saveSignedTemplate,
  listFiles,
  signedTemplatesFor,
  loadFileBytes,
  SIGNED_TEMPLATE,
  publicFile,
  maxUploadBytes,
};
