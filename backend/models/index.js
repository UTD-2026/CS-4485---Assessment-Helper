const mongoose = require("mongoose");

const { Schema } = mongoose;

// Shared email field definition (all people are keyed by their UTD email).
const emailField = (required = true) => ({
  type: String,
  required,
  lowercase: true,
  trim: true,
});

// Professor
const professorSchema = new Schema({
  email: { ...emailField(), unique: true },
  name: { type: String, required: true },
  department: { type: String, required: true },
  hire_level: { type: String, required: true }, // assistant | associate | full
  last_observed: { type: Date, default: null },
  password_hash: { type: String, required: true },
  is_ac_member: { type: Boolean, default: false },
});

// Course Section
const courseSectionSchema = new Schema({
  course_code: { type: String, required: true },
  section_number: { type: String, required: true },
  term: { type: String, required: true },
  timing: { type: String, required: true }, // e.g. "MW 08:30-09:45"
  instructor_email: emailField(),
});

courseSectionSchema.index(
  { course_code: 1, section_number: 1, term: 1 },
  { unique: true }
);
courseSectionSchema.index({ term: 1, instructor_email: 1 });

// Evaluation Cycle
const evaluationCycleSchema = new Schema({
  term: { type: String, required: true, unique: true },
  signup_deadline: { type: Date, required: true },
  observation_deadline: { type: Date, required: true },
  feedback_deadline: { type: Date, required: true },
  // Optional time each deadline closes on its date ("HH:MM", 24-hour, server local time). null = 11:59 PM.
  signup_deadline_time: { type: String, default: null },
  observation_deadline_time: { type: String, default: null },
  feedback_deadline_time: { type: String, default: null },
});

// Observation (one per signed-up course section per term)
// Status lifecycle (see services/observationStateMachine.js):
//   signed_up | unmatched -> matched -> scheduled -> awaiting_confirmation -> completed
//   (missed and deferred can be reported along the way)
const observationSchema = new Schema({
  course_code: { type: String, required: true },
  section_number: { type: String, required: true },
  term: { type: String, required: true },
  // Null until the final observer is selected
  observer_email: { ...emailField(false), default: null },
  signup_date: { type: Date, default: null },
  observation_date: { type: Date, default: null },
  observation_time: { type: String, default: null }, // "HH:MM" (24h) class start time
  status: { type: String, required: true },
  observer_signed_date: { type: Date, default: null },
  observee_signed_date: { type: Date, default: null },
  // { [criterionId]: number | { rating, notes } }
  ratings: { type: Schema.Types.Mixed, default: null },

  // Observer list generation / release (POST generate-observer-list / release-observer-list)
  match_flag: { type: String, default: null }, // OK | INSUFFICIENT_OBSERVERS | NO_ELIGIBLE_OBSERVER
  list_generated_date: { type: Date, default: null },
  list_released_date: { type: Date, default: null },
  selected_manually: { type: Boolean, default: false },

  // Digital evaluation form (PATCH .../form)
  evaluation_items: { type: Schema.Types.Mixed, default: null }, // criteria snapshot at submission time
  evaluation_submitted_date: { type: Date, default: null },
  evaluation_draft: { type: Schema.Types.Mixed, default: null },
  evaluation_draft_saved: { type: Date, default: null },

  // Did-not-happen / could-not-complete reporting
  missed_reason: { type: String, default: null },
  missed_reported_by: { ...emailField(false), default: null },
  missed_date: { type: Date, default: null },
  deferral_reason: { type: String, default: null },
  deferred_by: { ...emailField(false), default: null },
});

observationSchema.index(
  { course_code: 1, section_number: 1, term: 1 },
  { unique: true }
);
observationSchema.index({ term: 1, observer_email: 1 });

// Observer Match (candidate list + requests for one observation)
// Status lifecycle: suggested -> requested -> accepted | declined -> confirmed | cancelled
const observerMatchSchema = new Schema({
  course_code: { type: String, required: true },
  section_number: { type: String, required: true },
  term: { type: String, required: true },
  observer_email: emailField(),
  requested_date: { type: Date, default: null },
  responded_date: { type: Date, default: null },
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
observerMatchSchema.index({ term: 1, observer_email: 1 });

// Survey (professor_email is only used to stop duplicate submissions;
// it is never returned by GET /api/surveys/responses)
const surveySchema = new Schema({
  professor_email: emailField(),
  term: { type: String, required: true },
  // Legacy seed fields
  process_rating: { type: Number, default: null },
  positive_feedback: { type: String, default: "" },
  negative_feedback: { type: String, default: "" },
  uploaded_file: { type: String, default: null },
  // Current survey form fields
  process_ok: { type: Boolean, default: null },
  difficulties: { type: String, default: "" },
  improvements: { type: String, default: "" },
  has_attachment: { type: Boolean, default: false },
  submitted_date: { type: Date, default: null },
});

surveySchema.index(
  { professor_email: 1, term: 1 },
  { unique: true }
);

// Notification (in-app inbox / archive)
const notificationSchema = new Schema({
  recipient_email: emailField(),
  message: { type: String, required: true },
  type: { type: String, default: "info" },
  read: { type: Boolean, default: false },
  archived: { type: Boolean, default: false },
  created_at: { type: Date, default: Date.now },
});

notificationSchema.index({ recipient_email: 1, created_at: -1 });

module.exports = {
  Professor: mongoose.model("Professor", professorSchema),
  CourseSection: mongoose.model("CourseSection", courseSectionSchema),
  EvaluationCycle: mongoose.model("EvaluationCycle", evaluationCycleSchema),
  Observation: mongoose.model("Observation", observationSchema),
  ObserverMatch: mongoose.model("ObserverMatch", observerMatchSchema),
  Survey: mongoose.model("Survey", surveySchema),
  Notification: mongoose.model("Notification", notificationSchema),
};
