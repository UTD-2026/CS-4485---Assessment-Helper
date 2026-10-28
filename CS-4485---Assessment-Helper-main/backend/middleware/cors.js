// A small CORS middleware (the API needs nothing more than this, so there is no `cors` package to install).
//
// A browser on another origin (the Vite dev server on :5173) may call the API only if the server says so.
//   * origin allowed  -> Access-Control-Allow-Origin: <that origin>, plus Vary: Origin
//   * "*" in the list -> Access-Control-Allow-Origin: *
//   * not allowed     -> no CORS headers at all (the browser then blocks the response)
//   * preflight (OPTIONS + Access-Control-Request-Method) is answered here with 204
// Requests without an Origin header (curl, server-to-server, same-origin) are untouched.
function corsMiddleware({
  origins = [],
  methods = ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE'],
  allowedHeaders = null, // null = echo whatever the browser asks for in the preflight
  exposedHeaders = [],
  maxAgeSeconds = 600,
} = {}) {
  const any = origins.includes('*');
  const allowed = new Set(origins.map((o) => String(o).trim().replace(/\/+$/, '')));

  return function cors(req, res, next) {
    const origin = req.headers.origin;
    // Responses differ by Origin, so caches must know.
    res.append('Vary', 'Origin');
    if (!origin) return next();

    const ok = any || allowed.has(String(origin).replace(/\/+$/, ''));
    if (ok) {
      res.set('Access-Control-Allow-Origin', any ? '*' : origin);
      if (exposedHeaders.length) res.set('Access-Control-Expose-Headers', exposedHeaders.join(', '));
    }

    const preflight = req.method === 'OPTIONS' && req.headers['access-control-request-method'];
    if (!preflight) return next();

    if (ok) {
      res.set('Access-Control-Allow-Methods', methods.join(', '));
      const requested = req.headers['access-control-request-headers'];
      const headers = allowedHeaders ? allowedHeaders.join(', ') : requested;
      if (headers) res.set('Access-Control-Allow-Headers', headers);
      res.set('Access-Control-Max-Age', String(maxAgeSeconds));
      res.append('Vary', 'Access-Control-Request-Headers');
    }
    return res.status(204).end();
  };
}

module.exports = { corsMiddleware };
