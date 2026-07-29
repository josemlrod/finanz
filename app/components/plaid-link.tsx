import { useCallback, useEffect, useState } from "react";
import { useFetcher, useRevalidator } from "react-router";
import {
  usePlaidLink,
  type PlaidLinkOnEvent,
  type PlaidLinkOnExit,
  type PlaidLinkOnSuccess,
} from "react-plaid-link";

interface LinkTokenResponse {
  linkToken?: string;
  error?: string;
}

function firstNonEmpty(
  ...values: (string | null | undefined)[]
): string | undefined {
  return values.find(
    (value): value is string => value != null && value.trim().length > 0,
  );
}

interface ExitDetails {
  message: string;
  /** Shown so a failed session can be looked up in the Plaid Dashboard. */
  linkSessionId: string | null;
}

interface PlaidLinkButtonProps {
  className?: string;
  children?: React.ReactNode;
  /**
   * Set to reconnect an existing Item via Link's update mode. Update mode
   * repairs the saved access token, so no new Item is created and no Item slot
   * is consumed.
   */
  itemId?: string;
}

function PlaidLinkInner({
  linkToken,
  itemId,
  className,
  children,
}: {
  linkToken: string;
  itemId?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  const exchangeFetcher = useFetcher<{ error?: string }>();
  const revalidator = useRevalidator();
  const [exit, setExit] = useState<ExitDetails | null>(null);

  const onSuccess = useCallback<PlaidLinkOnSuccess>(
    (publicToken, metadata) => {
      if (!publicToken) {
        return;
      }

      // Update mode returns a public_token that must not be exchanged; the
      // existing access token has already been repaired in place.
      if (itemId) {
        revalidator.revalidate();
        return;
      }

      const formData = new FormData();
      formData.set("public_token", publicToken);
      formData.set("institution_id", metadata.institution?.institution_id ?? "");
      formData.set("institution_name", metadata.institution?.name ?? "");

      exchangeFetcher.submit(formData, {
        method: "POST",
        action: "/api/plaid/exchange",
      });
    },
    [itemId, exchangeFetcher, revalidator],
  );

  const onExit = useCallback<PlaidLinkOnExit>((error, metadata) => {
    console.warn("[plaid-link] exit", { error, metadata });

    if (!error) {
      setExit(null);
      return;
    }

    setExit({
      // Plaid sends these as empty strings as often as null, so `??` alone
      // would let a blank message through and close the modal silently.
      message:
        firstNonEmpty(error.display_message, error.error_message) ??
        `${error.error_type}: ${error.error_code}`,
      linkSessionId: firstNonEmpty(metadata.link_session_id) ?? null,
    });
  }, []);

  const onEvent = useCallback<PlaidLinkOnEvent>((eventName, metadata) => {
    if (eventName === "ERROR" || import.meta.env.DEV) {
      console.info(`[plaid-link] ${eventName}`, metadata);
    }
  }, []);

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess,
    onExit,
    onEvent,
  });

  const isExchanging = exchangeFetcher.state !== "idle";
  const errorMessage = exchangeFetcher.data?.error ?? exit?.message ?? null;
  const label = itemId ? "Reconnect" : "Connect bank account";

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        className={className}
        disabled={!ready || isExchanging}
        onClick={() => {
          setExit(null);
          open();
        }}
      >
        {isExchanging ? "Connecting…" : (children ?? label)}
      </button>
      {errorMessage && (
        <div className="max-w-xs text-right text-xs text-red-600 dark:text-red-400">
          <p>{errorMessage}</p>
          {exit?.linkSessionId && (
            <p className="mt-1 font-mono text-[10px] text-neutral-500 dark:text-neutral-400">
              session {exit.linkSessionId}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function PlaidLinkButton({
  className,
  children,
  itemId,
}: PlaidLinkButtonProps) {
  const [mounted, setMounted] = useState(false);
  const tokenFetcher = useFetcher<LinkTokenResponse>();

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (
      mounted &&
      tokenFetcher.state === "idle" &&
      tokenFetcher.data === undefined
    ) {
      tokenFetcher.submit(
        itemId ? { itemId } : null,
        { method: "POST", action: "/api/plaid/link-token" },
      );
    }
  }, [mounted, tokenFetcher, itemId]);

  const label = itemId ? "Reconnect" : "Connect bank account";

  if (!mounted) {
    return (
      <button type="button" className={className} disabled>
        {children ?? label}
      </button>
    );
  }

  const linkToken = tokenFetcher.data?.linkToken;
  const tokenError = tokenFetcher.data?.error;
  const isLoadingToken =
    tokenFetcher.state !== "idle" || (tokenFetcher.data === undefined && !tokenError);

  if (isLoadingToken) {
    return (
      <button type="button" className={className} disabled>
        Loading…
      </button>
    );
  }

  if (tokenError || !linkToken) {
    return (
      <button type="button" className={className} disabled>
        Unable to start Link
      </button>
    );
  }

  return (
    <PlaidLinkInner linkToken={linkToken} itemId={itemId} className={className}>
      {children}
    </PlaidLinkInner>
  );
}
