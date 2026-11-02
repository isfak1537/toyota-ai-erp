// Test users and tokens. Users are written straight to the database (cheap hash
// rounds are not used: the real hashing is part of what the login tests cover).
const request = require("supertest");

const { prisma } = require("./db");
const authService = require("../../src/services/auth.service");

let counter = 0;

const createUser = async (role = "ADMIN", overrides = {}) => {
  counter += 1;
  const password = overrides.password ?? "correct-horse-battery";
  const { password: _ignored, ...rest } = overrides;

  const user = await prisma.user.create({
    data: {
      name: `Test ${role} ${counter}`,
      email: `${role.toLowerCase()}-${counter}-${Date.now()}@test.local`,
      role,
      passwordHash: await authService.hashPassword(password),
      ...rest,
    },
  });

  return { user, password, token: authService.signToken(user) };
};

const bearer = (token) => `Bearer ${token}`;

// supertest agent that sends a valid token for a fresh user of the given role.
const asRole = async (app, role = "ADMIN") => {
  const { token, user } = await createUser(role);
  const agent = request.agent(app).set("Authorization", bearer(token));

  return Object.assign(agent, { user });
};

module.exports = { createUser, bearer, asRole };
