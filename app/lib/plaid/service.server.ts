import type { LinkTokenCreateRequest, PlaidApi } from "plaid";
import {
  CountryCode,
  PersonalFinanceCategoryVersion,
  Products,
  type AccountBase,
  type Transaction as PlaidTransaction,
} from "plaid";
import { decrypt, encrypt } from "~/lib/crypto.server";
import { env } from "~/lib/env.server";
import { getPlaidClient } from "~/lib/plaid/client.server";
import { HEALTHY_ITEM, toItemHealth } from "~/lib/plaid/errors.server";
import { runTransactionsSync } from "~/lib/plaid/sync-engine.server";
import type {
  ItemHealth,
  ItemStore,
  LinkedAccount,
  PlaidItem,
  SyncDiff,
  Transaction,
  TransactionStore,
} from "~/lib/plaid/types";

const DEFAULT_USER_ID = "default-user";
/** Plaid Sandbox returning-user seed number — OTP is always 123456. */
const DEFAULT_SANDBOX_LINK_PHONE = "+14155550010";

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
  userId?: string;
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
    private readonly client: PlaidApi = getPlaidClient(),
  ) {}

  async createLinkToken(options: CreateLinkTokenOptions = {}): Promise<string> {
    const { userId = DEFAULT_USER_ID, itemId } = options;

    const request: LinkTokenCreateRequest = {
      client_name: "Finanz",
      language: "en",
      country_codes: env.PLAID_COUNTRY_CODES as CountryCode[],
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
      request.access_token = await this.getDecryptedAccessToken(itemId);
    } else {
      request.products = env.PLAID_PRODUCTS as Products[];
      request.transactions = {
        days_requested: env.PLAID_TRANSACTIONS_DAYS_REQUESTED,
      };
    }

    const response = await this.client.linkTokenCreate(request);
    return response.data.link_token;
  }

  async findItemByInstitution(
    institutionId: string,
  ): Promise<PlaidItem | null> {
    if (!institutionId) {
      return null;
    }

    const items = await this.itemStore.list();
    return items.find((item) => item.institutionId === institutionId) ?? null;
  }

  async exchangePublicToken(
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
    };

    await this.itemStore.save(item);
    return item;
  }

  async getAccounts(itemId: string): Promise<LinkedAccount[]> {
    const accessToken = await this.getDecryptedAccessToken(itemId);
    const response = await this.client.accountsGet({ access_token: accessToken });
    return response.data.accounts.map((account) =>
      mapAccount(account, itemId),
    );
  }

  /**
   * Like `getAccounts`, but converts Item-level failures into a health status
   * instead of throwing, so one broken bank cannot blank the dashboard.
   */
  async getAccountsSnapshot(itemId: string): Promise<AccountsSnapshot> {
    try {
      return { accounts: await this.getAccounts(itemId), health: HEALTHY_ITEM };
    } catch (error) {
      return { accounts: [], health: toItemHealth(error) };
    }
  }

  async refreshBalances(itemId: string): Promise<LinkedAccount[]> {
    const accessToken = await this.getDecryptedAccessToken(itemId);
    const response = await this.client.accountsBalanceGet({
      access_token: accessToken,
    });
    return response.data.accounts.map((account) =>
      mapAccount(account, itemId),
    );
  }

  async syncTransactions(
    itemId: string,
    options: SyncTransactionsOptions = {},
  ): Promise<SyncTransactionsResult> {
    const item = await this.itemStore.get(itemId);
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

    const result = await runTransactionsSync(fetchPage, initialCursor);

    if (result.status === "product_not_ready") {
      return { diff: emptyDiff(), hasUpdates: false };
    }

    const { diff, finalCursor } = result;

    if (finalCursor) {
      await this.itemStore.setCursor(itemId, finalCursor);
    }

    if (hasDiffChanges(diff)) {
      await this.transactionStore.applySync(itemId, diff);
    }

    return { diff, hasUpdates: hasDiffChanges(diff) };
  }

  private async getDecryptedAccessToken(itemId: string): Promise<string> {
    const item = await this.itemStore.get(itemId);
    if (!item) {
      throw new Error(`Item not found: ${itemId}`);
    }
    return decrypt(item.accessToken);
  }
}

export function createPlaidService(
  itemStore: ItemStore,
  transactionStore: TransactionStore,
  client?: PlaidApi,
): PlaidService {
  return new PlaidService(itemStore, transactionStore, client);
}

function mapAccount(account: AccountBase, itemId: string): LinkedAccount {
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
