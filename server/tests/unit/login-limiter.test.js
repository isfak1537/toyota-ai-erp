const { createLoginLimiter } = require("../../src/middlewares/login-limiter");

const run = (limiter, ip, email) => {
  let outcome;

  limiter({ ip, body: { email } }, {}, (err) => {
    outcome = err ? err.statusCode : "ok";
  });

  return outcome;
};

describe("login limiter", () => {
  it("allows `max` attempts per window per address+email, then 429, then recovers", () => {
    let t = 0;
    const limiter = createLoginLimiter({ max: 3, windowMs: 1000, now: () => t });

    expect([1, 2, 3].map(() => run(limiter, "1.1.1.1", "a@x.com"))).toEqual(["ok", "ok", "ok"]);
    expect(run(limiter, "1.1.1.1", "a@x.com")).toBe(429);
    expect(run(limiter, "1.1.1.1", "A@x.com")).toBe(429); // case-insensitive
    expect(run(limiter, "1.1.1.1", "b@x.com")).toBe("ok"); // other email
    expect(run(limiter, "2.2.2.2", "a@x.com")).toBe("ok"); // other address

    t = 1000; // window elapsed
    expect(run(limiter, "1.1.1.1", "a@x.com")).toBe("ok");
  });

  it("limits one address that tries many different accounts (password spraying), without hurting other addresses", () => {
    const limiter = createLoginLimiter({ max: 10, maxPerAddress: 5, windowMs: 1000, now: () => 0 });

    const results = [1, 2, 3, 4, 5, 6, 7].map((i) => run(limiter, "6.6.6.6", `victim${i}@x.com`)); // a different account each time

    expect(results).toEqual(["ok", "ok", "ok", "ok", "ok", 429, 429]);
    expect(run(limiter, "7.7.7.7", "victim1@x.com")).toBe("ok"); // another address is unaffected
  });

  it("a blocked attempt does not extend the block (the window keeps sliding)", () => {
    let t = 0;
    const limiter = createLoginLimiter({ max: 2, maxPerAddress: 100, windowMs: 1000, now: () => t });

    run(limiter, "1.1.1.1", "a@x.com");
    run(limiter, "1.1.1.1", "a@x.com");
    t = 500;
    expect(run(limiter, "1.1.1.1", "a@x.com")).toBe(429);
    t = 1001; // the first two attempts are now outside the window; the blocked one at 500 was not recorded
    expect(run(limiter, "1.1.1.1", "a@x.com")).toBe("ok");
  });

  it("forgets addresses whose attempts have all expired, so memory cannot grow without bound", () => {
    let t = 0;
    const limiter = createLoginLimiter({ max: 3, windowMs: 1000, now: () => t });

    for (let i = 0; i < 150; i += 1) run(limiter, `10.0.0.${i}`, `u${i}@x.com`);
    expect(limiter.size()).toBe(300); // one entry per address and email, plus one per address

    t = 5000; // everything above has expired
    for (let i = 0; i < 100; i += 1) run(limiter, "9.9.9.9", "fresh@x.com"); // enough calls to trigger a sweep

    expect(limiter.size()).toBe(2); // the fresh address: its address-and-email entry and its address entry
  });

  it("keeps an address that is still inside its window when it sweeps", () => {
    let t = 0;
    const limiter = createLoginLimiter({ max: 3, windowMs: 1000, now: () => t });

    for (let i = 0; i < 3; i += 1) run(limiter, "1.1.1.1", "a@x.com");
    t = 900;
    for (let i = 0; i < 100; i += 1) run(limiter, "2.2.2.2", `u${i}@x.com`);

    expect(run(limiter, "1.1.1.1", "a@x.com")).toBe(429); // still blocked: its attempts were not forgotten
  });
});
