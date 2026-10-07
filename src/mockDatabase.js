// mockDatabase.js

export const currentSemester = "Spring 2027";
const semesterIndex = {
  "Spring 2024": 1, "Fall 2024": 2, "Spring 2025": 3, "Fall 2025": 4, 
  "Spring 2026": 5, "Fall 2026": 6, "Spring 2027": 7, "Fall 2027": 8
};

// Centralized Evaluation Logic (Used by Admin and Professor Dashboards)
export const calculateEvaluationStatus = (professor) => {
  if (!professor.last_evaluation) return { status: "Due", next_eval: currentSemester, overdue_by: 0 };
  
  const lastIndex = semesterIndex[professor.last_evaluation];
  const currentIndex = semesterIndex[currentSemester];
  
  // Assistant = 1 year (2 semesters). Associate/Full = 2 years (4 semesters).
  const requiredInterval = professor.hire_level === "Assistant" ? 2 : 4;
  const nextEvalIndex = lastIndex + requiredInterval;
  
  const next_eval = Object.keys(semesterIndex).find(key => semesterIndex[key] === nextEvalIndex) || "Future";
  
  if (currentIndex > nextEvalIndex) {
    return { status: "Overdue", next_eval, overdue_by: currentIndex - nextEvalIndex };
  } else if (currentIndex === nextEvalIndex) {
    return { status: "Due", next_eval, overdue_by: 0 };
  } else {
    return { status: "Not Due", next_eval, overdue_by: 0 };
  }
};

export const mockProfessors = [
  { professor_id: 1, username: "asmith", password: "123", name: "Dr. Alice Smith", department: "CS", hire_level: "Assistant", is_ac_member: false, last_evaluation: "Spring 2026" }, // Due
  { professor_id: 2, username: "bjones", password: "123", name: "Dr. Bob Jones", department: "CS", hire_level: "Associate", is_ac_member: true, last_evaluation: "Spring 2025" }, // Due (Admin)
  { professor_id: 3, username: "cwhite", password: "123", name: "Dr. Carol White", department: "CS", hire_level: "Full", is_ac_member: false, last_evaluation: "Spring 2024" }, // Overdue
  { professor_id: 4, username: "dbrown", password: "123", name: "Dr. David Brown", department: "CS", hire_level: "Assistant", is_ac_member: false, last_evaluation: "Fall 2026" }, // Not Due
  { professor_id: 5, username: "stran", password: "123", name: "Dr. Scott Tran", department: "CS", hire_level: "Assistant", is_ac_member: false, last_evaluation: "Fall 2025" }, // Overdue
  { professor_id: 6, username: "fgreen", password: "123", name: "Dr. Frank Green", department: "CS", hire_level: "Associate", is_ac_member: false, last_evaluation: "Spring 2026" }, // Not Due
  { professor_id: 7, username: "msagar", password: "123", name: "Dr. Mikael Sagar", department: "CS", hire_level: "Full", is_ac_member: true, last_evaluation: "Spring 2026" }, // Not Due (Admin)
];

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
  survey: "2027-05-01" // Hand-off for teammate
};