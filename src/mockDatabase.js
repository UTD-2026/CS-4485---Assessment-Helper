// mockDatabase.js

/*Will add currentUser.is_ac_member true later
Using if currentUser.role === 'admin' for now*/
export const mockAdmins = [
  { professor_id: 0, username: "admin", password: "123", name: "Assessment Committee Admin", role: "admin" }, 
];

export const mockProfessors = [
  { professor_id: 1, username: "asmith", password: "123", name: "Dr. Alice Smith", department: "CS", hire_level: "Assistant", is_ac_member: false },
  { professor_id: 2, username: "bjones", password: "123", name: "Dr. Bob Jones", department: "CS", hire_level: "Associate", is_ac_member: true },
  { professor_id: 3, username: "cwhite", password: "123", name: "Dr. Carol White", department: "CS", hire_level: "Full", is_ac_member: false },
  { professor_id: 4, username: "dbrown", password: "123", name: "Dr. David Brown", department: "CS", hire_level: "Assistant", is_ac_member: false },
  { professor_id: 5, username: "edavis", password: "123", name: "Dr. Eve Davis", department: "EE", hire_level: "Assistant", is_ac_member: false },
  { professor_id: 6, username: "fgreen", password: "123", name: "Dr. Frank Green", department: "CS", hire_level: "Associate", is_ac_member: false },
];

export const mockCourses = [
  { section_id: 101, course_code: "CS 1000", timing: "MW 8:30 AM", instructor_id: 1 },
  { section_id: 102, course_code: "CS 2000", timing: "TR 10:00 AM", instructor_id: 2 },
  { section_id: 103, course_code: "CS 1000", timing: "TR 2:00 PM", instructor_id: 3 },
  { section_id: 104, course_code: "CS 1000", timing: "TR 10:00 AM", instructor_id: 4 },
  { section_id: 105, course_code: "EE 1000", timing: "MW 8:30 AM", instructor_id: 5 },
  { section_id: 106, course_code: "CS 3000", timing: "MW 8:30 AM", instructor_id: 6 },
];