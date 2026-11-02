require("dotenv").config();

const env = require("./config/env");
const app = require("./app");

app.listen(env.port, () => {
  console.log(`Server running on http://localhost:${env.port}`);
});
