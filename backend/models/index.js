const mongoose = require("mongoose");

const { Schema } = mongoose;

// Professor
const professorSchema = new Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  name: { type: String, required: true },
  department: { type: String, required: true },
  hire_level: { type: String, required: true },
  last_observed: { type: Date, default: null },
  password_hash: { type: String, required: true },
  is_ac_member: { type: Boolean, default: false },
});

// Course Section
const courseSectionSchema = new Schema({
  course_code: { type: String, required: true },
  section_number: { type: String, required: true },
  term: { type: String, required: true },
  timing: { type: String, required: true },
  instructor_email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
  },
});

courseSectionSchema.index(
  { course_code: 1, section_number: 1, term: 1 },
  { unique: true }
);

// Evaluation Cycle
const evaluationCycleSchema = new Schema({
  term: { type: String, required: true, unique: true },
  signup_deadline: { type: Date, required: true },
  observation_deadline: { type: Date, required: true },
  feedback_deadline: { type: Date, required: true },
});

// Observation
const observationSchema = new Schema({
  course_code: { type: String, required: true },
  section_number: { type: String, required: true },
  term: { type: String, required: true },
  observer_email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
  },
  signup_date: { type: Date, default: null },
  observation_date: { type: Date, default: null },
  status: { type: String, required: true },
  observer_signed_date: { type: Date, default: null },
  observee_signed_date: { type: Date, default: null },
  ratings: { type: Schema.Types.Mixed, default: null },
});

observationSchema.index(
  { course_code: 1, section_number: 1, term: 1 },
  { unique: true }
);

// Observer Match
const observerMatchSchema = new Schema({
  course_code: { type: String, required: true },
  section_number: { type: String, required: true },
  term: { type: String, required: true },
  observer_email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
  },
  requested_date: { type: Date, required: true },
  status: { type: String, required: true },
});

observerMatchSchema.index(
  {
    course_code: 1,
    section_number: 1,
    term: 1,
    observer_email: 1,
  },
  { unique: true }
);

// Survey
const surveySchema = new Schema({
  professor_email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
  },
  term: { type: String, required: true },
  process_rating: { type: Number, default: null },
  positive_feedback: { type: String, default: "" },
  negative_feedback: { type: String, default: "" },
  uploaded_file: { type: String, default: null },
  submitted_date: { type: Date, default: null },
});

surveySchema.index(
  { professor_email: 1, term: 1 },
  { unique: true }
);

module.exports = {
  Professor: mongoose.model("Professor", professorSchema),
  CourseSection: mongoose.model("CourseSection", courseSectionSchema),
  EvaluationCycle: mongoose.model("EvaluationCycle", evaluationCycleSchema),
  Observation: mongoose.model("Observation", observationSchema),
  ObserverMatch: mongoose.model("ObserverMatch", observerMatchSchema),
  Survey: mongoose.model("Survey", surveySchema),
};
