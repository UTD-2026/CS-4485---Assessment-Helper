require("dotenv").config();

const crypto = require("node:crypto");
const { promisify } = require("node:util");
const mongoose = require("mongoose");
const { Professor } = require("./models");

const scrypt = promisify(crypto.scrypt);

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, 32);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

async function setupDemoLogins() {
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is missing. Check backend/.env.");
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
  try {
    const professors = await Professor.find({}).select("_id").lean();
    if (!professors.length) throw new Error("No professor records were found; no passwords were changed.");
    const operations = await Promise.all(professors.map(async professor => ({
      updateOne: {
        filter: { _id: professor._id },
        update: { $set: { password_hash: await hashPassword("123") } },
      },
    })));
    const result = await Professor.bulkWrite(operations, { ordered: true });
    console.log(`Configured the shared demo password for ${result.modifiedCount} professor accounts.`);
  } finally {
    await mongoose.disconnect();
  }
}

setupDemoLogins().catch(error => {
  console.error("Demo login setup failed:", error.message);
  process.exitCode = 1;
});
