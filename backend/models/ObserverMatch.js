import mongoose from "mongoose";

export const MATCH_STATUSES = ["suggested", "requested", "confirmed", "declined"];

const observerMatchSchema = new mongoose.Schema(
  {
    sectionId: { type: mongoose.Schema.Types.ObjectId, ref: "CourseSection", required: true },
    observerEmail: { type: String, required: true, lowercase: true },
    requestedDate: { type: Date, default: null },
    status: { type: String, enum: MATCH_STATUSES, required: true },
  },
  { collection: "observerMatches", versionKey: false }
);
observerMatchSchema.index({ sectionId: 1, observerEmail: 1 }, { unique: true }); // composite PK

export default mongoose.model("ObserverMatch", observerMatchSchema);
