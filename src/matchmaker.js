// matchmaker.js
import { mockProfessors, mockCourses } from './mockDatabase.js';

export const generateObserverMatches = (observeeId, inputCourseCode, inputTiming, observerPoolIds = []) => {
  const observee = mockProfessors.find(p => p.professor_id === observeeId);
  if (!observee || !inputCourseCode) return { matches: [], flag: "NO ELIGIBLE OBSERVER" };

  const courseParts = inputCourseCode.split(" ");
  const courseLevelNumber = courseParts.length > 1 ? courseParts[1].charAt(0) : "1";

  const eligibleObservers = mockProfessors.filter(prof => {
    if (!observerPoolIds.includes(prof.professor_id)) return false;
    if (prof.professor_id === observeeId) return false; 
    if (prof.department !== observee.department) return false; 

    const profCourses = mockCourses.filter(c => c.instructor_id === prof.professor_id);
    
    const teachesSameLevel = profCourses.some(c => c.course_code.split(" ")[1].charAt(0) === courseLevelNumber);
    if (!teachesSameLevel) return false;

    const [days, ...time] = inputTiming.toUpperCase().trim().split(/\s+/);
    const isBusyAtThatTime = profCourses.some(c => {
      const [otherDays, ...otherTime] = c.timing.toUpperCase().trim().split(/\s+/);
      return otherTime.join(' ') === time.join(' ') && [...days].some(day => otherDays.includes(day));
    });
    if (isBusyAtThatTime) return false;

    return true; 
  });

  const finalMatches = eligibleObservers.slice(0, 5); 
  
  let flag = "OK";
  if (finalMatches.length === 0) flag = "NO ELIGIBLE OBSERVER";
  else if (finalMatches.length < 5) flag = "INSUFFICIENT OBSERVERS";

  return { matches: finalMatches, flag };
};