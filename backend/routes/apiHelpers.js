class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function asyncRoute(handler) {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}

function sendData(response, data, status = 200) {
  return response.status(status).json({ data });
}

function requireObject(value, label = "Request body") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(400, `${label} must be a JSON object.`);
  }
}

function rejectUnknownFields(body, allowedFields) {
  const unknown = Object.keys(body).filter((key) => !allowedFields.includes(key));
  if (unknown.length) {
    throw new ApiError(400, `Unsupported field(s): ${unknown.join(", ")}.`);
  }
}

function requireString(value, field, { pattern, allowEmpty = false } = {}) {
  if (typeof value !== "string") {
    throw new ApiError(400, `${field} must be a string.`);
  }

  const normalized = value.trim();
  if ((!allowEmpty && !normalized) || (pattern && !pattern.test(normalized))) {
    throw new ApiError(400, `Invalid ${field}.`);
  }
  return normalized;
}

function normalizeEmail(value, field = "email") {
  const email = requireString(value, field).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ApiError(400, `Invalid ${field}.`);
  }
  return email;
}

function normalizeTerm(value, field = "term") {
  return requireString(value, field, {
    pattern: /^(Spring|Fall) \d{4}$/,
  });
}

function termIndex(term) {
  const match = /^(Spring|Fall) (\d{4})$/.exec(term);
  if (!match) return null;
  return Number(match[2]) * 2 + (match[1] === "Fall" ? 1 : 0);
}

function sortTermsDescending(a, b) {
  return termIndex(b.term) - termIndex(a.term);
}

function parseDate(value, field, { allowNull = false } = {}) {
  if (allowNull && value === null) return null;
  if (typeof value !== "string" && !(value instanceof Date)) {
    throw new ApiError(400, `${field} must be a valid date.`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ApiError(400, `${field} must be a valid date.`);
  }
  return date;
}

function ensureDateOrder(signupDeadline, observationDeadline, feedbackDeadline) {
  if (
    signupDeadline > observationDeadline ||
    observationDeadline > feedbackDeadline
  ) {
    throw new ApiError(
      400,
      "Deadlines must be in signup, observation, then feedback order."
    );
  }
}

function routeSectionKey(request) {
  const course_code = requireString(request.params.course_code, "course_code");
  const section_number = requireString(request.params.section_number, "section_number", {
    pattern: /^\d{3}$/,
  });
  const term = normalizeTerm(request.params.term);
  return { course_code, section_number, term };
}

function errorHandler(error, request, response, next) {
  if (response.headersSent) return next(error);

  if (error instanceof ApiError) {
    return response.status(error.status).json({ error: error.message });
  }
  if (error.name === "ValidationError" || error.name === "CastError") {
    return response.status(400).json({ error: error.message });
  }
  if (error.code === 11000) {
    return response.status(409).json({ error: "A record with that identifier already exists." });
  }
  if (error.type === "entity.parse.failed") {
    return response.status(400).json({ error: "Request body must be valid JSON." });
  }

  console.error("Unhandled API error:", error);
  return response.status(500).json({ error: "Internal server error." });
}

module.exports = {
  ApiError,
  asyncRoute,
  sendData,
  requireObject,
  rejectUnknownFields,
  requireString,
  normalizeEmail,
  normalizeTerm,
  termIndex,
  sortTermsDescending,
  parseDate,
  ensureDateOrder,
  routeSectionKey,
  errorHandler,
};
