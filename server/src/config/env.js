require("dotenv").config();

// Values are read when first used, not when this file loads, so tests and
// scripts can set them after requiring the module. Secrets only ever come from
// the environment; nothing here has a usable default for a secret.
const MIN_JWT_SECRET_LENGTH = 32;

const env = {
  port: Number(process.env.PORT) || 5001,
  clientUrl: process.env.CLIENT_URL || "http://localhost:5173",

  get jwtSecret() {
    const secret = process.env.JWT_SECRET;

    if (!secret || secret.length < MIN_JWT_SECRET_LENGTH) {
      throw new Error(
        `JWT_SECRET must be set to at least ${MIN_JWT_SECRET_LENGTH} characters`
      );
    }

    return secret;
  },

  get jwtExpiresIn() {
    return process.env.JWT_EXPIRES_IN || "8h";
  },
};

module.exports = env;
