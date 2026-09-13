# Browser verification harness

Real-Chrome, real-API, real-database verification for things a jsdom component test cannot
honestly prove: computed CSS values, httpOnly cookie behaviour, session survival across a page
reload, and the refresh-on-401 interceptor recovering from a genuinely expired token.

These scripts are **not** part of `pnpm test` and do **not** run in CI. `vitest.config.ts` only
picks up `src/**/*.test.{ts,tsx}`, so this directory is invisible to the unit suite. The intent is
a verification transcript that can be re-run by hand in a later session, without adding a browser
download to `pnpm install` or a flaky browser job to CI.

`puppeteer-core` (not `puppeteer`) is the dependency deliberately: it ships no bundled Chromium and
drives whichever Chrome the machine already has.

## Running

```bash
# 1. Database + Redis (Phase 12's worker needs both)
cd apps/api && bash scripts/dev-mysql-sandbox.sh start
cd apps/api && bash scripts/dev-redis-sandbox.sh start

# 2. API — the short TTL is what makes phase 3's token-expiry step honest rather than simulated.
#    Phase 4 doesn't need it; run plain `pnpm dev` for that.
cd apps/api && JWT_ACCESS_TTL=5s pnpm dev

# 3. Admin web
cd apps/admin-web && pnpm dev

# 4a. Phase 3 — auth, session, shell
cd apps/admin-web && pnpm e2e

# 4a2. Slice 1 shell — drawer at 375, collapse persistence at 768/1440
cd apps/admin-web && pnpm e2e:responsive

# 4b. Phase 4 — members CRUD. Reset the fixtures first; the script is idempotent.
cd apps/api && pnpm tsx scripts/phase4-fixtures.ts
cd apps/admin-web && pnpm e2e:members

# 4c. Phase 5 — membership plans and the membership lifecycle.
cd apps/api && pnpm tsx scripts/phase5-fixtures.ts
cd apps/admin-web && pnpm e2e:memberships

# 4e. Phase 7 — attendance.
cd apps/api && pnpm tsx scripts/phase7-fixtures.ts
cd apps/admin-web && pnpm e2e:attendance

# 4f. Phase 8 — dashboard aggregates.
cd apps/api && pnpm tsx scripts/phase8-fixtures.ts
cd apps/admin-web && pnpm e2e:dashboard

# 4g. Phase 9 — trainers and own-roster attendance.
cd apps/api && pnpm tsx scripts/phase9-fixtures.ts
cd apps/admin-web && pnpm e2e:trainers

# 4h. Phase 10 — leads / CRM pipeline.
cd apps/api && pnpm tsx scripts/phase10-fixtures.ts
cd apps/admin-web && pnpm e2e:leads

# 4i. Phase 11 — expenses and the revenue-vs-expenses report.
cd apps/api && pnpm tsx scripts/phase11-fixtures.ts
cd apps/admin-web && pnpm e2e:expenses

# 4j. Phase 12 — notifications + BullMQ. Redis must be up (compose or the sandbox).
cd apps/api && bash scripts/dev-redis-sandbox.sh start
cd apps/api && pnpm tsx scripts/phase12-fixtures.ts
cd apps/admin-web && pnpm e2e:notifications

# 4k. Phase 13 — member Flutter app (Web/Chrome). CORS must include :8080.
cd apps/api && pnpm tsx scripts/phase13-fixtures.ts
cd apps/member-app && flutter run -d web-server --web-port 8080 --web-hostname 127.0.0.1
cd apps/admin-web && E2E_APP_URL=http://127.0.0.1:8080 pnpm e2e:member
```

The API's global rate limiter is a 15-minute per-IP window held in process memory, and a few
back-to-back harness runs will exhaust it (the symptom is a `429` and a selector timeout part-way
through). Restarting `pnpm dev` resets the counter, which beats waiting out the window.

Exits non-zero if any check fails. Screenshots land in `e2e/screenshots/`, which is gitignored —
they are regenerated on every run, so committing them would just be binary churn.

## Environment overrides

| Variable       | Default                        | Purpose                              |
| -------------- | ------------------------------ | ------------------------------------ |
| `E2E_CHROME`   | autodetected                   | Path to a Chrome/Chromium binary     |
| `E2E_HEADFUL`  | unset (headless)               | Set to `1` to watch the run          |
| `E2E_APP_URL`  | `http://localhost:5173`        | Admin web origin                     |
| `E2E_API_URL`  | `http://localhost:4000/api/v1` | API origin                           |
| `E2E_EMAIL`    | `owner@demo-gym.test`          | Seeded login                         |
| `E2E_PASSWORD` | `ChangeMe123!`                 | Seeded password                      |

## Shared database and fixture isolation

These harnesses use the same `gym_dev` MySQL as local demo — there is no dedicated E2E database.
Each phase owns a phone-prefix namespace (Phase 4 fixtures `+9199000000…`, browser-created
`+9198888…`, later phases their own ranges). A fixture script resets **only** its own prefix;
it must not delete later-phase Demo Gym rows (Alice/Bob, notification members, converted leads,
extra branches). Phase 4 therefore scopes member-list assertions to `+9199000000` and
explicitly selects Main Branch on create, because Demo Gym may already have several branches.

## What `phase3-verify.ts` covers

1. Unauthenticated visit to `/` redirects to `/login`.
2. Brand palette (Section 1.14) as computed CSS on the login screen.
3. Login with the seeded OWNER; app shell renders; refresh cookie is httpOnly/SameSite=Lax and
   path-scoped; no token in `localStorage`/`sessionStorage`; shell colours as computed CSS.
4. Reload restores the session from the cookie in exactly one `POST /auth/refresh`.
5. A genuinely expired access token produces `401 → refresh → retry`, exactly three calls.
6. Three concurrent 401s collapse into a single refresh (the API revokes a token family on
   replay, so more than one would sign the user out).
7. Logout revokes server-side, clears the cookie, and redirects.
8. Revisiting a protected route redirects again.

Step 5 and 6 reach the app's own axios instance by importing `/src/lib/api-client.ts` inside the
page. Vite serves each source file at a stable URL and the browser caches ES modules by URL, so
this is the same singleton the running app uses — real interceptors, real in-memory token, nothing
stubbed. If it resolved to a fresh copy, the store would hold no token and the call would 401
twice instead of recovering, so the assertions themselves catch that failure mode.

## What `phase4-verify.ts` covers

1. The members list renders the fixture set, with archived members hidden by default.
2. Brand palette on the members screens as computed CSS.
3. Creating a member through the form, read back out of MySQL.
4. Editing through the form, confirmed in MySQL including `updatedAt`.
5. A duplicate phone number surfacing as a field-level error naming the conflicting member, with
   the database unchanged.
6. Search + status filter + pagination + sort in combination, cross-checked against the
   equivalent SQL count, including that reversing the sort changes which row lands on page 1.
7. Archiving through the confirmation dialog: `status = ARCHIVED`, `deletedAt` still NULL.
8. RBAC with a real RECEPTIONIST login — create and view allowed, no archive button, and the
   archive request refused 403 `PERMISSION_DENIED` when fired directly at the API.
9. The archived member's phone number becoming available to a new member.

Database assertions shell out to the `mysql` client rather than importing Prisma, so they read the
rows through a different driver than the one that wrote them. Override the connection with
`E2E_DB_HOST`, `E2E_DB_PORT`, `E2E_DB_USER`, `E2E_DB_PASSWORD`, `E2E_DB_NAME`.

The script deletes every member whose phone starts with `+9198888` before it runs, so repeated
passes stay clean; fixture members live in the `+9199000000xx` range. Neither range touches real
data.

## What `phase5-verify.ts` covers

1. Creating a membership plan through the form, read back as `DECIMAL(10,2)` in MySQL.
2. Selling it: `priceAtPurchase` / `durationDaysAtPurchase` snapshotted, inclusive term dates,
   branch inherited from the member.
3. Repricing the plan afterwards — the issued membership keeps its own price, duration and end
   date, in the database and on screen.
4. Renewal inserting a *new* row at the new price, chained by `previousMembershipId`, with the
   original row untouched.
5. Freeze pausing the countdown, and unfreeze pushing `endDate` out by exactly the frozen days
   while recording `totalFrozenDays` (Locked Decision 1.15.2).
6. All four illegal transitions on a `CANCELLED` term refused 409 `INVALID_MEMBERSHIP_TRANSITION`
   when fired directly at the API, not merely hidden in the UI (1.15.1).
7. Mid-term plan change forfeiting the remaining days, with the warning naming the exact count
   (1.15.4).
8. Lazy expiry: a lapsed term left idle stays `ACTIVE` because nothing is scheduled, then flips to
   `EXPIRED` on the first read and stays there (1.8).
9. Brand palette on the plan and membership screens as computed CSS.
10. RBAC with a real RECEPTIONIST login — create and renew allowed, freeze/cancel/change-plan and
    plan management refused 403 `PERMISSION_DENIED` when fired directly at the API.

Step 5 backdates `frozenAt` with a direct `UPDATE`, and step 8 forces a lapsed row back to
`ACTIVE`. Those two writes stand in for elapsed time — everything else runs through the real UI
and the real endpoints. Phase 5 fixture members live in the `+9197777000xx` range and their plans
are prefixed `E2E `; `phase5-fixtures.ts` clears both before each run.

## What `phase6-verify.ts` covers

1. Selling a membership raising its own invoice, at the term's *snapshot* price, born `UNPAID` and
   linked to the term it bills.
2. Three part payments walking one invoice `UNPAID → PARTIALLY_PAID → PAID`, landing as three
   separate rows with their own methods rather than one edited row (1.16.2).
3. Overpayment refused 409 `PAYMENT_EXCEEDS_INVOICE` with the real balance named, and **no** row
   written; then cancel-and-reissue as the correction path, refused by the server as well as
   hidden by the UI once an invoice is cancelled or has money against it.
4. Brand palette on the billing screens as computed CSS.
5. The pending-fees view listing exactly the rows MySQL says are outstanding.
6. A partial refund as a **new negative row** with the original re-read from MySQL and found
   unchanged down to `paidAt`, the invoice rolling back `PAID → PARTIALLY_PAID`, and an `AuditLog`
   entry with the right actor, action, `entityId` and before/after payloads (1.16.3). A second
   refund is capped at what is left.
7. Ten simultaneous invoice creations returning ten distinct, contiguous numbers, with the counter
   left above everything issued (1.16.4).
8. RBAC with real ACCOUNTANT and RECEPTIONIST logins — the receptionist reads the ledger but is
   offered no refund, and both refund and invoice-create are refused 403 `PERMISSION_DENIED` when
   fired directly at the API, leaving no row and no audit entry behind. The same receptionist
   *can* record a payment.
9. A member's outstanding balance on their own detail page.
10. The mid-term plan-change warning quoting the forfeited value in money, with MySQL confirming no
    credit was issued (1.16.1).
11. The payments ledger showing every receipt and refund, netting to `SUM(amount)`.

Nothing here is simulated — the only thing that bypasses the UI is step 7, since ten buttons
cannot be clicked at once and racing them is the point. Phase 6 fixture members live in the
`+9196666000xx` range and their plan is prefixed `P6 `; `phase6-fixtures.ts` clears both, plus the
invoices, payments and audit rows hanging off them, before each run. The invoice counter is
deliberately *not* reset, so a re-run proves numbering keeps climbing rather than starting over.

## What `phase8-verify.ts` covers

1. OWNER, all branches: every widget number matches a hand-written SQL aggregate against MySQL
   (members on the books vs covering today, `SUM(payments.amount)` for the gym-local month net of
   refunds, `SUM(invoices.amountPending)`, 7-day expiring window, today's attendance).
2. Brand palette as computed CSS on the heading and metric values.
3. Switching the topbar to Main Branch vs P8 Andheri: the two dashboards disagree, and each still
   matches its own SQL. Andheri's revenue includes the ₹777 collected there.
4. Transferring a member with a direct `UPDATE`: the headcount moves, the revenue does not
   (Locked Decision 1.18.2).
5. RECEPTIONIST: pinned to their branch, no revenue widget, remaining widgets match SQL.
6. TRAINER: members and attendance only.
7. ACCOUNTANT: money widgets, no attendance.
8. The cancelled-invoice fixture has `amountPending = 0`, and a `FAILED` payment row exists so
   the revenue exclusion is actually being tested rather than vacuously true.

## What `phase9-verify.ts` covers

1. Creating a TrainerProfile through the form for an eligible candidate, read back from MySQL
   including `DECIMAL(5,2)` commission.
2. Editing specialization without touching the user row.
3. Assigning a member through the roster UI, confirmed as a `trainer_assignments` row.
4. A TRAINER session: members and attendance show assigned people only, with the own-roster
   banner, no check-in panel, and `GET /attendance` through the app's own client agreeing with
   a hand-written SQL join on `trainer_assignments`. Brand palette on the create heading.
5. Unassigning drops the member from the trainer's members list *and* from their attendance
   register, including a check-in that already happened (1.19.2). The desk still sees that
   check-in.
6. A TRAINER with a profile but no assignments sees the empty set, not the gym (1.19.1).
7. RBAC: RECEPTIONIST, TRAINER and ACCOUNTANT are refused `GET /trainers` with 403
   `PERMISSION_DENIED`. ACCOUNTANT still sees both members (not own-rostered) and cannot open
   attendance.

Phase 9 fixture members live in the `+9193333…` range. `phase9-fixtures.ts` recreates them, upserts
the demo trainer's profile, and deletes the coach's profile so the create-through-form step stays
repeatable.

## What `phase10-verify.ts` covers

1. Creating a lead through the form, read back from MySQL as `NEW`.
2. Skipping `CONTACTED` (`NEW → TRIAL_SCHEDULED`) through the pipeline UI, confirmed in MySQL.
3. A backward `PATCH` (`TRIAL_SCHEDULED → CONTACTED`) refused 409 `INVALID_LEAD_TRANSITION`, and
   `PATCH status: CONVERTED` refused 400 — convert is its own endpoint (1.20.1).
4. `LOST → NEW` refused; `LOST → CONTACTED` through the UI; convert from `LOST` refused 409
   `LEAD_NOT_CONVERTIBLE`.
5. Convert through the form: a `members` row with the lead's phone, `convertedMemberId` stamped,
   the lead frozen (`PATCH` and a second convert are 409 `LEAD_CONVERTED`).
6. Brand palette on the leads heading.
7. RBAC: RECEPTIONIST `GET /leads` 200; TRAINER and ACCOUNTANT 403 `PERMISSION_DENIED`.

Phase 10 fixture leads live in the `+9192222…` range. `phase10-fixtures.ts` recreates them and
syncs `leads.manage` onto receptionist/manager so a gym seeded before this phase still has the
key.

## What `phase11-verify.ts` covers

1. Creating an expense through the form, read back from MySQL as `EQUIPMENT` on the main branch.
2. Editing amount and notes rewrites the same row (live book, 1.21.3); hard-delete removes it.
3. Org-wide P&L revenue and expenses match hand-written SQL: `SUM(payments.amount)` (not
   FAILED/PENDING, gym-local month bounds) minus `SUM(expenses.amount)` (`expenseDate` in the
   same local months). Software (null `branchId`) is on this screen.
4. Filtering the P&L to Main Branch drops org-level SOFTWARE and the other branch's utilities
   (1.21.1). Totals still match SQL restricted to `expenses.branchId = Main`.
5. RBAC: ACCOUNTANT and OWNER hold `expenses.manage`; MANAGER has `reports.view` (P&L 200) but
   not expense CRUD (403); RECEPTIONIST and TRAINER are 403 on both.

Phase 11 fixture expenses are namespaced on payee `P11 …`. `phase11-fixtures.ts` recreates them,
upserts `manager@demo-gym.test`, and syncs `expenses.manage` onto accountant/owner/admin.

## What `phase12-verify.ts` covers

1. OWNER opens `/notifications`, brand palette on the heading, default SMS templates listed.
2. **Run nightly scan** queues real BullMQ jobs; the worker marks both rows `SENT` (Expiry Soon
   membership + Owing Balance unpaid invoice), confirmed in MySQL — not merely `QUEUED`.
3. Frozen Hold (status `FROZEN`, endDate inside the window) and Far Away (endDate +20 days) are
   absent from the log. The cancelled invoice with `amountPending = 0` is absent.
4. Running the scan a second time on the same gym-local day reports skipped and does **not**
   insert a second log row (unique key, 1.22.1).
5. RBAC: OWNER `GET /notifications/logs` is 200; MANAGER, RECEPTIONIST, TRAINER, ACCOUNTANT are
   403 `PERMISSION_DENIED` and do not see the nav item (`notifications.manage` is 4.2 OWNER/ADMIN).

Phase 12 fixture members live in the `+9190001…` range. `phase12-fixtures.ts` recreates them,
syncs `notifications.manage`, and seeds the default SMS templates so a gym seeded before this
phase still has both. Redis must be running; the API process starts the send worker on boot.

## What `phase13-verify.ts` covers

1. Alice Portal signs in through the Flutter app (pre-filled controllers — CanvasKit ignores
   HTML `input.value` writes) and home greets her, not Bob, with outstanding ₹1500.00.
2. Membership / payments / attendance match MySQL for Alice only; Bob's ₹9999 / ₹111 stay off
   her screens.
3. A reload restores Alice via the stored refresh token (1.23.4) without bouncing to Sign in.
4. API self-scope: Alice `GET /me/payments` is one ₹500.00 row; Bob `GET /me` outstanding is
   ₹9999.00.

Phase 13 fixture members are `+919111100001` (Alice) and `+919111100002` (Bob).
`phase13-fixtures.ts` recreates them. `E2E_APP_URL` defaults to `http://127.0.0.1:8080`.

Flutter Web is CanvasKit. Headless Chrome often never paints the semantics tree, so
`document.body.innerText` stays empty and this harness times out even when a headed
Chrome session against the same server is fine. Prefer `E2E_HEADFUL=1`, or treat a
headed Chrome walkthrough + the API/SQL assertions as the proof. Do not read a
headless timeout as "the member app is broken."

