import { mockProfessors, mockCourses } from './mockDatabase.js';

export const generateObserverMatches = (observeeId, requestedCourseSectionId) => {
  // 1. Get the observee and the specific course they want observed
  const observee = mockProfessors.find(p => p.professor_id === observeeId);
  const targetCourse = mockCourses.find(c => c.section_id === requestedCourseSectionId);

  if (!observee || !targetCourse) return [];

  // Extract the course level (e.g., "CS 1000" -> "1000")
  const courseLevel = targetCourse.course_code.split(" ")[1].charAt(0);

  // 2. Filter the professor pool to find eligible matches
  const eligibleObservers = mockProfessors.filter(prof => {
    // Rule A: Cannot be the same person requesting the observation
    if (prof.professor_id === observeeId) return false;

    // Rule B: Must be in the exact same department
    if (prof.department !== observee.department) return false;

    // Get all courses this specific professor teaches
    const profCourses = mockCourses.filter(c => c.instructor_id === prof.professor_id);

    // Rule C: Must teach the same level course (e.g., a 1000-level class)
    const teachesSameLevel = profCourses.some(c => c.course_code.includes(courseLevel));
    if (!teachesSameLevel) return false;

    // Rule D: Must be free at the requested time (they do not teach a class at that exact time)
    const isBusyAtThatTime = profCourses.some(c => c.timing === targetCourse.timing);
    if (isBusyAtThatTime) return false;

    return true; // If they pass all rules, they are a match!
  });

  // The system requires a list of up to 5 observers
  return eligibleObservers.slice(0, 5); 
};