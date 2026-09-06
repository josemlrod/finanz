# Finanz

Personal finance app: shows spending from locally stored Plaid transactions
and tracks self-reported savings toward personal or shared goals.

## Language

**Item**:
A linked bank connection in Plaid; owns an encrypted access token and a sync Cursor.
_Avoid_: connection, bank link

**Linked Account**:
An individual account (checking, credit card, …) belonging to an Item.
_Avoid_: account (ambiguous — see flagged ambiguities)

**Transaction**:
A single money movement on a Linked Account; Plaid signs outflows positive and inflows negative.

**Cursor**:
Plaid's bookmark for incremental sync; persisted on the Item only after a complete pagination.

**Sync Diff**:
The added/modified/removed set produced by one complete sync pagination.

**Sync Engine**:
The module that runs Plaid's sync protocol (pagination, mutation retry, cursor rules) over a page fetcher and produces a Sync Diff. See ADR-0001.

**Item Health**:
Whether an Item can still be read: `ok`, `reauth_required`, `consent_expiring`, or `error`.

**Dashboard Model**:
The computed view data for the home page (month summary, category totals, daily spending series) derived from stored Transactions.

### Savings

The savings domain below is agreed for implementation, not yet shipped. See
[the savings goals MVP plan](docs/plans/savings-goals.md).

**Savings Goal**:
A personal or shared target for self-reported savings, with a start date, target date, and one owner.

**Savings Cell**:
A fixed whole-dollar portion of a Savings Goal that one user can complete in full.
_Avoid_: payment, scheduled installment

**Contribution**:
A user's manual record of money set aside to complete one Savings Cell.
_Avoid_: Transaction, payment, deposit

**Goal Member**:
A signed-in user granted access to view a Savings Goal and record their own Contributions.

**Goal Invite**:
A single-use invitation that grants membership to the first eligible signed-in recipient who accepts it before expiry or revocation.

## Relationships

- An **Item** has many **Linked Accounts** and many **Transactions**
- The **Sync Engine** produces a **Sync Diff**, which is applied to the transaction store and advances the **Item**'s **Cursor**
- The **Dashboard Model** is derived from stored **Transactions** only — it never calls Plaid
- A **Savings Goal** has one owner, many **Savings Cells**, and zero or more invited **Goal Members**.
- A **Savings Cell** has at most one active **Contribution** and can retain earlier undone **Contributions**.
- A **Contribution** belongs to one user and one **Savings Cell**; it is independent of **Transactions** and **Linked Accounts**.
- Recorded savings for a **Savings Goal** equal the sum of its active **Contributions**, not a verified balance.
- Removing a **Goal Member** revokes access without changing their **Contributions** or attribution.
- Archiving a **Savings Goal** freezes savings activity and settings, but its owner can still revoke access or unarchive it.
- Unarchiving restores activity without restoring removed **Goal Members** or making old **Goal Invites** usable again.

## Example dialogue

> **Dev:** "When an **Item**'s sync fails mid-pagination, do we keep the **Transactions** we already fetched?"
> **Domain expert:** "No — the **Sync Engine** discards the partial **Sync Diff**, restarts from the saved **Cursor**, and only advances the **Cursor** after a complete pagination."

> **Dev:** "If I remove a **Goal Member**, do their savings disappear from the goal?"
> **Domain expert:** "No. Removal only ends access. The owner must undo their **Contributions** separately if those savings should no longer count. Undo preserves history and makes each affected **Savings Cell** available again."

## Flagged ambiguities

- "account" has been used for both **Item** and **Linked Account** (e.g. `const [account] = items` in the home route refers to a dashboard Item) — resolved: use **Item** for the bank connection and **Linked Account** for individual accounts.
- "paid" and "saved" can imply a payment or current balance. Savings UI uses "Record savings", "Recorded savings", and completed or unpaid cells; Finanz neither moves money nor verifies that recorded savings remain available.
