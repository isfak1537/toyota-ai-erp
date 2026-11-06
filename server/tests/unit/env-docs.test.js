const fs = require("fs");
const path = require("path");

const repo = path.resolve(__dirname, "../../..");
const IGNORED = new Set(["NODE_ENV", "DOTENV_CONFIG_QUIET"]); // set by tooling, not by a person

const files = (dir, pattern, out = []) => {
  for (const name of fs.readdirSync(dir)) {
    if (["node_modules", "generated", ".venv", "dist", "tests", "notebooks", "models"].includes(name)) continue;
    const full = path.join(dir, name);

    if (fs.statSync(full).isDirectory()) files(full, pattern, out);
    else if (pattern.test(name)) out.push(full);
  }

  return out;
};

const variablesIn = (list, regexes) => {
  const found = new Map();

  for (const file of list) {
    const text = fs.readFileSync(file, "utf8");

    for (const re of regexes) for (const m of text.matchAll(re)) if (!IGNORED.has(m[1])) found.set(m[1], path.relative(repo, file));
  }

  return found;
};

const docs = fs.readFileSync(path.join(repo, "docs/deployment.md"), "utf8");
const example = (file) => fs.readFileSync(path.join(repo, file), "utf8");

describe("every setting the code reads is documented", () => {
  it("the ERP API's variables are in docs/deployment.md and server/.env.example", () => {
    const used = variablesIn(
      [...files(path.join(repo, "server/src"), /\.js$/), ...files(path.join(repo, "server/scripts"), /\.js$/), ...files(path.join(repo, "server/prisma"), /\.js$/), path.join(repo, "server/prisma.config.ts")],
      [/process\.env\.([A-Z][A-Z0-9_]+)/g, /process\.env\["([A-Z][A-Z0-9_]+)"\]/g]
    );
    const example_ = example("server/.env.example");
    const missing = [...used].filter(([name]) => !docs.includes(`\`${name}\``) || !new RegExp(`^#?\\s*${name}=`, "m").test(example_)).map(([name, file]) => `${name} (read in ${file})`);

    expect(used.size).toBeGreaterThan(15);
    expect(missing).toEqual([]);
  });

  it("the AI service's variables are in docs/deployment.md and ai-service/.env.example", () => {
    const used = variablesIn(files(path.join(repo, "ai-service/app"), /\.py$/), [/\.get\("([A-Z][A-Z0-9_]+)"\)/g, /environ(?:\.get)?[\[(]"([A-Z][A-Z0-9_]+)"/g]);
    const example_ = example("ai-service/.env.example");
    const missing = [...used].filter(([name]) => !docs.includes(`\`${name}\``) || !new RegExp(`^${name}=`, "m").test(example_)).map(([name, file]) => `${name} (read in ${file})`);

    expect([...used.keys()].sort()).toEqual(["AI_AUTOTRAIN", "AI_DB_URL", "AI_MODEL_DIR", "AI_SERVICE_SECRET", "AI_TZ_OFFSET_HOURS"]);
    expect(missing).toEqual([]);
  });

  it("the example files hold no real-looking values", () => {
    for (const file of ["server/.env.example", "client/.env.example", "ai-service/.env.example"]) {
      const text = example(file);

      expect(text).not.toMatch(/gsk_[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{30,}|sk-[A-Za-z0-9]{20,}/); // key shapes of Groq, Google, OpenAI
      expect(text).not.toMatch(/postgres(ql)?:\/\/[^:\s]+:(?!CHANGE_ME|PASSWORD)[^@\s]{6,}@(?!localhost)/); // a real remote connection string
    }
  });
});
