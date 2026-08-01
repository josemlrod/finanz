import { data } from "react-router";
import type { Route } from "./+types/sync";
import { normalizePlaidError } from "~/lib/plaid/errors.server";
import { getPlaidService, getTransactionStore } from "~/lib/plaid/wiring.server";

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const itemId = formData.get("itemId");

  if (typeof itemId !== "string" || itemId.length === 0) {
    return data({ error: "Missing itemId" }, { status: 400 });
  }

  try {
    const plaid = getPlaidService();
    const result = await plaid.syncTransactions(itemId);
    const transactions = await getTransactionStore().list(itemId);

    return data({
      hasUpdates: result.hasUpdates,
      transactionCount: transactions.length,
    });
  } catch (error) {
    const plaidError = normalizePlaidError(error);
    return data(
      { error: plaidError.display_message ?? "Sync failed" },
      { status: 500 },
    );
  }
}
