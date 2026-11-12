// Drops the app's collections so `npm run seed` can load fresh data.
// Only runs against a database on this machine (localhost / 127.0.0.1); the shared Atlas
// database is protected, matching seed.mjs's "never overwrite" rule.
import "dotenv/config";
import mongoose from "mongoose";

const uri = process.env.MONGODB_URI || "";
if (!/^mongodb:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(uri)) {
  console.error("Refusing to reset: MONGODB_URI is not a local mongodb://localhost/... database.");
  process.exit(1);
}

await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
const names = ["professors", "coursesections", "evaluationcycles", "observations", "observermatches", "surveys", "notifications"];
for (const name of names) {
  await mongoose.connection.db.collection(name).drop().catch(() => {});
  console.log(`Dropped ${name}`);
}
await mongoose.disconnect();
