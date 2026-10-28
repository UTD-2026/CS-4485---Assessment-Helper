// One error shape for the whole API:  { "error": "human readable message", "code": "OPTIONAL_MACHINE_CODE", "details": ... }

class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    Object.assign(this, extra); // e.g. code, details
  }
}
const badRequest = (m, extra) => new HttpError(400, m, extra);
const unauthorized = (m = 'Authentication required.', extra) => new HttpError(401, m, extra);
const forbidden = (m = 'You are not allowed to do that.', extra) => new HttpError(403, m, extra);
const notFound = (m = 'Not found.', extra) => new HttpError(404, m, extra);
const conflict = (m, extra) => new HttpError(409, m, extra);
const payloadTooLarge = (m, extra) => new HttpError(413, m, extra);
const unsupportedMedia = (m, extra) => new HttpError(415, m, extra);
const gone = (m, extra) => new HttpError(410, m, extra);
const unprocessable = (m, extra) => new HttpError(422, m, extra);

/** Wrap an async route handler so a thrown error reaches the error middleware (works on Express 4 and 5). */
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function notFoundHandler(req, res) {
  res.status(404).json({ error: `No route for ${req.method} ${req.originalUrl || req.url}` });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  if (err instanceof HttpError) {
    const body = { error: err.message };
    if (err.code) body.code = err.code;
    if (err.details !== undefined) body.details = err.details;
    return res.status(err.status).json(body);
  }
  if (err && err.type === 'entity.too.large') {
    const mb = err.limit ? ` (the limit is ${Math.round((err.limit / 1048576) * 10) / 10} MB)` : '';
    return res.status(413).json({ error: `The request is too large${mb}.`, code: 'PAYLOAD_TOO_LARGE' });
  }
  if (err && (err.type === 'encoding.unsupported' || err.type === 'charset.unsupported')) {
    return res.status(415).json({ error: 'Unsupported request encoding.', code: 'UNSUPPORTED_MEDIA' });
  }
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Request body is not valid JSON.' });
  }
  if (err && err.name === 'ValidationError') {
    return res.status(400).json({ error: err.message, code: 'VALIDATION_FAILED' });
  }
  if (err && err.name === 'CastError') {
    return res.status(400).json({ error: `Invalid value for ${err.path}.`, code: 'BAD_VALUE' });
  }
  if (err && err.code === 11000) {
    return res.status(409).json({ error: 'That record already exists.', code: 'DUPLICATE' });
  }
  console.error('[error]', err);
  const production = process.env.NODE_ENV === 'production';
  return res.status(500).json({ error: production ? 'Internal server error.' : String(err && err.message ? err.message : err) });
}

module.exports = {
  HttpError,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  payloadTooLarge,
  unsupportedMedia,
  gone,
  unprocessable,
  asyncHandler,
  notFoundHandler,
  errorHandler,
};
