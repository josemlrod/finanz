import { useFetcher } from 'react-router';

interface RefreshTransactionsButtonProps {
  itemId: string;
  label: string;
  disabled: boolean;
}

export function RefreshTransactionsButton({
  itemId,
  label,
  disabled,
}: RefreshTransactionsButtonProps) {
  const fetcher = useFetcher<{ error?: string }>();
  const isRefreshing = fetcher.state !== 'idle';

  return (
    <div>
      <fetcher.Form method='post' action='/api/plaid/sync'>
        <input type='hidden' name='itemId' value={itemId} />
        <button
          type='submit'
          disabled={disabled || isRefreshing}
          className='rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition duration-200 ease-out hover:bg-muted disabled:opacity-50'
        >
          {isRefreshing ? 'Refreshing...' : label}
        </button>
      </fetcher.Form>
      {fetcher.data?.error ? (
        <p className='mt-1 max-w-48 text-xs text-red-600 dark:text-red-400' role='alert'>
          {fetcher.data.error}
        </p>
      ) : null}
    </div>
  );
}
