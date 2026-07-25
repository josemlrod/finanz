import type { Route } from "./+types/home";
import { PlaidLinkButton } from "~/components/plaid-link";
import {
  ItemPanel,
  type DashboardItemData,
} from "~/components/dashboard/item-panel";
import {
  getItemStore,
  getPlaidService,
  getTransactionStore,
} from "~/lib/plaid/wiring.server";
import { env } from "~/lib/env.server";

export function meta(_args: Route.MetaArgs) {
  return [
    { title: "Finanz" },
    { name: "description", content: "Personal finance dashboard" },
  ];
}

export async function loader(_args: Route.LoaderArgs) {
  const plaid = getPlaidService();
  const items = await getItemStore().list();
  const transactionStore = getTransactionStore();

  const dashboardItems: DashboardItemData[] = await Promise.all(
    items.map(async (item) => {
      const transactions = await transactionStore.list(item.itemId);
      const { accounts, health } = await plaid.getAccountsSnapshot(item.itemId);

      return {
        itemId: item.itemId,
        institutionId: item.institutionId,
        institutionName: item.institutionName,
        createdAt: item.createdAt,
        accounts,
        transactions,
        health,
        status: transactions.length > 0 ? ("populated" as const) : ("loading" as const),
      };
    }),
  );

  return { items: dashboardItems, isSandbox: env.PLAID_ENV === "sandbox" };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { items, isSandbox } = loaderData;

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-4 py-10">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Finanz
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Personal finance{isSandbox ? " — Plaid Sandbox" : ""}
          </p>
        </div>
        <PlaidLinkButton className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-800 disabled:opacity-50 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white" />
      </header>

      {items.length === 0 ? (
        <section className="rounded-xl border border-dashed border-gray-300 px-6 py-16 text-center dark:border-gray-700">
          <h2 className="text-lg font-medium text-gray-900 dark:text-gray-100">
            No accounts linked yet
          </h2>
          {isSandbox ? (
            <>
              <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                Connect a Sandbox bank to see balances and transactions. Use{" "}
                <code className="rounded bg-gray-100 px-1 py-0.5 text-xs dark:bg-gray-800">
                  user_transactions_dynamic
                </code>{" "}
                at First Platypus Bank.
              </p>
              <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">
                Plaid Link will ask to verify a phone number first. In Sandbox,
                real numbers are rejected — use the pre-filled{" "}
                <code className="rounded bg-gray-100 px-1 py-0.5 text-xs dark:bg-gray-800">
                  415-555-0010
                </code>{" "}
                and enter OTP{" "}
                <code className="rounded bg-gray-100 px-1 py-0.5 text-xs dark:bg-gray-800">
                  123456
                </code>
                .
              </p>
            </>
          ) : (
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
              Connect your bank to see balances and transactions. History can
              take a few minutes to arrive after linking.
            </p>
          )}
        </section>
      ) : (
        <div className="space-y-6">
          {items.map((item) => (
            <ItemPanel key={item.itemId} item={item} />
          ))}
        </div>
      )}
    </main>
  );
}
