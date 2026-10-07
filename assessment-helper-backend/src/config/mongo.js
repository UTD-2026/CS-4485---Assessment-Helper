// MongoDB connection singleton (Step 2)
// Holds flexible document data: dynamic evaluation forms, raw UTD Course
// Book API payloads, and survey submissions. All three change shape over
// time, which is exactly the case Postgres migrations handle poorly.

require('dotenv').config();
const { MongoClient } = require('mongodb');

const uri = process.env.MONGO_URI || 'mongodb://localhost:27017';
const dbName = process.env.MONGO_DB || 'assessment_helper_docs';

let client;
let db;

async function connectMongo() {
    if (db) return db;
    client = new MongoClient(uri, { maxPoolSize: 10 });
    await client.connect();
    db = client.db(dbName);
    console.log(`[mongo] connected to ${uri}/${dbName}`);
    return db;
}

function getDb() {
    if (!db) {
        throw new Error('Mongo not initialized yet — call connectMongo() first (see server.js)');
    }
    return db;
}

async function closeMongo() {
    if (client) await client.close();
    db = undefined;
}

module.exports = { connectMongo, getDb, closeMongo };
