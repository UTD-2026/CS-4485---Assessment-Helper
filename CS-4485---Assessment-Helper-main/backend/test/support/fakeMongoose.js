// A small in-memory stand-in for the slice of Mongoose that this backend uses, so the demos and tests run with
// plain `node` and no MongoDB or npm install. It is deliberately STRICT: it throws on any query/update operator or
// option the backend does not already use, and on `undefined` filter values, so the backend cannot quietly start
// relying on something this file does not model. It is not a MongoDB; it proves the backend's logic and flow, not the
// database engine (index builds, replication, etc.).
const { randomBytes } = require('node:crypto');

// ---------- ObjectId ----------------------------------------------------------------------------
const HEX24 = /^[0-9a-fA-F]{24}$/;
class ObjectId {
  constructor(value) {
    if (value instanceof ObjectId) this.hex = value.hex;
    else if (typeof value === 'string' && HEX24.test(value)) this.hex = value.toLowerCase();
    else if (value === undefined) this.hex = randomBytes(12).toString('hex');
    else throw castError('_id', value, 'ObjectId');
  }
  get _bsontype() { return 'ObjectId'; }
  toString() { return this.hex; }
  toJSON() { return this.hex; }
  equals(other) { return String(other) === this.hex; }
}
const isValidObjectId = (v) => v instanceof ObjectId || (typeof v === 'string' && HEX24.test(v));

function castError(path, value, kind) {
  const e = new Error(`Cast to ${kind} failed for value "${String(value)}" at path "${path}"`);
  e.name = 'CastError'; e.path = path; return e;
}
function validationError(message) {
  const e = new Error(message); e.name = 'ValidationError'; return e;
}
function duplicateError(index) {
  const e = new Error(`E11000 duplicate key error (index ${index})`); e.name = 'MongoServerError'; e.code = 11000; return e;
}

// ---------- Schema ------------------------------------------------------------------------------
class MixedType {}
class ObjectIdType {}
const TYPE_NAMES = new Map([[String, 'String'], [Number, 'Number'], [Date, 'Date'], [Boolean, 'Boolean'], [MixedType, 'Mixed'], [ObjectIdType, 'ObjectId']]);

function normalizePath(spec) {
  const s = (spec && typeof spec === 'object' && !Array.isArray(spec) && 'type' in spec) ? spec : { type: spec };
  if (Array.isArray(s.type)) {
    const inner = normalizePath(s.type[0]);
    return { kind: 'Array', inner, default: 'default' in s ? s.default : [], required: s.required };
  }
  const kind = TYPE_NAMES.get(s.type);
  if (!kind) throw new Error(`fakeMongoose: unsupported schema type for ${JSON.stringify(Object.keys(s))}`);
  const allowed = new Set(['type', 'required', 'enum', 'default', 'unique', 'lowercase', 'trim', 'min', 'max']);
  for (const k of Object.keys(s)) if (!allowed.has(k)) throw new Error(`fakeMongoose: unsupported schema option "${k}"`);
  return { kind, required: s.required, enum: s.enum, default: s.default, hasDefault: 'default' in s, unique: s.unique, lowercase: s.lowercase, trim: s.trim, min: s.min, max: s.max };
}

class Schema {
  constructor(definition, options = {}) {
    this.options = options;
    this.paths = { _id: { kind: 'ObjectId', hasDefault: false } };
    for (const [path, spec] of Object.entries(definition)) this.paths[path] = normalizePath(spec);
    this.indexes = [];
    for (const [path, p] of Object.entries(this.paths)) if (p.unique) this.indexes.push({ fields: { [path]: 1 }, unique: true, name: `${path}_1` });
  }
  index(fields, options = {}) {
    const name = Object.entries(fields).map(([k, v]) => `${k}_${v}`).join('_');
    this.indexes.push({ fields, unique: Boolean(options.unique), partial: options.partialFilterExpression, name });
    return this;
  }
}
Schema.Types = { Mixed: MixedType, ObjectId: ObjectIdType };

// ---------- value helpers -----------------------------------------------------------------------
function clone(v) {
  if (v === null || typeof v !== 'object') return v;
  if (v instanceof Date) return new Date(v.getTime());
  if (v instanceof ObjectId) return new ObjectId(v);
  if (Array.isArray(v)) return v.map(clone);
  const out = {};
  for (const [k, val] of Object.entries(v)) out[k] = clone(val);
  return out;
}
const getPath = (doc, path) => path.split('.').reduce((o, k) => (o === null || o === undefined ? undefined : o[k]), doc);
function setPath(doc, path, value) {
  const parts = path.split('.');
  let o = doc;
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (o[parts[i]] === null || typeof o[parts[i]] !== 'object') o[parts[i]] = {};
    o = o[parts[i]];
  }
  o[parts[parts.length - 1]] = value;
}
function unsetPath(doc, path) {
  const parts = path.split('.');
  let o = doc;
  for (let i = 0; i < parts.length - 1; i += 1) { o = o && o[parts[i]]; if (!o) return; }
  delete o[parts[parts.length - 1]];
}

function castValue(spec, value, path) {
  if (value === null || value === undefined) return value;
  switch (spec.kind) {
    case 'String': {
      if (typeof value !== 'string') throw castError(path, value, 'string');
      let v = value;
      if (spec.trim) v = v.trim();
      if (spec.lowercase) v = v.toLowerCase();
      return v;
    }
    case 'Number': {
      const n = typeof value === 'number' ? value : (typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN);
      if (Number.isNaN(n)) throw castError(path, value, 'number');
      return n;
    }
    case 'Boolean':
      if (typeof value === 'boolean') return value;
      throw castError(path, value, 'boolean');
    case 'Date': {
      const d = value instanceof Date ? value : new Date(value);
      if (Number.isNaN(d.getTime())) throw castError(path, value, 'date');
      return new Date(d.getTime());
    }
    case 'ObjectId':
      if (!isValidObjectId(value)) throw castError(path, value, 'ObjectId');
      return new ObjectId(value);
    case 'Mixed': return clone(value);
    case 'Array':
      if (!Array.isArray(value)) throw castError(path, value, 'array');
      return value.map((x) => castValue(spec.inner, x, path));
    default: throw new Error(`unreachable ${spec.kind}`);
  }
}

function checkValue(spec, value, path) {
  if (value === null || value === undefined) return;
  if (spec.enum && !spec.enum.includes(value)) throw validationError(`\`${value}\` is not a valid enum value for path \`${path}\`.`);
  if (spec.min !== undefined && value < spec.min) throw validationError(`Path \`${path}\` (${value}) is less than minimum allowed value (${spec.min}).`);
  if (spec.max !== undefined && value > spec.max) throw validationError(`Path \`${path}\` (${value}) is more than maximum allowed value (${spec.max}).`);
}

/** timestamps: true -> createdAt / updatedAt;  timestamps: {createdAt: 'created_at', updatedAt: 'updated_at'} -> those names. */
function timestampNames(schema) {
  const t = schema.options.timestamps;
  if (!t) return null;
  return t === true ? { createdAt: 'createdAt', updatedAt: 'updatedAt' } : { createdAt: t.createdAt || 'createdAt', updatedAt: t.updatedAt || 'updatedAt' };
}

// ---------- querying ----------------------------------------------------------------------------
const norm = (v) => (v instanceof ObjectId ? `oid:${v.hex}` : v instanceof Date ? v.getTime() : v);
function eq(a, b) {
  if ((a === undefined || a === null) && (b === undefined || b === null)) return true;
  if (a === undefined || a === null || b === undefined || b === null) return false;
  if (a instanceof ObjectId || b instanceof ObjectId) return String(a) === String(b);
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return a === b;
}
function cmp(a, b) {
  const x = norm(a); const y = norm(b);
  if (x === undefined || x === null || y === undefined || y === null) return null;
  if (typeof x !== typeof y) return null;
  return x < y ? -1 : x > y ? 1 : 0;
}
function typeMatches(v, t) {
  if (t === 'string') return typeof v === 'string';
  if (t === 'date') return v instanceof Date;
  if (t === 'number') return typeof v === 'number';
  throw new Error(`fakeMongoose: unsupported $type "${t}"`);
}

function matchValue(docVal, expected) {
  if (expected instanceof RegExp) {
    // { field: /re/ } - MongoDB matches strings (and array members that are strings) against the pattern
    const test = (v) => typeof v === 'string' && new RegExp(expected.source, expected.flags.replace('g', '')).test(v);
    return Array.isArray(docVal) ? docVal.some(test) : test(docVal);
  }
  const isOp = expected && typeof expected === 'object' && !(expected instanceof Date) && !(expected instanceof ObjectId) && !Array.isArray(expected)
    && Object.keys(expected).some((k) => k.startsWith('$'));
  if (!isOp) {
    if (Array.isArray(docVal) && !Array.isArray(expected)) return docVal.some((x) => eq(x, expected));
    return eq(docVal, expected);
  }
  return Object.entries(expected).every(([op, arg]) => {
    switch (op) {
      case '$eq': return eq(docVal, arg);
      case '$ne': return !eq(docVal, arg);
      case '$in': return arg.some((x) => eq(docVal, x));
      case '$nin': return !arg.some((x) => eq(docVal, x));
      case '$gt': { const c = cmp(docVal, arg); return c !== null && c > 0; }
      case '$gte': { const c = cmp(docVal, arg); return c !== null && c >= 0; }
      case '$lt': { const c = cmp(docVal, arg); return c !== null && c < 0; }
      case '$lte': { const c = cmp(docVal, arg); return c !== null && c <= 0; }
      case '$exists': return (docVal !== undefined) === Boolean(arg);
      case '$type': return typeMatches(docVal, arg);
      case '$regex': {
        const source = arg instanceof RegExp ? arg.source : String(arg);
        const flags = expected.$options !== undefined ? String(expected.$options) : (arg instanceof RegExp ? arg.flags.replace('g', '') : '');
        const re = new RegExp(source, flags);
        return Array.isArray(docVal) ? docVal.some((v) => typeof v === 'string' && re.test(v)) : (typeof docVal === 'string' && re.test(docVal));
      }
      case '$options': return true; // handled together with $regex
      default: throw new Error(`fakeMongoose: query operator ${op} is not supported (the backend should not use it)`);
    }
  });
}

function matches(doc, filter) {
  return Object.entries(filter).every(([path, expected]) => {
    if (expected === undefined) throw new Error(`fakeMongoose: filter value for "${path}" is undefined (a real driver would turn this into null - never pass undefined)`);
    if (path === '$or') return expected.some((f) => matches(doc, f));
    if (path === '$and') return expected.every((f) => matches(doc, f));
    if (path.startsWith('$')) throw new Error(`fakeMongoose: top-level operator ${path} is not supported`);
    return matchValue(getPath(doc, path), expected);
  });
}

/** Cast filter values using the schema (string ids -> ObjectId, ISO strings -> Date) like Mongoose does. */
function castFilter(schema, filter) {
  const out = {};
  for (const [path, expected] of Object.entries(filter)) {
    if (path === '$or' || path === '$and') { out[path] = expected.map((f) => castFilter(schema, f)); continue; }
    const spec = schema.paths[path];
    const castOne = (v) => {
      if (!spec || v === null || v === undefined) return v;
      if (spec.kind === 'ObjectId' || spec.kind === 'Date' || spec.kind === 'Number') return castValue(spec, v, path);
      return v;
    };
    if (expected && typeof expected === 'object' && !(expected instanceof Date) && !(expected instanceof ObjectId) && !Array.isArray(expected)
      && Object.keys(expected).some((k) => k.startsWith('$'))) {
      const o = {};
      for (const [op, arg] of Object.entries(expected)) o[op] = Array.isArray(arg) && op !== '$type' ? arg.map(castOne) : (op === '$exists' || op === '$type' ? arg : castOne(arg));
      out[path] = o;
    } else out[path] = castOne(expected);
  }
  return out;
}

// ---------- the in-memory "database" -------------------------------------------------------------
const store = new Map(); // collection name -> docs[]
const docsOf = (name) => { if (!store.has(name)) store.set(name, []); return store.get(name); };

function indexKey(doc, fields) {
  return JSON.stringify(Object.keys(fields).map((f) => { const v = getPath(doc, f); return v === undefined ? null : norm(v); }));
}
function checkUnique(model, candidate, ignoreDoc) {
  for (const idx of model.schema.indexes) {
    if (!idx.unique) continue;
    if (idx.partial && !matches(candidate, idx.partial)) continue;
    const k = indexKey(candidate, idx.fields);
    for (const other of docsOf(model.collection.name)) {
      if (other === ignoreDoc) continue;
      if (idx.partial && !matches(other, idx.partial)) continue;
      if (indexKey(other, idx.fields) === k) throw duplicateError(idx.name);
    }
  }
}

function withToObject(doc) {
  const out = clone(doc);
  Object.defineProperty(out, 'toObject', { value: () => clone(doc), enumerable: false });
  return out;
}

function build(model, input, { validate = true } = {}) {
  const { schema } = model;
  const doc = {};
  for (const [path, spec] of Object.entries(schema.paths)) {
    let v = input[path];
    if (v === undefined) {
      if (path === '_id') v = new ObjectId();
      else if (spec.kind === 'Array') v = spec.default === undefined ? undefined : clone(spec.default);
      else if (spec.hasDefault) v = typeof spec.default === 'function' ? spec.default() : spec.default;
    }
    if (v !== undefined) v = castValue(spec, v, path);
    if (validate && spec.required && (v === undefined || v === null || v === '')) throw validationError(`Path \`${path}\` is required.`);
    if (v !== undefined) { checkValue(spec, v, path); doc[path] = v; }
  }
  const ts = timestampNames(schema);
  if (ts) { const t = new Date(); doc[ts.createdAt] = doc[ts.createdAt] || t; doc[ts.updatedAt] = t; }
  return doc;
}

function applyUpdate(model, doc, update, { inserting = false } = {}) {
  const { schema } = model;
  const ops = Object.keys(update);
  for (const op of ops) {
    if (!['$set', '$unset', '$push', '$inc', '$max', '$min', '$setOnInsert'].includes(op)) throw new Error(`fakeMongoose: update operator ${op} is not supported`);
  }
  // MongoDB refuses an update that touches the same path (or a parent and its child) through two operators.
  const touched = [];
  for (const op of ops) for (const path of Object.keys(update[op] || {})) touched.push(path);
  for (let i = 0; i < touched.length; i += 1) {
    for (let j = i + 1; j < touched.length; j += 1) {
      const a = touched[i]; const b = touched[j];
      if (a === b || a.startsWith(`${b}.`) || b.startsWith(`${a}.`)) {
        throw new Error(`fakeMongoose: Updating the path '${a}' would create a conflict at '${b}' (MongoDB rejects this update)`);
      }
    }
  }
  const top = (path) => path.split('.')[0];
  const ts = timestampNames(schema);
  const known = (path) => top(path) in schema.paths || (ts && (top(path) === ts.createdAt || top(path) === ts.updatedAt));
  const specFor = (path) => (path.includes('.') ? null : schema.paths[path]);
  const castSet = (path, value) => {
    const spec = specFor(path);
    if (!spec) return clone(value); // dotted path under a Mixed field
    const v = castValue(spec, value, path);
    checkValue(spec, v, path);
    return v;
  };
  if (update.$set) for (const [p, v] of Object.entries(update.$set)) { if (known(p)) setPath(doc, p, castSet(p, v)); }
  if (inserting && update.$setOnInsert) for (const [p, v] of Object.entries(update.$setOnInsert)) { if (known(p)) setPath(doc, p, castSet(p, v)); }
  if (update.$unset) for (const p of Object.keys(update.$unset)) unsetPath(doc, p);
  if (update.$inc) for (const [p, v] of Object.entries(update.$inc)) setPath(doc, p, (getPath(doc, p) || 0) + v);
  if (update.$max) for (const [p, v] of Object.entries(update.$max)) {
    const nv = castSet(p, v); const cur = getPath(doc, p);
    if (cur === undefined || cur === null || cmp(nv, cur) > 0) setPath(doc, p, nv);
  }
  if (update.$min) for (const [p, v] of Object.entries(update.$min)) {
    const nv = castSet(p, v); const cur = getPath(doc, p);
    if (cur === undefined || cur === null || cmp(nv, cur) < 0) setPath(doc, p, nv);
  }
  if (update.$push) for (const [p, v] of Object.entries(update.$push)) {
    if (!known(p)) continue;
    const spec = specFor(p);
    const element = spec && spec.kind === 'Array' ? castValue(spec.inner, v, p) : clone(v);
    const cur = getPath(doc, p);
    if (cur === undefined || cur === null) setPath(doc, p, [element]);
    else if (Array.isArray(cur)) cur.push(element);
    else throw new Error(`fakeMongoose: $push to non-array ${p}`);
  }
  if (ts) doc[ts.updatedAt] = new Date();
}

const OPTION_WHITELIST = new Set(['returnDocument', 'upsert']);
function checkOptions(options) {
  for (const k of Object.keys(options)) if (!OPTION_WHITELIST.has(k)) throw new Error(`fakeMongoose: option "${k}" is not supported (the backend should not use it)`);
}

// ---------- Query (thenable) ----------------------------------------------------------------------
class Query {
  constructor(run) { this.run = run; this.opts = { sort: null, limit: null, skip: 0, lean: false, select: null }; }
  sort(spec) { this.opts.sort = spec; return this; }
  limit(n) { this.opts.limit = n; return this; }
  skip(n) { this.opts.skip = n; return this; }
  lean() { this.opts.lean = true; return this; }
  select(spec) { this.opts.select = spec; return this; }
  exec() { return this.run(this.opts); }
  then(resolve, reject) { return this.exec().then(resolve, reject); }
  catch(reject) { return this.exec().catch(reject); }
}

function sortDocs(docs, spec) {
  const entries = Object.entries(spec);
  return docs.slice().sort((a, b) => {
    for (const [k, dir] of entries) {
      const av = getPath(a, k); const bv = getPath(b, k);
      const c = cmp(av, bv);
      if (c === null) { if ((av == null) !== (bv == null)) return (av == null ? -1 : 1) * dir; continue; }
      if (c !== 0) return c * dir;
    }
    return 0;
  });
}
const shape = (doc, opts) => {
  let out = clone(doc);
  if (opts.select) {
    // Same rules as MongoDB projections: a list of fields to keep, or "-field" / {field: 0} to drop; not both.
    const entries = typeof opts.select === 'string'
      ? opts.select.split(/\s+/).filter(Boolean).map((t) => (t.startsWith('-') ? [t.slice(1), 0] : [t.replace(/^\+/, ''), 1]))
      : Object.entries(opts.select).map(([k, v]) => [k, v ? 1 : 0]);
    const nonId = entries.filter(([k]) => k !== '_id');
    const includes = nonId.filter(([, v]) => v === 1).map(([k]) => k);
    const excludes = entries.filter(([, v]) => v === 0).map(([k]) => k);
    if (includes.length && nonId.some(([, v]) => v === 0)) throw new Error('fakeMongoose: cannot mix included and excluded fields in select() (MongoDB rejects this)');
    if (includes.length) out = Object.fromEntries(Object.entries(out).filter(([k]) => k === '_id' || includes.includes(k)));
    else out = Object.fromEntries(Object.entries(out).filter(([k]) => !excludes.includes(k)));
  }
  return opts.lean ? out : withToObject(out);
};

// ---------- Model ---------------------------------------------------------------------------------
function createModel(name, schema, collectionName) {
  const collection = collectionName;
  const model = class {
    static modelName = name;
    static schema = schema;
    static collection = { name: collectionName };

    static find(filter = {}) {
      const f = castFilter(schema, filter);
      return new Query(async (opts) => {
        let docs = docsOf(collection).filter((d) => matches(d, f));
        if (opts.sort) docs = sortDocs(docs, opts.sort);
        docs = docs.slice(opts.skip, opts.limit ? opts.skip + opts.limit : undefined);
        return docs.map((d) => shape(d, opts));
      });
    }
    static findOne(filter = {}) {
      const f = castFilter(schema, filter);
      return new Query(async (opts) => {
        let docs = docsOf(collection).filter((d) => matches(d, f));
        if (opts.sort) docs = sortDocs(docs, opts.sort);
        return docs.length ? shape(docs[0], opts) : null;
      });
    }
    static countDocuments(filter = {}) {
      const f = castFilter(schema, filter);
      return new Query(async () => docsOf(collection).filter((d) => matches(d, f)).length);
    }
    static async create(input) {
      const many = Array.isArray(input);
      const out = [];
      for (const item of many ? input : [input]) {
        const doc = build(model, item);
        checkUnique(model, doc, null);
        docsOf(collection).push(doc);
        out.push(withToObject(doc));
      }
      return many ? out : out[0];
    }
    static async insertMany(items) {
      return model.create(items);
    }
    static exists(filter = {}) {
      const f = castFilter(schema, filter);
      return new Query(async () => {
        const d = docsOf(collection).find((x) => matches(x, f));
        return d ? { _id: d._id } : null;
      });
    }
    static async createCollection() { docsOf(collection); return model; }
    static async createIndexes() { return undefined; }
    static updateOne(filter, update, options = {}) {
      checkOptions(options);
      const f = castFilter(schema, filter);
      return new Query(async () => {
        const target = docsOf(collection).find((d) => matches(d, f));
        if (!target) return { acknowledged: true, matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
        const next = clone(target);
        applyUpdate(model, next, update);
        const changed = JSON.stringify(next) !== JSON.stringify(target);
        if (changed) { checkUnique(model, next, target); Object.keys(target).forEach((k) => delete target[k]); Object.assign(target, next); }
        return { acknowledged: true, matchedCount: 1, modifiedCount: changed ? 1 : 0, upsertedCount: 0 };
      });
    }
    static updateMany(filter, update, options = {}) {
      checkOptions(options);
      const f = castFilter(schema, filter);
      return new Query(async () => {
        const targets = docsOf(collection).filter((d) => matches(d, f));
        let modified = 0;
        for (const target of targets) {
          const next = clone(target);
          applyUpdate(model, next, update);
          if (JSON.stringify(next) !== JSON.stringify(target)) { checkUnique(model, next, target); Object.keys(target).forEach((k) => delete target[k]); Object.assign(target, next); modified += 1; }
        }
        return { acknowledged: true, matchedCount: targets.length, modifiedCount: modified, upsertedCount: 0 };
      });
    }
    static findOneAndUpdate(filter, update, options = {}) {
      checkOptions(options);
      const f = castFilter(schema, filter);
      return new Query(async (opts) => {
        const docs = docsOf(collection);
        const target = docs.find((d) => matches(d, f));
        const after = options.returnDocument === 'after';
        if (!target) {
          if (!options.upsert) return null;
          const seed = {};
          for (const [k, v] of Object.entries(f)) if (!k.startsWith('$') && !(v && typeof v === 'object' && !(v instanceof Date) && !(v instanceof ObjectId))) seed[k] = v;
          const doc = build(model, seed, { validate: false });
          applyUpdate(model, doc, update, { inserting: true });
          for (const [path, spec] of Object.entries(schema.paths)) {
            if (spec.required && (doc[path] === undefined || doc[path] === null || doc[path] === '')) throw validationError(`Path \`${path}\` is required.`);
          }
          checkUnique(model, doc, null);
          docs.push(doc);
          return after ? shape(doc, opts) : null;
        }
        const before = clone(target);
        const next = clone(target);
        applyUpdate(model, next, update);
        checkUnique(model, next, target);
        Object.keys(target).forEach((k) => delete target[k]); Object.assign(target, next);
        return shape(after ? target : before, opts);
      });
    }
    static deleteMany(filter = {}) {
      const f = castFilter(schema, filter);
      return new Query(async () => {
        const docs = docsOf(collection);
        const keep = docs.filter((d) => !matches(d, f));
        const deleted = docs.length - keep.length;
        store.set(collection, keep);
        return { acknowledged: true, deletedCount: deleted };
      });
    }
  };
  return model;
}

// ---------- the mongoose-shaped default export ---------------------------------------------------------
const models = {};
const connection = {
  readyState: 1,
  name: 'in-memory',
  collection(name) {
    return {
      async deleteMany() { store.set(name, []); return { deletedCount: 0 }; },
      async insertMany(docs) { docsOf(name).push(...docs.map((d) => { const c = clone(d); if (c._id === undefined) c._id = new ObjectId(); return c; })); return { insertedCount: docs.length }; },
      async createIndex() { return 'ok'; },
      find() { return { toArray: async () => docsOf(name).map(clone) }; },
      async countDocuments() { return docsOf(name).length; },
    };
  },
};

/** The same rule Mongoose's default pluralizer applies to the model names used here (Professor -> professors, ObserverMatch -> observermatches, Survey -> surveys). */
function pluralize(modelName) {
  const w = modelName.toLowerCase();
  if (/(x|ch|ss|sh)$/.test(w)) return `${w}es`;
  if (/([^aeiouy]|qu)y$/.test(w)) return `${w.slice(0, -1)}ies`;
  return `${w}s`;
}

const mongoose = {
  Schema,
  Types: { ObjectId },
  isValidObjectId,
  models,
  connection,
  // Like Mongoose: with no collection name given, the collection is the lower-cased, pluralised model name.
  model(name, schema, collection) { models[name] = createModel(name, schema, collection || pluralize(name)); return models[name]; },
  async connect() { connection.readyState = 1; return mongoose; },
  async disconnect() { connection.readyState = 0; },
  set() {},
  /** Test helper: wipe every collection. */
  __reset() { store.clear(); },
  __store: store,
};

module.exports = mongoose;
module.exports.default = mongoose;
module.exports.ObjectId = ObjectId;
module.exports.clone = clone;
module.exports.pluralize = pluralize;
