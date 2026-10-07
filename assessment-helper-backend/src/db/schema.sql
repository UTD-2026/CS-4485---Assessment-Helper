-- =====================================================================
-- Assessment Helper — Core Relational Schema (v2)
--
-- v2 incorporates the detailed business rules gathered after the
-- initial 7-step build: semester-based due/overdue calculation, the
-- Assessment Committee (AC) semester workflow, course-level/department
-- eligibility matching, the signup -> request -> confirm -> select
-- flow, physical sign-off tracking, and the KPI definitions given.
--
-- This file is written to be applied to a FRESH database. If you
-- already ran v1's schema.sql, drop and recreate the schema first:
--   DROP SCHEMA public CASCADE; CREATE SCHEMA public;
-- (v1 and v2 model evaluation_cycle differently enough that an in-place
-- ALTER migration would be messier than a clean re-apply for a project
-- at this stage.)
--
-- Design notes:
--   * All primary keys use UUID (gen_random_uuid).
--   * Enum types encode every workflow state.
--   * created_at / updated_at are present on every table; kept current
--     by a shared trigger function.
--   * "Semester" is modeled as (term, year) rather than a plain date, so
--     the due/overdue math in src/services/dueStatusCalculator.js can
--     reason about calendar-year and same-term-N-years-later rules
--     exactly as specified by the Assessment Committee.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid()

-- ---------------------------------------------------------------------
-- ENUM TYPES
-- ---------------------------------------------------------------------

DO $$ BEGIN
    CREATE TYPE hiring_level_enum AS ENUM (
        'ADJUNCT',
        'LECTURER',
        'SENIOR_LECTURER',
        'ASSISTANT_PROFESSOR',
        'ASSOCIATE_PROFESSOR',
        'PROFESSOR'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE academic_term_enum AS ENUM ('SPRING', 'SUMMER', 'FALL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Evaluation cadence is stored as a plain integer
-- (scheduling_rule.years_between_evaluations) rather than a named
-- frequency enum — "annual"/"biennial" don't generalize cleanly once a
-- Summer term exists, so there is no cycle_frequency_enum in this
-- schema; see src/services/dueStatusCalculator.js for the math.
-- NOT_YET_DUE  -> anniversary hasn't arrived yet
-- DUE          -> teacher is inside their due window this semester
-- OVERDUE      -> due window passed with no COMPLETED observation
-- COMPLETED    -> evaluation satisfied for this window
-- WAIVED       -> AC manually excused this teacher for this cycle
DO $$ BEGIN
    CREATE TYPE evaluation_cycle_status_enum AS ENUM (
        'NOT_YET_DUE',
        'DUE',
        'OVERDUE',
        'COMPLETED',
        'WAIVED'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE assessment_cycle_status_enum AS ENUM (
        'OPEN_FOR_SIGNUP',
        'OBSERVER_SELECTION',
        'OBSERVATION_PERIOD',
        'SURVEY_PERIOD',
        'CLOSED'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE signup_status_enum AS ENUM (
        'SUBMITTED',
        'OBSERVERS_GENERATED',
        'REQUESTS_SENT',
        'OBSERVER_CONFIRMED',
        'COMPLETED',
        'CANCELLED'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE observation_request_status_enum AS ENUM (
        'PENDING',
        'OBSERVER_CONFIRMED',
        'OBSERVER_DECLINED',
        'SELECTED',
        'NOT_SELECTED',
        'CANCELLED',
        'EXPIRED'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE observation_status_enum AS ENUM (
        'PROPOSED',
        'CONFIRMED',
        'SUBMITTED',
        'COMPLETED',
        'CANCELLED'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------
-- SHARED TRIGGER FUNCTION: keep updated_at current on every UPDATE
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------
-- TABLE: department
--   A real reference table instead of a freeform department code on
--   every teacher/course_section row — normalizes department naming and
--   lets department.department_code be validated by foreign key rather
--   than by convention.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS department (
    department_code   VARCHAR(10) PRIMARY KEY,
    department_name   VARCHAR(100) NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Reference data, not fake/demo data — every department course sections
-- and teachers might belong to. Add more rows here as the catalog grows.
INSERT INTO department (department_code, department_name) VALUES
    ('CS',   'Computer Science'),
    ('MATH', 'Mathematics'),
    ('EE',   'Electrical Engineering'),
    ('PHYS', 'Physics')
ON CONFLICT (department_code) DO NOTHING;

-- ---------------------------------------------------------------------
-- TABLE: teacher
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS teacher (
    teacher_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name       VARCHAR(150)        NOT NULL,
    email           VARCHAR(255)        NOT NULL UNIQUE,
    hiring_level    hiring_level_enum   NOT NULL,
    department      VARCHAR(10)         NOT NULL DEFAULT 'CS' REFERENCES department (department_code) ON DELETE RESTRICT,
    is_ac_member    BOOLEAN             NOT NULL DEFAULT FALSE,
    focus_areas     TEXT[]              NOT NULL DEFAULT '{}',   -- retained for future recommendation tie-breaks; not used for eligibility
    hire_date       DATE                NOT NULL,
    is_active       BOOLEAN             NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ         NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ         NOT NULL DEFAULT now(),

    CONSTRAINT teacher_email_format_chk CHECK (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);

CREATE INDEX IF NOT EXISTS idx_teacher_hiring_level ON teacher (hiring_level);
CREATE INDEX IF NOT EXISTS idx_teacher_department    ON teacher (department);

DROP TRIGGER IF EXISTS trg_teacher_updated_at ON teacher;
CREATE TRIGGER trg_teacher_updated_at
    BEFORE UPDATE ON teacher
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------
-- TABLE: course_section
--   department + course_level drive the eligibility rule: an observer
--   must teach at the same level, in the same department, as the
--   observee's selected course.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS course_section (
    section_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_number       VARCHAR(20)   NOT NULL,        -- e.g. 'CS 4485'
    course_title        VARCHAR(200)  NOT NULL,
    section_number      VARCHAR(10)   NOT NULL,        -- e.g. '001'
    semester             VARCHAR(10)   NOT NULL,        -- display code e.g. '26F' (see academic_term/year below for logic)
    term                academic_term_enum NOT NULL,
    year                SMALLINT      NOT NULL,
    department          VARCHAR(10)   NOT NULL DEFAULT 'CS' REFERENCES department (department_code) ON DELETE RESTRICT,
    course_level        SMALLINT      NOT NULL,         -- e.g. 1000, 2000, 4000, 6000
    instructor_id       UUID          REFERENCES teacher (teacher_id) ON DELETE SET NULL,
    meeting_days        VARCHAR(10),                    -- e.g. 'MWF', 'TuTh'
    start_time          TIME          NOT NULL,          -- e.g. 10:00 — real TIME columns so schedule-conflict checks are exact, not string-parsed
    end_time            TIME          NOT NULL,          -- e.g. 10:50
    location            VARCHAR(80),
    source              VARCHAR(20)   NOT NULL DEFAULT 'MANUAL'
                          CHECK (source IN ('MANUAL', 'COURSE_BOOK_API', 'SEED')),
    external_reference  VARCHAR(100),
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),

    CONSTRAINT course_section_unique_offering
        UNIQUE (course_number, section_number, semester),
    CONSTRAINT course_section_time_order_chk CHECK (end_time > start_time)
);

CREATE INDEX IF NOT EXISTS idx_course_section_instructor ON course_section (instructor_id);
CREATE INDEX IF NOT EXISTS idx_course_section_semester   ON course_section (term, year);
CREATE INDEX IF NOT EXISTS idx_course_section_dept_level ON course_section (department, course_level);

DROP TRIGGER IF EXISTS trg_course_section_updated_at ON course_section;
CREATE TRIGGER trg_course_section_updated_at
    BEFORE UPDATE ON course_section
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------
-- TABLE: scheduling_rule
--   years_between_evaluations is a plain integer (1, 2, 3, 5, ...)
--   rather than a named frequency — with three terms per year (Spring/
--   Summer/Fall), words like "annual" or "biennial" stop being precise
--   ("annual" = 3 terms now, not 2), so the cadence is just a number of
--   years and due_window_terms is a plain number of terms. Per the AC's
--   rules: a 1-year cadence gets a 3-term window (any term of the next
--   calendar year satisfies it, since a year now has three terms); every
--   longer cadence gets a 1-term window (must land on the exact same
--   term N years later). See src/services/dueStatusCalculator.js.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS scheduling_rule (
    rule_id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hiring_level                    hiring_level_enum      NOT NULL,
    years_between_evaluations       SMALLINT               NOT NULL CHECK (years_between_evaluations > 0),
    due_window_terms                SMALLINT               NOT NULL DEFAULT 1 CHECK (due_window_terms > 0),
    required_observations_per_cycle SMALLINT               NOT NULL DEFAULT 1
                                       CHECK (required_observations_per_cycle > 0),
    description                     TEXT,
    is_active                       BOOLEAN                NOT NULL DEFAULT TRUE,
    created_at                      TIMESTAMPTZ            NOT NULL DEFAULT now(),
    updated_at                      TIMESTAMPTZ            NOT NULL DEFAULT now(),

    CONSTRAINT scheduling_rule_unique_active_level
        UNIQUE (hiring_level, is_active) DEFERRABLE INITIALLY DEFERRED
);

DROP TRIGGER IF EXISTS trg_scheduling_rule_updated_at ON scheduling_rule;
CREATE TRIGGER trg_scheduling_rule_updated_at
    BEFORE UPDATE ON scheduling_rule
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------
-- TABLE: assessment_cycle
--   One semester-wide administrative cycle, kicked off by an AC member.
--   Holds the three deadlines the AC controls: signup, observation
--   period, and survey.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS assessment_cycle (
    assessment_cycle_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    term                        academic_term_enum NOT NULL,
    year                        SMALLINT NOT NULL,
    signup_deadline             DATE NOT NULL,
    observation_period_deadline DATE NOT NULL,
    survey_deadline             DATE NOT NULL,
    kicked_off_by               UUID REFERENCES teacher (teacher_id) ON DELETE SET NULL,
    status                      assessment_cycle_status_enum NOT NULL DEFAULT 'OPEN_FOR_SIGNUP',
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT assessment_cycle_unique_term_year UNIQUE (term, year),
    CONSTRAINT assessment_cycle_deadline_order CHECK (
        signup_deadline <= observation_period_deadline
        AND observation_period_deadline <= survey_deadline
    )
);

DROP TRIGGER IF EXISTS trg_assessment_cycle_updated_at ON assessment_cycle;
CREATE TRIGGER trg_assessment_cycle_updated_at
    BEFORE UPDATE ON assessment_cycle
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------
-- TABLE: evaluation_cycle
--   The computed due/overdue status of ONE teacher for ONE semester.
--   Keyed naturally by (teacher_id, term, year) rather than a surrogate
--   ID — a teacher has at most one evaluation_cycle row per semester by
--   definition, so a generated cycle_id added nothing. (term, year) is
--   also a composite foreign key into assessment_cycle, which is the
--   authority on that semester's deadlines. Rows are created/refreshed
--   by evaluationCycleService.ensureEvaluationCycle() rather than
--   hand-written.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS evaluation_cycle (
    teacher_id           UUID  NOT NULL REFERENCES teacher (teacher_id) ON DELETE RESTRICT,
    term                 academic_term_enum NOT NULL,   -- the semester this status was computed for
    year                 SMALLINT NOT NULL,
    rule_id              UUID  NOT NULL REFERENCES scheduling_rule (rule_id) ON DELETE RESTRICT,
    anniversary_term     academic_term_enum NOT NULL,   -- the term this teacher's due-window is anchored to
    anniversary_year     SMALLINT NOT NULL,
    status               evaluation_cycle_status_enum NOT NULL DEFAULT 'NOT_YET_DUE',
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (teacher_id, term, year),
    CONSTRAINT evaluation_cycle_assessment_cycle_fk FOREIGN KEY (term, year)
        REFERENCES assessment_cycle (term, year) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_evaluation_cycle_status  ON evaluation_cycle (status);
CREATE INDEX IF NOT EXISTS idx_evaluation_cycle_term    ON evaluation_cycle (term, year);

DROP TRIGGER IF EXISTS trg_evaluation_cycle_updated_at ON evaluation_cycle;
CREATE TRIGGER trg_evaluation_cycle_updated_at
    BEFORE UPDATE ON evaluation_cycle
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------
-- TABLE: signup
--   An Observee's signup for exactly one course section within one
--   assessment cycle (current spec: one course per Observee per cycle).
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS signup (
    signup_id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assessment_cycle_id        UUID NOT NULL REFERENCES assessment_cycle (assessment_cycle_id) ON DELETE RESTRICT,
    observee_teacher_id        UUID NOT NULL REFERENCES teacher (teacher_id) ON DELETE RESTRICT,
    course_section_id          UUID NOT NULL REFERENCES course_section (section_id) ON DELETE RESTRICT,
    status                     signup_status_enum NOT NULL DEFAULT 'SUBMITTED',
    observer_candidate_count   SMALLINT NOT NULL DEFAULT 0,   -- size of the surfaced list (capped at 5)
    total_eligible_count       SMALLINT NOT NULL DEFAULT 0,   -- full eligible pool size before capping — denominator for the accuracy KPI
    has_sufficient_observers   BOOLEAN NOT NULL DEFAULT FALSE,
    created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT signup_unique_observee_per_cycle UNIQUE (assessment_cycle_id, observee_teacher_id)
);

CREATE INDEX IF NOT EXISTS idx_signup_cycle    ON signup (assessment_cycle_id);
CREATE INDEX IF NOT EXISTS idx_signup_observee ON signup (observee_teacher_id);
CREATE INDEX IF NOT EXISTS idx_signup_status   ON signup (status);

DROP TRIGGER IF EXISTS trg_signup_updated_at ON signup;
CREATE TRIGGER trg_signup_updated_at
    BEFORE UPDATE ON signup
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------
-- TABLE: observer_candidate
--   The system-generated shortlist (target size: 5) of eligible
--   observers for a signup, produced by the matching engine
--   (src/services/matchingService.js) once the signup deadline passes.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS observer_candidate (
    candidate_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    signup_id           UUID NOT NULL REFERENCES signup (signup_id) ON DELETE CASCADE,
    candidate_teacher_id UUID NOT NULL REFERENCES teacher (teacher_id) ON DELETE RESTRICT,
    rank                 SMALLINT NOT NULL,
    generated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT observer_candidate_unique UNIQUE (signup_id, candidate_teacher_id)
);

CREATE INDEX IF NOT EXISTS idx_observer_candidate_signup ON observer_candidate (signup_id);

-- ---------------------------------------------------------------------
-- TABLE: observation_request
--   An Observee's request to one candidate observer. Multiple requests
--   per signup are allowed; the Observee ultimately SELECTs exactly one
--   confirmed request, which materializes an observation_assignment row.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS observation_request (
    request_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    signup_id              UUID NOT NULL REFERENCES signup (signup_id) ON DELETE CASCADE,
    observer_teacher_id    UUID NOT NULL REFERENCES teacher (teacher_id) ON DELETE RESTRICT,
    requested_days         VARCHAR(10) NOT NULL,   -- copied from the observee's course section at request time
    requested_start_time   TIME NOT NULL,
    requested_end_time     TIME NOT NULL,
    status                 observation_request_status_enum NOT NULL DEFAULT 'PENDING',
    responded_at           TIMESTAMPTZ,
    -- TA Q&A: "Typical expectation is people respond within 48 hours. So,
    -- by that expectation, invitations should expire after 48 hours."
    expires_at             TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '48 hours'),
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT observation_request_unique UNIQUE (signup_id, observer_teacher_id)
);

CREATE INDEX IF NOT EXISTS idx_observation_request_signup   ON observation_request (signup_id);
CREATE INDEX IF NOT EXISTS idx_observation_request_observer ON observation_request (observer_teacher_id);
CREATE INDEX IF NOT EXISTS idx_observation_request_status   ON observation_request (status);
CREATE INDEX IF NOT EXISTS idx_observation_request_expires  ON observation_request (status, expires_at) WHERE status = 'PENDING';

DROP TRIGGER IF EXISTS trg_observation_request_updated_at ON observation_request;
CREATE TRIGGER trg_observation_request_updated_at
    BEFORE UPDATE ON observation_request
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------
-- TABLE: observation_assignment
--   The single, finalized observer<->observee pairing for a signup,
--   created the moment the Observee selects a confirmed
--   observation_request. Carries the state machine from Step 6 plus the
--   physical sign-off timestamps required by the observation-day
--   workflow. (term, year) + observee_teacher_id is a composite foreign
--   key into evaluation_cycle, replacing the old surrogate cycle_id.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS observation_assignment (
    assignment_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    term                     academic_term_enum NOT NULL,  -- the evaluation_cycle semester this assignment satisfies
    year                     SMALLINT NOT NULL,
    signup_id               UUID REFERENCES signup (signup_id) ON DELETE SET NULL,
    source_request_id       UUID REFERENCES observation_request (request_id) ON DELETE SET NULL,
    observee_teacher_id     UUID NOT NULL REFERENCES teacher (teacher_id) ON DELETE RESTRICT,
    observer_teacher_id     UUID NOT NULL REFERENCES teacher (teacher_id) ON DELETE RESTRICT,
    course_section_id       UUID REFERENCES course_section (section_id) ON DELETE SET NULL,
    status                  observation_status_enum NOT NULL DEFAULT 'PROPOSED',

    -- Physical observation-day sign-off. Both signatures indicate the
    -- observation actually happened, independent of the ratings given.
    -- No file upload is required here — the survey (Mongo) is where an
    -- Observee can attach supporting documents if needed.
    observee_signed_at      TIMESTAMPTZ,
    observer_signed_at      TIMESTAMPTZ,

    could_not_complete         BOOLEAN NOT NULL DEFAULT FALSE,
    could_not_complete_reason  TEXT,

    proposed_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    confirmed_at            TIMESTAMPTZ,
    submitted_at            TIMESTAMPTZ,
    completed_at            TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT observation_no_self_review CHECK (observee_teacher_id <> observer_teacher_id),
    CONSTRAINT observation_assignment_eval_cycle_fk FOREIGN KEY (observee_teacher_id, term, year)
        REFERENCES evaluation_cycle (teacher_id, term, year) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_observation_eval_cycle ON observation_assignment (observee_teacher_id, term, year);
CREATE INDEX IF NOT EXISTS idx_observation_observee ON observation_assignment (observee_teacher_id);
CREATE INDEX IF NOT EXISTS idx_observation_observer ON observation_assignment (observer_teacher_id);
CREATE INDEX IF NOT EXISTS idx_observation_status   ON observation_assignment (status);
CREATE INDEX IF NOT EXISTS idx_observation_signup   ON observation_assignment (signup_id);

DROP TRIGGER IF EXISTS trg_observation_assignment_updated_at ON observation_assignment;
CREATE TRIGGER trg_observation_assignment_updated_at
    BEFORE UPDATE ON observation_assignment
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------
-- TABLE: observation_audit_log
--   Append-only audit trail for every state transition on an
--   observation_assignment. Never mutated or deleted once written.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS observation_audit_log (
    audit_id        BIGSERIAL PRIMARY KEY,
    assignment_id   UUID NOT NULL REFERENCES observation_assignment (assignment_id) ON DELETE CASCADE,
    changed_by      VARCHAR(150) NOT NULL,   -- teacher_id (as text) or 'SYSTEM'
    from_status     observation_status_enum,
    to_status       observation_status_enum NOT NULL,
    note            TEXT,
    changed_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_assignment ON observation_audit_log (assignment_id);
CREATE INDEX IF NOT EXISTS idx_audit_changed_at ON observation_audit_log (changed_at);

-- ---------------------------------------------------------------------
-- TABLE: eligibility_violation_log
--   Feeds the "Evaluation Eligibility Accuracy" KPI. The matching engine
--   and the request-creation endpoint both re-check eligibility (defense
--   in depth); any blocked attempt is logged here with a reason code
--   rather than silently rejected, so the AC can see whether the
--   system's own recommendations are ever wrong.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS eligibility_violation_log (
    violation_id             BIGSERIAL PRIMARY KEY,
    signup_id                UUID REFERENCES signup (signup_id) ON DELETE CASCADE,
    attempted_observer_id    UUID REFERENCES teacher (teacher_id) ON DELETE SET NULL,
    violation_type           VARCHAR(40) NOT NULL CHECK (violation_type IN (
                                'SAME_PROFESSOR', 'DIFFERENT_DEPARTMENT', 'DIFFERENT_LEVEL', 'SCHEDULE_CONFLICT'
                              )),
    detected_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    context                  TEXT
);

CREATE INDEX IF NOT EXISTS idx_violation_signup ON eligibility_violation_log (signup_id);

-- ---------------------------------------------------------------------
-- TABLE: notification_log
--   Records every notification the system has sent (or would send, in
--   this free/open-source proof of concept — see
--   src/services/notificationService.js for the swap-in point for real
--   email delivery). Lets the AC "see" that reminders went out.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS notification_log (
    notification_id       BIGSERIAL PRIMARY KEY,
    recipient_teacher_id  UUID NOT NULL REFERENCES teacher (teacher_id) ON DELETE CASCADE,
    assessment_cycle_id   UUID REFERENCES assessment_cycle (assessment_cycle_id) ON DELETE SET NULL,
    notification_type     VARCHAR(40) NOT NULL CHECK (notification_type IN (
                             'DUE_REMINDER', 'OVERDUE_REMINDER', 'OBSERVER_LIST_READY',
                             'SURVEY_REMINDER', 'REQUEST_RECEIVED', 'REQUEST_CONFIRMED', 'REQUEST_DECLINED',
                             'REQUEST_EXPIRED'
                           )),
    message                TEXT NOT NULL,
    channel                VARCHAR(20) NOT NULL DEFAULT 'IN_APP' CHECK (channel IN ('EMAIL', 'IN_APP')),
    sent_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notification_recipient ON notification_log (recipient_teacher_id);
CREATE INDEX IF NOT EXISTS idx_notification_cycle     ON notification_log (assessment_cycle_id);

-- =====================================================================
-- End of schema.sql
-- =====================================================================
