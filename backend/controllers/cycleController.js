import EvaluationCycle from "../models/EvaluationCycle.js";

// The "current" cycle = the one with the latest feedback deadline.
export async function getCurrentCycleDoc() {
  return EvaluationCycle.findOne().sort({ feedbackDeadline: -1 }).lean();
}

export async function getCurrentCycle(req, res) {
  const cycle = await getCurrentCycleDoc();
  if (!cycle) return res.status(404).json({ error: "No evaluation cycle found" });
  res.json(cycle);
}
