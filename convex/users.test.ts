import { afterAll, describe, expect, test } from "bun:test";
import { convexTest } from "convex-test";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = {
  "./_generated/api.js": () => import("./_generated/api.js"),
  "./users.ts": () => import("./users"),
};

describe("users.upsert", () => {
  const original = process.env.CONVEX_INTERNAL_SECRET;

  test("is idempotent per Clerk user", async () => {
    process.env.CONVEX_INTERNAL_SECRET = "expected-secret";
    const t = convexTest(schema, modules);

    const firstId = await t.mutation(api.users.upsert, {
      userId: "user_123",
      secret: "expected-secret",
    });
    const repeatedId = await t.mutation(api.users.upsert, {
      userId: "user_123",
      secret: "expected-secret",
    });
    const otherId = await t.mutation(api.users.upsert, {
      userId: "user_456",
      secret: "expected-secret",
    });
    const users = await t.run((ctx) => ctx.db.query("users").collect());

    expect(repeatedId).toBe(firstId);
    expect(otherId).not.toBe(firstId);
    expect(users.map(({ clerkUserId }) => clerkUserId).sort()).toEqual([
      "user_123",
      "user_456",
    ]);
  });

  afterAll(() => {
    if (original === undefined) {
      delete process.env.CONVEX_INTERNAL_SECRET;
    } else {
      process.env.CONVEX_INTERNAL_SECRET = original;
    }
  });
});
