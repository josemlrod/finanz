# Finanz

Personal finance dashboard: links bank accounts through Plaid and shows month-over-month spending from locally stored transactions.

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

## Relationships

- An **Item** has many **Linked Accounts** and many **Transactions**
- The **Sync Engine** produces a **Sync Diff**, which is applied to the transaction store and advances the **Item**'s **Cursor**
- The **Dashboard Model** is derived from stored **Transactions** only — it never calls Plaid

## Example dialogue

> **Dev:** "When an **Item**'s sync fails mid-pagination, do we keep the **Transactions** we already fetched?"
> **Domain expert:** "No — the **Sync Engine** discards the partial **Sync Diff**, restarts from the saved **Cursor**, and only advances the **Cursor** after a complete pagination."

## Flagged ambiguities

- "account" has been used for both **Item** and **Linked Account** (e.g. `const [account] = items` in the home route refers to a dashboard Item) — resolved: use **Item** for the bank connection and **Linked Account** for individual accounts.
