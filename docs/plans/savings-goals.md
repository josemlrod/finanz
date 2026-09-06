# Savings goals MVP

Status: implemented locally with the Tactile design; not deployed.

Implementation verification passed: `bun test` reports 187 passing tests,
including an isolated route-test wrapper whose child suite passes 121 checks.
`bun run typecheck`, `bun run build`, and supported
`bunx convex codegen --typecheck enable` also pass. No prototype imports remain.

The production routes replace the prototypes. Creation, settings, invitations,
member management, and archive controls use the chosen Tactile design language.

Outstanding invitations are limited to 20 unexpired, unredeemed, unrevoked links
per goal. Expired links do not consume capacity. Archive revokes live links in
the same bounded transaction. Goals list reads paginate 12 memberships at a time
and filter archive state before calculating totals; filtered pages can be empty.

Release checks still needed: live two-user Clerk flows, real Convex concurrent
requests, desktop/mobile keyboard and dialog behavior, and deployment. The
`convex-test` runtime serializes top-level mutations, so its concurrency tests
verify legal serial outcomes rather than production OCC retries.

Accepted deferral: the owner declined a production-server logging change during
implementation. `react-router-serve` logs full request URLs, including invitation
tokens and auth `returnTo` destinations. Hashing stored tokens and response
referrer policies do not prevent this access-log exposure. Keep log access
restricted. Review proxy logs and Clerk telemetry before wider sharing.

Finanz records self-reported savings toward a personal or shared goal.
It does not move money, verify balances, or track withdrawals.

The first savings method is a fixed grid of varied whole-dollar amounts.
Dates determine pacing, not cell amounts or grid layout.

This document supersedes the earlier conversational draft. Follow the glossary
in `CONTEXT.md`. Implementation choices below explain how to deliver the agreed
behavior; they are not additional user-facing features.

## Agreed behavior

### Create and configure a goal

- Supply a name, USD target, minimum and maximum cell amounts, start date, and target date.
- All monetary inputs and cell amounts are positive whole dollars. Minimum and maximum are strict bounds.
- Offer a duration shortcut such as six months alongside date selection.
- Preview the grid, cell count, and planned average weekly savings before creation.
- Generate a deliberate mix of smaller and larger amounts, favoring familiar denominations and multiples of $5 where possible.
- Allow other whole-dollar denominations when necessary to reach the exact target. Never create an out-of-bounds remainder cell.
- The cell amounts sum exactly to the target. Minimum and maximum need not both appear.
- Choose the count automatically, with a maximum of 500 cells. There is no cell-count input or regenerate button.
- Identical target and contribution bounds produce the same preview. If the only feasible grid has equal amounts, explain that in the preview rather than inventing variation.
- If no grid is possible within the bounds and count limit, explain the conflict and ask the user to adjust the inputs.
- Rows and columns are responsive layout only. Users can select any unpaid cell; there are no weekly rows, scheduled cells, or reservations.
- Goals work without any linked Item and do not call Plaid.

The owner can edit target, bounds, and start date until the first Contribution
is recorded. Target or bound changes require a new preview and confirmation.
After the first Contribution, these settings stay locked even if every
Contribution is later undone. Name and target date remain editable while active.

### Record and correct savings

- Selecting cells is local UI state. It does not reserve them or record savings.
- Confirm selected cells with "Record savings" and their combined amount.
- The signed-in user records only their own Contributions, using the current server timestamp. There is no backdating or recording on behalf of another person.
- Contributions count immediately. There is no owner approval queue.
- Each cell is completed in full by one user. Partial funding and multiple active contributors to one cell are excluded.
- Show recorded and remaining amounts, completion percentage, and contributor attribution.
- Members can undo individual cells they contributed; the owner can undo anyone's Contributions.
- Undo marks the Contribution as undone, preserves who performed the correction and when, and releases the cell.
- Recording several cells at once does not force them to be undone together.
- Removing a member does not change totals. If their savings should no longer count, the owner must undo the relevant Contributions separately.
- Explain that this tracks completed savings steps, not money currently available. No withdrawal amount or automatic bank reconciliation exists.

If another user completes any selected cell before confirmation, reject the
entire submission. Refresh the grid, preserve still-available selections, explain
the conflict, and require confirmation of the revised total. Never silently
record a smaller amount. A grid revision mismatch also rejects the submission;
clear selections from the old grid and show the new preview.

### Pacing and completion

- Dates affect pacing only. Extending a deadline never changes cells or Contributions.
- Show planned average weekly savings across the full current date range and current average weekly savings needed to finish on time. Editing the deadline recalculates both; there is no creation-time pace snapshot.
- Contributions are permitted before the start date and after the deadline.
- Before the start date, show the planned pace rather than a catch-up rate.
- Once the deadline has passed, show "Overdue" and the remaining amount, not a negative or infinite weekly rate.
- A fully recorded target is "Completed" regardless of the date. Completion does not automatically archive the goal.
- Undo can reopen a completed goal. Do not automatically redistribute unfinished cells or prevent late Contributions.

### Sharing and access

- Only the owner creates Goal Invites and removes members.
- A cryptographically secret link is single-use, expires seven days after creation, and can be revoked by the owner.
- The first eligible signed-in recipient to explicitly accept it becomes a member immediately. Merely loading the URL does not redeem it.
- A link is not bound to a specific email. Warn the owner that anyone holding an unused valid link can join.
- Identify the signed-in recipient on the acceptance page before they accept.
- The owner and existing active members cannot consume invitations. Removed members may return through a new invitation.
- Active members can see amounts, dates, contributor names, and the goal-wide Contribution history. When a collaborator has no profile name, members see that collaborator's primary email instead. They cannot see banking data.
- Expiry affects invitations, not accepted memberships. Removed users lose server access immediately, even if their browser still displays a stale page.
- No self-service leave action or ownership transfer in the MVP.

### Archive and unarchive

- Only the owner can archive or unarchive a goal.
- Archived goals remain readable to the owner and active members.
- Archive blocks Contributions, undo, settings edits, invitation creation, and invitation acceptance.
- The owner can still remove members and revoke invitations while archived.
- Archive invalidates all outstanding invitations. Unarchive must not make them usable again.
- Unarchive restores activity with the same grid, history, and remaining memberships. It does not restore removed members.
- There is no deletion in the MVP.

### Activity and shared updates

- Include a goal-wide chronological activity list, newest first.
- Group each multi-cell confirmation into one entry, for example "Alex recorded $150 across 3 cells."
- Expanding an entry shows cell amounts and their current active or undone state.
- Undo is a separate chronological entry naming the actor and the affected Contribution. Keep the original entry visible and mark the affected cell as undone.
- Per-cell details can show attribution and permitted undo controls; a separate per-cell history interface is not required.
- Refresh the visible detail page approximately every ten seconds, without browser Convex subscriptions.
- Polling is read-only. Skip hidden tabs, overlapping reads, and active mutations; refresh when returning to the tab.
- Remove stale selections for cells completed by others. A server conflict check remains mandatory regardless of polling.
- On loss of access, discard the stale detail view rather than leaving financial history visible indefinitely in the application.

## Existing architecture and constraints

- The app uses React Router Framework Mode with SSR, Clerk, and server-only Convex HTTP calls.
- `app/lib/auth.server.ts` resolves authenticated Clerk identity. Convex functions validate the internal secret and resolve the local user through `convex/lib/users.ts`.
- API arguments currently called `userId` carry a Clerk string ID; persisted owner, member, and contributor references use Convex user IDs. Never accept an actor ID from a form.
- `users` currently stores only the Clerk ID. Use the trusted authenticated profile name for goal attribution, then the primary email when no name is available, with a neutral fallback only when Clerk provides neither.
- `app/routes/sign-in.tsx` and `app/routes/sign-up.tsx` currently return users to `/`. Invites require safe destination preservation across both flows.
- The Dashboard Model remains derived from stored Transactions. Savings progress is a separate calculation and does not alter ADR-0001 or Plaid synchronization.
- The README recommends a single-user Clerk allowlist. Confirm deployed settings permit intended collaborators before testing registration or releasing sharing.

## Implementation choices

### Money, dates, and generation

Store money as safe integer cents, constrained to multiples of 100. Generate in
whole dollars and convert with overflow checks. This does not change existing
Transaction storage. Reject non-finite, fractional-dollar, unsafe, or malformed
inputs on the server as well as in the UI.

Use validated date-only `YYYY-MM-DD` values, with target date strictly after
start date. Past start dates and past target dates are allowed; the overdue
rules still apply. For a consistent MVP boundary, derive today's date in UTC
and say so near date-sensitive pacing details. Use calendar-day arithmetic,
not local-time millisecond differences affected by daylight saving time.
Duration shortcuts use calendar months and clamp to the destination month's
last valid day.

Treat the target date as an inclusive final saving day. Let `endExclusive` be
the day after it. Planned weekly pace is `targetCents * 7 / planDays`, where
`planDays` is the day count from start date to `endExclusive`. During the plan,
current weekly pace is `remainingCents * 7 / remainingDays`, measured from today
to `endExclusive`. Round only for display. Completion and overdue states take
precedence over rate calculation; dates never constrain cell selection.

For target dollars `T`, lower bound `L`, and upper bound `U`, feasible counts
satisfy:

```text
ceil(T / U) <= n <= min(floor(T / L), 500)
```

If that interval is empty, reject the configuration. Otherwise first consider
counts that permit unequal whole-dollar amounts, and prefer one whose average
is near the midpoint of the bounds. Use a uniform grid only if no feasible
count permits variation. For example, a $100 target with $40-$160 bounds should
produce varied cells such as $40 and $60, not a single $100 cell. For the chosen
count, distribute amounts across the allowed range rather than filling almost
every cell with the average. Favor familiar denominations and repair the exact
sum using whole-dollar adjustments within the bounds. Keep ordering deterministic.

The implementing agent must test a representative $10,000 / $10-$100 preview
for meaningful low and high denominations, not merely $54 and $55 cells.
Also test forced-equal and awkward-remainder inputs. Use the same pure generator
for the preview and authoritative server creation. Keep its result persisted;
future generator changes must not alter existing goals.

### Data model

The following are logical fields and indexes, to be expressed with existing
Convex validators and naming conventions. Indexes do not enforce uniqueness;
mutations must enforce it atomically.

| Table               | Fields and purpose                                                                                                                                                                                                                      | Important indexes                            |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `goals`             | Owner, name, literal USD currency, method `amount_grid`, target/min/max cents, start/target dates, immutable-between-approved-edits cell amount array, grid revision, optional first-Contribution timestamp, optional archive timestamp | Owner                                        |
| `goalMembers`       | Goal, user, trusted display-name snapshot, joined timestamp, optional removal timestamp; include an owner row for attribution and listing, but derive owner privileges from the goal                                                    | Goal/user; user                              |
| `goalContributions` | Goal, cell index, contributor, amount cents, submission ID, recorded timestamp, optional undo actor and timestamp                                                                                                                       | Goal; goal/cell; goal/contributor/submission |
| `goalInvites`       | Goal, token hash, creator, created/expiry timestamps, optional recipient/redemption timestamp, optional revocation timestamp                                                                                                            | Token hash; goal                             |
| `goalActivity`      | Goal, event kind, actor, timestamp, submission ID or affected Contribution ID                                                                                                                                                           | Goal and chronological order                 |

The activity table is an implementation choice for the requested chronological
list. It allows bounded pagination of grouped recording and undo events without
scanning all Contributions every ten seconds. Write events in the same mutation
as the state change. It is not a second source of monetary totals.

Store cell amounts once as a bounded array on the goal. A cell's identity is
the goal ID plus its grid revision and array index, never row/column coordinates.
After the first Contribution, the revision and amounts cannot change. No
separate cell table or generic savings-strategy framework is required.

Derive recorded totals from active Contributions. Do not persist a mutable
`savedAmount`. Repeated record/undo cycles retain separate Contribution records;
only one can be active for any cell. Detail reads should not fetch unbounded
historical Contributions: use suitable active-state indexes or bounded per-cell
active lookups. Activity responses are cursor-paginated and bounded separately.

### Atomic operations and authorization

Every query and mutation validates the internal secret and authenticated user.
Goal IDs, cell indexes, Contribution IDs, and tokens are untrusted inputs. Check
that every referenced record belongs to the authorized goal. Goal membership
never authorizes reads of an Item, Linked Account, or Transaction.

| Operation                     | Owner                                       | Active member                  | Removed member / outsider                      |
| ----------------------------- | ------------------------------------------- | ------------------------------ | ---------------------------------------------- |
| Read goal and activity        | Yes, including archived                     | Yes, including archived        | No                                             |
| Record own Contributions      | Active goal only                            | Active goal only               | No                                             |
| Undo Contribution             | Anyone's, active goal only                  | Own only, active goal only     | No                                             |
| Edit name/deadline            | Active goal only                            | No                             | No                                             |
| Edit target/bounds/start      | Active goal, before first Contribution only | No                             | No                                             |
| Create invite                 | Active goal only                            | No                             | No                                             |
| Remove member / revoke invite | Yes, including archived                     | No                             | No                                             |
| Archive / unarchive           | Yes                                         | No                             | No                                             |
| Accept valid invite           | Owner cannot consume                        | Existing member cannot consume | Signed-in eligible recipient, active goal only |

The owner cannot remove their own owner membership. Removal retains the
membership record and display attribution. Rejoining reactivates access without
reassigning old Contributions or creating duplicate active memberships.

Recording accepts distinct cell indexes, the expected grid revision, and an
idempotency submission ID. Compute amounts server-side. Claim all selected cells,
set the permanent first-Contribution marker if absent, and append one grouped
activity event in a single Convex mutation. Grid edits and recording must both
read/write the goal state so their race cannot bypass the permanent lock.

Scope submission IDs to goal and contributor. Repeating a successful request
with the same payload returns the original outcome without creating new records
or events, even after undo. Reusing the ID with a different payload is an error.
Check current access before returning a replay. Repeated undo must not release
a newer Contribution or append duplicate correction events.

Invite redemption atomically checks expiry, revocation, consumption, recipient
eligibility, and archive state before granting membership and consuming the
invite. Archive revokes outstanding invites atomically with the state change.
Choose a bounded outstanding-invite policy if needed for Convex transaction
limits and document it before implementation rather than silently truncating
revocation. Race-test redemption against revocation and archive.

### Invitations and authentication

Generate high-entropy tokens with the server's cryptographic random source and
persist only a hash. Return the raw link when created; do not attempt to recover
it from storage. Treat tokens as credentials: no raw URLs in application logs
or error reports. Review request logging and third-party resources on the invite
and auth pages for token exposure.

Use an authenticated invite landing page and explicit POST acceptance. Safe
return-to handling accepts only same-origin local absolute paths, rejects
protocol-relative URLs, backslashes and control characters, and prevents auth
redirect loops. Preserve the validated destination across sign-in, sign-up,
their cross-links, and Clerk completion. Use URL encoding helpers, not manual
query-string concatenation.

Set `Cache-Control: no-store` and `Referrer-Policy: no-referrer` on invitation
responses and auth responses carrying the invitation destination. Do not expose
Contribution history before membership is granted. Expired, revoked, or consumed
links provide a useful unavailable message without exposing goal details.

### UI and refresh behavior

Use the existing visual tokens and Base UI primitives. Keep the grid responsive,
with keyboard-operable selection, visible focus, accessible amounts and states,
and completion indicators that do not rely only on color. Completed-cell details
must remain accessible; a disabled button alone cannot provide them.

Use page loaders/actions and a server-only store. Keep ten-second revalidation
in the detail route with proper cleanup; do not reuse Plaid's mutation-based
AutoSync. Preserve expanded activity and valid local selection across refreshes.
Paginated history should deduplicate by stable event ID when new events arrive.
Represent pending, failed, conflict, expired-invite, archived, empty, completed,
and lost-access states explicitly. Do not optimistically count unconfirmed money.

## Execution slices

Implement and verify each slice before handing it off. Read current repository
instructions and the React Router Framework Mode guidance before route edits.
Do not manually edit generated Convex files or deploy without authorization.

### 1. Solo goal creation and progress

Deliver creation, preview, list/detail pages, recording, individual undo, and the
chronological activity list for the owner. Include the final data invariants now
so collaboration does not require replacing the recording model.

| File                                             | Change                                                                        |
| ------------------------------------------------ | ----------------------------------------------------------------------------- |
| `convex/schema.ts`                               | Add goals, memberships, Contributions, and activity definitions and indexes   |
| `convex/lib/goals.ts`                            | Pure money/date/configuration validation and deterministic grid generation    |
| `convex/goals.ts`                                | Owner-authorized reads, creation, atomic record/undo, and activity pagination |
| `app/lib/goals/convex-goal-store.server.ts`      | Typed adapter using existing Convex client and authenticated identity         |
| `app/routes/goals.tsx`                           | Authenticated list, create form, and preview                                  |
| `app/routes/goal-detail.tsx`                     | Detail loader and intent-based actions                                        |
| `app/components/goals/amount-grid.tsx`           | Selection, confirmation, attribution, and undo controls                       |
| `app/components/goals/contribution-activity.tsx` | Grouped, expandable, paginated chronological history                          |
| `app/routes.ts`                                  | Register `/goals` and `/goals/:goalId`                                        |
| `app/components/signal-dashboard.tsx`            | Add a Savings goals link in the existing header                               |

Acceptance: creation works without an Item; reload preserves grid and progress;
totals remain exact; private-user isolation holds; multi-cell recording is
atomic and idempotent; per-cell undo preserves grouped history. Grid tests cover
feasibility, strict limits, variation, determinism, safe integer handling, and
the 500-cell boundary.

### 2. Signed-in invitations and shared membership

Deliver the complete create-link, authenticate, accept, and contribute flow.

| File                                                  | Change                                                                            |
| ----------------------------------------------------- | --------------------------------------------------------------------------------- |
| `convex/schema.ts` and `convex/goals.ts`              | Invites, membership authorization, atomic redemption, removal, and revocation     |
| `app/lib/goals/convex-goal-store.server.ts`           | Token generation/hashing and trusted contributor display names                    |
| `app/lib/auth-redirect.ts`                            | Pure shared local-destination validation                                          |
| `app/lib/auth.server.ts`                              | Preserve requested local destination for page auth; leave API 401 behavior intact |
| `app/routes/sign-in.tsx` and `app/routes/sign-up.tsx` | Carry safe destination across forms, cross-links, and completion                  |
| `app/routes/goal-invite.tsx`                          | Authenticated landing page and POST acceptance                                    |
| `app/routes/goal-detail.tsx`                          | Owner invitation and membership controls                                          |
| `app/routes.ts`                                       | Register `/invites/:token`                                                        |

Acceptance: GET never consumes invitations; first eligible recipient wins;
expiry and revocation work; authentication returns to the invite; unsafe redirects
fail; removed users cannot read or mutate; attribution and totals survive removal;
owner/member undo permissions hold; no collaborator banking data leaks.

### 3. Lifecycle, pacing, and shared refresh

| File                                             | Change                                                                                  |
| ------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `convex/goals.ts`                                | Allowed settings edits, permanent configuration lock, grid revisions, archive/unarchive |
| `app/lib/goals/progress.ts`                      | Pure date-based pacing and completion calculations                                      |
| `app/routes/goal-detail.tsx`                     | Settings, pacing, archive controls, polling, and access-loss handling                   |
| `app/components/goals/amount-grid.tsx`           | Revision mismatch and concurrent-selection feedback                                     |
| `app/components/goals/contribution-activity.tsx` | Stable pagination/expansion during refresh                                              |

Acceptance: stale-grid submissions fail; edits racing first Contribution cannot
bypass the lock; an undone goal does not regain configuration editability;
conflicting cells reject the whole request; archiving blocks savings but permits
access revocation; unarchive restores neither members nor links; pacing handles
future starts, overdue goals, deadline edits, leap dates, and completion.

### 4. Release verification and documentation

Write tests alongside each earlier slice, not only at the end. Expected files:

- `convex/lib/goals.test.ts`: generation and validation invariants.
- `convex/goals.test.ts`: permissions, atomicity, retries, history, membership, invitations, and lifecycle races.
- `app/lib/auth-redirect.test.ts`: safe paths and malicious redirect inputs.
- `app/lib/goals/progress.test.ts`: date boundaries and pacing.
- `app/routes/goals.test.ts`: authenticated actor forwarding, input errors, invite GET/POST semantics, and response policies.

Follow `convex-test` module registration patterns in existing tests. Update the
README with manual-tracking semantics, polling, invite access requirements, and
deployment order. Remove the not-yet-shipped note in `CONTEXT.md` only when the
feature actually ships. Keep this plan's status accurate.

Run from the repository root:

```bash
bun test
bun run typecheck
bun run build
```

Use supported Convex code generation when API types change; never hand-edit
`convex/_generated/`. Generation can require deployment configuration. Report
missing credentials rather than deploying production as a verification shortcut.

There is no existing browser E2E setup. Manually verify two signed-in sessions,
an unauthenticated invite flow through both sign-in and sign-up, cell conflicts,
member removal during an open session, archive/unarchive, and fresh progress
within roughly ten seconds on visible tabs. Check mobile, keyboard interaction,
focus, and activity pagination. Automated unit tests alone do not verify these.

When deployment is explicitly authorized, deploy Convex before the application:

```bash
bunx convex deploy
fly deploy
```

### Coordination and handoff

Execute slices 1-3 in order. Auth return-to work may run alongside slice 1 once
its helper contract is agreed. Avoid simultaneous edits to the schema,
`convex/goals.ts`, route registration, or detail route. Separate generator and
pacing tests can be delegated after interfaces are fixed.

Each agent reports exact changed files, verification commands and results,
remaining risks, and any deviations requiring approval. Do not change product
rules to make a failing test pass. Preserve unrelated worktree changes.

## Risks and excluded scope

The main risks are a technically valid but unhelpful denomination mix, stale-grid
or shared-cell races, invitation credential exposure, and incomplete authorization
on secondary reads such as activity pagination. Test these explicitly.

The plan does not add bank transfers, balance verification, withdrawals, partial
cells, contribution approval, contribution backdating, recording for someone
else, automatic redistribution, multiple currencies, self-service leaving,
ownership transfer, deletion, instant subscriptions, or additional savings methods.
