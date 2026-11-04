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

  it("forgets addresses whose attempts have all expired, so memory cannot grow without bound", () => {
    let t = 0;
    const limiter = createLoginLimiter({ max: 3, windowMs: 1000, now: () => t });

    for (let i = 0; i < 150; i += 1) run(limiter, `10.0.0.${i}`, `u${i}@x.com`);
    expect(limiter.size()).toBe(150);

    t = 5000; // everything above has expired
    for (let i = 0; i < 100; i += 1) run(limiter, "9.9.9.9", "fresh@x.com"); // enough calls to trigger a sweep

    expect(limiter.size()).toBe(1);
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
