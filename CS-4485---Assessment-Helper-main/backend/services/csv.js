// Tiny CSV writer for the Assessment Committee's exports (opens correctly in Excel and Google Sheets).
//  - RFC 4180 quoting; CRLF line endings; a UTF-8 byte-order mark so Excel reads accents correctly.
//  - Spreadsheet formula injection guard: a TEXT cell that starts with = + - @ (or a tab / carriage return) gets a
//    leading apostrophe, so a name like "=HYPERLINK(...)" is shown as text instead of being run. Numbers are untouched.
const NEEDS_QUOTES = /[",\r\n]/;
const FORMULA_START = /^[=+\-@\t\r]/;

function csvCell(value) {
  if (value === null || value === undefined) return '';
  let text;
  if (value instanceof Date) text = Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10);
  else if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  else if (typeof value === 'boolean') return value ? 'true' : 'false';
  else text = String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  return NEEDS_QUOTES.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * @param columns  [{label: 'Name', value: (row) => row.name}]   (or {label, key})
 * @param rows     array of any objects
 */
function toCsv(columns, rows) {
  const read = (col, row) => (typeof col.value === 'function' ? col.value(row) : row[col.key]);
  const lines = [columns.map((c) => csvCell(c.label)).join(',')];
  for (const row of rows) lines.push(columns.map((c) => csvCell(read(c, row))).join(','));
  return `﻿${lines.join('\r\n')}\r\n`;
}

module.exports = {
  csvCell,
  toCsv,
};
