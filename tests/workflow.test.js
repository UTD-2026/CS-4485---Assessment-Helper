import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateEvaluationStatus, mockCourses } from '../src/mockDatabase.js';
import { generateObserverMatches } from '../src/matchmaker.js';
import { validObservationDate } from '../src/workflow.js';

test('assistant professors have the entire following calendar year', () => {
  const p = {hire_level:'Assistant', last_evaluation:'Spring 2025'};
  assert.equal(calculateEvaluationStatus(p,'Spring 2026').status,'Due');
  assert.equal(calculateEvaluationStatus(p,'Fall 2026').status,'Due');
  assert.equal(calculateEvaluationStatus(p,'Spring 2027').status,'Overdue');
  assert.equal(calculateEvaluationStatus(p,'Fall 2025').status,'Not Due');
  assert.equal(calculateEvaluationStatus({...p,last_evaluation:'Fall 2025'},'Spring 2026').status,'Due');
});

test('associate/full professors are overdue after the corresponding semester', () => {
  for (const hire_level of ['Associate','Full']) {
    const p = {hire_level,last_evaluation:'Spring 2025'};
    assert.equal(calculateEvaluationStatus(p,'Spring 2027').status,'Due');
    assert.equal(calculateEvaluationStatus(p,'Fall 2027').status,'Overdue');
    assert.equal(calculateEvaluationStatus({...p,last_evaluation:'Fall 2025'},'Spring 2027').status,'Not Due');
  }
});

test('selection uses only signed-up eligible colleagues and excludes self', () => {
  assert.equal(generateObserverMatches(1,'CS 1337','MW 8:30 AM',[]).matches.length,0);
  assert.equal(generateObserverMatches(1,'CS 1337','MW 8:30 AM',[1]).matches.length,0);
  assert.deepEqual(generateObserverMatches(1,'CS 1337','MW 8:30 AM',[1,3]).matches.map(p=>p.professor_id),[3]);
  assert.equal(generateObserverMatches(1,'CS 1337','MW 8:30 AM',[2]).matches.length,0);
  const course=mockCourses.find(c=>c.instructor_id===3);
  const original=course.timing;
  try {
    course.timing='W 8:30 AM';
    assert.equal(generateObserverMatches(1,'CS 1337','MW 8:30 AM',[3]).matches.length,0);
  } finally { course.timing=original; }
});

test('requested date must match class days and precede deadline', () => {
  assert.ok(validObservationDate('2027-03-01','2027-04-15','MW 8:30 AM','2027-02-01'));
  assert.equal(validObservationDate('2027-03-02','2027-04-15','MW 8:30 AM','2027-02-01'),false);
  assert.equal(validObservationDate('2027-03-01','2027-03-01','MW 8:30 AM','2027-02-01'),false);
  assert.equal(validObservationDate('2027-03-01','2027-04-15','MW 8:30 AM','2027-03-02'),false);
  assert.equal(validObservationDate('2027-02-30','2027-04-15','MW 8:30 AM','2027-02-01'),false);
});
