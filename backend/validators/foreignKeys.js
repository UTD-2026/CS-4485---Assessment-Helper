const {
  Professor,
  CourseSection,
  EvaluationCycle,
  Observation,
} = require("../models");

async function requireProfessor(email) {
  const exists = await Professor.exists({
    email: email.toLowerCase().trim(),
  });

  if (!exists) {
    throw new Error(`Professor not found: ${email}`);
  }
}

async function requireCourseSection(data) {
  const filter = {
    course_code: data.course_code,
    section_number: data.section_number,
    term: data.term,
  };

  const exists = await CourseSection.exists(filter);

  if (!exists) {
    throw new Error(
      `Course section not found: ${data.course_code}, section ${data.section_number}, ${data.term}`
    );
  }
}

async function requireEvaluationCycle(term) {
  const exists = await EvaluationCycle.exists({ term });

  if (!exists) {
    throw new Error(`Evaluation cycle not found: ${term}`);
  }
}

async function validateCourseSection(data) {
  await requireProfessor(data.instructor_email);
  await requireEvaluationCycle(data.term);
}

async function validateObservation(data) {
  await requireCourseSection(data);
  await requireProfessor(data.observer_email);
}

async function validateObserverMatch(data) {
  const observationExists = await Observation.exists({
    course_code: data.course_code,
    section_number: data.section_number,
    term: data.term,
  });

  if (!observationExists) {
    throw new Error(
      `Observation not found for section: ${data.course_code}, section ${data.section_number}, ${data.term}`
    );
  }

  await requireProfessor(data.observer_email);
}

async function validateSurvey(data) {
  await requireProfessor(data.professor_email);
  await requireEvaluationCycle(data.term);
}

module.exports = {
  validateCourseSection,
  validateObservation,
  validateObserverMatch,
  validateSurvey,
};
