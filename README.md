# PayTrace

PayTrace reconciles digital payments and detects failures for Indian payment rails: UPI, debit and credit cards, NEFT and RTGS.

Every participant in a payment keeps its own record: the switch, the issuing bank, the acquiring bank, the merchant and settlement. PayTrace compares those records and sorts every disagreement into one of nine exception categories. It also names where the payment broke and puts the RBI deadline on each case. Analysts then work the cases under maker-checker control, and supervisors approve the high-value ones.

A built-in simulator generates realistic business days with injected failures. Because it knows the ground truth, it can score how accurately the reconciliation engine detects them.

---

## Quick start

You need Node.js 22.12+ and Docker (or any PostgreSQL 14+ server).

```bash
npm ci
docker run -d --name paytrace-db -e POSTGRES_PASSWORD=paytrace -e POSTGRES_DB=paytrace -p 5433:5432 postgres:16
cp .env.example .env
# In .env set:
#   DATABASE_URL=postgres://postgres:paytrace@localhost:5433/paytrace
#   TRUSTED_PROXY_HOPS=0
npm run db:migrate
npm run seed:demo
npm run dev
```

Open http://localhost:3000 and sign in with any account below. The seed also loads a simulated business day that has already been reconciled, so every screen has data.

| Role       | Email                  | Password     |
| ---------- | ---------------------- | ------------ |
| Admin      | `admin@demo.test`      | `admin`      |
| Supervisor | `supervisor@demo.test` | `supervisor` |
| Analyst    | `analyst@demo.test`    | `analyst`    |
| Viewer     | `viewer@demo.test`     | `viewer`     |

> **Demo only.** These accounts and their short passwords exist for local evaluation. Never seed them into an environment that holds real payment data. See [Real installations](#real-installations).

---

## Contents

1. [Quick start](#quick-start)
2. [Logins and roles](#logins-and-roles)
3. [What it does](#what-it-does)
4. [Requirement to feature mapping](#requirement-to-feature-mapping)
5. [Architecture](#architecture)
6. [Stack and why](#stack-and-why)
7. [Data model and migrations](#data-model-and-migrations)
8. [Reconciliation rules](#reconciliation-rules)
9. [Getting started (local)](#getting-started-local)
10. [Environment variables](#environment-variables)
11. [Deployment](#deployment)
12. [Testing and results](#testing-and-results)
13. [Security](#security)
14. [Accessibility and design](#accessibility-and-design)
15. [Performance](#performance)
16. [Troubleshooting](#troubleshooting)
17. [Research and sources](#research-and-sources)
18. [Known limitations](#known-limitations)

---

## Logins and roles

PayTrace has four roles, from least to most access. Each role can do everything the role before it can, plus more:

**viewer → analyst → supervisor → admin**

### Demo accounts

`npm run seed:demo` creates one account per role. Each password is the role name.

| Role       | Email                  | Password     | Demo name         | In one line                                                          |
| ---------- | ---------------------- | ------------ | ----------------- | -------------------------------------------------------------------- |
| Admin      | `admin@demo.test`      | `admin`      | Asha Admin        | Runs the system: users, settings and deletions.                      |
| Supervisor | `supervisor@demo.test` | `supervisor` | Suresh Supervisor | Checks the analysts' work: approves, sends back and reopens cases.   |
| Analyst    | `analyst@demo.test`    | `analyst`    | Anita Analyst     | Does the daily reconciliation work: files, runs and exceptions.      |
| Viewer     | `viewer@demo.test`     | `viewer`     | Vikram Viewer     | Looks but does not touch: dashboards, cases, traces and CSV exports. |

To give every demo account the same password instead, run `npm run seed:demo -- --password "<password>"` or set `DEMO_PASSWORD`. The seed never changes accounts that already exist. If simulated data is already present, it skips creating another demo day, so it is safe to run again.

### What each person does

#### Viewer: read-only oversight

For auditors, risk and compliance staff, business owners and anyone else who needs visibility without the power to change anything.

- Watch the **dashboard**: volumes, success and failure counts, reconciliation rate, exceptions by category and failure point, value affected and the manual-investigation queue.
- Browse and filter **exceptions**, open any case to read the evidence and history, and **export the list to CSV**.
- Use **transaction trace** to follow one payment across every participant, run and switch hop.
- See reconciliation runs, participant files (including downloads and the CSV template), simulations and the industry context page.
- Manage their own account: change their password and sign out other devices.

A viewer cannot change any data. The case-workflow buttons, upload forms and admin pages are not available to them, and the server refuses those actions anyway.

#### Analyst: the daily reconciliation work

The operations team member who keeps the books matched. An analyst can do everything a viewer can, and also:

1. **Bring in data.** Upload each participant's daily CSV file (switch, issuer, acquirer, merchant, settlement), or generate a simulated day in the **Simulator**.
2. **Run reconciliation.** Choose a business date and the files to compare, then start a run. It executes in the background, and the results show per-transaction verdicts and statistics.
3. **Work the exceptions.** For each break:
   - assign it (to themselves or a colleague) and **start review**;
   - read the suspected cause, recommended action, deadline and side-by-side participant records;
   - add comments as they investigate;
   - **resolve** it with a resolution code and a note, or **dismiss** it as not a break, with a reason.
4. **Respect the approval threshold.** If the value affected is **₹50,000 or more** (configurable), the analyst's resolution or dismissal does not close the case. It goes to **Pending approval** and waits for a supervisor.

Analysts work to the RBI and internal deadlines shown on every case. The dashboard counts the cases that are past their deadline and the compensation accrued.

#### Supervisor: the checker in maker-checker

The team lead who signs off on the analysts' work. A supervisor can do everything an analyst can, and also:

- **Approve** a pending resolution or dismissal, which closes the case.
- **Send back** a pending proposal with a note explaining what is missing. The case returns to _In review_, and the proposed resolution is cleared.
- **Reopen** a resolved or dismissed case with a reason, which returns it to _In review_.
- Read the **audit log**: every sign-in, failed sign-in and change to users, settings, files, runs and exceptions, with who did it and from which IP.

Two rules apply to approvals:

- **Four-eyes rule:** nobody can approve their own proposal, so a different supervisor or admin must approve it.
- A supervisor's own resolutions close immediately, even above the threshold, because they already hold approval authority.

#### Admin: system owner

The person responsible for the platform. An admin can do everything a supervisor can, and also:

- **Manage users:** invite people, assign or change roles, deactivate accounts, and issue one-time password-reset links (invites last 72 hours, resets 30 minutes). Links are emailed when SMTP is configured; otherwise the admin copies them from the screen.
- **Change settings:** amount-matching tolerance, duplicate-request window, credit SLAs per payment method, the high-value marker, the maker-checker approval threshold, and the RBI repo rate used for NEFT/RTGS penal interest.
- **Delete** participant files, reconciliation runs and simulations. A file that a run still uses cannot be deleted.

Safety guards: admins cannot change their own role or deactivate themselves, and the system always keeps at least one active admin.

### Permissions at a glance

| Capability                                                        | Viewer | Analyst | Supervisor | Admin |
| ----------------------------------------------------------------- | :----: | :-----: | :--------: | :---: |
| Dashboard, exceptions, runs, files, simulations, trace, insights  |   ✓    |    ✓    |     ✓      |   ✓   |
| Export exceptions to CSV, download files and the template         |   ✓    |    ✓    |     ✓      |   ✓   |
| Own account: change password, sign out other sessions             |   ✓    |    ✓    |     ✓      |   ✓   |
| Upload participant files                                          |        |    ✓    |     ✓      |   ✓   |
| Generate simulations, start reconciliation runs                   |        |    ✓    |     ✓      |   ✓   |
| Assign, comment, start review, resolve and dismiss exceptions     |        |    ✓    |     ✓      |   ✓   |
| Close high-value exceptions (at or above the threshold) directly  |        |         |     ✓      |   ✓   |
| Approve or send back proposals (never your own)                   |        |         |     ✓      |   ✓   |
| Reopen resolved or dismissed exceptions                           |        |         |     ✓      |   ✓   |
| Read the audit log                                                |        |         |     ✓      |   ✓   |
| Invite users, change roles, deactivate users, issue reset links   |        |         |            |   ✓   |
| Change settings (tolerances, SLAs, approval threshold, repo rate) |        |         |            |   ✓   |
| Delete files, runs and simulations                                |        |         |            |   ✓   |

The single source of truth is `src/server/auth/permissions.ts`. Every API route and service checks it on the server, so hiding a button is never the only protection.

### Exception lifecycle

```mermaid
stateDiagram-v2
  [*] --> Open: a reconciliation run finds a break
  Open --> InReview: start review (analyst+)
  Open --> Resolved: resolve or dismiss below the threshold (analyst+)
  InReview --> Resolved: resolve or dismiss below the threshold (analyst+)
  Open --> PendingApproval: analyst resolves or dismisses at or above the threshold
  InReview --> PendingApproval: analyst resolves or dismisses at or above the threshold
  PendingApproval --> Resolved: approve (supervisor+, not the proposer)
  PendingApproval --> InReview: send back with a note (supervisor+)
  Resolved --> InReview: reopen with a reason (supervisor+)
```

In the diagram, _Resolved_ also stands for _Dismissed_: both are closed states, and the same rules apply. Supervisors and admins skip _Pending approval_. Assignment and comments are available while a case is open. Every change is versioned, so if two people edit the same case at once, the second one is asked to reload instead of overwriting the first.

### Try the maker-checker flow (5 minutes)

1. Sign in as **analyst@demo.test** / `analyst`. Open **Exceptions**, set **Sort by** to _Amount affected_, and open a case worth ₹50,000 or more.
2. Click **Start review**, then **Resolve…**. Pick a resolution, write a note and submit. The case moves to **Pending approval**.
3. Sign out, then sign in as **supervisor@demo.test** / `supervisor`. Open the same case and click **Approve**, or **Send back…** with a note.
4. Still as supervisor, open **Audit log** to see both actions recorded with actor, time and IP.
5. Sign in as **viewer@demo.test** / `viewer` and open the same case. It shows _You have read-only access._ instead of action buttons.
6. Sign in as **admin@demo.test** / `admin`. Open **Settings** to change the approval threshold, or **Users** → **Invite a person** to add someone.

### Real installations

Do not run `seed:demo` against real data. It refuses to run when `NODE_ENV=production` unless `--allow-production` is passed, and that flag is meant only for demo environments.

1. Create the first administrator. The command prints a one-time link to set the password:

   ```bash
   npm run create-admin -- --email ops@yourbank.example --name "Ops Lead"
   ```

2. Sign in as that admin and invite everyone else from **Users** with the least role they need.
3. Invited users set their own password from the invite link (valid for 72 hours). Passwords must be 12–128 characters, and common passwords are refused.
4. After 10 failed sign-ins an account is locked for 15 minutes. Admins can issue a reset link at any time.

## What it does

| Area                    | What you get                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Dashboard**           | <ul><li>Totals, successful, failed and pending counts</li><li>Reconciliation %, exception count, value affected and manual-investigation count</li><li>Exceptions by category and by failure point, plus a per-method table</li><li>Reconciliation-rate trend (with a table alternative)</li><li>Open work across runs: past-TAT count and compensation accrued</li><li>The manual investigation queue</li></ul>      |
| **Exceptions**          | <ul><li>Filter by status, category, severity, method, failure point, assignee, handling, past-TAT and run; sort by risk, deadline or amount; export to CSV</li><li>Each exception shows the suspected cause and recommended action</li><li>It shows each participant's record side by side, the RBI or internal deadline, and the compensation accrued</li><li>It also keeps a comment and activity history</li></ul> |
| **Case workflow**       | <ul><li>Assign, start review, resolve with a resolution code, dismiss, approve, send back and reopen</li><li>Resolutions at or above the approval threshold (default ₹50,000) need a supervisor, and never the person who proposed them (four-eyes rule)</li><li>Optimistic locking stops lost updates</li></ul>                                                                                                      |
| **Participant files**   | <ul><li>Upload UTF-8 CSVs, one layout for all five participants</li><li>Files are validated row by row and rejected atomically with line-level errors</li><li>Exact re-uploads are rejected by checksum</li><li>Card numbers are refused</li><li>Download, delete and template are available</li></ul>                                                                                                                |
| **Reconciliation runs** | <ul><li>Pick a business date and the files to compare</li><li>Runs execute in a background worker</li><li>Results include stats, a per-transaction verdict and, for simulated data, detection accuracy</li></ul>                                                                                                                                                                                                      |
| **Transaction trace**   | Follow one reference across every participant, every run, and the simulated switch timeline hop by hop.                                                                                                                                                                                                                                                                                                               |
| **Simulator**           | <ul><li>Generates a business day of up to 100,000 payment intents, reproducible by seed</li><li>Presets: normal day, outage, festive peak</li><li>Configurable method mix and 17 failure-injection rates</li><li>Writes five participant files</li></ul>                                                                                                                                                              |
| **Administration**      | <ul><li>Users and roles, with invites and reset links (emailed if SMTP is set)</li><li>Settings: matching tolerances, SLAs, approval threshold and repo rate</li><li>Append-only audit log</li><li>Account page: change password, see and revoke sessions</li></ul>                                                                                                                                                   |
| **Industry context**    | In-app research page with 13 cited sources, mapping the eight recent industry issues to features.                                                                                                                                                                                                                                                                                                                     |

Every page and API route checks the signed-in role on the server. See [Logins and roles](#logins-and-roles) for who can do what.

## Requirement to feature mapping

| Requirement (problem statement #10)                                                                                                                                   | Where it is implemented                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Transaction simulator**: txn ID, customer, merchant, amount, method, timestamp, issuing and acquiring bank, switch, bank, merchant, settlement and refund status | `src/domain/simulator/simulate.ts` (`SimTransaction` has every field), stored in `sim_transactions`, UI at `/simulator`                                                                                                                                                                                                                                                                                                                                                                                                    |
| **B. Switch simulation** (Customer → Gateway/Switch → Bank → Merchant → Settlement): success, failure, timeouts, duplicates, delays, partial processing               | `routePayment()` builds a hop-by-hop timeline with latency. It injects 17 fault types: business and technical declines, timeout after debit (with and without auto-reversal), deemed/pending, beneficiary credit failure, delayed credit, duplicate debit, duplicate request, merchant not updated, merchant marked paid on failure, missing at the acquirer or switch, amount mismatch, missing from settlement, refund not credited and refund not in merchant books. Clean payments and clean refunds make up the rest. |
| **C. Reconciliation engine**                                                                                                                                          | `src/domain/recon/engine.ts`: a pure function that groups records by reference and applies ordered rules (see below). It runs in the worker (`src/server/services/runs.ts`).                                                                                                                                                                                                                                                                                                                                               |
| **D. Exception classification**: 9 categories                                                                                                                         | `EXCEPTION_CATEGORIES` in `src/domain/types.ts`. Each is detected by named rules, with a severity, failure point, cause, action, evidence and TAT.                                                                                                                                                                                                                                                                                                                                                                         |
| **E. Dashboard**: totals, success, failed, pending, recon %, exception count, value affected, categories, manual queue                                                | `src/app/(app)/page.tsx` and `src/server/services/dashboard.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| RBI/NPCI research and the 8 recent issues                                                                                                                             | `/insights` page, plus [Research and sources](#research-and-sources) below                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Real persistence, authentication, RBAC, security, accessibility, tests, deployment                                                                                    | Sections below                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

## Architecture

```mermaid
flowchart LR
  B[Browser] -->|HTTPS| P[proxy.ts<br/>CSP nonce, auth redirect]
  P --> W[Next.js App Router<br/>server components + /api routes]
  W -->|Drizzle / postgres.js| DB[(PostgreSQL 16)]
  W -->|enqueue + NOTIFY| DB
  K[Worker<br/>embedded or separate process] -->|LISTEN, SKIP LOCKED claim| DB
  K -->|simulate / reconcile| DB
```

- **One codebase, two processes.** The web app (Next.js) serves pages and a JSON API. The background worker runs simulations and reconciliations. The worker runs inside the web process when `EMBEDDED_WORKER=true` (simple deployments), or as separate replicas via `npm run worker`.
- **Job queue in PostgreSQL.**
  - Jobs live in a `jobs` table and are claimed with `FOR UPDATE SKIP LOCKED`.
  - `LISTEN/NOTIFY` gives instant pickup, with polling as the fallback.
  - Failures retry with exponential backoff, and stale jobs are recovered.
  - No Redis or other broker is needed.
- **Domain logic is pure TypeScript** (`src/domain`): the engine, simulator, TAT rules and CSV format have no I/O. That makes them fast to unit test, and the same code runs in the worker and the tests.
- **Layers:** `src/app` (UI and route handlers) → `src/server` (auth, HTTP helpers, services, worker) → `src/domain` (pure logic) → `src/db` (schema, client, COPY loader).
- **Rendering:** server components render every page with live data, and small client components handle forms and polling. Every page is dynamic because the CSP needs a per-request nonce.

## Stack and why

| Choice                                             | Why                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Next.js 16 (App Router) + React 19, TypeScript** | <ul><li>One deployable for the UI and API</li><li>Server components keep data access on the server</li><li>`proxy.ts` handles per-request CSP nonces</li><li>Standalone output gives a small container</li></ul>                                                                                                                                    |
| **PostgreSQL 16**                                  | <ul><li>Reconciliation is relational and needs ACID transactions; each run's results commit atomically</li><li>Bulk loading uses `COPY`</li><li>The job queue (`SKIP LOCKED`, `LISTEN/NOTIFY`) and append-only audit triggers run in the database, so no extra infrastructure is needed</li><li>Managed offerings exist in Indian regions</li></ul> |
| **Drizzle ORM + postgres.js**                      | <ul><li>Typed SQL with no runtime engine</li><li>SQL migrations are generated and checked in</li><li>The raw driver is available for `COPY`</li></ul>                                                                                                                                                                                               |
| **zod**                                            | One schema validates API input, forms, settings, environment variables and CSV rows.                                                                                                                                                                                                                                                                |
| **Argon2id (@node-rs/argon2)**                     | The OWASP-recommended password hash, with native speed.                                                                                                                                                                                                                                                                                             |
| **Database-backed sessions**                       | <ul><li>Revocable</li><li>Visible to the user (account page)</li><li>Only a SHA-256 hash of the token is stored</li></ul>                                                                                                                                                                                                                           |
| **Tailwind CSS v4**                                | Design tokens for light and dark themes, with no runtime CSS-in-JS (CSP-friendly).                                                                                                                                                                                                                                                                  |
| **pino**                                           | Structured JSON logs with secret redaction.                                                                                                                                                                                                                                                                                                         |
| **Vitest, Playwright + axe-core**                  | Fast unit and integration tests against a real database, and end-to-end tests with automated WCAG checks against the production build.                                                                                                                                                                                                              |

Alternatives considered:

- **A separate SPA + API:** two deployables for no benefit.
- **Redis/BullMQ for jobs:** another stateful service, while Postgres can do the job at this scale.
- **Prisma:** a heavier runtime and no first-class `COPY`.

## Data model and migrations

Migrations live in `drizzle/` and are applied with `npm run db:migrate`. They are idempotent and serialised with an advisory lock.

| Table                                  | Purpose                                                                                                                                                           |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `users`, `sessions`, `password_tokens` | Accounts (role, lockout counters), hashed session tokens, single-use hashed invite and reset tokens                                                               |
| `rate_limits`                          | Fixed-window counters for login throttling (per account and per IP)                                                                                               |
| `audit_events`                         | Append-only audit trail. A trigger (`drizzle/0001_audit_append_only.sql`) blocks UPDATE and DELETE, except anonymising the actor.                                 |
| `app_settings`                         | Matching tolerances, SLAs, approval threshold, repo rate                                                                                                          |
| `simulations`, `sim_transactions`      | Simulator configs and ground-truth transactions (with hop timeline)                                                                                               |
| `source_files`, `source_records`       | Participant files (unique per source + SHA-256) and their parsed rows                                                                                             |
| `recon_runs`, `recon_run_files`        | Runs, the files each used (file deletion is blocked while used), and a settings snapshot                                                                          |
| `recon_transactions`                   | Per-transaction verdict for each run                                                                                                                              |
| `exceptions`, `exception_activity`     | Classified breaks (unique per run + reference + category, `version` for optimistic locking, TAT fields, compensation rule), and their comments and status history |
| `jobs`                                 | Background job queue                                                                                                                                              |

Money is stored as integer **paise** (`bigint`). Times are stored as `timestamptz` and shown in IST.

To change the schema, edit `src/db/schema.ts`, run `npm run db:generate`, review the generated SQL and commit it.

## Reconciliation rules

Records are grouped by transaction reference. For each payment, the rules run in this order, and each payment gets at most one exception per category.

1. **Duplicate.** The same reference appears more than once in a participant's file.
2. **Amount mismatch.** The switch, issuer, acquirer and merchant disagree beyond the tolerance.
3. **Delayed (pending).** A participant still says PENDING at cutoff. Status rules stop here until the final status is known.
4. **Delayed (late credit).** The beneficiary was credited later than the method's SLA (UPI 5 min, cards 15, NEFT 120, RTGS 30, all configurable).
5. **Failed but debited.** The issuer debited, the beneficiary was not credited (acquirer failed, or the switch failed or has no record), and there is no reversal.
6. **Status mismatch (double payout).** A reversal was recorded although the beneficiary was credited.
7. **Successful, merchant not updated.** The beneficiary was credited, but the merchant has no record or says failed.
8. **Settlement mismatch.** The payment was settled but not credited, credited but unsettled, missing from settlement, or settled for a different amount.
9. **Missing.** A participant that should have a record has none, and no earlier rule explains it.
10. **Status mismatch.** Any remaining disagreement about the final status.

Two more checks run across payments:

- **Suspected duplicate requests:** the same customer pays the same merchant the same amount by the same method within 10 minutes.
- **Refund mismatch:** a refund is not credited, is missing in the merchant's books, is still pending, or exceeds the original payment.

**Deadlines (TAT) and compensation** (`src/domain/recon/tat.ts`):

- RBI circular RBI/2019-20/67:
  - UPI failed but debited: **T+1**.
  - UPI merchant payments and cards: **T+5**.
  - ₹100 per day beyond the deadline.
- NEFT must be credited or returned within 2 hours, and RTGS returned within 1 hour, with penal interest at **repo + 2%**. The repo rate is configurable and defaults to 5.50%.
- All other categories get internal SLAs, clearly labelled "Internal SLA".

## Getting started (local)

Requirements: Node.js 22.12+ and PostgreSQL 14+ (16 recommended). The [Quick start](#quick-start) runs PostgreSQL in Docker; any existing server works too.

```bash
npm ci
cp .env.example .env            # set DATABASE_URL (and APP_URL if not http://localhost:3000)
createdb paytrace               # or create the database in your Postgres tool
npm run db:migrate
npm run seed:demo               # optional: the 4 demo accounts + a reconciled demo day
npm run dev                     # http://localhost:3000 (the worker runs embedded)
```

The npm scripts `db:migrate`, `seed:demo`, `create-admin` and `worker` read `.env` automatically. For a plain local setup, set `TRUSTED_PROXY_HOPS=0`, because no proxy sits in front of the app.

Demo accounts and real administrators are covered in [Logins and roles](#logins-and-roles).

To run the production build locally: `npm run build && npm start`.

## Environment variables

See `.env.example`. All are validated at startup (`src/lib/env.ts`).

| Variable                        | Required     | Default       | Meaning                                                                                              |
| ------------------------------- | ------------ | ------------- | ---------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                  | yes          |               | `postgres://` connection string                                                                      |
| `APP_URL`                       | yes          |               | Public origin (e.g. `https://paytrace.example.in`). Used for CSRF origin checks and links in emails. |
| `NODE_ENV`                      |              | `development` | `production` enables `__Host-` secure cookies and HSTS                                               |
| `DATABASE_POOL_MAX`             |              | `10`          | Connections per process                                                                              |
| `SESSION_TTL_HOURS`             |              | `12`          | Session lifetime (sliding)                                                                           |
| `EMBEDDED_WORKER`               |              | `false`       | `true` runs the job worker inside the web process                                                    |
| `LOG_LEVEL`                     |              | `info`        | pino level                                                                                           |
| `SMTP_URL`, `MAIL_FROM`         |              |               | Enables invite and reset emails. Without them, admins copy one-time links from the UI.               |
| `TRUSTED_PROXY_HOPS`            |              | `1`           | Reverse proxies in front of the app, used to read the client IP for rate limiting                    |
| `POSTGRES_PASSWORD`, `WEB_PORT` | compose only |               | Used by `docker-compose.yml`                                                                         |

Test-only variables:

- `TEST_DATABASE_URL`: integration tests, default `…/paytrace_test`. The name must contain "test".
- `E2E_DATABASE_URL`: end-to-end tests, default `…/paytrace_e2e`. It is dropped and recreated on each run.

## Deployment

**Containers.** The `Dockerfile` builds two images:

- `--target web`: the standalone Next.js server, non-root, with a health check on `/api/health`. 432 MB uncompressed.
- `--target tools`: migrations, the worker and the admin scripts.

To try the production-like stack with Docker Compose:

```bash
cp .env.example .env    # set POSTGRES_PASSWORD; APP_URL=http://localhost:3000
docker compose up --build -d
```

Then add users: a real administrator, or the demo accounts for an evaluation:

```bash
docker compose run --rm migrate npm run create-admin -- --email you@example.com --name "Your Name"
docker compose run --rm migrate npx tsx --tsconfig tsconfig.json scripts/seed-demo.ts --allow-production   # demo only
```

The images run with `NODE_ENV=production`, so the session cookie is `Secure`. Chrome and Edge accept it on `http://localhost`; other browsers may need HTTPS.

To run compose next to a dev server, override the port and origin in the shell, for example `WEB_PORT=3001 APP_URL=http://localhost:3001 docker compose up --build -d`. Stop the stack with `docker compose down`, or `docker compose down -v` to delete its data as well. Compose needs `POSTGRES_PASSWORD` set for every command, including `down`.

Compose starts these services:

1. `db` (PostgreSQL 16 with a volume, not published on the host).
2. `migrate`, which runs once.
3. `web` (port 3000, or `WEB_PORT`).
4. `worker`, which you can scale with `docker compose up -d --scale worker=3`.

Both images were built and run in this environment. A simulation and a reconciliation went through the separate worker container with 100% recall.

**Production checklist.**

- **Data localisation (mandatory for real payment data).** RBI's April 2018 directive requires payment system data to be stored only in India. Run the database, backups, logs and the app in an Indian region, for example AWS `ap-south-1` (Mumbai) or `ap-south-2` (Hyderabad), GCP `asia-south1` or `asia-south2`, or Azure Central India.
- **Database:** use a managed PostgreSQL 16 with encryption at rest, automated backups and point-in-time recovery, and a private network. Run `migrate` before each release.
- **TLS:** terminate TLS at a load balancer. Set `APP_URL` to the HTTPS origin, `NODE_ENV=production`, and `TRUSTED_PROXY_HOPS=1` (or however many proxies you have).
- **Secrets:** keep `DATABASE_URL` and `SMTP_URL` in the platform's secret manager, never in the image.
- **Scaling:** the web tier is stateless, so run 2+ replicas. Run workers as a separate deployment with `EMBEDDED_WORKER=false` on the web tier. Jobs are safe with several workers.
- **Monitoring:**
  - Use `/api/health` (checks the database) for liveness and readiness.
  - Ship the JSON logs (stdout) to your log platform and alert on `level>=50`.
  - Worker logs `job completed` and `job failed` with timings.
  - Every API error response carries an `X-Request-Id` that matches the log line.
- **Backups and recovery:**
  - Rely on daily snapshots plus point-in-time recovery.
  - Restore drills: restore into a new instance, point a staging deployment at it, and check `/api/health` and the audit log.
  - Uploaded files are stored in the database, so a database backup is a complete backup.
- **Rollback:**
  - Images are immutable, so roll back by redeploying the previous tag.
  - Migrations are additive. Write a forward fix rather than a down-migration.
  - Take a snapshot before releases that change the schema.

**CI** (`.github/workflows/ci.yml`) runs these steps against a PostgreSQL service:

1. `npm audit`
2. Typecheck, lint and format check
3. Unit tests
4. Integration tests
5. Production build
6. Playwright end-to-end and accessibility tests
7. Builds of both Docker images

## Testing and results

| Suite       | Command                             | What it covers                                                                                                                                                                                                                                                                                                                                                                                                      | Result (29 Oct 2026, this repo) |
| ----------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| Unit        | `npm test`                          | Every engine rule and category, rule ordering and invariants, TAT dates and compensation, CSV parsing, validation, formula-injection escaping and Luhn check, money parsing and formatting, open-redirect guard, permission monotonicity, Argon2id, tokens, simulator determinism and limits, simulator→engine ground truth (5,000 txns), 100k-transaction volume                                                   | **74 passed** (7 files, ~10 s)  |
| Integration | `npm run test:integration`          | Real PostgreSQL: login, generic errors, lockout, throttling, inactive users, reset tokens (single-use, expiry, sign-out everywhere), audit trigger blocks UPDATE and DELETE, simulate→reconcile through the job queue with 100% recall, maker-checker and four-eyes rules, stale-version 409, API 401/403 per role, CSRF rejection, upload/dedupe/row errors/RBAC, CSV export, 100k volume                          | **31 passed** (3 files, ~44 s)  |
| End-to-end  | `npm run build && npm run test:e2e` | Production server: sign-in and return-to, open-redirect guard, security headers, cookie flags, analyst→supervisor approval journey, viewer read-only, admin refusal, upload with row errors, simulate→reconcile→accuracy, trace, filters and CSV export, user invite. axe WCAG 2.2 AA on every page (light, plus dark samples), 375 px reflow, mobile menu, skip link. Fails on any console error or CSP violation. | **40 passed** (~2 min)          |

The end-to-end tests sign in with the demo accounts. They drop and recreate their own database (`E2E_DATABASE_URL`) on every run, so they never touch your working data. Install the browser once with `npx playwright install chromium`.

The end-to-end tests found seven real bugs, all fixed:

- Exception filters were ignored when other filters were left blank.
- A crash on the simulation page after completion: a function was passed to a client component.
- A crash on the account page.
- Horizontal scroll on mobile.
- Four accessibility issues.

## Security

Mapped to the OWASP Top 10:

- **Access control:**
  - Every route checks the role on the server (`apiRoute({ permission })`), and services re-check resource rules (four-eyes, self-change, last-admin guards).
  - Pages render an access-denied state, not just hidden links.
  - IDs are UUIDs and are validated.
- **Authentication:**
  - Argon2id (m=19 MiB, t=2, p=1).
  - Passwords are 12–128 characters, with a blocklist.
  - Login is throttled per account (10 per 15 min) and per IP (50 per 15 min), and an account locks after 10 failures.
  - Unknown and known emails take the same time and get the same error.
  - Sessions use a 256-bit random token stored as a SHA-256 hash, in an `__Host-` cookie that is `Secure`, `HttpOnly` and `SameSite=Lax`.
  - Sessions slide, are revocable per device, and are revoked on password change or reset.
  - Invite and reset tokens are hashed and single-use.
- **CSRF:** mutating requests must carry an `Origin` matching `APP_URL` (falling back to `Sec-Fetch-Site`), on top of SameSite cookies.
- **Injection:**
  - All SQL is parameterised (Drizzle and postgres.js).
  - The CSP uses a per-request nonce with `strict-dynamic`, has no `unsafe-inline` scripts, and sets `frame-ancestors 'none'`.
  - React escapes output.
  - CSV exports neutralise spreadsheet formulas.
- **Uploads:**
  - Limits: extension, MIME type and size (25 MB / 250k rows).
  - Content checks: strict UTF-8, NUL bytes, row-level schema validation, and checksum dedupe.
  - Values that look like card numbers (Luhn) are refused, so primary account numbers never enter the database.
- **Headers:** HSTS (production), `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options: DENY`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`, and no `X-Powered-By`.
- **Audit:** logins, failures, user, settings, file, run and exception actions are recorded with actor and IP. The trail is append-only in the database.
- **Secrets and logs:** configuration comes from the environment and is validated. Logs redact passwords, tokens, cookies and authorization headers. `.env` is gitignored.
- **Dependencies:** `npm audit` reports 0 vulnerabilities, and CI fails on high-severity ones.

## Accessibility and design

Target: **WCAG 2.2 AA**, checked automatically with axe-core on every page and in dark mode.

- Semantic landmarks, a skip link, one `h1` per page, and labelled form fields with inline errors linked via `aria-describedby`.
- `role="alert"` and `role="status"` regions announce results.
- Status and severity always pair colour with an icon and text.
- Charts have a table alternative and keyboard-reachable tooltips.
- Tables scroll inside focusable regions, and pages reflow at 375 px.
- Visible focus, `prefers-reduced-motion` and forced-colours support.
- Native `<dialog>` for confirmations; the mobile menu closes with Escape.

**Colour palette.** Four brand colours, defined as design tokens in `src/app/globals.css`:

| Colour    | Hex       | Used for                                                                       |
| --------- | --------- | ------------------------------------------------------------------------------ |
| Vermilion | `#c54836` | Brand mark; buttons, links and chart bars (`#b8402f` wherever text sits on it) |
| Cream     | `#f6f8ed` | Page background in the light theme; text on vermilion and plum                 |
| Plum      | `#1c032b` | Body text, the sidebar, and the page background in the dark theme              |
| Apricot   | `#e29454` | The current page in the sidebar, and buttons in the dark theme                 |

Status colours (good, warning, serious, critical) stay separate from the brand colours. Critical is a crimson, so it is never mistaken for the vermilion accent. Every pairing passes axe's WCAG 2.2 AA contrast checks in both themes.

## Performance

These timings were measured in this environment (a shared cloud container with PostgreSQL 16 on the same host):

| Workload                                                                        | Time                  |
| ------------------------------------------------------------------------------- | --------------------- |
| Engine only: 100,761 transactions / 482,261 participant records                 | **2.6 s**             |
| Simulate and persist 100,000 intents (484,736 records, via `COPY`)              | **18.5 s**            |
| Reconcile and persist the same day (load, match, write verdicts and exceptions) | **13.5 s**            |
| Simulator → engine detection on the outage preset (5,000 txns)                  | 100% recall, 0 missed |

Several things keep this fast:

- Matching is a single hash-grouping pass, linear in the number of records.
- Bulk inserts use `COPY`. Replacing batched `INSERT`s cut the 100k simulation from 119 s to 18.5 s.
- Heavy work runs off the request path in the worker.
- Lists are paginated server-side and backed by indexes.

## Troubleshooting

| Symptom                                            | Fix                                                                                                                                                                          |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL is not set`                          | Create `.env` from `.env.example`, and run the npm scripts from the project folder.                                                                                          |
| "Email or password is incorrect" with a demo login | Make sure you seeded this database (`npm run seed:demo`). After 10 failed attempts an account locks for 15 minutes.                                                          |
| Signing in returns you to the sign-in page         | `APP_URL` must match the address in the browser exactly (scheme, host and port). On the Docker stack, use Chrome or Edge on `http://localhost`, or put HTTPS in front of it. |
| Port 3000 or 5432 is already in use                | Publish Postgres on another host port (the Quick start uses 5433), or start Next.js with `npm run dev -- -p 3001` and set `APP_URL` to match.                                |
| Style changes do not appear in `npm run dev`       | Stop the dev server, delete `.next/dev`, and start it again.                                                                                                                 |
| `seed:demo` says "Simulated data already exists"   | The database already has a demo day, so the seed left it alone. Generate another day from the **Simulator** page, or recreate the database.                                  |

## Research and sources

The `/insights` page presents this research in the app. Key figures:

- UPI was 83.7% of digital transaction volume in FY25.
- Digital payments were 99.7% of payment volume in 2024.
- FY26 (to February) saw 218.6 billion UPI transactions worth ₹284.7 lakh crore.

How PayTrace responds to the eight recent issues named in the brief:

| Issue                                 | PayTrace's response                                                                                                                                            |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Network or server failures            | Injected technical declines, timeouts and deemed states. Unresolved states are classified as Delayed, and the UPI playbook follows NPCI's status-check limits. |
| Payment vs merchant inconsistency     | "Successful, merchant not updated" with the RBI T+5 deadline and ₹100/day compensation.                                                                        |
| Duplicate requests                    | Exact duplicates plus suspected duplicate requests within a time window.                                                                                       |
| Fraudulent or suspicious transactions | Reconciliation signals that often accompany abuse go to manual review. **Not a fraud engine.**                                                                 |
| Delayed refunds                       | Refund mismatch: not credited, not in merchant books, pending, or over-refunded.                                                                               |
| Increasing volumes                    | Linear matching, `COPY` loading, background workers, measured at 100k transactions.                                                                            |
| Finding the exact point of failure    | The first disagreeing participant in path order, side-by-side records, and the switch timeline.                                                                |
| Faster automated reconciliation       | Five-way automated runs, categories with suggested actions, and a separate manual queue.                                                                       |

Sources:

1. RBI Annual Report 2024-25 (via IANS, 30 May 2025): https://ianslive.in/upi-share-surges-to-837-pc-in-digital-transactions-for-fy25--20250530153004
2. RBI Payment System Report, June 2025 (via The Tribune): https://www.tribuneindia.com/news/business/digital-payments-made-up-99-7-transactions-in-volume-in-2024-rbi
3. NPCI data, FY26 to February (via Angel One): https://www.angelone.in/news/market-updates/upi-records-218-6-billion-transactions-valued-at-284-7-lakh-crore-in-fy26
4. NPCI data, July 2026 (via StartupTalky): https://startuptalky.com/india-upi-transactions-july-2026/
5. NPCI circular UPI-OC-215 on outages and status-check limits (via MediaNama): https://www.medianama.com/2025/04/223-npci-new-guidelines-upi-outage/
6. NPCI decline data, July 2022 (via Inc42): https://inc42.com/buzz/ncpi-working-on-real-time-fix-for-upi-transaction-failures
7. RBI circular RBI/2019-20/67, harmonisation of TAT and customer compensation: https://www.rbi.org.in/scripts/NotificationUser.aspx?Id=11693
8. SBI RTGS/NEFT FAQ (RBI credit and return rules): https://sbi.bank.in/en/web/faq-s/faq-rtgs-neft
9. RBI Annual Report 2024-25 fraud data (via Deccan Chronicle): https://www.deccanchronicle.com/amp/nation/bank-fraud-amount-triples-to-36014-cr-in-fy25-despite-fewer-cases-rbi-1882116
10. RBI Ombudsman Scheme Annual Report 2024-25 (via Business Standard): https://www.business-standard.com/amp/finance/news/rbi-ombudsman-complaints-fy25-rise-loans-credit-cards-125120101346_1.html
11. Razorpay on NPCI's UDIR: https://razorpay.com/blog/all-you-need-to-know-about-npci-led-udir/
12. RBI FAQ, Storage of Payment System Data: https://rbi.org.in/scripts/FS_FAQs.aspx?Id=130
13. RBI MPC decision of 7 Oct 2026, repo 5.50% (via GKToday): https://www.gktoday.in/rbi-hikes-repo-rate-by-25-basis-points-to-5-50/

Several figures come from news coverage of RBI and NPCI publications rather than the primary PDFs. Each is labelled as such.

## Known limitations

- **No live rail integrations.** Data comes from CSV uploads or the simulator. There are no connectors to NPCI, card networks or bank SFTP drops, and no ISO 8583 or ISO 20022 parsing. The CSV layout is PayTrace's own, so real files would need a mapping step.
- **Matching is by reference.** Records whose references differ across participants (for example, an RRN at one participant and a UTR at another) are not linked. There is no fuzzy or many-to-one matching beyond suspected duplicates.
- **Simplified TAT dates.**
  - T+n uses calendar days in IST. Bank holidays are not modelled.
  - NEFT "B+2 hours" is measured from the transaction time, not from the batch settlement time.
  - The card-not-present TAT is blank in the RBI circular, so PayTrace applies T+5 internally.
- **Compensation is calculated, not paid.** PayTrace shows what is owed but does not post reversals, refunds or compensation.
- **Fraud is out of scope.** There is no real-time scoring, device or velocity models, or sanctions screening.
- **Authentication extras are missing.** There is no SSO/SAML or MFA. Password reset relies on email (SMTP) or an admin-issued link.
- **Single tenant and INR only.** A run compares one business date. Files above 25 MB / 250,000 rows must be split.
- **Load testing was single-node.** Measured at 100k transactions per run on a single shared node. No multi-node load test was run.
- **The simulator is not a replica of real traffic.** Its distributions (amounts, latencies, failure rates) are plausible, configurable assumptions, not calibrated to real data, so 100% recall on simulated data does not guarantee the same on real files.
