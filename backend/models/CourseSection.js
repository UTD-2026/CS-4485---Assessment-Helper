import mongoose from "mongoose";

const courseSectionSchema = new mongoose.Schema(
  {
    // _id is the section_id (PK)
    courseCode: { type: String, required: true },
    courseLevel: Number, // extra: 1-6, derived from courseCode (used for matching)
    sectionNumber: { type: String, required: true },
    term: { type: String, required: true }, // FK -> EvaluationCycle.term
    timing: { type: String, required: true }, // e.g. "MW 10:00-11:15"
    days: String, // extra: structured copy of timing for conflict checks
    startTime: String,
    endTime: String,
    instructorEmail: { type: String, required: true, lowercase: true }, // FK -> Professor.email
  },
  { collection: "courseSections", versionKey: false }
);

export default mongoose.model("CourseSection", courseSectionSchema);
