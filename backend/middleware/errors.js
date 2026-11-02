// Error helpers. Status codes follow the "HTTP status codes" table in the API Endpoints doc.

class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const badRequest = (msg, details) => new HttpError(400, msg, details);
const unauthorized = (msg = "Authentication is required.") => new HttpError(401, msg);
const forbidden = (msg = "You do not have permission to perform this action.") => new HttpError(403, msg);
const notFound = (msg = "Not found.") => new HttpError(404, msg);
const conflict = (msg, details) => new HttpError(409, msg, details);

function notFoundHandler(req, res) {
  res.status(404).json({ error: "API endpoint not found." });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(error, req, res, next) {
  if (error.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Request body must be valid JSON." });
  }
  if (error instanceof HttpError) {
    return res.status(error.status).json({ error: error.message, ...(error.details ? { details: error.details } : {}) });
  }
  if (error.name === "ValidationError" || error.name === "CastError") {
    return res.status(400).json({ error: error.message });
  }
  if (error.code === 11000) {
    return res.status(409).json({ error: "A record with the same key already exists." });
  }
  console.error("Unhandled API error:", error);
  return res.status(500).json({ error: "Internal server error." });
}

module.exports = { HttpError, badRequest, unauthorized, forbidden, notFound, conflict, notFoundHandler, errorHandler };
