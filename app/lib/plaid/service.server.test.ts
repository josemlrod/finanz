import { beforeAll, describe, expect, test } from "bun:test";
import type { PlaidApi } from "plaid";
import type {
  AccountStore,
  ItemHealth,
  ItemStore,
  PlaidItem,
  TransactionStore,
} from "~/lib/plaid/types";

const TEST_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

let createPlaidService: typeof import("./service.server").createPlaidService;
let encrypt: typeof import("~/lib/crypto.server").encrypt;

beforeAll(async () => {
  process.env.PLAID_CLIENT_ID = "test-client-id";
  process.env.PLAID_SECRET = "test-secret";
  process.env.PLAID_ENV = "sandbox";
  process.env.PLAID_PRODUCTS = "transactions";
  process.env.PLAID_COUNTRY_CODES = "US";
  process.env.PLAID_TRANSACTIONS_DAYS_REQUESTED = "90";
  process.env.PLAID_TOKEN_ENCRYPTION_KEY = TEST_KEY;
  process.env.CLERK_SECRET_KEY = "test-clerk-secret";
  process.env.VITE_CLERK_PUBLISHABLE_KEY = "test-clerk-publishable";
  process.env.CONVEX_URL = "https://example.convex.cloud";
  process.env.CONVEX_INTERNAL_SECRET = "test-convex-secret";

  ({ encrypt } = await import("~/lib/crypto.server"));
  ({ createPlaidService } = await import("./service.server"));
});

const userId = "user_test";

function createItemStore(item: PlaidItem, events: string[] = []): ItemStore {
  return {
    async save(receivedUserId, nextItem) {
      expect(receivedUserId).toBe(userId);
      item = nextItem;
    },
    async list(receivedUserId) {
      expect(receivedUserId).toBe(userId);
      return [{ ...item }];
    },
    async get(receivedUserId, itemId) {
      expect(receivedUserId).toBe(userId);
      return item.itemId === itemId ? { ...item } : null;
    },
    async setCursor(receivedUserId, _itemId, cursor) {
      expect(receivedUserId).toBe(userId);
      events.push("cursor");
      item.cursor = cursor;
    },
    async setHealth(receivedUserId) {
      expect(receivedUserId).toBe(userId);
      events.push("health");
    },
    async remove(receivedUserId) {
      expect(receivedUserId).toBe(userId);
    },
  };
}

function createAccountStore(events: string[] = []): AccountStore {
  return {
    async replaceForItem(receivedUserId) {
      expect(receivedUserId).toBe(userId);
      events.push("accounts");
    },
    async list() {
      return [];
    },
  };
}

function makeItem(): PlaidItem {
  return {
    itemId: "item-1",
    accessToken: encrypt("access-token"),
    institutionId: "institution-1",
    institutionName: "Test Bank",
    cursor: "cursor-0",
    createdAt: "2026-07-01T00:00:00.000Z",
    health: {
      state: "ok",
      errorCode: null,
      message: null,
    },
  };
}

function syncResponse(nextCursor: string, withTransaction = false) {
  return {
    data: {
      added: withTransaction
        ? [
            {
              transaction_id: "tx-1",
              account_id: "account-1",
              amount: 10,
              date: "2026-07-01",
              name: "Coffee",
              merchant_name: null,
              pending: false,
              personal_finance_category: null,
              personal_finance_category_icon_url: null,
              logo_url: null,
              website: null,
              iso_currency_code: "USD",
            },
          ]
        : [],
      modified: [],
      removed: [],
      next_cursor: nextCursor,
      has_more: false,
    },
  };
}

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("PlaidService.syncTransactions", () => {
  test("does not advance the Cursor when applying the Sync Diff fails", async () => {
    const events: string[] = [];
    const itemStore = createItemStore(makeItem(), events);
    const transactionStore: TransactionStore = {
      async applySync(receivedUserId) {
        expect(receivedUserId).toBe(userId);
        events.push("diff");
        throw new Error("write failed");
      },
      async list() {
        return [];
      },
    };
    const client = {
      async transactionsSync() {
        return syncResponse("cursor-1", true);
      },
      async accountsGet() {
        return {
          data: {
            accounts: [
              {
                account_id: "account-1",
                name: "Checking",
                official_name: null,
                type: "depository",
                subtype: "checking",
                mask: "1234",
                balances: {
                  current: 100,
                  available: 90,
                  iso_currency_code: "USD",
                },
              },
            ],
          },
        };
      },
    } as unknown as PlaidApi;
    const service = createPlaidService(
      itemStore,
      transactionStore,
      createAccountStore(events),
      client,
    );

    await expect(service.syncTransactions(userId, "item-1")).rejects.toThrow(
      "write failed",
    );
    expect(events).toEqual(["diff", "health"]);
    expect((await itemStore.get(userId, "item-1"))?.cursor).toBe("cursor-0");
  });

  test("persists item health when sync fails with a reauth error", async () => {
    const healthEvents: ItemHealth[] = [];
    const itemStore: ItemStore = {
      ...createItemStore(makeItem()),
      async setHealth(_userId, _itemId, health) {
        healthEvents.push(health);
      },
    };
    const transactionStore: TransactionStore = {
      async applySync() {
        throw Object.assign(new Error("login required"), {
          response: {
            data: {
              error_code: "ITEM_LOGIN_REQUIRED",
              error_type: "ITEM_ERROR",
              display_message: "Please reconnect",
            },
          },
        });
      },
      async list() {
        return [];
      },
    };
    const client = {
      async transactionsSync() {
        return syncResponse("cursor-1", true);
      },
    } as unknown as PlaidApi;
    const service = createPlaidService(
      itemStore,
      transactionStore,
      createAccountStore(),
      client,
    );

    await expect(service.syncTransactions(userId, "item-1")).rejects.toThrow(
      "login required",
    );
    expect(healthEvents).toEqual([
      {
        state: "reauth_required",
        errorCode: "ITEM_LOGIN_REQUIRED",
        message: "Please reconnect",
      },
    ]);
  });

  test("serializes concurrent syncs for the same Item", async () => {
    const itemStore = createItemStore(makeItem());
    const transactionStore: TransactionStore = {
      async applySync(receivedUserId) {
        expect(receivedUserId).toBe(userId);
      },
      async list() {
        return [];
      },
    };
    const firstResponse = deferred<ReturnType<typeof syncResponse>>();
    const firstStarted = deferred<void>();
    const requests: Array<{ cursor?: string }> = [];
    const client = {
      async transactionsSync(request: { cursor?: string }) {
        requests.push(request);
        if (requests.length === 1) {
          firstStarted.resolve();
          return firstResponse.promise;
        }
        return syncResponse("cursor-2");
      },
      async accountsGet() {
        return { data: { accounts: [] } };
      },
    } as unknown as PlaidApi;
    const service = createPlaidService(
      itemStore,
      transactionStore,
      createAccountStore(),
      client,
    );

    const firstSync = service.syncTransactions(userId, "item-1");
    await firstStarted.promise;
    const secondSync = service.syncTransactions(userId, "item-1");
    await Promise.resolve();

    expect(requests).toHaveLength(1);

    firstResponse.resolve(syncResponse("cursor-1"));
    await Promise.all([firstSync, secondSync]);

    expect(requests).toHaveLength(2);
    expect(requests[1]?.cursor).toBe("cursor-1");
    expect((await itemStore.get(userId, "item-1"))?.cursor).toBe("cursor-2");
  });
});
