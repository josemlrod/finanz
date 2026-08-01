import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dir, "../..");

const PLAID_ENV_KEYS = [
  "PLAID_CLIENT_ID",
  "PLAID_SECRET",
  "PLAID_ENV",
  "PLAID_PRODUCTS",
  "PLAID_COUNTRY_CODES",
  "PLAID_TRANSACTIONS_DAYS_REQUESTED",
  "PLAID_TOKEN_ENCRYPTION_KEY",
  "PLAID_REDIRECT_URI",
  "PLAID_WEBHOOK_URL",
  "PLAID_SANDBOX_LINK_PHONE",
] as const;

function loadEnv(extra: Record<string, string> = {}) {
  const env = { ...process.env } as Record<string, string | undefined>;
  for (const key of PLAID_ENV_KEYS) {
    delete env[key];
  }
  Object.assign(env, extra);

  const result = spawnSync(
    "bun",
    ["--env-file=/dev/null", "-e", "import('./app/lib/env.server.ts')"],
    {
      cwd: projectRoot,
      env: env as NodeJS.ProcessEnv,
      encoding: "utf8",
    },
  );

  return {
    status: result.status,
    stderr: result.stderr,
    stdout: result.stdout,
  };
}

function validEnv(overrides: Record<string, string> = {}) {
  return {
    PLAID_CLIENT_ID: "test-client-id",
    PLAID_SECRET: "test-secret",
    PLAID_ENV: "sandbox",
    PLAID_PRODUCTS: "transactions",
    PLAID_COUNTRY_CODES: "US",
    PLAID_TRANSACTIONS_DAYS_REQUESTED: "90",
    PLAID_TOKEN_ENCRYPTION_KEY:
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    ...overrides,
  };
}

describe("env.server", () => {
  test("fails fast when required vars are missing", () => {
    const result = loadEnv();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Missing required environment variable");
  });

  test("accepts valid sandbox configuration", () => {
    const result = loadEnv(validEnv());

    expect(result.status).toBe(0);
  });

  test("rejects invalid PLAID_ENV", () => {
    const result = loadEnv(validEnv({ PLAID_ENV: "staging" }));

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Invalid PLAID_ENV");
  });

  test("rejects trailing characters in integer values", () => {
    const result = loadEnv(
      validEnv({ PLAID_TRANSACTIONS_DAYS_REQUESTED: "90days" }),
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("must be a positive integer");
  });

  test("rejects transaction history beyond Plaid's maximum", () => {
    const result = loadEnv(
      validEnv({ PLAID_TRANSACTIONS_DAYS_REQUESTED: "731" }),
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("must be between 1 and 730");
  });

  test("rejects unknown Plaid products", () => {
    const result = loadEnv(validEnv({ PLAID_PRODUCTS: "transactionz" }));

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Invalid PLAID_PRODUCTS value");
  });

  test("rejects unknown Plaid country codes", () => {
    const result = loadEnv(validEnv({ PLAID_COUNTRY_CODES: "USA" }));

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Invalid PLAID_COUNTRY_CODES value");
  });
});
