// mockDatabase.js

export const currentSemester = "Spring 2027";
// Restored: Centralized Evaluation Logic 
export const calculateEvaluationStatus = (professor, semester = currentSemester) => {
  if (!professor.last_evaluation) return { status: "Due", next_eval: semester, overdue_by: 0 };
  
  const [lastSeason, lastYearText] = professor.last_evaluation.split(' ');
  const [season, yearText] = semester.split(' ');
  const dueYear = Number(lastYearText) + (professor.hire_level === 'Assistant' ? 1 : 2);
  const year = Number(yearText);
  const next_eval = `${professor.hire_level === 'Assistant' ? 'Spring' : lastSeason} ${dueYear}`;
  const dueIndex = dueYear * 2 + (professor.hire_level === 'Assistant' ? 1 : lastSeason === 'Fall' ? 1 : 0);
  const currentIndex = year * 2 + (season === 'Fall' ? 1 : 0);
  if (currentIndex > dueIndex) return { status: 'Overdue', next_eval, overdue_by: currentIndex - dueIndex };
  const isDue = professor.hire_level === 'Assistant' ? year === dueYear : currentIndex === dueIndex;
  return { status: isDue ? 'Due' : 'Not Due', next_eval, overdue_by: 0 };
};

// Kept teammate's Admin array
export const mockAdmins = [
  { professor_id: 0, username: "admin", password: "123", name: "Assessment Committee Admin", role: "admin" }, 
];

// Restored your expanded professors
export const mockProfessors = [
  { professor_id: 1, username: "asmith", password: "123", name: "Dr. Alice Smith", department: "CS", hire_level: "Assistant", is_ac_member: false, last_evaluation: "Spring 2026" },
  { professor_id: 2, username: "bjones", password: "123", name: "Dr. Bob Jones", department: "CS", hire_level: "Associate", is_ac_member: true, last_evaluation: "Spring 2025" },
  { professor_id: 3, username: "cwhite", password: "123", name: "Dr. Carol White", department: "CS", hire_level: "Full", is_ac_member: false, last_evaluation: "Spring 2024" },
  { professor_id: 4, username: "dbrown", password: "123", name: "Dr. David Brown", department: "CS", hire_level: "Assistant", is_ac_member: false, last_evaluation: "Fall 2026" },
  { professor_id: 5, username: "stran", password: "123", name: "Dr. Scott Tran", department: "CS", hire_level: "Assistant", is_ac_member: false, last_evaluation: "Fall 2025" },
  { professor_id: 6, username: "fgreen", password: "123", name: "Dr. Frank Green", department: "CS", hire_level: "Associate", is_ac_member: false, last_evaluation: "Spring 2026" },
  { professor_id: 7, username: "msagar", password: "123", name: "Dr. Mikael Sagar", department: "CS", hire_level: "Full", is_ac_member: true, last_evaluation: "Spring 2026" },
];

// Restored your expanded courses
export const mockCourses = [
  { section_id: 101, course_code: "CS 1337", section: "001", timing: "MW 8:30 AM", instructor_id: 1 },
  { section_id: 102, course_code: "CS 2305", section: "001", timing: "TR 10:00 AM", instructor_id: 2 },
  { section_id: 103, course_code: "CS 1337", section: "002", timing: "TR 2:00 PM", instructor_id: 3 },
  { section_id: 104, course_code: "CS 1337", section: "003", timing: "TR 10:00 AM", instructor_id: 4 },
  { section_id: 105, course_code: "CS 3345", section: "001", timing: "MW 1:00 PM", instructor_id: 5 },
  { section_id: 106, course_code: "CS 3345", section: "002", timing: "MW 8:30 AM", instructor_id: 6 },
  { section_id: 107, course_code: "CS 4485", section: "001", timing: "TR 4:00 PM", instructor_id: 7 },
];

export const initialDeadlines = {
  signup: "2027-02-15",
  observation: "2027-04-15",
  survey: "2027-05-01" 
};

export const mockEvaluationTemplate = [
  { id: 1, criteria: "Clear presentation of course objectives", ratingScale: "1 to 5 (Poor to Excellent)" },
  { id: 2, criteria: "Effective use of class time and pacing", ratingScale: "1 to 5 (Poor to Excellent)" },
  { id: 3, criteria: "Encourages student participation and questions", ratingScale: "1 to 5 (Poor to Excellent)" },
  { id: 4, criteria: "Overall effectiveness of instructional delivery", ratingScale: "1 to 5 (Poor to Excellent)" }
];