// Turns Zod issues into { "dotted.path": message }. The first message per path
// wins. Unknown keys of a strict object are reported on the unknown key itself
// ("Zod reports them once on the parent with `keys`"), so clients see which
// field was not allowed.
const fieldDetails = (issues) =>
  issues.reduce((acc, issue) => {
    const targets =
      issue.code === "unrecognized_keys"
        ? issue.keys.map((key) => [...issue.path, key])
        : [issue.path];

    for (const path of targets) {
      const field = path.join(".");

      if (field && !(field in acc)) {
        acc[field] =
          issue.code === "unrecognized_keys" ? "Unknown field" : issue.message;
      }
    }

    return acc;
  }, {});

module.exports = { fieldDetails };
