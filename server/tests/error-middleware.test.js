const express = require("express");
const request = require("supertest");
const { z } = require("zod");

const errorMiddleware = require("../src/middlewares/error.middleware");
const validate = require("../src/middlewares/validate.middleware");
const {
  ConflictError,
  NotFoundError,
  ValidationError,
} = require("../src/errors/app-error");

const buildApp = (register) => {
  const app = express();

  app.use(express.json());
  register(app);
  app.use(errorMiddleware);

  return app;
};

describe("Express 5 async error forwarding", () => {
  it("maps an AppError thrown in a plain async controller (no try/catch, no wrapper)", async () => {
    const app = buildApp((a) => {
      a.get("/conflict", async () => {
        throw new ConflictError("Insufficient available stock");
      });
    });

    const res = await request(app).get("/conflict");

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      success: false,
      message: "Insufficient available stock",
    });
  });

  it("maps an AppError raised after an awaited call (rejected promise)", async () => {
    const app = buildApp((a) => {
      a.get("/missing", async () => {
        await Promise.resolve();
        throw new NotFoundError("Inventory record not found");
      });
    });

    const res = await request(app).get("/missing");

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      success: false,
      message: "Inventory record not found",
    });
  });

  it("includes details as errors for a ValidationError", async () => {
    const app = buildApp((a) => {
      a.post("/bad", async () => {
        throw new ValidationError("Validation failed", { quantity: "Required" });
      });
    });

    const res = await request(app).post("/bad").send({});

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      success: false,
      message: "Validation failed",
      errors: { quantity: "Required" },
    });
  });
});

describe("error middleware mapping", () => {
  let consoleError;

  beforeEach(() => {
    consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it("maps ZodError to 400 with dotted field paths", async () => {
    const schema = z.object({
      items: z.array(z.object({ quantity: z.number().positive() })),
    });

    const app = buildApp((a) => {
      a.post("/zod", async (req) => {
        schema.parse(req.body);
      });
    });

    const res = await request(app)
      .post("/zod")
      .send({ items: [{ quantity: -1 }] });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Validation failed");
    expect(Object.keys(res.body.errors)).toEqual(["items.0.quantity"]);
  });

  it("maps validate() middleware failures to 400 with field details", async () => {
    const schema = z.object({ sku: z.string().min(1, "SKU is required") });

    const app = buildApp((a) => {
      a.post("/validated", validate(schema), (req, res) => res.json({ ok: true }));
    });

    const res = await request(app).post("/validated").send({ sku: "" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      success: false,
      message: "Validation failed",
      errors: { sku: "SKU is required" },
    });
  });

  it("maps Prisma P2002 to 409 using meta.target when present", async () => {
    const app = buildApp((a) => {
      a.get("/dup", async () => {
        throw Object.assign(new Error("unique"), {
          code: "P2002",
          meta: { target: ["sku"] },
        });
      });
    });

    const res = await request(app).get("/dup");

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      success: false,
      message: "Product SKU already exists",
    });
  });

  it("maps Prisma P2002 without meta.target to a generic 409", async () => {
    const app = buildApp((a) => {
      a.get("/dup", async () => {
        throw Object.assign(new Error("unique"), { code: "P2002" });
      });
    });

    const res = await request(app).get("/dup");

    expect(res.status).toBe(409);
    expect(res.body.message).toBe("A record with the same unique value already exists");
  });

  it("maps Prisma P2025 to 404", async () => {
    const app = buildApp((a) => {
      a.get("/gone", async () => {
        throw Object.assign(new Error("not found"), { code: "P2025" });
      });
    });

    const res = await request(app).get("/gone");

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ success: false, message: "Record not found" });
  });

  it("keeps the status and details of legacy errors that set statusCode", async () => {
    const app = buildApp((a) => {
      a.get("/legacy", async () => {
        const error = new Error("Category not found");
        error.statusCode = 404;
        throw error;
      });
    });

    const res = await request(app).get("/legacy");

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ success: false, message: "Category not found" });
  });

  it("returns a generic 500 without leaking the message or stack", async () => {
    const app = buildApp((a) => {
      a.get("/boom", async () => {
        throw new Error("secret connection string");
      });
    });

    const res = await request(app).get("/boom");

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      success: false,
      message: "Internal server error",
    });
    expect(JSON.stringify(res.body)).not.toMatch(/secret|stack|at /);
    expect(consoleError).toHaveBeenCalled();
  });

  it("does not treat a 5xx statusCode on a plain error as client-safe", async () => {
    const app = buildApp((a) => {
      a.get("/legacy500", async () => {
        const error = new Error("db exploded");
        error.statusCode = 503;
        throw error;
      });
    });

    const res = await request(app).get("/legacy500");

    expect(res.status).toBe(500);
    expect(res.body.message).toBe("Internal server error");
  });

  it("maps a malformed JSON body to 400", async () => {
    const app = buildApp((a) => {
      a.post("/json", (req, res) => res.json({ ok: true }));
    });

    const res = await request(app)
      .post("/json")
      .set("Content-Type", "application/json")
      .send('{"broken":');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, message: "Malformed JSON body" });
  });
});
