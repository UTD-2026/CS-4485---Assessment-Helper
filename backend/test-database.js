
require("dotenv").config();
const mongoose = require("mongoose");

async function testDatabase() {
  try {
    if (!process.env.MONGODB_URI) {
      throw new Error("MONGODB_URI is missing from backend/.env");
    }

    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 10000,
    });

    await mongoose.connection.db.admin().ping();

    console.log("Database connection successful!");
    console.log(`Connected to database: ${mongoose.connection.name}`);
  } catch (error) {
    console.error("Database connection failed:", error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

testDatabase();
