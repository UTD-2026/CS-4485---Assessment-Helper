const dns = require('node:dns');
const mongoose = require('mongoose');
const { env } = require('./env');

async function connectDb(uri = env.mongoUri) {
  if (env.dnsServers.length) dns.setServers(env.dnsServers);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
  return mongoose.connection;
}

async function disconnectDb() {
  await mongoose.disconnect();
}

module.exports = { connectDb, disconnectDb };
