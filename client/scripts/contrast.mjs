// WCAG 2.x contrast ratios for the colour pairs the UI actually uses, read from src/styles/tokens.css.
// `npm run contrast` prints the table (pasted into docs/design.md); src/styles/contrast.test.ts enforces the minimums.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// run from client/ (npm test and npm run contrast both do)
export const TOKENS_PATH = resolve(process.cwd(), "src/styles/tokens.css");

// [foreground token, background token, minimum ratio, where it is used]
export const PAIRS = [
  ["text", "bg", 4.5, "body text on the page"],
  ["text", "surface", 4.5, "body text on cards and tables"],
  ["text-muted", "surface", 4.5, "secondary text on cards"],
  ["text-muted", "bg", 4.5, "secondary text on the page"],
  ["text-faint", "surface", 4.5, "captions, table headers"],
  ["text-faint", "bg", 4.5, "captions on the page"],
  ["primary", "surface", 4.5, "links and text buttons"],
  ["primary", "primary-soft", 4.5, "selected tab, soft badge"],
  ["surface", "primary", 4.5, "primary button label"],
  ["surface", "primary-hover", 4.5, "primary button label, hovered"],
  ["nav-text", "nav-bg", 4.5, "navigation links"],
  ["nav-text-strong", "nav-active", 4.5, "active navigation link"],
  ["nav-section", "nav-bg", 4.5, "navigation section labels"],
  ["nav-text-strong", "nav-hover", 4.5, "hovered navigation link"],
  ["on-solid", "ai", 4.5, "AI button label"],
  ["on-solid", "ai-hover", 4.5, "AI button label, hovered"],
  ["danger", "danger-soft", 4.5, "error badge and banner"],
  ["nav-text", "nav-active", 4.5, "navigation text over the active row"],
  ["success", "success-soft", 4.5, "success badge"],
  ["warning", "warning-soft", 4.5, "warning badge"],
  ["info", "info-soft", 4.5, "info badge"],
  ["neutral-text", "neutral-soft", 4.5, "neutral badge"],
  ["banner-warning-text", "warning-soft", 4.5, "warning banner text"],
  ["banner-info-text", "info-soft", 4.5, "info banner text"],
  ["banner-danger-text", "danger-soft", 4.5, "error banner text"],
  ["banner-ai-text", "ai-soft", 4.5, "AI banner text"],
  ["hero-text", "hero-bg", 4.5, "login panel text"],
  ["chart-actual", "surface", 3, "chart line: actual (non-text, 3:1)"],
  ["chart-baseline", "surface", 3, "chart line: baseline (non-text, 3:1)"],
  ["chart-ml", "surface", 3, "chart line: model (non-text, 3:1)"],
  ["success", "surface", 4.5, "success text on cards"],
  ["danger", "surface", 4.5, "error text on cards"],
  ["ai", "ai-soft", 4.5, "AI chip, AI explanation text"],
  ["ai", "surface", 4.5, "AI text on cards"],
  ["focus", "bg", 3, "focus ring against the page (non-text, 3:1)"],
  ["focus", "surface", 3, "focus ring against cards (non-text, 3:1)"],
  ["border-strong", "surface", 3, "input and button borders (non-text, 3:1)"],
  ["border-strong", "bg", 3, "input borders on the page (non-text, 3:1)"],
];

export const readTokens = (css = readFileSync(TOKENS_PATH, "utf8")) =>
  Object.fromEntries([...css.matchAll(/--color-([a-z-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map((m) => [m[1], m[2].toLowerCase()]));

const channel = (v) => {
  const c = v / 255;

  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

export const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => channel(parseInt(hex.slice(i, i + 2), 16)));

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

export const ratio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);

  return (hi + 0.05) / (lo + 0.05);
};

export const table = (tokens = readTokens()) =>
  PAIRS.map(([fg, bg, min, use]) => {
    if (!tokens[fg] || !tokens[bg]) throw new Error(`Unknown token in pair ${fg} / ${bg}`);

    return { fg, bg, fgHex: tokens[fg], bgHex: tokens[bg], min, ratio: ratio(tokens[fg], tokens[bg]), use };
  });

if (process.argv[1] && process.argv[1].endsWith("contrast.mjs")) {
  console.log("| Text / element | On | Ratio | Needed | Used for |\n|---|---|---|---|---|");
  for (const r of table()) {
    console.log(`| \`${r.fg}\` ${r.fgHex} | \`${r.bg}\` ${r.bgHex} | ${r.ratio.toFixed(2)} | ${r.min} | ${r.use} |`);
  }
}
