require("dotenv").config();

const mongoose = require("mongoose");
const {
  Professor,
  CourseSection,
  EvaluationCycle,
  Observation,
  ObserverMatch,
  Survey,
} = require("./models");

async function setupDatabase() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);

    // Remove indexes from the previous section_id schema.
    const obsoleteIndexes = [
      { collection: "coursesections", index: "section_id_1" },
      { collection: "observations", index: "section_id_1" },
      {
        collection: "observermatches",
        index: "section_id_1_observer_email_1",
      },
    ];

    for (const item of obsoleteIndexes) {
      const collection = mongoose.connection.db.collection(item.collection);
      const indexes = await collection.indexes();
      const exists = indexes.some((index) => index.name === item.index);

      if (exists) {
        await collection.dropIndex(item.index);
        console.log(`Removed obsolete index: ${item.index}`);
      }
    }

    const models = [
      Professor,
      CourseSection,
      EvaluationCycle,
      Observation,
      ObserverMatch,
      Survey,
    ];

    for (const model of models) {
      await model.createCollection().catch((error) => {
        if (error.code !== 48) throw error;
      });

      await model.createIndexes();
      console.log(`Indexes ready: ${model.collection.name}`);
    }

    console.log("Database setup completed.");
  } catch (error) {
    console.error("Database setup failed:", error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

setupDatabase();
