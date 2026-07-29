import {
  isMutationDuringPagination,
  isProductNotReady,
  normalizePlaidError,
} from "~/lib/plaid/errors.server";
import type { SyncDiff, Transaction } from "~/lib/plaid/types";

export const MUTATION_RETRY_CAP = 5;

export interface SyncPage {
  added: Transaction[];
  modified: Transaction[];
  removedIds: string[];
  nextCursor: string;
  hasMore: boolean;
}

export type FetchSyncPage = (cursor: string | undefined) => Promise<SyncPage>;

export type SyncRunResult =
  | { status: "complete"; diff: SyncDiff; finalCursor: string | null }
  | { status: "product_not_ready" };

function emptyDiff(): SyncDiff {
  return { added: [], modified: [], removed: [] };
}

function mergePageIntoDiff(diff: SyncDiff, page: SyncPage): void {
  diff.added.push(...page.added);
  diff.modified.push(...page.modified);
  diff.removed.push(...page.removedIds);
}

export async function runTransactionsSync(
  fetchPage: FetchSyncPage,
  initialCursor: string | undefined,
): Promise<SyncRunResult> {
  let mutationRetries = 0;

  while (true) {
    const diff = emptyDiff();
    let pageCursor: string | undefined = initialCursor;
    let hasMore = true;
    let finalCursor: string | null = null;
    let paginationFailed = false;

    while (hasMore) {
      try {
        const page = await fetchPage(pageCursor);
        mergePageIntoDiff(diff, page);
        pageCursor = page.nextCursor || undefined;
        hasMore = page.hasMore;

        if (!hasMore) {
          finalCursor = page.nextCursor || null;
        }
      } catch (error) {
        const plaidError = normalizePlaidError(error);

        if (isMutationDuringPagination(plaidError)) {
          mutationRetries += 1;
          if (mutationRetries >= MUTATION_RETRY_CAP) {
            throw new Error(
              "Transaction sync failed: too many pagination mutations",
            );
          }
          paginationFailed = true;
          break;
        }

        if (isProductNotReady(plaidError)) {
          return { status: "product_not_ready" };
        }

        throw error;
      }
    }

    if (paginationFailed) {
      continue;
    }

    return { status: "complete", diff, finalCursor };
  }
}
