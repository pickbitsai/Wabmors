// Vercel serverless entry point. All routes are rewritten to this file
// via vercel.json; we re-export the Express app untouched.
module.exports = require('../server');
