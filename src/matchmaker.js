// matchmaker.js
import { mockProfessors, mockCourses } from './mockDatabase.js';

export const generateObserverMatches = (observeeId, inputCourseCode, inputTiming) => {
  const observee = mockProfessors.find(p => p.professor_id === observeeId);
  if (!observee || !inputCourseCode) return [];

  // Extract level (e.g., "CS 1000" -> "1", "CS 3345" -> "3")
  const courseParts = inputCourseCode.split(" ");
  const courseLevelNumber = courseParts.length > 1 ? courseParts[1].charAt(0) : "1";

  const eligibleObservers = mockProfessors.filter(prof => {
    if (prof.professor_id === observeeId) return false;
    if (prof.department !== observee.department) return false;

    const profCourses = mockCourses.filter(c => c.instructor_id === prof.professor_id);
    
    // Check if they teach the same level
    const teachesSameLevel = profCourses.some(c => {
      const pLevel = c.course_code.split(" ")[1].charAt(0);
      return pLevel === courseLevelNumber;
    });
    if (!teachesSameLevel) return false;

    // Check if they are busy at the requested time
    const isBusyAtThatTime = profCourses.some(c => c.timing.toLowerCase() === inputTiming.toLowerCase());
    if (isBusyAtThatTime) return false;

    return true; 
  });

  return eligibleObservers.slice(0, 5); 
};