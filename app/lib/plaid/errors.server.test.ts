import { describe, expect, test } from "bun:test";
import {
  isConsentExpiring,
  isMutationDuringPagination,
  isProductNotReady,
  normalizePlaidError,
  PLAID_ERROR_CODES,
  requiresReauth,
  toItemHealth,
} from "./errors.server";

function plaidApiError(errorCode: string, displayMessage: string | null = null) {
  return {
    response: {
      data: {
        error_type: "ITEM_ERROR",
        error_code: errorCode,
        error_message: errorCode.toLowerCase(),
        display_message: displayMessage,
      },
    },
  };
}

describe("normalizePlaidError", () => {
  test("maps SDK-shaped axios response errors", () => {
    const error = {
      response: {
        data: {
          error_type: "ITEM_ERROR",
          error_code: "ITEM_LOGIN_REQUIRED",
          error_message: "the login details of this item have changed",
          display_message:
            "The login details of this item have changed. Please re-link.",
          request_id: "abc123",
        },
      },
    };

    expect(normalizePlaidError(error)).toEqual({
      error_code: "ITEM_LOGIN_REQUIRED",
      error_type: "ITEM_ERROR",
      display_message:
        "The login details of this item have changed. Please re-link.",
      request_id: "abc123",
    });
  });

  test("recognizes mutation-during-pagination", () => {
    const error = normalizePlaidError({
      response: {
        data: {
          error_type: "TRANSACTIONS_ERROR",
          error_code:
            PLAID_ERROR_CODES.TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION,
          error_message: "mutation during pagination",
          display_message: null,
        },
      },
    });

    expect(isMutationDuringPagination(error)).toBe(true);
    expect(isProductNotReady(error)).toBe(false);
  });

  test("recognizes product-not-ready", () => {
    const error = normalizePlaidError({
      response: {
        data: {
          error_type: "ITEM_ERROR",
          error_code: PLAID_ERROR_CODES.PRODUCT_NOT_READY,
          error_message: "product not ready",
          display_message: "Product is not yet ready.",
        },
      },
    });

    expect(isProductNotReady(error)).toBe(true);
    expect(isMutationDuringPagination(error)).toBe(false);
  });

  test("falls back for unknown errors", () => {
    expect(normalizePlaidError(new Error("network down"))).toEqual({
      error_code: "UNKNOWN",
      error_type: "UNKNOWN",
      display_message: "network down",
    });
  });
});

describe("item error classification", () => {
  test("flags credential failures as re-authenticable", () => {
    for (const code of [
      PLAID_ERROR_CODES.ITEM_LOGIN_REQUIRED,
      PLAID_ERROR_CODES.ITEM_LOCKED,
      PLAID_ERROR_CODES.INVALID_CREDENTIALS,
      PLAID_ERROR_CODES.INVALID_MFA,
      PLAID_ERROR_CODES.INSUFFICIENT_CREDENTIALS,
      PLAID_ERROR_CODES.ACCESS_NOT_GRANTED,
    ]) {
      const error = normalizePlaidError(plaidApiError(code));
      expect(requiresReauth(error)).toBe(true);
      expect(isConsentExpiring(error)).toBe(false);
    }
  });

  test("separates expiring consent from an already-broken Item", () => {
    for (const code of [
      PLAID_ERROR_CODES.PENDING_EXPIRATION,
      PLAID_ERROR_CODES.PENDING_DISCONNECT,
    ]) {
      const error = normalizePlaidError(plaidApiError(code));
      expect(isConsentExpiring(error)).toBe(true);
      expect(requiresReauth(error)).toBe(false);
    }
  });

  test("does not treat sync-protocol errors as Item failures", () => {
    const error = normalizePlaidError(
      plaidApiError(PLAID_ERROR_CODES.PRODUCT_NOT_READY),
    );
    expect(requiresReauth(error)).toBe(false);
    expect(isConsentExpiring(error)).toBe(false);
  });
});

describe("toItemHealth", () => {
  test("maps a login-required failure to the reconnect state", () => {
    expect(
      toItemHealth(plaidApiError(PLAID_ERROR_CODES.ITEM_LOGIN_REQUIRED)),
    ).toEqual({
      state: "reauth_required",
      errorCode: PLAID_ERROR_CODES.ITEM_LOGIN_REQUIRED,
      message: "Your bank needs you to sign in again to keep sharing data.",
    });
  });

  test("prefers Plaid's display message over the fallback copy", () => {
    expect(
      toItemHealth(
        plaidApiError(PLAID_ERROR_CODES.ITEM_LOGIN_REQUIRED, "Sign in again."),
      ).message,
    ).toBe("Sign in again.");
  });

  test("maps pending expiration to a non-blocking warning", () => {
    expect(
      toItemHealth(plaidApiError(PLAID_ERROR_CODES.PENDING_EXPIRATION)).state,
    ).toBe("consent_expiring");
  });

  test("falls back to a generic error for unrecognized failures", () => {
    expect(toItemHealth(new Error("socket hang up"))).toEqual({
      state: "error",
      errorCode: "UNKNOWN",
      message: "socket hang up",
    });
  });
});
