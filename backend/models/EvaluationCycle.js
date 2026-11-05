import mongoose from "mongoose";

const evaluationCycleSchema = new mongoose.Schema(
  {
    term: { type: String, required: true, unique: true }, // PK, e.g. "Fall 2026"
    signupDeadline: { type: Date, required: true },
    observationDeadline: { type: Date, required: true },
    feedbackDeadline: { type: Date, required: true },
  },
  { collection: "evaluationCycles", versionKey: false }
);

export default mongoose.model("EvaluationCycle", evaluationCycleSchema);
