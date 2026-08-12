import { CountryCode, Products } from "plaid";
import type { RequiredEnvKey } from "./env.keys";

function required(name: RequiredEnvKey): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string): string | undefined {
  const value = process.env[name];
  return value || undefined;
}

function parseList(value: string, name: string): string[] {
  const items = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (items.length === 0) {
    throw new Error(`${name} must contain at least one value`);
  }
  return items;
}

function parsePositiveInt(name: string, value: string, max?: number): number {
  const normalized = value.trim();
  if (!/^[1-9]\d*$/.test(normalized)) {
    throw new Error(`${name} must be a positive integer`);
  }

  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${name} must be a positive integer`);
  }
  if (max !== undefined && parsed > max) {
    throw new Error(`${name} must be between 1 and ${max}`);
  }

  return parsed;
}

function parseEnumList<Value extends string>(
  value: string,
  name: string,
  allowedValues: readonly Value[],
): Value[] {
  const items = parseList(value, name);
  const allowed = new Set<string>(allowedValues);
  const invalid = items.find((item) => !allowed.has(item));
  if (invalid) {
    throw new Error(`Invalid ${name} value: ${invalid}`);
  }
  return items as Value[];
}

function parseEncryptionKey(value: string): string {
  if (/^[0-9a-fA-F]{64}$/.test(value)) {
    return value;
  }

  const decoded = Buffer.from(value, "base64");
  if (decoded.length === 32) {
    return decoded.toString("hex");
  }

  throw new Error(
    "PLAID_TOKEN_ENCRYPTION_KEY must be 32 bytes (64 hex chars or base64-encoded 32 bytes)",
  );
}

const plaidEnv = required("PLAID_ENV");
if (plaidEnv !== "sandbox" && plaidEnv !== "production") {
  throw new Error(`Invalid PLAID_ENV: ${plaidEnv}. Must be sandbox or production.`);
}

export const env = {
  PLAID_CLIENT_ID: required("PLAID_CLIENT_ID"),
  PLAID_SECRET: required("PLAID_SECRET"),
  PLAID_ENV: plaidEnv,
  PLAID_PRODUCTS: parseEnumList(
    required("PLAID_PRODUCTS"),
    "PLAID_PRODUCTS",
    Object.values(Products),
  ),
  PLAID_COUNTRY_CODES: parseEnumList(
    required("PLAID_COUNTRY_CODES"),
    "PLAID_COUNTRY_CODES",
    Object.values(CountryCode),
  ),
  PLAID_TRANSACTIONS_DAYS_REQUESTED: parsePositiveInt(
    "PLAID_TRANSACTIONS_DAYS_REQUESTED",
    required("PLAID_TRANSACTIONS_DAYS_REQUESTED"),
    730,
  ),
  PLAID_TOKEN_ENCRYPTION_KEY: parseEncryptionKey(
    required("PLAID_TOKEN_ENCRYPTION_KEY"),
  ),
  PLAID_REDIRECT_URI: optional("PLAID_REDIRECT_URI"),
  PLAID_WEBHOOK_URL: optional("PLAID_WEBHOOK_URL"),
  PLAID_SANDBOX_LINK_PHONE: optional("PLAID_SANDBOX_LINK_PHONE"),

  CLERK_SECRET_KEY: required("CLERK_SECRET_KEY"),
  VITE_CLERK_PUBLISHABLE_KEY: required("VITE_CLERK_PUBLISHABLE_KEY"),

  CONVEX_URL: required("CONVEX_URL"),
  CONVEX_INTERNAL_SECRET: required("CONVEX_INTERNAL_SECRET"),
} as const;

export type PlaidEnvName = typeof env.PLAID_ENV;
