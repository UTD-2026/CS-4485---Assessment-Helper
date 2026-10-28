// A small stand-in for the parts of Express 5 this backend uses (Router, app.use/get/post/put/patch, express.json,
// error middleware, :params, query strings, nested routers, async handlers that reject -> error middleware),
// plus `request()` to call the app in-process. No sockets, no npm install.

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

function compile(path, end) {
  const keys = [];
  const source = path
    .replace(/\/+$/, '')
    .split('/')
    .map((seg) => {
      if (seg.startsWith(':')) { keys.push(seg.slice(1)); return '([^/]+?)'; }
      if (seg.includes('*')) throw new Error(`fakeExpress: wildcard path "${path}" is not supported`);
      return seg.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return { keys, regex: new RegExp(`^${source}${end ? '/?$' : '(?=/|$)'}`, 'i') };
}

function Router() {
  const layers = [];
  const router = function noop() {};
  router.isRouter = true;

  function add(method, path, handlers) {
    if (typeof path === 'function' || (path && path.isRouter)) { handlers = [path, ...handlers]; path = '/'; }
    layers.push({ method, path, handlers: handlers.flat(), ...compile(path, method !== null ? true : false) });
  }
  router.use = (path, ...handlers) => add(null, path, handlers);
  for (const m of METHODS) router[m] = (path, ...handlers) => add(m.toUpperCase(), path, handlers);

  router.handle = (req, res, done) => {
    let i = 0;
    const originalUrl = req.url;
    const originalBase = req.baseUrl;
    const originalParams = req.params;

    const finish = (err) => { req.url = originalUrl; req.baseUrl = originalBase; req.params = originalParams; done(err); };

    function next(err) {
      if (i >= layers.length) return finish(err);
      const layer = layers[i]; i += 1;
      if (layer.method && layer.method !== req.method) return next(err);
      const pathOnly = req.url.split('?')[0] || '/';
      const m = layer.regex.exec(pathOnly === '' ? '/' : pathOnly);
      if (!m && !(layer.path === '/' && layer.method === null)) return next(err);

      const params = { ...originalParams };
      if (m) layer.keys.forEach((k, idx) => { params[k] = decodeURIComponent(m[idx + 1]); });
      req.params = params;

      let consumed = '';
      if (layer.method === null && m) {
        consumed = m[0];
        req.baseUrl = originalBase + consumed;
        req.url = pathOnly.slice(consumed.length) || '/';
        const qs = req.url.includes('?') ? '' : (originalUrl.includes('?') ? `?${originalUrl.split('?')[1]}` : '');
        req.url += qs;
      }

      let h = 0;
      const after = (e) => {
        if (layer.method === null) { req.url = originalUrl; req.baseUrl = originalBase; }
        next(e);
      };
      function runHandler(e) {
        if (h >= layer.handlers.length) return after(e);
        const handler = layer.handlers[h]; h += 1;
        const isErrorHandler = !handler.isRouter && handler.length === 4;
        if (e && !isErrorHandler) return runHandler(e);
        if (!e && isErrorHandler) return runHandler();
        try {
          let result;
          if (handler.isRouter) result = handler.handle(req, res, (err2) => runHandler(err2));
          else if (isErrorHandler) result = handler(e, req, res, (err2) => runHandler(err2));
          else result = handler(req, res, (err2) => runHandler(err2));
          if (result && typeof result.then === 'function') result.catch((err2) => runHandler(err2));
        } catch (thrown) {
          runHandler(thrown);
        }
        return undefined;
      }
      return runHandler(err);
    }
    next();
  };
  return router;
}

function express() {
  const app = Router();
  app.disable = () => app;
  app.set = () => app;
  app.listen = () => { throw new Error('fakeExpress: no real server in the demos - use request()'); };
  return app;
}
express.Router = Router;
express.json = () => (req, res, next) => next(); // bodies are handed to request() already parsed
/**
 * express.raw({type, limit}): like body-parser 2 (Express 5). If the Content-Type matches, req.body becomes a Buffer
 * (or the request fails with the same error type/status body-parser uses when it is too big); if not, req.body is untouched.
 */
express.raw = ({ type = 'application/octet-stream', limit = '100kb' } = {}) => (req, res, next) => {
  const contentType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (!req.rawBuffer || contentType !== String(type).toLowerCase()) return next();
  const m = /^(\d+(?:\.\d+)?)\s*(b|kb|mb)?$/i.exec(String(limit));
  const bytes = m ? Math.floor(Number(m[1]) * ({ b: 1, kb: 1024, mb: 1048576 }[(m[2] || 'b').toLowerCase()])) : 102400;
  if (req.rawBuffer.length > bytes) {
    const err = new Error('request entity too large');
    Object.assign(err, { type: 'entity.too.large', status: 413, statusCode: 413, limit: bytes, length: req.rawBuffer.length });
    return next(err);
  }
  req.body = req.rawBuffer;
  return next();
};

function makeResponse() {
  const res = {
    statusCode: 200, headers: {}, headersSent: false, body: undefined, text: '',
    status(code) { res.statusCode = code; return res; },
    set(k, v) { res.headers[String(k).toLowerCase()] = v; return res; },
    append(k, v) {
      const name = String(k).toLowerCase();
      const existing = res.headers[name];
      res.headers[name] = existing === undefined ? v : `${existing}, ${v}`;
      return res;
    },
    header(k, v) { return res.set(k, v); },
    getHeader(k) { return res.headers[String(k).toLowerCase()]; },
    type(t) { return res.set('Content-Type', t === 'csv' ? 'text/csv' : t); },
    json(payload) {
      res.text = JSON.stringify(payload);   // real JSON round trip: ObjectId/Date become strings exactly as on the wire
      res.body = JSON.parse(res.text);
      return res.end();
    },
    send(payload) {
      if (Buffer.isBuffer(payload)) { res.rawBody = payload; res.text = ''; res.body = payload; return res.end(); }
      res.text = String(payload); res.body = res.text;
      if (!res.headers['content-type']) res.set('Content-Type', 'text/html; charset=utf-8');
      return res.end();
    },
    end() { res.headersSent = true; res.finished = true; res.resolve(); return res; },
  };
  res.done = new Promise((resolve) => { res.resolve = resolve; });
  return res;
}

/**
 * Call the app in-process.
 * @returns {Promise<{status:number, body:any, headers:object}>}
 */
async function request(app, method, url, { body, headers = {}, raw } = {}) {
  const [pathPart, queryPart = ''] = url.split('?');
  const query = {};
  for (const [k, v] of new URLSearchParams(queryPart)) query[k] = v;
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const req = {
    method: method.toUpperCase(), url: pathPart + (queryPart ? `?${queryPart}` : ''), originalUrl: url, baseUrl: '', path: pathPart,
    query, params: {}, headers: lower, body: body === undefined ? undefined : JSON.parse(JSON.stringify(body)),
    rawBuffer: raw === undefined ? undefined : Buffer.from(raw), // a binary body (e.g. a PDF), only seen by express.raw()
    get(h) { return lower[String(h).toLowerCase()]; },
  };
  const res = makeResponse();
  app.handle(req, res, (err) => {
    if (!res.finished) { res.status(err ? 500 : 404).json({ error: err ? String(err.message || err) : `No route for ${req.method} ${url}` }); }
  });
  await res.done;
  return { status: res.statusCode, body: res.body, headers: res.headers, text: res.text, raw: res.rawBody };
}

module.exports = express;
module.exports.request = request;
