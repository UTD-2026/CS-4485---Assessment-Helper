const mongoose = require("mongoose");
const {
  FILE_KINDS,
  MATCH_STATUSES,
  OBSERVATION_STATUSES,
  VIOLATIONS,
} = require("../config/rules");

const { Schema } = mongoose;

// The six collections below are the team's schema (field names, keys and indexes unchanged).
// Fields and models marked "(added)" were added for the API; they are optional, and everything works
// when they are missing from older or seeded documents. Two existing fields are less strict than before:
//   observations.observer_email  no longer required  (a signup exists before any observer has said yes)
//   observerMatches.requested_date  no longer required  (a `suggested` row has not been requested yet)
// The team's own seed data has both situations, so the old rules could never have been enforced on it.

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
// (added) "everything one professor teaches in a term"
courseSectionSchema.index({ term: 1, instructor_email: 1 });

// Evaluation Cycle
const evaluationCycleSchema = new Schema({
  term: { type: String, required: true, unique: true },
  signup_deadline: { type: Date, required: true },
  observation_deadline: { type: Date, required: true },
  feedback_deadline: { type: Date, required: true },
});

// Observation: one signup and its observation, start to finish
const observationSchema = new Schema({
  course_code: { type: String, required: true },
  section_number: { type: String, required: true },
  term: { type: String, required: true },
  // Was required. Now null until the first observer confirms.
  observer_email: {
    type: String,
    default: null,
    lowercase: true,
    trim: true,
  },
  signup_date: { type: Date, default: null },
  observation_date: { type: Date, default: null },
  status: { type: String, required: true, enum: OBSERVATION_STATUSES },
  observer_signed_date: { type: Date, default: null },
  observee_signed_date: { type: Date, default: null },
  ratings: { type: Schema.Types.Mixed, default: null },
  // (added) -----------------------------------------------------------------------------------
  observee_email: { type: String, lowercase: true, trim: true }, // who signed up (also derivable from the section)
  record: { type: Schema.Types.Mixed, default: null }, // the in-app observation form copy (services/observationRecords.js)
  confirmed_date: { type: Date },
  completed_date: { type: Date },
  selection_run_date: { type: Date }, // when the eligible-observer list was generated
  candidate_count: { type: Number },
  eligible_count: { type: Number },
  list_notified_date: { type: Date },
  observation_time: { type: String, default: null }, // "08:30" - the class start time the observer will visit (24h)
  missed_reported_by: { type: String, default: null }, // who pressed "Did Not Happen"; null when the sweep marked it missed
  missed_reason: { type: String, default: null },
  missed_date: { type: Date, default: null },
  status_history: { type: [Schema.Types.Mixed], default: undefined }, // [{at, by, from, to, note}]
});

observationSchema.index(
  { course_code: 1, section_number: 1, term: 1 },
  { unique: true }
);
// (added) At most one signup per professor per term, enforced by the database for API-created signups
// (seeded documents have no observee_email, so the partial index ignores them).
observationSchema.index(
  { observee_email: 1, term: 1 },
  { unique: true, partialFilterExpression: { observee_email: { $type: "string" } } }
);
observationSchema.index({ status: 1, observation_date: 1 });

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
  // Was required. A `suggested` row (an observer on the list who has not been asked yet) has no request date; the
  // team's own seed data has 39 of them with requested_date null.
  requested_date: { type: Date, default: null },
  status: { type: String, required: true, enum: MATCH_STATUSES },
  // (added) 48-hour expiry (TA Q&A) and when the observer answered
  expires_at: { type: Date, default: null },
  responded_date: { type: Date, default: null },
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
observerMatchSchema.index({ status: 1, expires_at: 1 });
observerMatchSchema.index({ observer_email: 1 });

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

// (added) SurveyTemplate: the versioned question list for the end-of-process survey (questions are embedded) -----------
const surveyTemplateSchema = new Schema({
  template_id: { type: String, required: true },
  version: { type: Number, required: true },
  title: { type: String, required: true },
  active: { type: Boolean, default: true },
  questions: { type: [Schema.Types.Mixed], default: [] }, // [{key, label, type: yes_no|rating|text, required, min, max, max_length}]
  created_at: { type: Date, default: null },
});
surveyTemplateSchema.index({ template_id: 1, version: 1 }, { unique: true });

// (added) SurveyResponse: the ANSWERS, with no identity and no timestamp --------------------------------------------
// The `surveys` collection above is only the "who finished" ledger. An answer row has a random _id (not an ObjectId, which
// would carry its creation time) and nothing that points at a person. See services/surveys.js.
const surveyResponseSchema = new Schema({
  _id: { type: String, required: true }, // random UUID
  term: { type: String, required: true },
  template_id: { type: String, required: true },
  template_version: { type: Number, required: true },
  answers: { type: Schema.Types.Mixed, default: {} },
  has_attachment: { type: Boolean, default: false },
});
surveyResponseSchema.index({ term: 1 });

// (added) AuditLog: who did what, when. Append-only; never records survey authorship ------------------------------------
const auditLogSchema = new Schema({
  at: { type: Date, required: true },
  actor_email: { type: String, default: null, lowercase: true, trim: true }, // null = the system (sweeps, seed)
  actor_role: { type: String, default: 'system' }, // professor | committee | system
  action: { type: String, required: true }, // e.g. observation.signed
  target_type: { type: String, default: null }, // observation | observer_match | cycle | form | ...
  target_id: { type: String, default: null }, // a sectionId, a term, a form id
  term: { type: String, default: null },
  detail: { type: Schema.Types.Mixed, default: null },
});
auditLogSchema.index({ at: -1 });
auditLogSchema.index({ actor_email: 1, at: -1 });
auditLogSchema.index({ action: 1, at: -1 });

// (added) EvaluationForm: the Observation Template the AC edits (every edit is a new version) ----------------
const evaluationFormSchema = new Schema(
  {
    form_id: { type: String, required: true, unique: true },
    title: { type: String, required: true },
    version: { type: Number, required: true, default: 1 },
    fields: { type: [Schema.Types.Mixed], default: [] },
    updated_by: { type: String },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

// (added) Notification: in-app only; change services/notifications.js to send real email -----------------------
const notificationSchema = new Schema({
  recipient_email: { type: String, required: true, lowercase: true, trim: true },
  type: { type: String, required: true },
  message: { type: String, required: true },
  // The course section the message is about, when there is one.
  course_code: { type: String },
  section_number: { type: String },
  term: { type: String },
  read_at: { type: Date, default: null },
  created_at: { type: Date, required: true },
});
notificationSchema.index({ recipient_email: 1, created_at: -1 });

// (added) EligibilityViolation: requests rejected because the pairing broke a rule ---------------------------------
const eligibilityViolationSchema = new Schema({
  course_code: { type: String, required: true },
  section_number: { type: String, required: true },
  term: { type: String, required: true },
  observer_email: { type: String, required: true, lowercase: true, trim: true },
  violation: { type: String, required: true, enum: VIOLATIONS },
  context: { type: String },
  created_at: { type: Date, required: true },
});
eligibilityViolationSchema.index({ term: 1 });

// (added) ObservationFile: the signed observation form the observer uploads ("My Duties") ---------------------------
// One file per observation and kind; uploading again replaces it (version counts the uploads).
// The PDF is stored as base64 text in `data_base64` (not a Buffer) so it behaves identically with .lean().
// NOTE: `version` has no schema default on purpose - the upload uses $inc on it, and a default would make
// Mongoose add the same path to $setOnInsert and MongoDB would reject the update as a conflict.
const observationFileSchema = new Schema({
  course_code: { type: String, required: true },
  section_number: { type: String, required: true },
  term: { type: String, required: true },
  kind: { type: String, required: true, enum: FILE_KINDS },
  filename: { type: String, required: true },
  content_type: { type: String, required: true },
  size: { type: Number, required: true },
  sha256: { type: String, required: true },
  data_base64: { type: String, required: true },
  uploaded_by: { type: String, required: true },
  uploaded_at: { type: Date, required: true },
  first_uploaded_at: { type: Date },
  version: { type: Number },
});
observationFileSchema.index(
  { course_code: 1, section_number: 1, term: 1, kind: 1 },
  { unique: true }
);

const model = (name, schema) => mongoose.models[name] || mongoose.model(name, schema);

module.exports = {
  Professor: model("Professor", professorSchema),
  CourseSection: model("CourseSection", courseSectionSchema),
  EvaluationCycle: model("EvaluationCycle", evaluationCycleSchema),
  Observation: model("Observation", observationSchema),
  ObserverMatch: model("ObserverMatch", observerMatchSchema),
  Survey: model("Survey", surveySchema),
  EvaluationForm: model("EvaluationForm", evaluationFormSchema),
  Notification: model("Notification", notificationSchema),
  EligibilityViolation: model("EligibilityViolation", eligibilityViolationSchema),
  ObservationFile: model("ObservationFile", observationFileSchema),
  SurveyTemplate: model("SurveyTemplate", surveyTemplateSchema),
  SurveyResponse: model("SurveyResponse", surveyResponseSchema),
  AuditLog: model("AuditLog", auditLogSchema),
};
