import type { PlaidError as SdkPlaidError } from "plaid";
import type { ItemHealth } from "~/lib/plaid/types";

export interface PlaidError {
  error_code: string;
  error_type: string;
  display_message: string | null;
  request_id?: string;
}

export const PLAID_ERROR_CODES = {
  TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION:
    "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION",
  PRODUCT_NOT_READY: "PRODUCT_NOT_READY",
  ITEM_LOGIN_REQUIRED: "ITEM_LOGIN_REQUIRED",
  ITEM_LOCKED: "ITEM_LOCKED",
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
  INVALID_MFA: "INVALID_MFA",
  INSUFFICIENT_CREDENTIALS: "INSUFFICIENT_CREDENTIALS",
  ACCESS_NOT_GRANTED: "ACCESS_NOT_GRANTED",
  PENDING_EXPIRATION: "PENDING_EXPIRATION",
  PENDING_DISCONNECT: "PENDING_DISCONNECT",
} as const;

/** Fixable by sending the user back through Link in update mode. */
const REAUTH_REQUIRED_CODES: ReadonlySet<string> = new Set([
  PLAID_ERROR_CODES.ITEM_LOGIN_REQUIRED,
  PLAID_ERROR_CODES.ITEM_LOCKED,
  PLAID_ERROR_CODES.INVALID_CREDENTIALS,
  PLAID_ERROR_CODES.INVALID_MFA,
  PLAID_ERROR_CODES.INSUFFICIENT_CREDENTIALS,
  PLAID_ERROR_CODES.ACCESS_NOT_GRANTED,
]);

/** Still readable, but consent lapses soon unless the user re-authenticates. */
const CONSENT_EXPIRING_CODES: ReadonlySet<string> = new Set([
  PLAID_ERROR_CODES.PENDING_EXPIRATION,
  PLAID_ERROR_CODES.PENDING_DISCONNECT,
]);

const FALLBACK_MESSAGES: Record<string, string> = {
  [PLAID_ERROR_CODES.ITEM_LOGIN_REQUIRED]:
    "Your bank needs you to sign in again to keep sharing data.",
  [PLAID_ERROR_CODES.ITEM_LOCKED]:
    "Your bank locked this account after too many failed sign-in attempts.",
  [PLAID_ERROR_CODES.INVALID_CREDENTIALS]:
    "The saved credentials for this bank are no longer valid.",
  [PLAID_ERROR_CODES.INVALID_MFA]:
    "Multi-factor authentication failed. Reconnect to try again.",
  [PLAID_ERROR_CODES.INSUFFICIENT_CREDENTIALS]:
    "Your bank asked for additional credentials.",
  [PLAID_ERROR_CODES.ACCESS_NOT_GRANTED]:
    "Access to this data was not granted. Reconnect and approve all accounts.",
  [PLAID_ERROR_CODES.PENDING_EXPIRATION]:
    "Access to this bank expires soon. Reconnect to keep it active.",
  [PLAID_ERROR_CODES.PENDING_DISCONNECT]:
    "Your bank is ending this connection soon. Reconnect to keep it active.",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSdkPlaidError(value: unknown): value is SdkPlaidError {
  return (
    isRecord(value) &&
    typeof value.error_code === "string" &&
    typeof value.error_type === "string"
  );
}

function extractSdkError(error: unknown): SdkPlaidError | null {
  if (isSdkPlaidError(error)) {
    return error;
  }

  if (isRecord(error) && "response" in error) {
    const response = error.response;
    if (isRecord(response) && "data" in response) {
      const data = response.data;
      if (isSdkPlaidError(data)) {
        return data;
      }
    }
  }

  return null;
}

export function normalizePlaidError(error: unknown): PlaidError {
  const sdkError = extractSdkError(error);
  if (sdkError) {
    return {
      error_code: sdkError.error_code,
      error_type: String(sdkError.error_type),
      display_message: sdkError.display_message ?? null,
      request_id: sdkError.request_id,
    };
  }

  if (error instanceof Error) {
    return {
      error_code: "UNKNOWN",
      error_type: "UNKNOWN",
      display_message: error.message,
    };
  }

  return {
    error_code: "UNKNOWN",
    error_type: "UNKNOWN",
    display_message: "An unexpected error occurred",
  };
}

export function isPlaidError(error: unknown): error is PlaidError {
  return isRecord(error) && typeof error.error_code === "string";
}

export function isMutationDuringPagination(error: PlaidError): boolean {
  return (
    error.error_code ===
    PLAID_ERROR_CODES.TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION
  );
}

export function isProductNotReady(error: PlaidError): boolean {
  return error.error_code === PLAID_ERROR_CODES.PRODUCT_NOT_READY;
}

export function requiresReauth(error: PlaidError): boolean {
  return REAUTH_REQUIRED_CODES.has(error.error_code);
}

export function isConsentExpiring(error: PlaidError): boolean {
  return CONSENT_EXPIRING_CODES.has(error.error_code);
}

/** Classify a failed Item read so the dashboard can offer the right recovery. */
export function toItemHealth(error: unknown): ItemHealth {
  const plaidError = normalizePlaidError(error);
  const message =
    plaidError.display_message ??
    FALLBACK_MESSAGES[plaidError.error_code] ??
    "Could not reach this bank.";

  if (requiresReauth(plaidError)) {
    return {
      state: "reauth_required",
      errorCode: plaidError.error_code,
      message,
    };
  }

  if (isConsentExpiring(plaidError)) {
    return {
      state: "consent_expiring",
      errorCode: plaidError.error_code,
      message,
    };
  }

  return { state: "error", errorCode: plaidError.error_code, message };
}

export const HEALTHY_ITEM: ItemHealth = {
  state: "ok",
  errorCode: null,
  message: null,
};
