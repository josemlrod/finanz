import { createConvexItemStore } from "~/lib/plaid/convex-item-store.server";
import { createConvexTransactionStore } from "~/lib/plaid/convex-transaction-store.server";
import { createPlaidService, type PlaidService } from "~/lib/plaid/service.server";
import type { ItemStore, TransactionStore } from "~/lib/plaid/types";

let itemStore: ItemStore | null = null;
let transactionStore: TransactionStore | null = null;
let plaidService: PlaidService | null = null;

function getStores(): { itemStore: ItemStore; transactionStore: TransactionStore } {
  itemStore ??= createConvexItemStore();
  transactionStore ??= createConvexTransactionStore();
  return { itemStore, transactionStore };
}

export function getItemStore(): ItemStore {
  return getStores().itemStore;
}

export function getTransactionStore(): TransactionStore {
  return getStores().transactionStore;
}

export function getPlaidService(): PlaidService {
  if (!plaidService) {
    const stores = getStores();
    plaidService = createPlaidService(stores.itemStore, stores.transactionStore);
  }
  return plaidService;
}

/** Reset singletons — useful in tests. */
export function resetPlaidWiring(): void {
  itemStore = null;
  transactionStore = null;
  plaidService = null;
}
