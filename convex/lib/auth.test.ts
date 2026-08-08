import { afterAll, describe, expect, test } from "bun:test";
import { requireInternalSecret } from "./auth";

describe("requireInternalSecret", () => {
  const original = process.env.CONVEX_INTERNAL_SECRET;

  test("accepts a matching secret", () => {
    process.env.CONVEX_INTERNAL_SECRET = "expected-secret";
    expect(() => requireInternalSecret("expected-secret")).not.toThrow();
  });

  test("rejects a missing secret", () => {
    process.env.CONVEX_INTERNAL_SECRET = "expected-secret";
    expect(() => requireInternalSecret(undefined)).toThrow(
      "Unauthorized: invalid internal secret",
    );
  });

  test("rejects a wrong secret", () => {
    process.env.CONVEX_INTERNAL_SECRET = "expected-secret";
    expect(() => requireInternalSecret("wrong-secret")).toThrow(
      "Unauthorized: invalid internal secret",
    );
  });

  test("rejects when deployment secret is unset", () => {
    delete process.env.CONVEX_INTERNAL_SECRET;
    expect(() => requireInternalSecret("anything")).toThrow(
      "Unauthorized: invalid internal secret",
    );
  });

  afterAll(() => {
    if (original === undefined) {
      delete process.env.CONVEX_INTERNAL_SECRET;
    } else {
      process.env.CONVEX_INTERNAL_SECRET = original;
    }
  });
});
