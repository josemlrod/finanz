export interface PlaidItem {
  itemId: string;
  /** AES-256-GCM ciphertext; never plaintext outside the service layer. */
  accessToken: string;
  institutionId: string;
  institutionName: string;
  cursor: string | null;
  createdAt: string;
}

export interface LinkedAccount {
  accountId: string;
  itemId: string;
  name: string;
  officialName: string | null;
  type: string;
  subtype: string | null;
  mask: string | null;
  currentBalance: number | null;
  availableBalance: number | null;
  isoCurrencyCode: string | null;
}

export interface PersonalFinanceCategory {
  primary: string;
  detailed: string;
  confidenceLevel: string | null;
}

export interface Transaction {
  transactionId: string;
  itemId: string;
  accountId: string;
  amount: number;
  date: string;
  name: string;
  merchantName: string | null;
  pending: boolean;
  personalFinanceCategory: PersonalFinanceCategory | null;
  categoryIconUrl: string | null;
  logoUrl: string | null;
  website: string | null;
  isoCurrencyCode: string | null;
}

/**
 * Whether an Item can still be read from. Sandbox Items are always `ok`; real
 * ones drift into `reauth_required` when credentials or consent lapse.
 */
export type ItemHealthState = "ok" | "reauth_required" | "consent_expiring" | "error";

export interface ItemHealth {
  state: ItemHealthState;
  errorCode: string | null;
  message: string | null;
}

export interface SyncDiff {
  added: Transaction[];
  modified: Transaction[];
  removed: string[];
}

export interface ItemStore {
  save(item: PlaidItem): Promise<void>;
  list(): Promise<PlaidItem[]>;
  get(itemId: string): Promise<PlaidItem | null>;
  setCursor(itemId: string, cursor: string): Promise<void>;
  remove(itemId: string): Promise<void>;
}

export interface TransactionStore {
  applySync(itemId: string, diff: SyncDiff): Promise<void>;
  list(itemId: string): Promise<Transaction[]>;
}
