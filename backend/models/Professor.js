import mongoose from "mongoose";

const professorSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true }, // PK
    name: { type: String, required: true },
    department: { type: String, required: true },
    hireLevel: { type: String, enum: ["assistant", "associate", "full"], required: true },
    lastObserved: { type: Date, default: null },
    passwordHash: { type: String, select: false }, // never returned unless asked for explicitly
    isAcMember: { type: Boolean, default: false },
  },
  { collection: "professors", versionKey: false }
);

export default mongoose.model("Professor", professorSchema);
