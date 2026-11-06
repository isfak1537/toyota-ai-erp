// Vercel entry point: the same Express app, served as one serverless function (see vercel.json).
// Nothing here listens on a port; Vercel calls the exported app with each request.
const app = require("../src/app");

module.exports = app;
