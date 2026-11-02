// 7. Reports and KPIs (committee only)
const express = require("express");
const { Survey } = require("../models");
const { loadTermContext, resolveTerm } = require("../services/context");
const { computeKpis, outstandingObservations, unmatchedFaculty } = require("../services/kpis");

const router = express.Router();

// GET /api/reports/kpis?term=
router.get("/kpis", async (req, res) => {
  const term = await resolveTerm(req.query.term);
  const [ctx, surveys] = await Promise.all([loadTermContext(term), Survey.find({ term }).select("professor_email").lean()]);
  res.json({ data: computeKpis(ctx, { surveys }) });
});

// GET /api/reports/outstanding-observations?term=
router.get("/outstanding-observations", async (req, res) => {
  const term = await resolveTerm(req.query.term);
  const { rows, byLevel } = outstandingObservations(await loadTermContext(term));
  res.json({ data: rows, meta: { term, total: rows.length, by_hire_level: byLevel } });
});

// GET /api/reports/unmatched-faculty?term=  (&include=all_due for every due/overdue professor without an observer)
router.get("/unmatched-faculty", async (req, res) => {
  const term = await resolveTerm(req.query.term);
  const rows = unmatchedFaculty(await loadTermContext(term), { includeAllDue: req.query.include === "all_due" });
  res.json({ data: rows, meta: { term, total: rows.length } });
});

module.exports = router;
