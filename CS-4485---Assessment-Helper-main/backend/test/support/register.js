// Makes the backend run with plain `node`, no database and no npm install, by swapping the packages it requires
// (mongoose, express, dotenv) for the in-memory stand-ins in this folder. The backend files themselves are never edited.
//
//   node --require ./test/support/register.js <script>        (npm test and the demos do this for you)
//
// Only these three are replaced. Everything else - the login tokens (services/jwt.js), CORS (middleware/cors.js), the
// password hashing - is the real code, because it uses nothing but node:crypto.
const Module = require('node:module');

const standIns = {
  mongoose: () => require('./fakeMongoose'),
  express: () => require('./fakeExpress'),
  dotenv: () => require('./fakeDotenv'),
};

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (Object.prototype.hasOwnProperty.call(standIns, request)) return standIns[request]();
  return originalLoad.call(this, request, parent, isMain);
};

module.exports = { standIns: Object.keys(standIns) };
