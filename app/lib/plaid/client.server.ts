import { Configuration, PlaidApi, PlaidEnvironments } from "plaid";
import { env } from "~/lib/env.server";

let client: PlaidApi | null = null;

export function getPlaidClient(): PlaidApi {
  if (!client) {
    const basePath = PlaidEnvironments[env.PLAID_ENV];
    if (!basePath) {
      throw new Error(`Unsupported PLAID_ENV: ${env.PLAID_ENV}`);
    }

    client = new PlaidApi(
      new Configuration({
        basePath,
        baseOptions: {
          headers: {
            "PLAID-CLIENT-ID": env.PLAID_CLIENT_ID,
            "PLAID-SECRET": env.PLAID_SECRET,
          },
        },
      }),
    );
  }

  return client;
}

/** Reset the singleton — useful in tests. */
export function resetPlaidClient(): void {
  client = null;
}
