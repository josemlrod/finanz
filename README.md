# Finanz

Single-user personal finance dashboard. Links bank accounts through [Plaid](https://plaid.com), shows account balances, and syncs transactions using Plaid's cursor-based sync protocol. Currently runs end-to-end against Plaid **Sandbox**.

## Stack

| Layer | Choice |
|---|---|
| Runtime / package manager | Bun |
| Framework | React 19 + React Router v8 (Framework Mode, SSR) |
| Build | Vite |
| Styling | Tailwind CSS v4 |
| Plaid | `plaid` (server SDK) + `react-plaid-link` (client) |
| Persistence | Convex (Items, Transactions, Linked Account snapshots) |
| Language | TypeScript (strict) |

## Architecture

```mermaid
flowchart LR
    subgraph Browser
        LB[PlaidLinkButton]
        DP[Dashboard + ItemPanel]
        AS[AutoSync polling]
    end

    subgraph Server["React Router server"]
        HL["GET / loader"]
        API["/api/plaid/*<br>link-token · exchange · sync · refresh-balances"]
        SVC[PlaidService]
        ST["Convex stores<br>(items · transactions · accounts)"]
    end

    PL[Plaid API]

    LB --> API
    AS --> API
    DP --> HL
    HL --> SVC
    API --> SVC
    SVC --> PL
    SVC --> ST
```

All client-server communication is React Router fetchers/forms posting to resource routes. No webhooks yet — `AutoSync` polls while initial transaction history backfills.

## Components

| Path | Responsibility |
|---|---|
| `app/routes/home.tsx` | Dashboard: loads items, account snapshots, and transactions; renders per-bank panels |
| `app/routes/api/plaid/*` | Resource routes: mint link tokens, exchange public tokens, run syncs, refresh balances |
| `app/lib/plaid/service.server.ts` | All Plaid logic: Link tokens (incl. update-mode reconnect), token exchange, cursor sync with pagination/retry, account fetches |
| `app/lib/plaid/convex-*-store.server.ts` | Convex-backed persistence implementing the `ItemStore` / `TransactionStore` / `AccountStore` interfaces from `types.ts` |
| `app/lib/plaid/wiring.server.ts` | Composition root: wires stores into `PlaidService` (lazy singletons) |
| `app/lib/plaid/errors.server.ts` | Normalizes Plaid errors and maps them to item health states (reauth, consent expiring, error) |
| `app/lib/crypto.server.ts` | AES-256-GCM encryption for Plaid access tokens at rest |
| `app/lib/env.server.ts` | Validates all `PLAID_*` env vars at boot, fails fast |
| `app/components/plaid-link.tsx` | SSR-safe Plaid Link modal wrapper (link + reconnect flows) |
| `app/components/dashboard/item-panel.tsx` | Per-bank UI: health banners, accounts, transactions, sync/refresh actions |
| `app/components/dashboard/auto-sync.tsx` | Headless backoff polling while transaction history loads (webhook substitute) |

## Setup & Commands

```bash
cp .env.example .env   # fill in Plaid/Clerk keys; generate encryption key: openssl rand -hex 32
bun install
bun run convex:dev     # create/select a dev deployment and push the schema/functions
```

Set `CONVEX_URL` in `.env` to the deployment's `CONVEX_CLOUD_URL` (the `CONVEX_SITE_URL` is not used). Generate `CONVEX_INTERNAL_SECRET` with `openssl rand -hex 32`, add it to `.env`, and set the same value on the development deployment:

```bash
bunx convex env set CONVEX_INTERNAL_SECRET
```

| Command | What it does |
|---|---|
| `bun run dev` | Dev server with HMR at `localhost:5173` |
| `bun run convex:dev` | Push Convex schema/functions to the development deployment and watch for changes |
| `bun run build` | Production build to `build/` |
| `bun run start` | Serve production build at `:3000` |
| `bun run typecheck` | Generate route types + `tsc` |
| `bun test` | Unit tests (crypto, env validation, error mapping, sync reconciliation) |

## Fly.io deployment

The app runs as a single Fly Machine. Per-Item sync uses an in-process lock, so only one machine should run sync for a given Item at a time (the default `fly scale count 1` is fine for this single-user app).

### Prerequisites

- [Fly CLI](https://fly.io/docs/hands-on/install-flyctl/) installed and authenticated (`fly auth login`)
- Plaid **production** API keys (requires [Plaid production access approval](https://plaid.com/docs/api/production/))
- Clerk **production** instance with live keys (`sk_live_…`, `pk_live_…`)
- A [Convex](https://dashboard.convex.dev/) project associated with this repository (`bun run convex:dev`)

### 1. Create the Fly app (no deploy yet)

From the repo root:

```bash
fly launch --no-deploy
```

Review `fly.toml` — confirm `internal_port = 3000` and the app name/region look correct.

`fly launch` may create two Machines by default. Scale to exactly one:

```bash
fly scale count 1
```

If upgrading from a deployment that used the old `finanz_data` volume, destroy it after confirming the app runs without it:

```bash
fly volumes list
fly volumes destroy <volume-id>
```

### 2. Configure and deploy Convex

Generate a shared secret, set it on the production Convex deployment, and deploy the functions and schema:

```bash
openssl rand -hex 32
bunx convex env set --prod CONVEX_INTERNAL_SECRET
bunx convex deploy
```

Enter the generated value when prompted by `convex env set` and retain it for the Fly secret in step 3. In the Convex dashboard, copy the production deployment's `CONVEX_CLOUD_URL`; use that value as `CONVEX_URL`. `CONVEX_SITE_URL` is not used by this app.

### 3. Set Fly secrets

Generate a fresh encryption key for production (`openssl rand -hex 32`). **Do not** reuse the sandbox key — existing encrypted tokens would be unreadable anyway on a fresh deploy.

```bash
fly secrets set \
  PLAID_CLIENT_ID="<production-client-id>" \
  PLAID_SECRET="<production-secret>" \
  PLAID_ENV="production" \
  PLAID_PRODUCTS="transactions" \
  PLAID_COUNTRY_CODES="US" \
  PLAID_TRANSACTIONS_DAYS_REQUESTED="90" \
  PLAID_TOKEN_ENCRYPTION_KEY="<64-hex-chars-from-openssl-rand-hex-32>" \
  CLERK_SECRET_KEY="sk_live_..." \
  VITE_CLERK_PUBLISHABLE_KEY="pk_live_..." \
  CONVEX_URL="https://<production-deployment>.convex.cloud" \
  CONVEX_INTERNAL_SECRET="<same-shared-secret-set-on-convex>"
```

Optional Plaid settings (set when needed):

```bash
fly secrets set PLAID_REDIRECT_URI="https://<your-domain>/..."   # mobile OAuth
fly secrets set PLAID_WEBHOOK_URL="https://<your-domain>/api/plaid/webhook"
```

### 4. Clerk production instance

1. In the [Clerk Dashboard](https://dashboard.clerk.com/), create a **production** instance (separate from development).
2. Add your Fly/custom domain under **Domains** and create the DNS **CNAME** records Clerk provides; wait until verification succeeds.
3. Under **API keys**, copy the live `sk_live_…` and `pk_live_…` keys into `fly secrets set` (step 4).
4. Mirror the development auth configuration:
   - **Email** one-time passcode sign-in enabled
   - **Passwords** disabled
   - **Sign-up restrictions** / allowlist so only your account can sign in (single-user app)

### 5. Deploy

```bash
fly deploy
```

Health checks hit `GET /sign-in` (returns 200; unauthenticated `/` redirects and is unsuitable). Confirm with `fly status` and `fly logs`.

### Local Docker smoke test

```bash
docker build -t finanz .
docker run --rm -p 3000:3000 \
  -e PLAID_CLIENT_ID=... -e PLAID_SECRET=... -e PLAID_ENV=sandbox \
  -e PLAID_PRODUCTS=transactions -e PLAID_COUNTRY_CODES=US \
  -e PLAID_TRANSACTIONS_DAYS_REQUESTED=90 \
  -e PLAID_TOKEN_ENCRYPTION_KEY="$(openssl rand -hex 32)" \
  -e CLERK_SECRET_KEY=sk_test_... -e VITE_CLERK_PUBLISHABLE_KEY=pk_test_... \
  -e CONVEX_URL=https://<development-deployment>.convex.cloud \
  -e CONVEX_INTERNAL_SECRET=<same-secret-set-on-development-convex> \
  finanz
```

Use an existing development Convex deployment with its schema/functions pushed. Visit `http://localhost:3000/sign-in` to confirm the server boots and env validation passes.

## Design decisions

- **No auth, single user by design** — a hardcoded user id is sent to Plaid.
- **Access tokens encrypted at rest** (AES-256-GCM); link/public tokens are never stored.
- **Free vs. billed calls**: page load uses free `/accounts/get`; billed real-time `/accounts/balance/get` only behind the explicit "Refresh balances" button.
- **Duplicate institutions blocked** on exchange — Plaid Item slots are permanently consumed on the Trial plan.
- **Reconnects use Link update mode** to repair an existing Item instead of creating a new billable one.
- **Persistence seam**: all storage goes through `ItemStore` / `TransactionStore` / `AccountStore` interfaces backed by Convex, keeping Plaid logic independent of the database.
