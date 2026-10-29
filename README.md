# PayTrace

PayTrace reconciles digital payments and detects failures for Indian payment rails: UPI, debit and credit cards, NEFT and RTGS.

It compares the records that every participant in a payment keeps (switch, issuing bank, acquiring bank, merchant and settlement). It sorts every disagreement into one of nine exception categories, names where the payment broke, and puts the RBI deadline on each case. Analysts then work the cases under maker-checker control.

A built-in simulator generates realistic business days with injected failures. Because it knows the ground truth, it can score how accurately the reconciliation engine detects them.

---

## Contents

1. [What it does](#what-it-does)
2. [Requirement to feature mapping](#requirement-to-feature-mapping)
3. [Architecture](#architecture)
4. [Stack and why](#stack-and-why)
5. [Data model and migrations](#data-model-and-migrations)
6. [Reconciliation rules](#reconciliation-rules)
7. [Getting started (local)](#getting-started-local)
8. [Environment variables](#environment-variables)
9. [Deployment](#deployment)
10. [Testing and results](#testing-and-results)
11. [Security](#security)
12. [Accessibility](#accessibility)
13. [Performance](#performance)
14. [Research and sources](#research-and-sources)
15. [Known limitations](#known-limitations)

---

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

Roles, from least to most access:

- **viewer**: read and export.
- **analyst**: work exceptions, upload files, run reconciliations and simulations.
- **supervisor**: approve, reopen and read the audit log.
- **admin**: users, settings and deletions.

Every API route and service checks the role on the server.

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

Requirements: Node.js 22.12+ and PostgreSQL 14+ (16 recommended).

```bash
npm ci
cp .env.example .env            # set DATABASE_URL (and APP_URL if not localhost:3000)
createdb paytrace               # or create it in your Postgres tool
npm run db:migrate
npm run seed:demo               # optional: 4 demo users + a reconciled demo day
npm run dev                     # http://localhost:3000 (worker runs embedded)
```

`seed:demo` creates these accounts:

- `admin@demo.paytrace.test`
- `supervisor@demo.paytrace.test`
- `analyst@demo.paytrace.test`
- `viewer@demo.paytrace.test`

They all use the password `PayTrace-Demo-2026` (override it with `--password` or `DEMO_PASSWORD`). The script refuses to run with `NODE_ENV=production` unless `--allow-production` is passed. Never use demo accounts with real data.

For a real installation, create the first administrator instead. It prints a one-time link to set the password:

```bash
npm run create-admin -- --email ops@yourbank.example --name "Ops Lead"
```

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

To try the stack with Docker Compose:

```bash
cp .env.example .env    # set POSTGRES_PASSWORD; APP_URL=http://localhost:3000
docker compose up --build -d
docker compose run --rm migrate npm run create-admin -- --email you@example.com --name "Your Name"
```

Compose starts these services:

1. `db` (PostgreSQL 16 with a volume).
2. `migrate`, which runs once.
3. `web` (port 3000).
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
| End-to-end  | `npm run build && npm run test:e2e` | Production server: sign-in and return-to, open-redirect guard, security headers, cookie flags, analyst→supervisor approval journey, viewer read-only, admin refusal, upload with row errors, simulate→reconcile→accuracy, trace, filters and CSV export, user invite. axe WCAG 2.2 AA on every page (light, plus dark samples), 375 px reflow, mobile menu, skip link. Fails on any console error or CSP violation. | **40 passed** (~1.5 min)        |

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

## Accessibility

Target: **WCAG 2.2 AA**, checked automatically with axe-core on every page and in dark mode.

- Semantic landmarks, a skip link, one `h1` per page, and labelled form fields with inline errors linked via `aria-describedby`.
- `role="alert"` and `role="status"` regions announce results.
- Status and severity always pair colour with an icon and text.
- Charts have a table alternative and keyboard-reachable tooltips.
- Tables scroll inside focusable regions, and pages reflow at 375 px.
- Visible focus, `prefers-reduced-motion` and forced-colours support.
- Native `<dialog>` for confirmations; the mobile menu closes with Escape.

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
