const fs = require("fs");
const path = require("path");

// Committed ground truth for the anomaly evaluation in P3. Regenerated with
// `npm run seed:synthetic -- --write-labels`; a test fails if it drifts from
// what the default seed produces.
const LABELS_PATH = path.join(__dirname, "anomaly-labels.json");

const serializeLabels = (labels) => `${JSON.stringify(labels, null, 2)}\n`;

const writeLabels = (labels, file = LABELS_PATH) => {
  fs.writeFileSync(file, serializeLabels(labels));
};

module.exports = { LABELS_PATH, serializeLabels, writeLabels };
