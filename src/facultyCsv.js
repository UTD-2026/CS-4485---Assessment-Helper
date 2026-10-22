const escapeCell = (value) => {
  let text = String(value ?? '');
  // Keep spreadsheet applications from interpreting text as formulas.
  if (/^[\s]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
};

export function createFacultyCsv(faculty) {
  const rows = [
    ['Professor', 'Department', 'Level', 'Last Evaluation', 'Status'],
    ...faculty.map(professor => [
      professor.name,
      professor.department,
      professor.hire_level,
      professor.last_evaluation || 'None',
      professor.status === 'Overdue'
        ? `Overdue (${professor.overdue_by} sem)`
        : professor.status,
    ]),
  ];
  return createCsv(rows);
}

export function createCsv(rows) {
  // The UTF-8 BOM preserves accented names when opened in Excel.
  return '\uFEFF' + rows.map(row => row.map(escapeCell).join(',')).join('\r\n') + '\r\n';
}

export function downloadCsv(rows, filename) {
  const url = URL.createObjectURL(new Blob([createCsv(rows)], { type: 'text/csv;charset=utf-8;' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
