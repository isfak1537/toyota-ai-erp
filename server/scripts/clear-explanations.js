#!/usr/bin/env node
// Clear the stored explanation of PENDING suggestions only, so the next view generates a new one.
//
//   npm run demo:clear-explanations                  dry run: prints how many rows it would change
//   npm run demo:clear-explanations -- --apply       writes, in one transaction
//   ... -- --apply --allow-remote                    only if the database host is not local and you mean it
//
// AiSuggestion.explanation and explanationSource are the only columns written. Decided suggestions and anomaly flags are not touched.
require("dotenv").config();

const { clearPendingExplanations } = require("../src/modules/demo/clear-explanations");

const main = async (argv, log = console.log) => {
  const known = new Set(["--apply", "--allow-remote"]);
  const unknown = argv.find((a) => !known.has(a));

  if (unknown) {
    log(`Unknown option ${unknown}\nUsage: node scripts/clear-explanations.js [--apply] [--allow-remote]`);

    return 2;
  }

  try {
    const result = await clearPendingExplanations({ apply: argv.includes("--apply"), allowRemote: argv.includes("--allow-remote") });

    log(
      result.applied
        ? `Cleared the explanation of ${result.count} PENDING suggestion(s).`
        : `DRY RUN, nothing is written: ${result.count} PENDING suggestion(s) have a stored explanation that would be cleared. Add --apply to do it.`,
    );

    return 0;
  } catch (error) {
    log(`Failed: ${error.message}`);

    return 1;
  }
};

module.exports = { main };

if (require.main === module) {
  main(process.argv.slice(2)).then(async (code) => {
    await require("../src/config/prisma").$disconnect();
    process.exitCode = code;
  });
}
