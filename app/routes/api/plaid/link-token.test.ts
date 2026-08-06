import { describe, expect, mock, test } from "bun:test";

const userId = "user_non_default";
const createLinkToken = mock(async () => "link-token");

mock.module("@clerk/react-router/server", () => ({
  getAuth: async () => ({ isAuthenticated: true, userId }),
}));

mock.module("~/lib/plaid/wiring.server", () => ({
  getPlaidService: () => ({ createLinkToken }),
}));

describe("POST /api/plaid/link-token", () => {
  test("forwards the authenticated Clerk userId to Plaid", async () => {
    const { action } = await import("./link-token");
    const request = new Request("http://localhost/api/plaid/link-token", {
      method: "POST",
      body: new FormData(),
    });

    await action({ request } as Parameters<typeof action>[0]);

    expect(createLinkToken).toHaveBeenCalledWith({
      userId,
      itemId: undefined,
    });
  });
});
