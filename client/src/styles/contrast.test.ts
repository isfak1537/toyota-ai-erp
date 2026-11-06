import { describe, expect, it } from "vitest";
// @ts-expect-error plain JavaScript module shared with `npm run contrast`
import { luminance, PAIRS, ratio, readTokens, table } from "../../scripts/contrast.mjs";

describe("colour contrast of the design tokens", () => {
  it("computes known WCAG values", () => {
    expect(luminance("#ffffff")).toBeCloseTo(1, 5);
    expect(ratio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(ratio("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
  });

  it("reads every token the pairs name", () => {
    const tokens = readTokens();

    for (const [fg, bg] of PAIRS) {
      expect(tokens[fg], fg).toBeDefined();
      expect(tokens[bg], bg).toBeDefined();
    }
  });

  it.each(table() as { fg: string; bg: string; ratio: number; min: number }[])("$fg on $bg is at least $min:1", (row) => {
    expect(row.ratio).toBeGreaterThanOrEqual(row.min);
  });

  it("fails when a token is made too light (the check is sensitive)", () => {
    const tokens = { ...readTokens(), "text-muted": "#b0b8b3" };
    const failing = (table(tokens) as { ratio: number; min: number }[]).filter((r) => r.ratio < r.min);

    expect(failing.length).toBeGreaterThan(0);
  });
});
