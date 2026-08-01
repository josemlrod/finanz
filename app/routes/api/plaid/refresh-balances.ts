import { data } from "react-router";
import type { Route } from "./+types/refresh-balances";
import { normalizePlaidError } from "~/lib/plaid/errors.server";
import { getPlaidService } from "~/lib/plaid/wiring.server";

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const itemId = formData.get("itemId");

  if (typeof itemId !== "string" || itemId.length === 0) {
    return data({ error: "Missing itemId" }, { status: 400 });
  }

  try {
    const accounts = await getPlaidService().refreshBalances(itemId);
    return data({ accounts });
  } catch (error) {
    const plaidError = normalizePlaidError(error);
    return data(
      { error: plaidError.display_message ?? "Failed to refresh balances" },
      { status: 500 },
    );
  }
}
