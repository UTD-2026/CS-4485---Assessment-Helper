import "dotenv/config";
import mongoose from "mongoose";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dataPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "seed-data.json"
);

const data = JSON.parse(readFileSync(dataPath, "utf8"));

const collections = {
  professors: "professors",
  courseSections: "coursesections",
  evaluationCycles: "evaluationcycles",
  observations: "observations",
  observerMatches: "observermatches",
  surveys: "surveys",
};

const dateFields = new Set([
  "last_observed",
  "signup_deadline",
  "observation_deadline",
  "feedback_deadline",
  "signup_date",
  "observation_date",
  "observer_signed_date",
  "observee_signed_date",
  "requested_date",
  "submitted_date",
]);

function castDates(document) {
  const result = { ...document };

  for (const field of dateFields) {
    if (
      typeof result[field] === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(result[field])
    ) {
      result[field] = new Date(
        `${result[field]}T00:00:00.000Z`
      );
    }
  }

  return result;
}

function sectionKey(section) {
  return `${section.course_code}|${section.section_number}|${section.term}`;
}

function validate() {
  for (const key of Object.keys(collections)) {
    if (!Array.isArray(data[key])) {
      throw new Error(`Missing seed-data array: ${key}`);
    }
  }

  const emails = new Set(data.professors.map((p) => p.email));
  const emailSuffixes = data.professors.map((p) => p.email.slice(3, 9));
  const sections = new Set(data.courseSections.map(sectionKey));
  const terms = new Set(data.evaluationCycles.map((c) => c.term));
  const observationKeys = new Set(data.observations.map(sectionKey));

  if (emails.size !== data.professors.length) {
    throw new Error("Duplicate professor email.");
  }

  if (new Set(emailSuffixes).size !== emailSuffixes.length) {
    throw new Error("Duplicate numeric email suffix.");
  }

  if (sections.size !== data.courseSections.length) {
    throw new Error("Duplicate course-section composite key.");
  }

  if (terms.size !== data.evaluationCycles.length) {
    throw new Error("Duplicate evaluation-cycle term.");
  }

  if (observationKeys.size !== data.observations.length) {
    throw new Error("Duplicate observation composite key.");
  }

  for (const professor of data.professors) {
    if (!/^[a-z]{3}\d{6}@utdallas\.edu$/.test(professor.email)) {
      throw new Error(`Invalid professor email: ${professor.email}`);
    }

    const nameParts = professor.name.trim().toLowerCase().split(/\s+/);
    const initials =
      nameParts.length >= 3
        ? nameParts[0][0] +
          nameParts[1][0] +
          nameParts[nameParts.length - 1][0]
        : "";

    if (professor.email.slice(0, 3) !== initials) {
      throw new Error(
        `Email initials do not match name: ${professor.name}`
      );
    }

    if (professor.department !== "CS") {
      throw new Error(
        `Professor must be in CS: ${professor.email}`
      );
    }
  }

  for (const section of data.courseSections) {
    if (!/^\d{3}$/.test(String(section.section_number))) {
      throw new Error(
        `Invalid section number (must be exactly 3 digits): ${section.section_number}`
      );
    }

    if (!/^CS (?:[1-4]\d|50)\d{2}$/.test(section.course_code)) {
      throw new Error(`Invalid CS course code: ${section.course_code}`);
    }

    if (!/^(?:MW|TT) \d{2}:\d{2}-\d{2}:\d{2}$/.test(section.timing)) {
      throw new Error(`Invalid course timing: ${section.timing}`);
    }

    if (
      !emails.has(section.instructor_email) ||
      !terms.has(section.term)
    ) {
      throw new Error(
        `Invalid instructor or term: ${sectionKey(section)}`
      );
    }
  }

  for (const observation of data.observations) {
    if (!/^\d{3}$/.test(String(observation.section_number))) {
      throw new Error(
        `Invalid observation section number: ${observation.section_number}`
      );
    }

    if (!sections.has(sectionKey(observation))) {
      throw new Error(
        `Observation references missing section: ${sectionKey(observation)}`
      );
    }

    if (
      observation.observer_email &&
      !emails.has(observation.observer_email)
    ) {
      throw new Error(
        `Unknown observation professor: ${observation.observer_email}`
      );
    }
  }

  const matchKeys = new Set();

  for (const match of data.observerMatches) {
    if (!/^\d{3}$/.test(String(match.section_number))) {
      throw new Error(
        `Invalid observer-match section number: ${match.section_number}`
      );
    }

    const key = `${sectionKey(match)}|${match.observer_email}`;

    if (
      !observationKeys.has(sectionKey(match)) ||
      !emails.has(match.observer_email) ||
      matchKeys.has(key)
    ) {
      throw new Error(`Invalid or duplicate observer match: ${key}`);
    }

    matchKeys.add(key);
  }

  const surveyPairs = new Set();

  for (const survey of data.surveys) {
    const key = `${survey.professor_email}|${survey.term}`;

    if (
      !emails.has(survey.professor_email) ||
      !terms.has(survey.term) ||
      surveyPairs.has(key)
    ) {
      throw new Error(`Invalid or duplicate survey: ${key}`);
    }

    surveyPairs.add(key);
  }
}

async function main() {
  validate();

  console.log(
    "Validated seed data:",
    Object.fromEntries(
      Object.entries(data).map(([key, value]) => [key, value.length])
    )
  );

  if (process.argv.includes("--dry-run")) {
    console.log("Dry run only. Database unchanged.");
    return;
  }

  if (process.argv.includes("--reset")) {
    throw new Error(
      "Reset is disabled. Clear the six mock collections manually before seeding."
    );
  }

  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI is missing. Check backend/.env.");
  }

  await mongoose.connect(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 15000,
  });

  try {
    const db = mongoose.connection.db;

    // Never insert into collections that already contain documents.
    for (const name of Object.values(collections)) {
      const count = await db.collection(name).countDocuments();

      if (count > 0) {
        throw new Error(
          `Collection "${name}" already contains ${count} documents. No data was inserted.`
        );
      }
    }

    for (const [key, name] of Object.entries(collections)) {
      const documents = data[key].map(castDates);

      if (documents.length > 0) {
        await db.collection(name).insertMany(documents, {
          ordered: true,
        });
      }

      console.log(
        `Inserted ${documents.length} documents into ${name}`
      );
    }

    console.log("Seeding completed successfully.");
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.error("Seeding failed:", error.message);
  process.exitCode = 1;
});
