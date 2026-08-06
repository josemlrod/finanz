import { data } from "react-router";
import type { Route } from "./+types/link-token";
import { normalizePlaidError } from "~/lib/plaid/errors.server";
import { requireApiAuth } from "~/lib/auth.server";
import { getPlaidService } from "~/lib/plaid/wiring.server";

export async function action(args: Route.ActionArgs) {
  const { userId } = await requireApiAuth(args);

  const formData = await args.request.formData();
  const itemId = formData.get("itemId");

  try {
    const linkToken = await getPlaidService().createLinkToken({
      userId,
      itemId: typeof itemId === "string" && itemId.length > 0 ? itemId : undefined,
    });
    return data({ linkToken });
  } catch (error) {
    const plaidError = normalizePlaidError(error);
    return data(
      { error: plaidError.display_message ?? "Failed to create link token" },
      { status: 500 },
    );
  }
}
