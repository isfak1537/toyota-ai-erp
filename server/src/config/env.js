require("dotenv").config();

const env = {
  port: Number(process.env.PORT) || 5001,
  clientUrl: process.env.CLIENT_URL || "http://localhost:5173",
};

module.exports = env;