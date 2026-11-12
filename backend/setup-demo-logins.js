// npm run setup-demo-logins: resets every professor's password to the shared demo password.
// From main; now uses services/password.js so the hashes match what the API checks.
require("dotenv").config();

const mongoose = require("mongoose");
const { Professor } = require("./models");
const { hashPassword } = require("./services/password");

const DEMO_PASSWORD = "Password123!";

async function setupDemoLogins() {
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is missing. Check backend/.env.");
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
  try {
    const professors = await Professor.find({}).select("_id").lean();
    if (!professors.length) throw new Error("No professor records were found; no passwords were changed.");
    const operations = professors.map((professor) => ({
      updateOne: { filter: { _id: professor._id }, update: { $set: { password_hash: hashPassword(DEMO_PASSWORD) } } },
    }));
    const result = await Professor.bulkWrite(operations, { ordered: true });
    console.log(`Set the demo password (${DEMO_PASSWORD}) for ${result.modifiedCount} professor accounts.`);
  } finally {
    await mongoose.disconnect();
  }
}

setupDemoLogins().catch((error) => {
  console.error("Demo login setup failed:", error.message);
  process.exitCode = 1;
});
