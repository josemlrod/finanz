import { useEffect, useRef, useState } from "react";
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
  const attemptRef = useRef(0);
  const [scheduled, setScheduled] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!enabled) {
      attemptRef.current = 0;
      setScheduled(false);
      setFailed(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled || failed || scheduled || fetcher.state !== "idle") {
      return;
    }

    const attempt = attemptRef.current;
    if (attempt >= MAX_AUTO_SYNC_ATTEMPTS) {
      return;
    }

    const delay = AUTO_SYNC_DELAYS_MS[attempt];
    setScheduled(true);

    const timer = window.setTimeout(() => {
      setScheduled(false);
      fetcher.submit({ itemId }, { method: "POST", action: "/api/plaid/sync" });
    }, delay);

    return () => window.clearTimeout(timer);
  }, [enabled, failed, scheduled, fetcher.state, itemId]);

  useEffect(() => {
    if (fetcher.state !== "idle" || fetcher.data === undefined) {
      return;
    }

    attemptRef.current += 1;

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
