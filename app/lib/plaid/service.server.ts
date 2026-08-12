import type { LinkTokenCreateRequest, PlaidApi } from "plaid";
import {
  PersonalFinanceCategoryVersion,
  type AccountBase,
  type Transaction as PlaidTransaction,
} from "plaid";
import { decrypt, encrypt } from "~/lib/crypto.server";
import { env } from "~/lib/env.server";
import { createKeyedLock } from "~/lib/plaid/async-lock.server";
import { getPlaidClient } from "~/lib/plaid/client.server";
import { HEALTHY_ITEM, toItemHealth } from "~/lib/plaid/errors.server";
import { runTransactionsSync } from "~/lib/plaid/sync-engine.server";
import type {
  AccountStore,
  ItemHealth,
  ItemStore,
  LinkedAccount,
  PlaidItem,
  SyncDiff,
  Transaction,
  TransactionStore,
} from "~/lib/plaid/types";

const DEFAULT_SANDBOX_LINK_PHONE = "+14155550010";
const withItemSyncLock = createKeyedLock<string>();

export interface ExchangeMetadata {
  institutionId: string;
  institutionName: string;
}

export interface SyncTransactionsResult {
  diff: SyncDiff;
  hasUpdates: boolean;
}

export interface SyncTransactionsOptions {
  /** Omit cursor to prime the Item (activates transaction history fetch). */
  prime?: boolean;
}

export interface CreateLinkTokenOptions {
  userId: string;
  /**
   * Set to put Link in update mode for an existing Item, which repairs the
   * saved access token in place instead of creating a new (billable) Item.
   */
  itemId?: string;
}

export interface AccountsSnapshot {
  accounts: LinkedAccount[];
  health: ItemHealth;
}

export class PlaidService {
  constructor(
    private readonly itemStore: ItemStore,
    private readonly transactionStore: TransactionStore,
    private readonly accountStore: AccountStore,
    private readonly client: PlaidApi = getPlaidClient(),
  ) {}

  async createLinkToken(options: CreateLinkTokenOptions): Promise<string> {
    const { userId, itemId } = options;

    const request: LinkTokenCreateRequest = {
      client_name: "Finanz",
      language: "en",
      country_codes: env.PLAID_COUNTRY_CODES,
      user: {
        client_user_id: userId,
        ...(env.PLAID_ENV === "sandbox"
          ? {
              phone_number:
                env.PLAID_SANDBOX_LINK_PHONE ?? DEFAULT_SANDBOX_LINK_PHONE,
            }
          : {}),
      },
      webhook: env.PLAID_WEBHOOK_URL,
      redirect_uri: env.PLAID_REDIRECT_URI,
    };

    if (itemId) {
      // Update mode rejects `products`; the Item's existing products are reused.
      request.access_token = await this.getDecryptedAccessToken(userId, itemId);
    } else {
      request.products = env.PLAID_PRODUCTS;
      request.transactions = {
        days_requested: env.PLAID_TRANSACTIONS_DAYS_REQUESTED,
      };
    }

    const response = await this.client.linkTokenCreate(request);
    return response.data.link_token;
  }

  async findItemByInstitution(
    userId: string,
    institutionId: string,
  ): Promise<PlaidItem | null> {
    if (!institutionId) {
      return null;
    }

    const items = await this.itemStore.list(userId);
    return items.find((item) => item.institutionId === institutionId) ?? null;
  }

  async exchangePublicToken(
    userId: string,
    publicToken: string,
    metadata: ExchangeMetadata,
  ): Promise<PlaidItem> {
    const response = await this.client.itemPublicTokenExchange({
      public_token: publicToken,
    });

    const item: PlaidItem = {
      itemId: response.data.item_id,
      accessToken: encrypt(response.data.access_token),
      institutionId: metadata.institutionId,
      institutionName: metadata.institutionName,
      cursor: null,
      createdAt: new Date().toISOString(),
      health: HEALTHY_ITEM,
    };

    await this.itemStore.save(userId, item);

    try {
      const accounts = await this.fetchAccountsFromPlaid(userId, item.itemId);
      await this.persistAccountsSnapshot(userId, item.itemId, accounts);
      await this.persistItemHealth(userId, item.itemId, HEALTHY_ITEM);
    } catch {
      // The Item is linked; a later sync can retry the account snapshot.
    }

    return item;
  }

  async getAccounts(userId: string, itemId: string): Promise<LinkedAccount[]> {
    const accounts = await this.fetchAccountsFromPlaid(userId, itemId);
    await this.persistAccountsSnapshot(userId, itemId, accounts);
    await this.persistItemHealth(userId, itemId, HEALTHY_ITEM);
    return accounts;
  }

  /**
   * Like `getAccounts`, but converts Item-level failures into a health status
   * instead of throwing, so one broken bank cannot blank the dashboard.
   */
  async getAccountsSnapshot(
    userId: string,
    itemId: string,
  ): Promise<AccountsSnapshot> {
    try {
      return {
        accounts: await this.getAccounts(userId, itemId),
        health: HEALTHY_ITEM,
      };
    } catch (error) {
      return { accounts: [], health: toItemHealth(error) };
    }
  }

  async refreshBalances(userId: string, itemId: string): Promise<LinkedAccount[]> {
    const accessToken = await this.getDecryptedAccessToken(userId, itemId);
    let response;

    try {
      response = await this.client.accountsBalanceGet({
        access_token: accessToken,
      });
    } catch (error) {
      await this.persistItemHealth(userId, itemId, toItemHealth(error));
      throw error;
    }

    const accounts = stampAccounts(
      response.data.accounts.map((account) => mapAccount(account, itemId)),
    );
    await this.persistAccountsSnapshot(userId, itemId, accounts);
    await this.persistItemHealth(userId, itemId, HEALTHY_ITEM);
    return accounts;
  }

  async syncTransactions(
    userId: string,
    itemId: string,
    options: SyncTransactionsOptions = {},
  ): Promise<SyncTransactionsResult> {
    const result = await withItemSyncLock(itemId, () =>
      this.runSyncTransactions(userId, itemId, options),
    );
    await this.refreshStoredAccountsSnapshot(userId, itemId);
    return result;
  }

  private async runSyncTransactions(
    userId: string,
    itemId: string,
    options: SyncTransactionsOptions,
  ): Promise<SyncTransactionsResult> {
    const item = await this.itemStore.get(userId, itemId);
    if (!item) {
      throw new Error(`Item not found: ${itemId}`);
    }

    const accessToken = decrypt(item.accessToken);
    const initialCursor = options.prime
      ? undefined
      : item.cursor && item.cursor.length > 0
        ? item.cursor
        : undefined;

    const fetchPage = async (cursor: string | undefined) => {
      const response = await this.client.transactionsSync({
        access_token: accessToken,
        ...(cursor !== undefined ? { cursor } : {}),
        options: {
          personal_finance_category_version:
            PersonalFinanceCategoryVersion.V2,
        },
      });

      const data = response.data;
      return {
        added: data.added.map((tx) => mapTransaction(tx, itemId)),
        modified: data.modified.map((tx) => mapTransaction(tx, itemId)),
        removedIds: data.removed.map((tx) => tx.transaction_id),
        nextCursor: data.next_cursor,
        hasMore: data.has_more,
      };
    };

    let result;
    try {
      result = await runTransactionsSync(fetchPage, initialCursor);
    } catch (error) {
      await this.persistItemHealth(userId, itemId, toItemHealth(error));
      throw error;
    }

    if (result.status === "product_not_ready") {
      return { diff: emptyDiff(), hasUpdates: false };
    }

    const { diff, finalCursor } = result;

    if (hasDiffChanges(diff)) {
      await this.transactionStore.applySync(userId, itemId, diff);
    }

    if (finalCursor) {
      await this.itemStore.setCursor(userId, itemId, finalCursor);
    }

    return { diff, hasUpdates: hasDiffChanges(diff) };
  }

  private async fetchAccountsFromPlaid(
    userId: string,
    itemId: string,
  ): Promise<LinkedAccount[]> {
    const accessToken = await this.getDecryptedAccessToken(userId, itemId);
    let response;

    try {
      response = await this.client.accountsGet({ access_token: accessToken });
    } catch (error) {
      await this.persistItemHealth(userId, itemId, toItemHealth(error));
      throw error;
    }

    return stampAccounts(
      response.data.accounts.map((account) => mapAccount(account, itemId)),
    );
  }

  private async refreshStoredAccountsSnapshot(
    userId: string,
    itemId: string,
  ): Promise<void> {
    const accounts = await this.fetchAccountsFromPlaid(userId, itemId);
    await this.persistAccountsSnapshot(userId, itemId, accounts);
    await this.persistItemHealth(userId, itemId, HEALTHY_ITEM);
  }

  private async persistAccountsSnapshot(
    userId: string,
    itemId: string,
    accounts: LinkedAccount[],
  ): Promise<void> {
    await this.accountStore.replaceForItem(userId, itemId, accounts);
  }

  private async persistItemHealth(
    userId: string,
    itemId: string,
    health: ItemHealth,
  ): Promise<void> {
    await this.itemStore.setHealth(userId, itemId, health);
  }

  private async getDecryptedAccessToken(
    userId: string,
    itemId: string,
  ): Promise<string> {
    const item = await this.itemStore.get(userId, itemId);
    if (!item) {
      throw new Error(`Item not found: ${itemId}`);
    }
    return decrypt(item.accessToken);
  }
}

export function createPlaidService(
  itemStore: ItemStore,
  transactionStore: TransactionStore,
  accountStore: AccountStore,
  client?: PlaidApi,
): PlaidService {
  return new PlaidService(itemStore, transactionStore, accountStore, client);
}

function stampAccounts(accounts: Omit<LinkedAccount, "updatedAt">[]): LinkedAccount[] {
  const updatedAt = new Date().toISOString();
  return accounts.map((account) => ({ ...account, updatedAt }));
}

function mapAccount(
  account: AccountBase,
  itemId: string,
): Omit<LinkedAccount, "updatedAt"> {
  return {
    accountId: account.account_id,
    itemId,
    name: account.name,
    officialName: account.official_name,
    type: String(account.type),
    subtype: account.subtype ? String(account.subtype) : null,
    mask: account.mask,
    currentBalance: account.balances.current ?? null,
    availableBalance: account.balances.available ?? null,
    isoCurrencyCode: account.balances.iso_currency_code ?? null,
  };
}

function mapTransaction(
  transaction: PlaidTransaction,
  itemId: string,
): Transaction {
  return {
    transactionId: transaction.transaction_id,
    itemId,
    accountId: transaction.account_id,
    amount: transaction.amount,
    date: transaction.date,
    name: transaction.name,
    merchantName: transaction.merchant_name ?? null,
    pending: transaction.pending,
    personalFinanceCategory: transaction.personal_finance_category
      ? {
          primary: transaction.personal_finance_category.primary,
          detailed: transaction.personal_finance_category.detailed,
          confidenceLevel:
            transaction.personal_finance_category.confidence_level ?? null,
        }
      : null,
    categoryIconUrl: transaction.personal_finance_category_icon_url ?? null,
    logoUrl: transaction.logo_url ?? null,
    website: transaction.website ?? null,
    isoCurrencyCode: transaction.iso_currency_code,
  };
}

function emptyDiff(): SyncDiff {
  return { added: [], modified: [], removed: [] };
}

function hasDiffChanges(diff: SyncDiff): boolean {
  return (
    diff.added.length > 0 ||
    diff.modified.length > 0 ||
    diff.removed.length > 0
  );
}
