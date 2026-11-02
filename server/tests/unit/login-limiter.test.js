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
});
