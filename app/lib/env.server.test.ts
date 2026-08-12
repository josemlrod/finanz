import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { REQUIRED_ENV_KEYS } from "./env.keys";

const projectRoot = path.resolve(import.meta.dir, "../..");

const ENV_KEYS = [
  ...REQUIRED_ENV_KEYS,
  "PLAID_REDIRECT_URI",
  "PLAID_WEBHOOK_URL",
  "PLAID_SANDBOX_LINK_PHONE",
] as const;

function parseEnvExampleKeys(filePath: string): string[] {
  const content = fs.readFileSync(filePath, "utf8");
  const keys: string[] = [];

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const match = trimmed.match(/^([A-Z][A-Z0-9_]+)=/);
    if (match) {
      keys.push(match[1]);
    }
  }

  return keys;
}

function loadEnv(extra: Record<string, string> = {}) {
  const env = { ...process.env } as Record<string, string | undefined>;
  for (const key of ENV_KEYS) {
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
    CLERK_SECRET_KEY: "test-clerk-secret",
    VITE_CLERK_PUBLISHABLE_KEY: "test-clerk-publishable",
    CONVEX_URL: "https://example.convex.cloud",
    CONVEX_INTERNAL_SECRET: "test-convex-secret",
    ...overrides,
  };
}

describe("env.server", () => {
  test("fails fast when required vars are missing", () => {
    const result = loadEnv();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Missing required environment variable");
  });

  test("fails fast when Convex vars are missing", () => {
    const result = loadEnv(
      validEnv({
        CONVEX_URL: "",
        CONVEX_INTERNAL_SECRET: "",
      }),
    );
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

  test(".env.example documents every required boot env var", () => {
    const envExamplePath = path.join(projectRoot, ".env.example");
    const documentedKeys = parseEnvExampleKeys(envExamplePath);

    for (const key of REQUIRED_ENV_KEYS) {
      expect(documentedKeys).toContain(key);
    }
  });
});
