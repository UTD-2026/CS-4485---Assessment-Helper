// mockDatabase.js
export const currentSemester = "Spring 2027";
const semesterIndex = {
  "Spring 2024": 1, "Fall 2024": 2, "Spring 2025": 3, "Fall 2025": 4, 
  "Spring 2026": 5, "Fall 2026": 6, "Spring 2027": 7, "Fall 2027": 8
};

export const calculateEvaluationStatus = (professor) => {
  if (!professor.last_evaluation) return { status: "Overdue", next_eval: "Immediate", overdue_by: 2 };
  
  const lastIndex = semesterIndex[professor.last_evaluation];
  const currentIndex = semesterIndex[currentSemester];
  
  const requiredInterval = professor.hire_level.includes("Assistant") ? 2 : 4;
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

export const mockAdmins = [
  { professor_id: 0, username: "admin", password: "123", name: "Assessment Committee Admin", email: "assessment.committee@utdallas.edu", role: "admin" }
];

export const mockProfessors = [
  { professor_id: 1, username: "asmith", password: "123", name: "Dr. Alice Smith", email: "asmith@utdallas.edu", department: "CS", hire_level: "Assistant", is_ac_member: false, last_evaluation: "Spring 2026" },
  { professor_id: 2, username: "bjones", password: "123", name: "Dr. Bob Jones", email: "bjones@utdallas.edu", department: "CS", hire_level: "Associate", is_ac_member: true, last_evaluation: "Spring 2025" },
  { professor_id: 3, username: "cwhite", password: "123", name: "Dr. Carol White", email: "cwhite@utdallas.edu", department: "CS", hire_level: "Full", is_ac_member: false, last_evaluation: "Fall 2024" },
  { professor_id: 4, username: "dbrown", password: "123", name: "Dr. David Brown", email: "dbrown@utdallas.edu", department: "CS", hire_level: "Assistant", is_ac_member: false, last_evaluation: "Fall 2026" },
  { professor_id: 5, username: "stran", password: "123", name: "Dr. Scott Tran", email: "stran@utdallas.edu", department: "CS", hire_level: "Full", is_ac_member: false, last_evaluation: "Fall 2025" },
  { professor_id: 6, username: "fgreen", password: "123", name: "Dr. Frank Green", email: "fgreen@utdallas.edu", department: "CS", hire_level: "Associate", is_ac_member: false, last_evaluation: "Fall 2026" },
  { professor_id: 7, username: "msagar", password: "123", name: "Dr. Mikael Sagar", email: "msagar@utdallas.edu", department: "CS", hire_level: "Full", is_ac_member: true, last_evaluation: "Spring 2026" },
  { professor_id: 8, username: "nkho", password: "123", name: "Dr. Nicholas Kho", email: "nkho@utdallas.edu", department: "CS", hire_level: "Associate", is_ac_member: false, last_evaluation: null },

  { professor_id: 9, username: "jdoe", password: "123", name: "Dr. John Doe", email: "jdoe@utdallas.edu", department: "MATH", hire_level: "Assistant", is_ac_member: false, last_evaluation: "Spring 2026" }, 
  { professor_id: 10, username: "rroe", password: "123", name: "Dr. Richard Roe", email: "rroe@utdallas.edu", department: "MATH", hire_level: "Associate", is_ac_member: false, last_evaluation: "Spring 2025" }, 
  { professor_id: 11, username: "mmay", password: "123", name: "Dr. Mary May", email: "mmay@utdallas.edu", department: "MATH", hire_level: "Full", is_ac_member: false, last_evaluation: "Spring 2024" }, 
  { professor_id: 12, username: "tlee", password: "123", name: "Dr. Tom Lee", email: "tlee@utdallas.edu", department: "MATH", hire_level: "Assistant", is_ac_member: false, last_evaluation: "Fall 2026" }, 

  { professor_id: 13, username: "wchen", password: "123", name: "Dr. Wei Chen", email: "wchen@utdallas.edu", department: "PHYS", hire_level: "Associate", is_ac_member: false, last_evaluation: "Spring 2025" }, 
  { professor_id: 14, username: "epark", password: "123", name: "Dr. Eun Park", email: "epark@utdallas.edu", department: "PHYS", hire_level: "Assistant", is_ac_member: false, last_evaluation: "Spring 2026" }, 

  { professor_id: 15, username: "fiona", password: "123", name: "Dr. Fiona Green", email: "fiona.green@utdallas.edu", department: "FILM", hire_level: "Assistant", is_ac_member: false, last_evaluation: "Spring 2026" } 
];

export const mockCourses = [
  // Alice gets 2 matches because David and Carol teach CS 1337
  { section_id: 101, course_code: "CS 1337", section: "001", timing: "MW 8:30 AM - 9:45 AM", instructor_id: 1 },
  { section_id: 103, course_code: "CS 1337", section: "002", timing: "TR 2:00 PM - 3:15 PM", instructor_id: 3 },
  { section_id: 104, course_code: "CS 1337", section: "003", timing: "TR 10:00 AM - 11:15 AM", instructor_id: 4 }, 
  
  // Bob gets 5 matches because we are making CS 2305 a massive multi-section course!
  { section_id: 102, course_code: "CS 2305", section: "001", timing: "TR 10:00 AM - 11:15 AM", instructor_id: 2 }, // Bob
  { section_id: 105, course_code: "CS 2305", section: "002", timing: "MW 1:00 PM - 2:15 PM", instructor_id: 5 }, // Scott
  { section_id: 106, course_code: "CS 2305", section: "003", timing: "MW 8:30 AM - 9:45 AM", instructor_id: 6 }, // Frank
  { section_id: 107, course_code: "CS 2305", section: "004", timing: "TR 4:00 PM - 5:15 PM", instructor_id: 7 }, // Mikael
  { section_id: 108, course_code: "CS 2305", section: "501", timing: "MW 5:30 PM - 6:45 PM", instructor_id: 8 }, // Nicholas
  { section_id: 109, course_code: "CS 2305", section: "005", timing: "F 1:00 PM - 3:45 PM", instructor_id: 3 }, // Carol

  { section_id: 201, course_code: "MATH 2413", section: "001", timing: "MW 10:00 AM - 11:15 AM", instructor_id: 9 },
  { section_id: 202, course_code: "MATH 2414", section: "001", timing: "TR 1:00 PM - 2:15 PM", instructor_id: 10 },
  { section_id: 203, course_code: "MATH 2418", section: "001", timing: "MW 10:00 AM - 11:15 AM", instructor_id: 11 }, 
  { section_id: 204, course_code: "MATH 3311", section: "001", timing: "F 9:00 AM - 11:45 AM", instructor_id: 12 },

  { section_id: 301, course_code: "PHYS 2325", section: "001", timing: "TR 8:30 AM - 9:45 AM", instructor_id: 13 },
  { section_id: 302, course_code: "PHYS 2326", section: "001", timing: "TR 8:30 AM - 9:45 AM", instructor_id: 14 },

  { section_id: 401, course_code: "FILM 2332", section: "001", timing: "F 1:00 PM - 3:45 PM", instructor_id: 15 }
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
  { id: 4, criteria: "Overall effectiveness of instructional delivery", ratingScale: "1 to 5 (Poor to Excellent)" },
  { id: 5, criteria: "Uses multimedia/board effectively to support the lecture.", ratingScale: "Yes / No / N/A" },
  { id: 6, criteria: "Observer's qualitative feedback and constructive notes.", ratingScale: "Text Feedback Only" }
];