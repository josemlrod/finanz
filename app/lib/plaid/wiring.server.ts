import { createConvexAccountStore } from "~/lib/plaid/convex-account-store.server";
import { createConvexItemStore } from "~/lib/plaid/convex-item-store.server";
import { createConvexTransactionStore } from "~/lib/plaid/convex-transaction-store.server";
import { createPlaidService, type PlaidService } from "~/lib/plaid/service.server";
import type { AccountStore, ItemStore, TransactionStore } from "~/lib/plaid/types";

let itemStore: ItemStore | null = null;
let transactionStore: TransactionStore | null = null;
let accountStore: AccountStore | null = null;
let plaidService: PlaidService | null = null;

function getStores(): {
  itemStore: ItemStore;
  transactionStore: TransactionStore;
  accountStore: AccountStore;
} {
  itemStore ??= createConvexItemStore();
  transactionStore ??= createConvexTransactionStore();
  accountStore ??= createConvexAccountStore();
  return { itemStore, transactionStore, accountStore };
}

export function getItemStore(): ItemStore {
  return getStores().itemStore;
}

export function getTransactionStore(): TransactionStore {
  return getStores().transactionStore;
}

export function getAccountStore(): AccountStore {
  return getStores().accountStore;
}

export function getPlaidService(): PlaidService {
  if (!plaidService) {
    const stores = getStores();
    plaidService = createPlaidService(
      stores.itemStore,
      stores.transactionStore,
      stores.accountStore,
    );
  }
  return plaidService;
}

/** Reset singletons — useful in tests. */
export function resetPlaidWiring(): void {
  itemStore = null;
  transactionStore = null;
  accountStore = null;
  plaidService = null;
}
