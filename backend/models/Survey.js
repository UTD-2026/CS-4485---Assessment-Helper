import mongoose from "mongoose";

const surveySchema = new mongoose.Schema(
  {
    professorEmail: { type: String, required: true, lowercase: true },
    term: { type: String, required: true },
    processRating: { type: Number, min: 1, max: 5 },
    positiveFeedback: String,
    negativeFeedback: String,
    uploadedFile: { type: String, default: null },
    submittedDate: Date,
  },
  { collection: "surveys", versionKey: false }
);
surveySchema.index({ professorEmail: 1, term: 1 }, { unique: true }); // one survey per professor per cycle

export default mongoose.model("Survey", surveySchema);
