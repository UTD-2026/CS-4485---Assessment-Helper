// matchmaker.js
import { mockProfessors, mockCourses } from './mockDatabase.js';

export const generateObserverMatches = (observeeId, inputCourseCode, inputTiming) => {
  const observee = mockProfessors.find(p => p.professor_id === observeeId);
  if (!observee || !inputCourseCode) return { matches: [], flag: "NO ELIGIBLE OBSERVER" };

  const courseParts = inputCourseCode.split(" ");
  const courseLevelNumber = courseParts.length > 1 ? courseParts[1].charAt(0) : "1";

  const eligibleObservers = mockProfessors.filter(prof => {
    if (prof.professor_id === observeeId) return false; // Rule: No self-observation
    if (prof.department !== observee.department) return false; // Rule: Same department

    const profCourses = mockCourses.filter(c => c.instructor_id === prof.professor_id);
    
    // Rule: Must teach same course level
    const teachesSameLevel = profCourses.some(c => c.course_code.split(" ")[1].charAt(0) === courseLevelNumber);
    if (!teachesSameLevel) return false;

    // Rule: Must be available (not teaching at the same time)
    const isBusyAtThatTime = profCourses.some(c => c.timing.toLowerCase() === inputTiming.toLowerCase());
    if (isBusyAtThatTime) return false;

    return true; 
  });

  const finalMatches = eligibleObservers.slice(0, 5); // Rule: Max 5
  
  let flag = "OK";
  if (finalMatches.length === 0) flag = "NO ELIGIBLE OBSERVER";
  else if (finalMatches.length < 5) flag = "INSUFFICIENT OBSERVERS";

  return { matches: finalMatches, flag };
};