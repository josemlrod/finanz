import { useEffect, useState } from "react";
import { useFetcher, useRevalidator } from "react-router";

/**
 * Sandbox backfills history in seconds, but a real institution routinely takes
 * two minutes or more, so the schedule has to outlast that before handing over
 * to the manual Sync button. Totals roughly three minutes.
 */
const AUTO_SYNC_DELAYS_MS = [
  2_000, 5_000, 10_000, 20_000, 30_000, 30_000, 30_000, 30_000, 30_000,
];
const MAX_AUTO_SYNC_ATTEMPTS = AUTO_SYNC_DELAYS_MS.length;

interface AutoSyncProps {
  itemId: string;
  enabled: boolean;
}

export function AutoSync({ itemId, enabled }: AutoSyncProps) {
  const fetcher = useFetcher<{ hasUpdates?: boolean; error?: string }>();
  const revalidator = useRevalidator();
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setAttempt(0);
      setFailed(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled || failed || fetcher.state !== "idle") {
      return;
    }

    if (attempt >= MAX_AUTO_SYNC_ATTEMPTS) {
      return;
    }

    const delay = AUTO_SYNC_DELAYS_MS[attempt];

    const timer = window.setTimeout(() => {
      fetcher.submit({ itemId }, { method: "POST", action: "/api/plaid/sync" });
    }, delay);

    return () => window.clearTimeout(timer);
  }, [attempt, enabled, failed, fetcher, itemId]);

  useEffect(() => {
    if (fetcher.state !== "idle" || fetcher.data === undefined) {
      return;
    }

    setAttempt((current) => current + 1);

    // A failing sync will keep failing; stop rather than burn the schedule.
    if (fetcher.data.error) {
      setFailed(true);
      return;
    }

    if (fetcher.data.hasUpdates) {
      revalidator.revalidate();
    }
  }, [fetcher.state, fetcher.data, revalidator]);

  return null;
}
