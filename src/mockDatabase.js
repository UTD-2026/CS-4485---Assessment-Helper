// mockDatabase.js

export const mockProfessors = [
  { 
    professor_id: 1, 
    name: "Dr. Alice Smith", 
    email: "alice@utd.edu", 
    department: "CS", 
    hire_level: "Assistant", 
    is_ac_member: false 
  },
  { 
    professor_id: 2, 
    name: "Dr. Bob Jones", 
    email: "bob@utd.edu", 
    department: "CS", 
    hire_level: "Associate", 
    is_ac_member: true // This user will see the Assessment Committee dashboard
  },
  { 
    professor_id: 3, 
    name: "Dr. Carol White", 
    email: "carol@utd.edu", 
    department: "CS", 
    hire_level: "Full", 
    is_ac_member: false 
  },
  { 
    professor_id: 4, 
    name: "Dr. David Brown", 
    email: "david@utd.edu", 
    department: "CS", 
    hire_level: "Assistant", 
    is_ac_member: false 
  },
  { 
    professor_id: 5, 
    name: "Dr. Eve Davis", 
    email: "eve@utd.edu", 
    department: "EE", 
    hire_level: "Assistant", 
    is_ac_member: false 
  }
];

export const mockCourses = [
  { 
    section_id: 101, 
    course_code: "CS 1000", 
    section_number: "001", 
    term: "Spring 2027", 
    timing: "MW 8:30 AM", 
    instructor_id: 1 // Belongs to Alice
  },
  { 
    section_id: 102, 
    course_code: "CS 2000", 
    section_number: "001", 
    term: "Spring 2027", 
    timing: "TR 10:00 AM", 
    instructor_id: 2 // Belongs to Bob
  },
  { 
    section_id: 103, 
    course_code: "CS 1000", 
    section_number: "002", 
    term: "Spring 2027", 
    timing: "TR 2:00 PM", 
    instructor_id: 3 // Belongs to Carol
  },
  { 
    section_id: 104, 
    course_code: "CS 1000", 
    section_number: "003", 
    term: "Spring 2027", 
    timing: "TR 10:00 AM", 
    instructor_id: 4 // Belongs to David
  },
  { 
    section_id: 105, 
    course_code: "EE 1000", 
    section_number: "001", 
    term: "Spring 2027", 
    timing: "MW 8:30 AM", 
    instructor_id: 5 // Belongs to Eve
  }
];