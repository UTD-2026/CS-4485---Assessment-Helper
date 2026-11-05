import Professor from "../models/Professor.js";
import { dueStatus } from "../services/dueStatus.js";
import { getCurrentCycleDoc } from "./cycleController.js";

// GET /api/professors?department=CS&hireLevel=assistant
export async function listProfessors(req, res) {
  const filter = {};
  if (req.query.department) filter.department = String(req.query.department).toUpperCase();
  if (req.query.hireLevel) filter.hireLevel = String(req.query.hireLevel);
  res.json(await Professor.find(filter).sort({ name: 1 }).lean());
}

// GET /api/professors/due  -> professors who are due or overdue for the current cycle
export async function listDueProfessors(req, res) {
  const cycle = await getCurrentCycleDoc();
  if (!cycle) return res.status(404).json({ error: "No evaluation cycle found" });

  const professors = await Professor.find().sort({ name: 1 }).lean();
  const due = professors
    .map((p) => ({ ...p, dueStatus: dueStatus(p, p.lastObserved, cycle.term) }))
    .filter((p) => p.dueStatus !== "not_due");

  res.json({ term: cycle.term, count: due.length, professors: due });
}

// GET /api/professors/:email
export async function getProfessor(req, res) {
  const prof = await Professor.findOne({ email: req.params.email.toLowerCase() }).lean();
  if (!prof) return res.status(404).json({ error: "Professor not found" });
  res.json(prof);
}
