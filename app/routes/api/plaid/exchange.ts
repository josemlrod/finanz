import { data, redirect } from "react-router";
import type { Route } from "./+types/exchange";
import { normalizePlaidError } from "~/lib/plaid/errors.server";
import { requireApiAuth } from "~/lib/auth.server";
import { getPlaidService } from "~/lib/plaid/wiring.server";

export async function action(args: Route.ActionArgs) {
  const { userId } = await requireApiAuth(args);

  const formData = await args.request.formData();
  const publicToken = formData.get("public_token");
  const institutionId = formData.get("institution_id");
  const institutionName = formData.get("institution_name");

  if (typeof publicToken !== "string" || publicToken.length === 0) {
    return data({ error: "Missing public_token" }, { status: 400 });
  }

  try {
    const plaid = getPlaidService();

    // Exchanging burns an Item slot permanently — /item/remove does not free one
    // on the Trial plan — so refuse a bank that is already linked.
    if (typeof institutionId === "string" && institutionId.length > 0) {
      const existing = await plaid.findItemByInstitution(userId, institutionId);
      if (existing) {
        return data(
          {
            error: `${existing.institutionName} is already linked. Use Reconnect on the existing connection instead of linking it again.`,
          },
          { status: 409 },
        );
      }
    }

    const item = await plaid.exchangePublicToken(userId, publicToken, {
      institutionId: typeof institutionId === "string" ? institutionId : "",
      institutionName:
        typeof institutionName === "string" ? institutionName : "Unknown bank",
    });

    try {
      await plaid.syncTransactions(userId, item.itemId, { prime: true });
    } catch {
      // The Item is linked; the dashboard's auto-sync can retry the backfill.
    }
    return redirect("/");
  } catch (error) {
    const plaidError = normalizePlaidError(error);
    return data(
      { error: plaidError.display_message ?? "Failed to link account" },
      { status: 500 },
    );
  }
}
