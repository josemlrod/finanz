import { beforeAll, describe, expect, test } from "bun:test";

const TEST_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

let encrypt: (plaintext: string) => string;
let decrypt: (ciphertext: string) => string;

beforeAll(async () => {
  process.env.PLAID_CLIENT_ID = "test-client-id";
  process.env.PLAID_SECRET = "test-secret";
  process.env.PLAID_ENV = "sandbox";
  process.env.PLAID_PRODUCTS = "transactions";
  process.env.PLAID_COUNTRY_CODES = "US";
  process.env.PLAID_TRANSACTIONS_DAYS_REQUESTED = "90";
  process.env.PLAID_TOKEN_ENCRYPTION_KEY = TEST_KEY;

  const crypto = await import("./crypto.server");
  encrypt = crypto.encrypt;
  decrypt = crypto.decrypt;
});

describe("encrypt/decrypt", () => {
  test("round-trips plaintext", () => {
    const plaintext = "access-sandbox-abc123";
    expect(decrypt(encrypt(plaintext))).toBe(plaintext);
  });

  test("uses a unique IV for each encryption", () => {
    const plaintext = "access-sandbox-abc123";
    expect(encrypt(plaintext)).not.toBe(encrypt(plaintext));
  });

  test("rejects tampered ciphertext", () => {
    const ciphertext = encrypt("secret-token");
    const [iv, authTag, payload] = ciphertext.split(":");
    // Replace the last char with a *different* one; a fixed replacement could
    // coincide with the original and leave the ciphertext untampered.
    const lastChar = payload!.slice(-1);
    const tampered = `${iv}:${authTag}:${payload!.slice(0, -1)}${lastChar === "0" ? "1" : "0"}`;

    expect(() => decrypt(tampered)).toThrow();
  });
});
