import { describe, expect, it } from "vitest";
import { PLAID_ERROR_CODES } from "~/lib/plaid/errors.server";
import {
  runTransactionsSync,
  type FetchSyncPage,
  type SyncPage,
} from "~/lib/plaid/sync-engine.server";
import type { Transaction } from "~/lib/plaid/types";

function makeTransaction(transactionId: string): Transaction {
  return {
    transactionId,
    itemId: "item-1",
    accountId: "acct-1",
    amount: 12.34,
    date: "2026-07-01",
    name: "Coffee Shop",
    merchantName: null,
    pending: false,
    personalFinanceCategory: null,
    categoryIconUrl: null,
    logoUrl: null,
    website: null,
    isoCurrencyCode: "USD",
  };
}

function makePage(
  overrides: Partial<SyncPage> & Pick<SyncPage, "hasMore">,
): SyncPage {
  return {
    added: [],
    modified: [],
    removedIds: [],
    nextCursor: "",
    ...overrides,
  };
}

function mutationDuringPaginationError() {
  return {
    response: {
      data: {
        error_type: "TRANSACTIONS_ERROR",
        error_code:
          PLAID_ERROR_CODES.TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION,
        error_message: "mutation during pagination",
        display_message: null,
      },
    },
  };
}

function productNotReadyError() {
  return {
    response: {
      data: {
        error_type: "ITEM_ERROR",
        error_code: PLAID_ERROR_CODES.PRODUCT_NOT_READY,
        error_message: "product not ready",
        display_message: null,
      },
    },
  };
}

type FetchStep = { page: SyncPage } | { error: unknown };

function createScriptedFetch(steps: FetchStep[]) {
  const cursors: (string | undefined)[] = [];
  let callIndex = 0;

  const fetchPage: FetchSyncPage = async (cursor) => {
    cursors.push(cursor);
    const step = steps[callIndex];
    callIndex += 1;

    if (!step) {
      throw new Error(`Unexpected fetchPage call #${callIndex}`);
    }

    if ("error" in step) {
      throw step.error;
    }

    return step.page;
  };

  return { fetchPage, cursors };
}

describe("runTransactionsSync", () => {
  it("completes a single page and sets finalCursor", async () => {
    const added = [makeTransaction("tx-1")];
    const { fetchPage } = createScriptedFetch([
      {
        page: makePage({
          added,
          modified: [makeTransaction("tx-2")],
          removedIds: ["tx-removed"],
          nextCursor: "cursor-final",
          hasMore: false,
        }),
      },
    ]);

    const result = await runTransactionsSync(fetchPage, "saved-cursor");

    expect(result).toEqual({
      status: "complete",
      diff: {
        added,
        modified: [makeTransaction("tx-2")],
        removed: ["tx-removed"],
      },
      finalCursor: "cursor-final",
    });
  });

  it("accumulates multiple pages and uses the last page nextCursor", async () => {
    const { fetchPage } = createScriptedFetch([
      {
        page: makePage({
          added: [makeTransaction("tx-1")],
          nextCursor: "cursor-page-2",
          hasMore: true,
        }),
      },
      {
        page: makePage({
          modified: [makeTransaction("tx-2")],
          removedIds: ["tx-old"],
          nextCursor: "cursor-final",
          hasMore: false,
        }),
      },
    ]);

    const result = await runTransactionsSync(fetchPage, "saved-cursor");

    expect(result).toEqual({
      status: "complete",
      diff: {
        added: [makeTransaction("tx-1")],
        modified: [makeTransaction("tx-2")],
        removed: ["tx-old"],
      },
      finalCursor: "cursor-final",
    });
  });

  it("discards partial diff and restarts from initialCursor after a mutation", async () => {
    const { fetchPage, cursors } = createScriptedFetch([
      {
        page: makePage({
          added: [makeTransaction("tx-aborted")],
          nextCursor: "cursor-page-2",
          hasMore: true,
        }),
      },
      { error: mutationDuringPaginationError() },
      {
        page: makePage({
          added: [makeTransaction("tx-final")],
          nextCursor: "cursor-final",
          hasMore: false,
        }),
      },
    ]);

    const result = await runTransactionsSync(fetchPage, "saved-cursor");

    expect(result).toEqual({
      status: "complete",
      diff: {
        added: [makeTransaction("tx-final")],
        modified: [],
        removed: [],
      },
      finalCursor: "cursor-final",
    });
    expect(cursors).toEqual(["saved-cursor", "cursor-page-2", "saved-cursor"]);
  });

  it("throws after repeated mutation errors hit the retry cap", async () => {
    const steps = Array.from({ length: 5 }, () => ({
      error: mutationDuringPaginationError(),
    }));
    const { fetchPage } = createScriptedFetch(steps);

    await expect(runTransactionsSync(fetchPage, "saved-cursor")).rejects.toThrow(
      "Transaction sync failed: too many pagination mutations",
    );
  });

  it("returns product_not_ready without throwing", async () => {
    const { fetchPage } = createScriptedFetch([
      { error: productNotReadyError() },
    ]);

    await expect(runTransactionsSync(fetchPage, undefined)).resolves.toEqual({
      status: "product_not_ready",
    });
  });

  it("rethrows unknown errors", async () => {
    const unknownError = new Error("network down");
    const { fetchPage } = createScriptedFetch([{ error: unknownError }]);

    await expect(runTransactionsSync(fetchPage, undefined)).rejects.toBe(
      unknownError,
    );
  });

  it("passes initialCursor to the first fetchPage call", async () => {
    const { fetchPage, cursors } = createScriptedFetch([
      {
        page: makePage({
          nextCursor: "cursor-final",
          hasMore: false,
        }),
      },
    ]);

    await runTransactionsSync(fetchPage, "saved-cursor");
    expect(cursors).toEqual(["saved-cursor"]);
  });

  it("works when initialCursor is undefined", async () => {
    const { fetchPage, cursors } = createScriptedFetch([
      {
        page: makePage({
          nextCursor: "",
          hasMore: false,
        }),
      },
    ]);

    const result = await runTransactionsSync(fetchPage, undefined);

    expect(cursors).toEqual([undefined]);
    expect(result).toEqual({
      status: "complete",
      diff: { added: [], modified: [], removed: [] },
      finalCursor: null,
    });
  });
});
