import "dotenv/config";
import mongoose from "mongoose";

const uri = process.env.MONGODB_URI;
console.log("URI found in .env:", !!uri);
if (!uri) {
  console.log("-> .env is missing, misnamed, or not in the backend folder.");
  process.exit(1);
}
console.log("Target:", uri.replace(/\/\/([^:]+):[^@]+@/, "//$1:****@"));

try {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
  console.log("CONNECTED. Database:", mongoose.connection.name);
} catch (e) {
  console.log("FAILED:", e.message);
} finally {
  await mongoose.disconnect().catch(() => {});
  process.exit(0);
}
