import { useEffect, useRef, useState } from 'react';
import { useConvexAuth, useQuery } from 'convex/react';
import {
  data,
  isRouteErrorResponse,
  Link,
  type ShouldRevalidateFunctionArgs,
  useFetcher,
  useFetchers,
  useNavigation,
  useRevalidator,
} from 'react-router';
import { ConvexError } from 'convex/values';
import type { GoalConfig } from '../../convex/lib/goals';
import type { Route } from './+types/goal-detail';
import { requirePageAuth } from '~/lib/auth.server';
import {
  goalError,
  goalStore,
  readGoalConfig,
  savingsHeaders,
} from '~/lib/goals/convex-goal-store.server';
import { calculateProgress } from '~/lib/goals/progress';
import {
  reconcileRecordAttempt,
  type RecordAttempt,
} from '~/lib/goals/record-attempt';
import { AmountGrid } from '~/components/goals/amount-grid';
import { ContributionActivity } from '~/components/goals/contribution-activity';
import { GoalForm } from '~/components/goals/goal-form';
import {
  Avatar,
  formatCents,
  formatDate,
  GoalHeader,
  inputClass,
  memberTone,
  panelClass,
  primaryButtonClass,
  Sheet,
} from '~/components/goals/shared';
import { cn } from '~/lib/utils';
import { api } from '../../convex/_generated/api';

export type GoalDetail = NonNullable<
  Awaited<ReturnType<ReturnType<typeof goalStore>['detail']>>
>;
type ActionResult = { intent: string; requestId: string } & (
  | {
      ok: true;
      invite?: { token: string; inviteId: string };
      recordedCents?: number;
    }
  | { ok: false; code: string; message: string }
);

export function headers() {
  return savingsHeaders;
}

export async function loader(args: Route.LoaderArgs) {
  const { userId } = await requirePageAuth(args);
  const store = goalStore(userId);
  const cursor =
    new URL(args.request.url).searchParams.get('activityCursor') ?? undefined;
  if (cursor !== undefined && (!cursor || cursor.length > 8192)) {
    throw data('Invalid activity cursor.', {
      status: 400,
      headers: savingsHeaders,
    });
  }
  let detail;
  let activity;
  const snapshotAt = new Date().toISOString();
  try {
    detail = await store.detail(args.params.goalId);
    activity = detail ? await store.activity(args.params.goalId, cursor) : null;
  } catch (error) {
    const safe = goalError(error);
    throw data(safe.message, { status: safe.status, headers: savingsHeaders });
  }
  if (!detail || !activity)
    throw data('Goal not found or access removed.', {
      status: 404,
      headers: savingsHeaders,
    });
  return data(
    { detail, activity, snapshotAt, today: snapshotAt.slice(0, 10) },
    { headers: savingsHeaders },
  );
}

export async function action(args: Route.ActionArgs) {
  const { userId } = await requirePageAuth(args);
  let intent = '';
  let requestId = '';
  try {
    if (args.request.method !== 'POST')
      throw new ConvexError({
        code: 'INVALID_INPUT',
        message: 'Use POST for goal changes.',
      });
    const form = await args.request.formData();
    const text = (name: string, max = 128) => {
      const value = form.get(name);
      if (
        typeof value !== 'string' ||
        !value.trim() ||
        value.length > max ||
        form.getAll(name).length !== 1
      ) {
        throw new ConvexError({
          code: 'INVALID_INPUT',
          message: `Invalid ${name}.`,
        });
      }
      return value;
    };
    intent = text('intent');
    requestId = text('requestId');
    const revision = () => {
      const raw = text('expectedGridRevision');
      const value = Number(raw);
      if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < 1)
        throw new ConvexError({
          code: 'INVALID_INPUT',
          message: 'Invalid grid revision.',
        });
      return value;
    };
    const store = goalStore(userId);
    const goalId = args.params.goalId;
    let invite: { token: string; inviteId: string } | undefined;
    let recordedCents: number | undefined;
    switch (intent) {
      case 'record': {
        const raw = form.getAll('cellIndexes');
        if (
          !raw.length ||
          raw.length > 500 ||
          raw.some((value) => typeof value !== 'string' || !/^\d+$/.test(value))
        )
          throw new ConvexError({
            code: 'INVALID_INPUT',
            message: 'Select valid cells.',
          });
        const cellIndexes = raw.map(Number);
        if (
          cellIndexes.some((index) => !Number.isSafeInteger(index)) ||
          new Set(cellIndexes).size !== cellIndexes.length
        )
          throw new ConvexError({
            code: 'INVALID_INPUT',
            message: 'Select distinct valid cells.',
          });
        const result = await store.record(goalId, {
          cellIndexes,
          expectedGridRevision: revision(),
          submissionId: text('submissionId'),
        });
        recordedCents = result.recordedCents;
        break;
      }
      case 'undo':
        await store.undo(goalId, text('contributionId'));
        break;
      case 'edit':
        await store.edit(goalId, readGoalConfig(form), revision());
        break;
      case 'createInvite':
        invite = await store.createInvite(goalId);
        break;
      case 'removeMember':
        await store.removeMember(goalId, text('memberUserId'));
        break;
      case 'revokeInvite':
        await store.revokeInvite(goalId, text('inviteId'));
        break;
      case 'archive':
        await store.setArchived(goalId, true);
        break;
      case 'unarchive':
        await store.setArchived(goalId, false);
        break;
      default:
        throw new ConvexError({
          code: 'INVALID_INPUT',
          message: 'Unknown goal action.',
        });
    }
    return data<ActionResult>(
      { ok: true, intent, requestId, invite, recordedCents },
      { headers: savingsHeaders },
    );
  } catch (error) {
    const safe = goalError(error);
    if (safe.status === 403)
      throw data(safe.message, { status: 403, headers: savingsHeaders });
    return data<ActionResult>(
      { ok: false, intent, requestId, code: safe.code, message: safe.message },
      { status: safe.status, headers: savingsHeaders },
    );
  }
}

export function shouldRevalidate({
  actionStatus,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
  return actionStatus === 409 || defaultShouldRevalidate;
}

export default function GoalDetailRoute({ loaderData }: Route.ComponentProps) {
  return (
    <LiveDetail
      key={`${loaderData.detail.goal._id}:${loaderData.detail.viewer.userId}`}
      loaderData={loaderData}
    />
  );
}

function LiveDetail({ loaderData }: Pick<Route.ComponentProps, 'loaderData'>) {
  const { isAuthenticated } = useConvexAuth();
  const args = isAuthenticated
    ? { goalId: loaderData.detail.goal._id }
    : ('skip' as const);
  const liveDetail = useQuery(api.goals.detailForCurrentUser, args);
  const liveActivity = useQuery(api.goals.activityForCurrentUser, args);

  if (liveDetail === null || liveActivity === null) {
    return <GoalUnavailable />;
  }

  return (
    <Detail
      loaderData={{
        ...loaderData,
        detail: liveDetail ?? loaderData.detail,
        activity: liveActivity ?? loaderData.activity,
      }}
    />
  );
}

function Detail({ loaderData }: Pick<Route.ComponentProps, 'loaderData'>) {
  const { detail, activity, today } = loaderData;
  const { goal, viewer, members } = detail;
  const mutation = useFetcher<typeof action>();
  const fetchers = useFetchers();
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const [selection, setSelection] = useState({
    revision: goal.gridRevision,
    indexes: new Set<number>(),
  });
  const [warning, setWarning] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [controls, setControls] = useState<'share' | 'settings' | null>(null);
  const [settingsWarning, setSettingsWarning] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<{
    url: string;
    id: string;
  } | null>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const inFlight = useRef(false);
  const submitted = useRef<string | null>(null);
  const processed = useRef<string | null>(null);
  const retry = useRef<RecordAttempt | null>(null);
  const submittedSettings = useRef<string | null>(null);
  const persistedConfig = [
    goal.name,
    goal.targetCents,
    goal.minCellCents,
    goal.maxCellCents,
    goal.startDate,
    goal.targetDate,
  ];
  const configKey = JSON.stringify(persistedConfig);
  const settingsKey = JSON.stringify([
    ...persistedConfig,
    goal.gridRevision,
    goal.firstContributionAt !== null,
  ]);
  const previousSettings = useRef(settingsKey);
  const archived = goal.archivedAt !== null;
  const busy =
    mutation.state !== 'idle' ||
    navigation.state !== 'idle' ||
    revalidator.state !== 'idle' ||
    fetchers.some((fetcher) => fetcher.state !== 'idle');
  const progress = calculateProgress({
    ...goal,
    recordedCents: detail.contributions.reduce(
      (sum, row) => sum + row.amountCents,
      0,
    ),
    today,
  });
  const occupied = new Set(detail.contributions.map((row) => row.cellIndex));
  const selected = new Set(
    [...selection.indexes].filter(
      (index) =>
        !archived &&
        selection.revision === goal.gridRevision &&
        !occupied.has(index) &&
        index < goal.cellAmountsCents.length,
    ),
  );

  useEffect(() => {
    if (controls !== 'settings') setSettingsWarning(null);
    if (previousSettings.current === settingsKey) return;
    previousSettings.current = settingsKey;
    const ownEdit =
      submittedSettings.current === configKey &&
      (mutation.state !== 'idle' ||
        (mutation.data?.ok &&
          mutation.data.intent === 'edit' &&
          mutation.data.requestId === submitted.current));
    submittedSettings.current = null;
    if (controls === 'settings' && !ownEdit) {
      setSettingsWarning(
        'Settings changed while this sheet was open. The form has been refreshed with the saved settings; any unsaved changes and preview were cleared. Review them before saving.',
      );
    }
  }, [settingsKey, configKey, controls, mutation.state, mutation.data]);

  useEffect(() => {
    const confirmed = [
      ...detail.contributions,
      ...activity.page.flatMap((event) => event.contributions),
    ];
    retry.current = reconcileRecordAttempt(
      retry.current,
      viewer.userId,
      confirmed,
    );
    try {
      const storageKey = `goal-record:${goal._id}:${viewer.userId}`;
      const saved: unknown = JSON.parse(
        sessionStorage.getItem(storageKey) ?? 'null',
      );
      const unresolved = reconcileRecordAttempt(
        saved,
        viewer.userId,
        confirmed,
      );
      if (saved && !unresolved) sessionStorage.removeItem(storageKey);
      if (!retry.current) retry.current = unresolved;
    } catch {
      /* Blocked storage must not prevent reconciliation of the in-memory attempt. */
    }
  }, [detail.contributions, activity, goal._id, viewer.userId]);

  useEffect(() => {
    if (mutation.state !== 'idle') return;
    const result = mutation.data;
    if (
      result &&
      result.requestId === submitted.current &&
      result.requestId !== processed.current
    ) {
      inFlight.current = false;
      submittedSettings.current = null;
      processed.current = result.requestId;
      if (!result.ok) {
        setWarning(
          result.message +
            (result.code === 'CONFLICT'
              ? ' Review the refreshed selection and confirm its total again.'
              : ''),
        );
      } else {
        setWarning(null);
        if (result.intent === 'record') {
          setSelection({ revision: goal.gridRevision, indexes: new Set() });
          setNotice(
            `Recorded ${formatCents(result.recordedCents ?? 0)}. Your confirmed savings are up to date.`,
          );
          retry.current = null;
          try {
            sessionStorage.removeItem(
              `goal-record:${goal._id}:${viewer.userId}`,
            );
          } catch {
            /* Storage may be disabled. In-memory retries still retain their ID. */
          }
          return;
        }
        setNotice(
          result.intent === 'undo'
            ? 'Contribution undone. History has been preserved.'
            : 'Goal updated.',
        );
        if (result.intent === 'edit') setControls(null);
        if (result.intent === 'createInvite' && result.invite) {
          setInviteLink({
            url: new URL(
              `/invites/${encodeURIComponent(result.invite.token)}`,
              window.location.origin,
            ).href,
            id: result.invite.inviteId,
          });
          setCopyStatus(null);
        }
      }
    }
    const taken = new Set(detail.contributions.map((row) => row.cellIndex));
    const next = [...selection.indexes].filter(
      (index) =>
        !archived &&
        selection.revision === goal.gridRevision &&
        !taken.has(index) &&
        index < goal.cellAmountsCents.length,
    );
    if (
      selection.revision === goal.gridRevision &&
      next.length === selection.indexes.size
    )
      return;
    setSelection({ revision: goal.gridRevision, indexes: new Set(next) });
    if (selection.indexes.size) {
      setWarning(
        archived
          ? 'This goal was archived. Your selection was cleared; no new savings were recorded by this refresh.'
          : selection.revision !== goal.gridRevision
            ? 'The grid changed. Your old selection was cleared. Review the new grid before recording savings.'
            : `Selected cells are no longer available. ${next.length ? `${next.length} still-available cells remain selected. Review the new total and confirm again.` : 'No selected cells remain. Review the grid before selecting again.'}`,
      );
    }
  }, [
    detail,
    archived,
    goal.gridRevision,
    goal.cellAmountsCents.length,
    goal._id,
    viewer.userId,
    selection,
    mutation.state,
    mutation.data,
  ]);

  useEffect(() => {
    if (
      inviteLink &&
      (archived ||
        !detail.invites.some((invite) => invite._id === inviteLink.id))
    )
      setInviteLink(null);
  }, [archived, detail.invites, inviteLink]);

  function submit(
    intent: string,
    fields: Record<string, string> = {},
    indexes?: number[],
  ) {
    if (busy || inFlight.current) return;
    inFlight.current = true;
    const requestId = crypto.randomUUID();
    submitted.current = requestId;
    setWarning(null);
    setNotice(null);
    const form = new FormData();
    form.set('intent', intent);
    form.set('requestId', requestId);
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    for (const index of indexes ?? [])
      form.append('cellIndexes', String(index));
    void mutation
      .submit(form, { method: 'post', action: `/goals/${goal._id}` })
      .catch(() => {
        if (submitted.current !== requestId) return;
        inFlight.current = false;
        submittedSettings.current = null;
        setWarning(
          'Could not confirm the request. Check your connection and review the refreshed goal before retrying.' +
            (intent === 'record'
              ? ' Your recording retry ID has been preserved.'
              : ''),
        );
      });
  }

  function record() {
    if (!selected.size || archived || busy || inFlight.current) return;
    const indexes = [...selected].sort((a, b) => a - b);
    const fingerprint = JSON.stringify([goal.gridRevision, indexes]);
    const storageKey = `goal-record:${goal._id}:${viewer.userId}`;
    if (!retry.current) {
      try {
        const saved: unknown = JSON.parse(
          sessionStorage.getItem(storageKey) ?? 'null',
        );
        retry.current = reconcileRecordAttempt(saved, viewer.userId, [
          ...detail.contributions,
          ...activity.page.flatMap((event) => event.contributions),
        ]);
      } catch {
        /* A blocked or invalid session store must not prevent recording. */
      }
    }
    if (retry.current?.fingerprint !== fingerprint)
      retry.current = { fingerprint, submissionId: crypto.randomUUID() };
    // Preserve the same ID after a lost response, including a reload followed by an identical retry.
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(retry.current));
    } catch {
      /* The ref still covers retries within this mounted page. */
    }
    submit(
      'record',
      {
        expectedGridRevision: String(goal.gridRevision),
        submissionId: retry.current.submissionId,
      },
      indexes,
    );
  }

  function edit(config: GoalConfig) {
    if (busy || inFlight.current) return;
    submittedSettings.current = JSON.stringify([
      config.name,
      config.targetCents,
      config.minCellCents,
      config.maxCellCents,
      config.startDate,
      config.targetDate,
    ]);
    submit('edit', {
      ...Object.fromEntries(
        Object.entries(config).map(([key, value]) => [key, String(value)]),
      ),
      expectedGridRevision: String(goal.gridRevision),
    });
  }

  let ringOffset = 0;
  const circumference = 2 * Math.PI * 82;
  const linkAvailable =
    inviteLink &&
    !archived &&
    detail.invites.some((invite) => invite._id === inviteLink.id);
  return (
    <main className='min-h-screen bg-[#0b0b0e] px-4 pb-28 text-zinc-100 sm:px-7'>
      <div className='mx-auto max-w-7xl'>
        <GoalHeader backTo='/goals' backLabel='Savings goals'>
          {viewer.isOwner && (
            <div className='flex gap-2'>
              <button
                type='button'
                onClick={() => setControls('share')}
                className='min-h-11 rounded-xl border border-white/10 px-4 text-sm hover:bg-white/5'
              >
                Share
              </button>
              <button
                type='button'
                onClick={() => setControls('settings')}
                className='min-h-11 rounded-xl border border-white/10 px-4 text-sm hover:bg-white/5'
              >
                Settings
              </button>
            </div>
          )}
        </GoalHeader>
        {notice && (
          <div
            role='status'
            className='mb-4 flex items-center justify-between gap-3 rounded-2xl border border-emerald-400/20 bg-emerald-400/5 px-4 py-3 text-sm text-emerald-200'
          >
            <p>{notice}</p>
            <button
              type='button'
              onClick={() => setNotice(null)}
              className='min-h-11 rounded-lg px-2'
            >
              Dismiss
            </button>
          </div>
        )}
        <div className='grid items-start gap-6 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)] lg:grid-rows-[auto_1fr] lg:gap-x-8'>
          <section
            className={cn(
              panelClass,
              'flex flex-col items-center px-6 py-8 text-center lg:col-start-1 lg:row-start-1',
            )}
          >
            <div className='relative size-44'>
              <svg
                width='176'
                height='176'
                viewBox='0 0 176 176'
                role='img'
                aria-label={`${progress.percent.toFixed(0)} percent recorded`}
                className='-rotate-90'
              >
                <circle
                  cx='88'
                  cy='88'
                  r='82'
                  fill='none'
                  stroke='rgba(255,255,255,0.06)'
                  strokeWidth='12'
                />
                {members
                  .filter((member) => member.recordedCents > 0)
                  .map((member) => {
                    const length =
                      (member.recordedCents / goal.targetCents) * circumference;
                    const offset = ringOffset;
                    ringOffset += length;
                    return (
                      <circle
                        key={member.userId}
                        cx='88'
                        cy='88'
                        r='82'
                        fill='none'
                        stroke={memberTone(member.colorIndex).hex}
                        strokeWidth='12'
                        strokeDasharray={`${Math.max(0, length - 3)} ${circumference}`}
                        strokeDashoffset={-offset}
                      />
                    );
                  })}
              </svg>
              <div
                aria-hidden='true'
                className='absolute inset-0 flex flex-col items-center justify-center'
              >
                <span className='font-heading text-4xl font-semibold tabular-nums tracking-tight'>
                  {progress.percent.toFixed(0)}%
                </span>
                <span className='mt-1 text-[10px] uppercase tracking-[0.14em] text-zinc-400'>
                  recorded
                </span>
              </div>
            </div>
            <h1 className='mt-5 max-w-full break-words font-heading text-2xl font-semibold tracking-tight'>
              {goal.name}
            </h1>
            <p className='mt-1 text-sm text-zinc-400'>
              <span className='tabular-nums text-zinc-100'>
                {formatCents(progress.recordedCents)}
              </span>{' '}
              of {formatCents(goal.targetCents)}
            </p>
            <span
              className={cn(
                'mt-4 rounded-full border px-3 py-1 text-xs capitalize',
                archived
                  ? 'border-zinc-400/20 text-zinc-300'
                  : progress.status === 'overdue'
                    ? 'border-rose-300/20 bg-rose-300/5 text-rose-200'
                    : 'border-indigo-300/20 bg-indigo-300/5 text-indigo-200',
              )}
            >
              {archived
                ? 'Archived'
                : progress.status === 'active'
                  ? 'In progress'
                  : progress.status}
            </span>
            <dl className='mt-5 w-full space-y-2 text-sm'>
              <div className='flex justify-between gap-3'>
                <dt className='text-zinc-400'>Remaining</dt>
                <dd className='tabular-nums'>
                  {formatCents(progress.remainingCents)}
                </dd>
              </div>
              <div className='flex justify-between gap-3'>
                <dt className='text-zinc-400'>Planned weekly</dt>
                <dd className='tabular-nums'>
                  {formatCents(progress.plannedWeeklyCents)}
                </dd>
              </div>
              {progress.currentWeeklyCents !== null && (
                <div className='flex justify-between gap-3'>
                  <dt className='text-zinc-400'>Needed weekly now</dt>
                  <dd className='tabular-nums'>
                    {formatCents(progress.currentWeeklyCents)}
                  </dd>
                </div>
              )}
            </dl>
            {progress.status === 'upcoming' && (
              <p className='mt-3 text-xs text-zinc-400'>
                Starts {formatDate(goal.startDate)}.{' '}
                {archived
                  ? 'Savings activity is frozen while archived.'
                  : 'Follow the planned pace; you can record savings early.'}
              </p>
            )}
            {progress.status === 'overdue' && (
              <p className='mt-3 text-xs text-rose-200'>
                Overdue. {formatCents(progress.remainingCents)} remains.{' '}
                {archived
                  ? 'Savings activity is frozen while archived.'
                  : 'You can still record savings.'}
              </p>
            )}
            <p className='mt-4 text-xs leading-relaxed text-zinc-500'>
              {formatDate(goal.startDate)} to {formatDate(goal.targetDate)}.
              <br />
              Dates and pacing use UTC. Updated for {today}.
            </p>
            <ul className='mt-6 w-full divide-y divide-white/[0.06] border-t border-white/[0.06] text-left'>
              {members.map((member) => (
                <li
                  key={member.userId}
                  className='flex items-center gap-3 py-3'
                >
                  <Avatar
                    colorIndex={member.colorIndex}
                    displayName={member.displayName}
                  />
                  <div className='min-w-0 flex-1'>
                    <p className='break-words text-sm text-zinc-300'>
                      {member.displayName}
                      {member.userId === viewer.userId ? ' (you)' : ''}
                    </p>
                    <p className='text-xs text-zinc-500'>
                      {member.userId === goal.ownerId
                        ? 'Owner'
                        : member.removedAt !== null
                          ? 'Former member'
                          : 'Member'}
                    </p>
                  </div>
                  <span className='text-sm tabular-nums text-zinc-400'>
                    {formatCents(member.recordedCents)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
          <section className='min-w-0 lg:col-start-2 lg:row-span-2 lg:row-start-1'>
            <AmountGrid
              detail={detail}
              selected={selected}
              warning={warning}
              pending={busy}
              recordedRequestId={
                mutation.data?.ok && mutation.data.intent === 'record'
                  ? mutation.data.requestId
                  : null
              }
              onToggle={(index) => {
                if (busy || archived) return;
                setNotice(null);
                setSelection({
                  revision: goal.gridRevision,
                  indexes: new Set(
                    selected.has(index)
                      ? [...selected].filter((value) => value !== index)
                      : [...selected, index],
                  ),
                });
              }}
              onRecord={record}
              onUndo={(id) => submit('undo', { contributionId: id })}
            />
          </section>
          <div className='min-w-0 lg:col-start-1 lg:row-start-2'>
            <ContributionActivity
              detail={detail}
              snapshotAt={loaderData.snapshotAt}
              firstPage={activity}
              busy={busy}
              onUndo={(id) => submit('undo', { contributionId: id })}
            />
          </div>
        </div>
      </div>
      <Sheet
        open={controls === 'share'}
        onOpenChange={(open) => {
          if (!open) {
            setControls(null);
            setInviteLink(null);
            setCopyStatus(null);
          }
        }}
        title='Share this goal'
      >
        {warning && (
          <p role='alert' className='mt-3 text-sm text-amber-200'>
            {warning}
          </p>
        )}
        <p className='mt-3 text-sm leading-relaxed text-zinc-400'>
          Members can view this goal and its Contribution history, and record
          their own savings. They can see each member's name, or email when no
          name is available, but cannot see banking data.
        </p>
        <p className='mt-3 text-sm text-amber-200'>
          Anyone holding an unused valid link can join. Each link works once and
          expires after seven days. Share it privately.
        </p>
        <button
          type='button'
          disabled={busy || archived}
          onClick={() => submit('createInvite')}
          className={cn(primaryButtonClass, 'mt-4 w-full')}
        >
          {mutation.state !== 'idle' &&
          mutation.formData?.get('intent') === 'createInvite'
            ? 'Creating link...'
            : 'Create invite link'}
        </button>
        {archived && (
          <p className='mt-2 text-sm text-zinc-400'>
            Unarchive to create new invitations. Existing links stay invalid.
          </p>
        )}
        {linkAvailable && (
          <div className='mt-4'>
            <label htmlFor='invite-link' className='text-xs text-zinc-400'>
              New single-use invite link. It cannot be recovered after closing.
            </label>
            <input
              id='invite-link'
              readOnly
              value={inviteLink.url}
              onFocus={(event) => event.currentTarget.select()}
              className={cn(inputClass, 'mt-2')}
            />
            <button
              type='button'
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(inviteLink.url);
                  setCopyStatus('Link copied. Share it privately.');
                } catch {
                  setCopyStatus(
                    'Could not copy. Select the link and copy it manually.',
                  );
                }
              }}
              className='mt-2 min-h-11 rounded-xl border border-white/10 px-4'
            >
              Copy link
            </button>
            {copyStatus && (
              <p role='status' className='mt-2 text-sm text-zinc-400'>
                {copyStatus}
              </p>
            )}
          </div>
        )}
        <h3 className='mt-6 text-sm font-medium'>Outstanding invitations</h3>
        {!detail.invites.length && (
          <p className='mt-2 text-sm text-zinc-500'>No unused invitations.</p>
        )}
        <ul className='mt-2 divide-y divide-white/10'>
          {detail.invites.map((invite) => (
            <li
              key={invite._id}
              className='flex items-center justify-between gap-3 py-2 text-sm'
            >
              <span>Expires {formatDate(invite.expiresAt)} UTC</span>
              <button
                type='button'
                disabled={busy}
                onClick={() => submit('revokeInvite', { inviteId: invite._id })}
                className='min-h-11 rounded-lg px-3 text-rose-300 disabled:opacity-50'
              >
                Revoke
              </button>
            </li>
          ))}
        </ul>
        <h3 className='mt-5 text-sm font-medium'>Members</h3>
        <ul className='mt-2 divide-y divide-white/10'>
          {members
            .filter((member) => member.removedAt === null)
            .map((member) => (
              <li
                key={member.userId}
                className='flex items-center justify-between gap-3 py-2 text-sm'
              >
                <span className='min-w-0 break-words'>
                  {member.displayName}
                  {member.userId === goal.ownerId ? ' (owner)' : ''}
                </span>
                {member.userId !== goal.ownerId && (
                  <button
                    type='button'
                    disabled={busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          `Remove ${member.displayName}? They will lose access. Their Contributions and attribution will remain unchanged. Undo their Contributions separately if those savings should no longer count.`,
                        )
                      )
                        submit('removeMember', { memberUserId: member.userId });
                    }}
                    className='min-h-11 rounded-lg px-3 text-rose-300 disabled:opacity-50'
                  >
                    Remove
                  </button>
                )}
              </li>
            ))}
        </ul>
        <button
          type='button'
          onClick={() => {
            setControls(null);
            setInviteLink(null);
          }}
          className='mt-4 min-h-11 w-full rounded-xl border border-white/10'
        >
          Close
        </button>
      </Sheet>
      <Sheet
        open={controls === 'settings'}
        onOpenChange={(open) => {
          if (!open) setControls(null);
        }}
        title='Goal settings'
      >
        {warning && (
          <p role='alert' className='mt-3 text-sm text-amber-200'>
            {warning}
          </p>
        )}
        {settingsWarning && (
          <p role='alert' className='mt-3 text-sm text-amber-200'>
            {settingsWarning}
          </p>
        )}
        {controls === 'settings' && (
          <GoalForm
            key={settingsKey}
            initial={goal}
            locked={goal.firstContributionAt !== null}
            disabled={archived || busy}
            pending={mutation.state !== 'idle'}
            submitLabel='Save settings'
            onSubmit={edit}
          />
        )}
        <div className='mt-6 border-t border-white/10 pt-4'>
          <p className='text-sm text-zinc-400'>
            {archived
              ? 'Unarchive restores savings activity, but does not restore removed members or old invite links.'
              : 'Archive freezes savings and settings and invalidates all outstanding invite links. Members can still read history. You can still remove members and revoke access.'}
          </p>
          <button
            type='button'
            disabled={busy}
            onClick={() => {
              if (
                window.confirm(
                  archived
                    ? 'Unarchive this goal? Old invitations and removed members will not be restored.'
                    : 'Archive this goal? Savings activity will stop and all outstanding invite links will be permanently invalidated.',
                )
              )
                submit(archived ? 'unarchive' : 'archive');
            }}
            className='mt-4 min-h-11 w-full rounded-xl border border-amber-400/20 bg-amber-400/5 px-4 text-amber-200 disabled:opacity-50'
          >
            {archived ? 'Unarchive goal' : 'Archive goal'}
          </button>
        </div>
        <button
          type='button'
          onClick={() => setControls(null)}
          className='mt-3 min-h-11 w-full rounded-xl border border-white/10'
        >
          Close
        </button>
      </Sheet>
    </main>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const unavailable =
    isRouteErrorResponse(error) &&
    (error.status === 403 || error.status === 404);
  if (unavailable) return <GoalUnavailable />;
  return (
    <main className='min-h-screen bg-[#0b0b0e] px-5 py-16 text-zinc-100'>
      <div className='mx-auto max-w-lg rounded-3xl border border-white/10 bg-[#101014] p-8'>
        <h1 className='font-heading text-2xl font-semibold'>
          Could not refresh this goal
        </h1>
        <p className='mt-3 text-sm leading-relaxed text-zinc-400'>
          The stale details have been cleared. Check your connection and reopen
          the goal. If a recording response was lost, review the refreshed grid
          before retrying.
        </p>
        <Link
          to='/goals'
          className={cn(primaryButtonClass, 'mt-6 inline-flex')}
        >
          Back to savings goals
        </Link>
      </div>
    </main>
  );
}

function GoalUnavailable() {
  return (
    <main className='min-h-screen bg-[#0b0b0e] px-5 py-16 text-zinc-100'>
      <div className='mx-auto max-w-lg rounded-3xl border border-white/10 bg-[#101014] p-8'>
        <h1 className='font-heading text-2xl font-semibold'>
          Goal unavailable
        </h1>
        <p className='mt-3 text-sm leading-relaxed text-zinc-400'>
          This goal does not exist or you no longer have access. Its details
          have been cleared from this page. Ask the owner for a new invitation
          if needed.
        </p>
        <Link
          to='/goals'
          className={cn(primaryButtonClass, 'mt-6 inline-flex')}
        >
          Back to savings goals
        </Link>
      </div>
    </main>
  );
}
