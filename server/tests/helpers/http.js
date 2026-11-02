// supertest with a valid token already attached, for tests that are not about auth.
const request = require("supertest");

const { BASELINE_ADMIN } = require("./db");
const authService = require("../../src/services/auth.service");

const METHODS = ["get", "post", "put", "patch", "delete"];

// authed(app) acts as the baseline ADMIN created by resetDatabase.
// authed(app, token) uses any other token (see helpers/auth.js).
const authed = (app, token = authService.signToken(BASELINE_ADMIN)) =>
  Object.fromEntries(
    METHODS.map((method) => [
      method,
      (...args) => request(app)[method](...args).set("Authorization", `Bearer ${token}`),
    ])
  );

module.exports = { authed };
