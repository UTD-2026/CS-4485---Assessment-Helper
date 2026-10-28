// One pagination convention for every list that can grow:
//
//   GET /api/...?page=2&pageSize=25          page starts at 1; pageSize defaults to 25 and is capped at 100
//   -> { ..., pagination: { page, pageSize, total, totalPages, hasNext } }
//
// Lists that already existed (professors, sections, notifications) stay unpaged unless `page` or `pageSize` is sent, so the
// current frontend keeps working. New lists (audit log, course offerings, eligible faculty, survey responses) are always paged.
const { badRequest } = require('../middleware/errors');

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

function positiveInt(value, name, fallback, max) {
  if (value === undefined || value === '') return fallback;
  if (typeof value !== 'string' || !/^\d{1,9}$/.test(value) || Number(value) < 1) throw badRequest(`${name} must be a whole number of 1 or more.`);
  const n = Number(value);
  if (max && n > max) throw badRequest(`${name} can be at most ${max}.`);
  return n;
}

/** Reads ?page= and ?pageSize= (or ?limit=). `requested` tells an opt-in list whether the caller asked for paging at all. */
function parsePaging(query = {}, { defaultSize = DEFAULT_PAGE_SIZE, maxSize = MAX_PAGE_SIZE } = {}) {
  const sizeInput = query.pageSize !== undefined ? query.pageSize : query.limit;
  const page = positiveInt(query.page, 'page', 1);
  const pageSize = positiveInt(sizeInput, 'pageSize', defaultSize, maxSize);
  return {
    page, pageSize, skip: (page - 1) * pageSize, requested: query.page !== undefined || sizeInput !== undefined,
  };
}

const describe = (paging, total) => ({
  page: paging.page,
  pageSize: paging.pageSize,
  total,
  totalPages: Math.max(1, Math.ceil(total / paging.pageSize)),
  hasNext: paging.skip + paging.pageSize < total,
});

/** Slices an in-memory list. */
function paginate(items, paging) {
  return { items: items.slice(paging.skip, paging.skip + paging.pageSize), pagination: describe(paging, items.length) };
}

module.exports = {
  DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, parsePaging, paginate, describe,
};
