import mongoose from "mongoose";

export const OBSERVATION_STATUSES = ["signed_up", "unmatched", "scheduled", "completed", "missed"];

const observationSchema = new mongoose.Schema(
  {
    // One observation per section. The observee is the section's instructor.
    sectionId: { type: mongoose.Schema.Types.ObjectId, ref: "CourseSection", required: true, unique: true },
    observerEmail: { type: String, lowercase: true, default: null }, // null until a final observer is confirmed
    signupDate: { type: Date, required: true },
    observationDate: { type: Date, default: null },
    status: { type: String, enum: OBSERVATION_STATUSES, required: true },
    observerSignedDate: { type: Date, default: null },
    observeeSignedDate: { type: Date, default: null },
    ratings: { type: mongoose.Schema.Types.Mixed, default: null }, // JSON, 1-5 per criterion
  },
  { collection: "observations", versionKey: false }
);

export default mongoose.model("Observation", observationSchema);
