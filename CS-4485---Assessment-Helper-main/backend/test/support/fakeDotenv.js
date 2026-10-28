// Stand-in for `require('dotenv')`: the demos and tests must not read a developer's real .env file.
module.exports = { config() { return { parsed: {} }; } };
