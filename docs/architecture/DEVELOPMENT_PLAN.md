# Gym Management Platform — Development Plan & Phase Tracker

This file is the **single source of truth** for building this project phase by phase. It exists so
that any session (human or AI agent) can open this file, see exactly what's decided, what's built,
and what's next, without re-deriving context from scratch.

**Rules for maintaining this file:**
- When a phase is started, change its `Status:` to `In progress`.
- When a phase's Definition of Done is fully checked, change its `Status:` to `Done` and check every
  box under it.
- Never delete history from this file — if a decision changes later, add a dated note under
  "Decision changes" at the bottom instead of silently editing the original text.
- Do not start a phase whose dependencies (listed under "Depends on") aren't `Done`, except where
  a phase itself documents that it is additive (Phase 15). Additive still does not mean
  "start automatically."

### Current phase tracker (read this first)

Section 7 below is the long-form history. This table is the index so Phases 14–15 are visible
without scrolling past ~2,500 lines of locked decisions. **This working-tree file is the source
of truth.** The last *committed* revision of this file is still the Phase 4 snapshot (Phases 5–15
shown as `Not started` in git HEAD). Uncommitted work from Phases 5–14 lives here until it is
committed.

| Phase | Name | Status |
|---|---|---|
| 0 | Repo & tooling | Done (CI-on-a-real-PR still open until a remote exists) |
| 1 | Backend foundation + core modules | Done |
| 2 | Auth, RBAC, tenant middleware | Done |
| 3 | Admin login / shell | Done |
| 4 | Admin members | Done |
| 5 | Memberships | Done |
| 6 | Payments + invoices | Done |
| 7 | Attendance | Done |
| 8 | Dashboard | Done |
| 9 | Trainers | Done |
| 10 | Leads / CRM | Done |
| 11 | Expenses + reports | Done |
| 12 | Notifications + Redis/BullMQ | Done |
| 13 | Flutter member **web** (Chrome) | **Done** |
| 14 | Android / iOS packaging + runtime | **In progress** (not Done) |
| 15 | Super Admin / SaaS | **Done** (2026-09-14) — 10.20 checked; Super Admin headed Chrome + admin-web 3–13 re-verified |

Phase 14 remaining blockers: **no production API host**, **no macOS/Xcode for iOS**.
Android force-stop session restore: **PASS** (real device, Alice Home, no login screen).
LAN sideload is not production.

---

## 1. Locked Decisions

These were deliberately decided (not defaulted) before any code was written, because they are
expensive to change once real data exists.

### 1.1 Monorepo tooling
**pnpm workspaces, no Turborepo yet.** Lightest option that still gives shared `node_modules` across
`apps/admin-web`, `apps/api`, `packages/shared-config`. Add Turborepo later only if build/test times
across the monorepo actually become a bottleneck — not needed at 2-app scale.

### 1.2 Primary key strategy: ULID
Considered three options:
- **CUID** (Prisma's built-in `@default(cuid())`) — the original cuid (v1) is actually timestamp-prefixed
  and roughly sortable, but the ecosystem is drifting toward `cuid2`, which is deliberately
  **non-sequential** for security. Depending on which one tooling gives us, we'd get different
  insert-locality behavior without explicitly choosing it — too ambiguous to build a whole schema on.
- **UUIDv7** — proper IETF standard (RFC 9562), time-ordered prefix + random suffix, solves the InnoDB
  clustered-index fragmentation problem (rows insert append-mostly instead of scattering across the
  B-tree). But neither Prisma nor MySQL 8 has a native generator for it, so it requires a userland
  library regardless, and its canonical string form is 36 characters (with hyphens).
- **ULID** (chosen) — same time-ordered-prefix + high-entropy-suffix shape as UUIDv7 (48-bit ms
  timestamp + 80 bits of randomness), so it gets the same append-friendly-insert / non-guessable-ID
  properties. Encodes more compactly as a 26-character Crockford base32 string. Mature, stable Node
  library (`ulid`).

**Decision: ULID**, generated in application code (stored as `@db.Char(26)`), not left to a DB or
Prisma default function (neither has a native ULID generator).

Implementation details (apply from Phase 1 onward):
- Generate IDs via a Prisma Client Extension that auto-populates `id` on `create`/`createMany` if not
  already set, so individual services never need to remember to call an ID generator manually.
  Central helper: `apps/api/src/lib/id.ts` exporting `generateId(): string`.
- Canonicalize to **lowercase** and store the ID columns with an explicit `utf8mb4_bin` (binary,
  case-sensitive) collation. MySQL's default collation is case-insensitive; since Crockford base32 is
  technically case-tolerant, mixed-case IDs on a case-insensitive column could theoretically collide
  or compare incorrectly. Always generating lowercase + binary collation removes that ambiguity.
- Every model's `id` field: `id String @id @db.Char(26)`.

### 1.3 Soft delete vs. composite unique constraints
Original draft would have added `deletedAt` to `member`, `user`, `membership`, `payment`, `invoice`,
plus `@@unique([organizationId, phone])` on `member` and `@@unique([organizationId, email])` on
`user` — which conflict: a soft-deleted row still physically exists, so its phone/email stays
"taken" forever at the DB level.

**Step 1 — narrow where `deletedAt` even applies.** Re-reading the spec's own rule ("financial
records are never hard-deleted... corrections happen via refund/reversal/adjustment records plus an
audit log") means `payment` and `invoice` shouldn't have `deletedAt` at all — they're append-only and
status-driven (`REFUNDED`, `CANCELLED`), not soft-deletable. `membership` doesn't need it either —
ending a membership is the `CANCELLED` status, not a delete. So `deletedAt` only exists on **`member`**
and **`user`**, and the composite-unique conflict is exactly `member.phone` and `user.email` —
nowhere else.

**Step 2 — pick the mechanism for those two.** Three options were weighed:
1. **App-layer enforcement (chosen):** drop the DB-level `@@unique`, replace with a plain non-unique
   `@@index` for lookup performance, and enforce "no duplicate active phone/email within this org" in
   the service layer inside a `prisma.$transaction` (check-then-create).
2. **Include `deletedAt` in the composite unique key:** only works if `deletedAt` defaults to a
   non-null sentinel value instead of `NULL` — MySQL treats every `NULL` as pairwise-distinct in a
   unique index, so a *nullable* `deletedAt` in the composite key would silently disable the
   uniqueness check for every active row (not an edge case — a correctness bug). Even with a sentinel,
   two soft-deletes of the same org+phone at the exact same timestamp could still collide.
3. **MySQL generated column:** a `STORED GENERATED` column like
   `IF(deletedAt IS NULL, phone, CONCAT(phone, ':', id))`, made unique — mathematically airtight (the
   `id` suffix guarantees deleted rows never collide with each other), but Prisma has no first-class
   schema syntax for generated columns; needs a hand-written raw-SQL migration and a schema field the
   app never writes to directly.

**Decision: Option 1.** Keeps `deletedAt` semantically simple everywhere (`IS NULL` = active, matches
standard ORM/tooling convention). The residual race (two different staff members creating a member
with the exact same phone number in the same request-processing instant) is accepted as low-risk
because this is low-concurrency admin/receptionist data entry, not a public high-throughput signup
flow — and the failure mode is "an admin notices and merges a duplicate member," not data corruption
or double-billing. Revisit with Option 3 (generated column) if duplicates actually become a
real-world problem — consistent with this project's "don't build infrastructure before you need it"
philosophy.

Applies to:
- `member`: `@@index([organizationId, phone])` (not `@@unique`); uniqueness enforced in
  `memberService.create()` / `.update()` via transaction.
- `user`: `@@index([organizationId, email])` (not `@@unique`); uniqueness enforced in
  `userService.create()` / `.update()` via transaction.

### 1.4 Timestamp & soft-delete convention (all tables)
- Every table: `createdAt DateTime @default(now())`.
- Every **mutable** table (not append-only financial records): `updatedAt DateTime @updatedAt`.
- Soft delete (`deletedAt DateTime?`) exists **only** on `member` and `user`. No other table gets it.
- `payment`, `invoice`, `attendance`: append-only, no `updatedAt` mutation of financial amounts —
  corrections happen via new rows (refund/reversal) + an `AuditLog` entry, never by editing history.

### 1.5 Status enums (defined now, not left implicit)
- `OrganizationStatus`: `ACTIVE`, `SUSPENDED`
- `BranchStatus`: `ACTIVE`, `INACTIVE`
- `UserStatus`: `ACTIVE`, `INACTIVE`
- `MemberStatus`: `ACTIVE`, `INACTIVE`, `ARCHIVED`
- `MembershipPlanStatus`: `ACTIVE`, `INACTIVE`
- `MembershipStatus`: `ACTIVE`, `EXPIRED`, `FROZEN`, `CANCELLED`
- `PaymentMethod`: `CASH`, `CARD`, `UPI`, `BANK_TRANSFER`, `OTHER`
- `PaymentStatus`: `SUCCESS`, `FAILED`, `REFUNDED`, `PENDING`
- `InvoiceStatus`: `DRAFT`, `UNPAID`, `PARTIALLY_PAID`, `PAID`, `CANCELLED`

### 1.6 Prisma schema location
`apps/api/prisma/schema.prisma` — colocated with the only service that touches the DB (the spec's
original top-level `database/prisma/` folder is not used; standard Prisma convention, simpler
`DATABASE_URL`/env wiring). Migrations live at `apps/api/prisma/migrations/`.

### 1.7 First Organization/OWNER bootstrap
No public self-serve signup until Phase 15 (Super Admin/SaaS layer). Phase 1 ships a Prisma seed
script (`apps/api/prisma/seed.ts`) that creates one default `Organization` + `Branch` + `OWNER` user
for local development, plus the full `Permission` catalog and default `Role` → `Permission` matrix
(see Section 3). Production orgs are created by hand (seed script re-run with different data, or a
one-off script) until Phase 15 builds real onboarding.

### 1.8 Membership expiry without a scheduler
Redis/BullMQ is deferred to Phase 12 per the spec. To avoid needing a scheduled job earlier,
`membership.status` is treated as **lazily computed**: any read path that returns a membership
checks `endDate < now() && status === 'ACTIVE'` and treats/display it as effectively `EXPIRED`
(and opportunistically writes the flip on next touch). A real nightly sweep job only becomes
necessary once notifications (Phase 12) need to *proactively* notify on expiry rather than just
answering "what's this membership's status right now" correctly.

### 1.9 Pagination / filter / sort convention (all list endpoints)
Query params: `?page=1&limit=20&search=&status=&sortBy=&sortOrder=asc|desc`. Response shape exactly
as defined in the original spec's "Standard pagination" block (Section 8 below). This is decided once,
in Phase 1, so every module (members, memberships, payments...) reuses the same list-endpoint helper
instead of reinventing it.

### 1.10 Error code registry
A single growing enum, `apps/api/src/lib/error-codes.ts`, e.g. `MEMBER_NOT_FOUND`,
`DUPLICATE_PHONE`, `INVALID_CREDENTIALS`, `TOKEN_EXPIRED`, `PERMISSION_DENIED`,
`ORG_MISMATCH`, `VALIDATION_ERROR`. Extended module-by-module as phases add features. No ad hoc
inline string error codes.

### 1.11 Testing strategy
- `apps/api`: Vitest + Supertest, introduced starting **Phase 1** (not bolted on at the end).
  Every module ships at least: happy-path CRUD test, one RBAC-denied test, one cross-tenant-denied
  test (org A cannot read org B's data).
- `apps/admin-web`: Vitest + React Testing Library, introduced starting **Phase 3**.

### 1.12 CI
Minimal GitHub Actions workflow from **Phase 0**: on push/PR, run lint + typecheck + test for
`apps/api` and `apps/admin-web` (pnpm workspace filters). No deploy automation yet.

### 1.13 Env var validation
Each app validates its own env vars at startup via a zod-parsed `env.ts` (fail fast with a clear
error instead of undefined-variable bugs at runtime). `.env.example` kept in sync per app.

### 1.14 Brand color palette
These are **estimated from a visual reference**, not sampled with an eyedropper — treat as
directionally correct, not pixel-final. Adjust later once exact values are available; when that
happens, only the Tailwind theme (Section below) needs to change, since no component hardcodes hex
values.

- **Primary background (dark):** `#000000` — Black
- **Secondary dark surface:** `#1F1F1F` — Black 88%
- **Primary accent (brand green):** `#C9FF1F` — Fit Green
- **Muted/tinted accent:** `#E9FFA5` — Fit Green 40%
- **Light surface/text-on-dark:** `#FEF9F5` — White
- **Muted text-on-dark:** `#C9C4BF` — White muted (Slice 0, 2026-09-15). Solid color, **not**
  `brand.white` at 40% alpha. Headed Chrome: `rgb(201, 196, 191)` on `#000` = **12.13:1**.

Wired into `apps/admin-web` and `apps/super-admin` Tailwind configs as named theme colors
(`brand.black`, `brand.black-88`, `brand.green`, `brand.green-muted`, `brand.white`,
`brand.white-muted`) — never hardcoded as raw hex
in components — so the palette can be corrected in one place later without touching any component.
Registered in Phase 1 and **applied to real UI as of Phase 3** (login screen and app shell),
verified in a browser as computed CSS values rather than as class names in JSX.

**Amendment 2026-09-15 — additive light theme, not a rewrite of this list.** 1.14 stays the
**dark default**. Components map through semantic CSS variables (`--color-bg`, `--color-fg`,
`--color-fg-muted`, `--color-accent`, `--color-accent-text`, `--color-warning`,
`--color-danger`, …) with `data-theme` on `<html>`. Dark computed values remain the RGB
readings above. Light is the same brand inverted onto cream `#FEF9F5`:

- Lime `#C9FF1F` is **fill only** (buttons, active-nav fill, chart stroke). It is never
  light-mode body, link, heading, or metric text.
- Light links / metrics / ACTIVE use `--color-accent-text` `#3D4D00` (**8.89:1** on cream).
- Light muted copy uses `--color-fg-muted` `#5C5854` (**6.74:1** on cream) — the Slice 0
  lesson applied to the light side, not a third grey.
- Light warning / danger: `#92400E` / `#9B1C1C`. Persistence: `vedafit.admin.theme` and
  `vedafit.platform.theme` (separate origins). No `prefers-color-scheme`. Full record:
  Section 11 and the dated Section 9 entries.

### 1.15 Membership lifecycle semantics

`MembershipStatus` drives money, access control and reporting, so every question about "what
happens when" is answered here rather than in whichever service function got written first.

#### 1.15.1 Valid state transitions

`ACTIVE` and `FROZEN` are the two live states. `EXPIRED` and `CANCELLED` are **terminal** — no
transition ever leaves them. The complete matrix (rows = from, columns = to):

| from \ to     | ACTIVE            | FROZEN         | EXPIRED               | CANCELLED    |
| ------------- | ----------------- | -------------- | --------------------- | ------------ |
| **ACTIVE**    | —                 | freeze         | lazy expiry *(system)* | cancel       |
| **FROZEN**    | unfreeze          | —              | ✗ never               | cancel       |
| **EXPIRED**   | ✗ never           | ✗ never        | —                     | ✗ never      |
| **CANCELLED** | ✗ never           | ✗ never        | ✗ never               | —            |

So the whole legal set is exactly five edges: `ACTIVE→FROZEN`, `ACTIVE→CANCELLED`,
`ACTIVE→EXPIRED`, `FROZEN→ACTIVE`, `FROZEN→CANCELLED`. Anything else is rejected with
`INVALID_MEMBERSHIP_TRANSITION` (409) naming both states — never silently ignored, and never
turned into a no-op success.

Notes on the two non-obvious cells:

- **`ACTIVE→EXPIRED` is system-only.** It is the lazy computation from 1.8, not an operator
  action; there is no "expire" endpoint. A membership expires because the calendar moved, and the
  read path is where that gets noticed and persisted.
- **`FROZEN→EXPIRED` cannot happen**, which follows directly from the freeze semantics below: a
  frozen membership's clock is paused, so its `endDate` is not a live deadline while frozen. A
  membership must be unfrozen (which pushes `endDate` out by the frozen duration) before it can
  expire.

Getting *out of* a terminal state is not a transition — it is a new membership. Renewing an
`EXPIRED` membership and re-selling to a `CANCELLED` one both produce a **new row** (1.15.3),
leaving the terminal row untouched as history. This is what makes "can't renew a CANCELLED
membership" (Phase 5 DoD) a real rule rather than a special case: `renew` is only offered on
`ACTIVE` and `EXPIRED` sources, and cancellation is therefore a deliberate, final act.

**One live membership per member.** A member may hold at most one `ACTIVE`-or-`FROZEN` membership
whose term overlaps a given date. `create` rejects with `MEMBERSHIP_OVERLAP` if the member already
has one; stacking another term is what `renew` is for. Without this, "what plan is this member
on?" — asked by attendance (Phase 8), payments (Phase 6) and every report — has no single answer.

#### 1.15.2 Freeze semantics — the clock pauses

**Chosen: `endDate` shifts forward by the frozen duration on unfreeze.** A member who freezes for
14 days gets those 14 days back at the end of their term.

The alternative (original `endDate` stands) makes freezing strictly worse for the member than
doing nothing at all, which means nobody would ever ask for it and front-desk staff would instead
hand-edit `endDate` — moving the semantics out of the system and into an untracked manual step.
Members also read a freeze as "pause my membership while I'm travelling/injured," and a system
that quietly burns paid days during a pause generates counter disputes. Pausing the clock is also
the industry norm, so it is what staff and members already expect.

The cost is that it cannot be derived — it has to be recorded. Two columns on `memberships`:

- `frozenAt DATETIME NULL` — when the *current* freeze began; `NULL` unless status is `FROZEN`.
- `totalFrozenDays INT NOT NULL DEFAULT 0` — cumulative across every freeze, kept so the original
  commercial term is still reconstructible (`endDate - totalFrozenDays`) for reporting and
  disputes.

On unfreeze: `days = ceil(now - frozenAt)`, then `endDate += days`, `totalFrozenDays += days`,
`frozenAt = NULL`. Freezing and unfreezing within the same day costs the member nothing and adds
nothing. **No maximum freeze duration is enforced in Phase 5** — a per-plan freeze allowance is a
plan-configuration feature, deferred until a real policy exists to encode.

#### 1.15.3 Renewal semantics — a new row per term

**Confirmed: renewal inserts a new `Membership` row and leaves the old one exactly as it is.**
Extending `endDate` in place was considered and rejected for three reasons:

1. **It breaks the snapshot.** `priceAtPurchase` / `durationDaysAtPurchase` describe *one* agreed
   term. Extending in place either keeps last year's price attached to a term sold at this year's
   price (wrong for revenue reporting) or overwrites it (destroying the record of what the member
   actually paid before). The snapshot is only coherent if a row is exactly one purchase.
2. **Payments attach to a term.** Phase 6 hangs `Payment` off `membershipId`. One row per paid
   term keeps that a clean one-to-many per purchase instead of a pile of payments against a single
   ever-growing row that nobody can reconcile.
3. **History and reporting come free.** "How many renewals last month," "has this member lapsed
   before," and the member's term-by-term timeline are all row queries rather than a diff of an
   audit log that doesn't exist yet.

Renewal rules: the source must be `ACTIVE` or `EXPIRED`; the new row's `startDate` is
`max(today, source.endDate + 1 day)`, so renewing early stacks after the current term instead of
throwing away paid days; the new row snapshots the plan's price/duration **as of the renewal**,
which is how a price rise reaches a member (at their next term, never retroactively); the source
row's status is not touched, and an `ACTIVE` source simply expires on schedule once its own term
runs out. Renewal defaults to the same plan but accepts a different `planId`, which is how a
member changes plan *at a term boundary* — the clean case that needs no proration at all.

#### 1.15.4 Upgrade/downgrade semantics — fresh start, proration deferred

Switching plans **mid-term** cancels the current membership and starts the new plan fresh from
today: the old row goes to `CANCELLED`, a new row is created with the new plan's snapshot and
`endDate = today + newPlan.durationDays`.

**Proration is explicitly out of scope for Phase 5 and deferred**, not undecided. Crediting
unused time is a *money* question, not a calendar one — a fair credit needs a refund/credit-note
concept (does the member get cash back on a downgrade? account credit? a discount on the next
invoice?), and none of that exists until Phase 6 brings in payments and invoices. Inventing a
day-count credit now (e.g. carrying remaining days onto the new plan) would silently over-credit
downgrades, since a day of a premium plan is not worth a day of a basic one, and it would be the
wrong shape to migrate once real credit notes arrive.

Until then, the remaining days on the old plan are **forfeited**, and both the API response and
the UI confirmation state the exact number of days being given up so the operator can decide
whether to instead wait for the term to end and use `renew` with a different plan (1.15.3), which
loses nothing. Revisit in Phase 6 once `Payment`/`Invoice` exist.

`previousMembershipId` (nullable self-reference on `memberships`) links each new row to the row it
succeeded, for both renewals and plan changes, so the member's term chain is navigable rather than
inferred from overlapping dates.

### 1.16 Payments & invoicing semantics

Money is the one area where a wrong default is not a bug report but a dispute, so the same
treatment as 1.15: every "what happens when" is answered here, not in whichever service function
gets written first. 1.4 already establishes the frame — `payment` and `invoice` are append-only,
corrections happen through new rows plus an `AuditLog` entry, and neither table has `deletedAt`.

#### 1.16.1 Upgrade/downgrade proration — forfeiture stands; refunding is a separate, permissioned act

Phase 5 deferred this pending `Payment`/`Invoice`. They now exist, and the answer is:
**`POST /memberships/:id/change-plan` still moves no money.** The old term is cancelled, the new
plan starts today, and the unused days are forfeited exactly as in 1.15.4. Proration is available,
but only as an **explicit two-step**: someone holding `payments.refund` issues a refund against the
original term's payment, and then the plan is changed.

The decisive argument is a permissions one. `change-plan` is gated on `memberships.cancel` +
`memberships.create`, which MANAGER holds and ACCOUNTANT does not. If the endpoint auto-credited
unused days, it would move money on behalf of a role that deliberately does **not** hold
`payments.refund` — the one permission the whole matrix is careful about. A refund would become
reachable through a route that doesn't say "refund", and the Section 4.2 boundary between
"manages memberships" and "handles money" would be decorative. Making proration a separate call is
what keeps that boundary real, and it has the side benefit that the refund lands in the audit log
as a refund, with a named actor, rather than as an invisible consequence of a plan switch.

What the API *does* do is compute the number so nobody does mental arithmetic at a front desk. The
change-plan response carries `forfeited: { days, value }`, where `value` is the old term's own
snapshot daily rate times the unused days:

```
value = round(priceAtPurchase / durationDaysAtPurchase * remainingDays, 2)
```

That uses the **snapshot**, not the plan's current price, for the same reason everything else in
1.15 does: it is what the member actually paid for those days. The UI shows the figure in the
confirmation and says plainly that no credit is being issued. Surfacing the number without acting
on it is the whole point — the operator decides, and the decision is logged.

**Credit-forward is still deferred, and now for a concrete reason rather than a vague one.**
Applying unused value to a *future* invoice needs a per-member account balance — a ledger that can
hold value not yet attached to any invoice. No such concept exists, and inventing one here would
mean a second money store that every report, every refund and every reconciliation has to know
about. A refund against the original payment returns real money through the one mechanism that
already exists and is already audited. Revisit if a gym asks for store credit; that is an account-
balance feature, not an invoicing tweak.

#### 1.16.2 Invoice ↔ payments — the rollup rule, and overpayment is refused

An invoice's `amountTotal` is **immutable** after creation. It is what the member was billed, and
it gets the same treatment as `priceAtPurchase`: a snapshot of an agreement, not a live figure.
Correcting an over- or under-billed invoice means cancelling it and issuing another.

`amountPaid` and `amountPending` are **not** independent facts — they are a cached rollup of the
payment rows, and they are **recomputed from those rows** inside the same transaction as every
payment write:

```
amountPaid    = SUM(payments.amount) WHERE invoiceId = ? AND status NOT IN (FAILED, PENDING)
amountPending = amountTotal - amountPaid
```

Recomputed by summing, never by incrementing. An increment is right once and then drifts forever
the first time a write half-fails, and the drift is silent — the invoice simply starts lying about
what it collected. Summing costs one indexed aggregate on a handful of rows and is self-healing.
The `NOT IN (FAILED, PENDING)` filter is written as an exclusion rather than
`IN (SUCCESS, REFUNDED)` so that a future gateway status defaults to *not* counting as money
received until someone decides otherwise.

This is worth stating against 1.4, which says financial rows are append-only and corrections never
edit history. Updating `amountPaid`/`amountPending`/`status` does not contradict that: the
history is the payment rows, and those are never edited. These three columns are a materialized
`SUM` kept on the invoice so a list screen can filter and sort on "who owes money" without a join
and an aggregate per row.

`status` is a **pure function** of the two amounts, evaluated in this order:

| condition                         | status           |
| --------------------------------- | ---------------- |
| invoice was explicitly cancelled   | `CANCELLED`      |
| `amountPaid >= amountTotal`        | `PAID`           |
| `amountPaid > 0`                   | `PARTIALLY_PAID` |
| otherwise                          | `UNPAID`         |

Consequences worth naming: a zero-total invoice (a free or complimentary term) is `PAID` on
creation with no payment rows, which is correct — there is nothing to collect. `CANCELLED` is the
only status a human sets directly, it is terminal, and a cancelled invoice accepts no further
payments (`INVOICE_NOT_PAYABLE`). **`DRAFT` is never written in Phase 6** — an invoice raised by a
membership sale is immediately payable, so invoices are born `UNPAID`. The value stays in the enum
for a later "compose before issuing" flow rather than being removed.

**Overpayment is rejected**, with `PAYMENT_EXCEEDS_INVOICE` (409) naming the exact outstanding
amount. A payment is accepted when `amount <= amountPending`; equality is fine, so the final
instalment of a split payment settles the invoice exactly. The three candidate behaviours were:

- *Credit it forward* — needs the account-balance ledger that 1.16.1 just deferred. Same gap.
- *Auto-refund the excess* — a money movement nobody authorized, triggered by a typo, behind
  `payments.create` rather than `payments.refund`. The same escalation shape as 1.16.1.
- *Reject it* — chosen. At a gym counter an overpayment is overwhelmingly a slipped digit
  (₹5,000 for a ₹500 balance), and the useful response to a slipped digit is a loud one that says
  what the balance actually is. A member genuinely paying extra is not an overpayment at all: it
  is this invoice settled plus a second invoice for whatever else they are buying.

Because amounts are `DECIMAL(10,2)` and compared as exact decimals, none of this needs a floating
point tolerance.

#### 1.16.3 Refunds — a new row with a negative amount, never a mutation

**Confirmed as the original spec had it.** A refund is a new `Payment` row:

- `amount` is **negative** — the exact refunded value, as a negative decimal
- `status = REFUNDED`, which is what marks the row as a reversal rather than a receipt
- `refundOfPaymentId` points at the payment being reversed (a new nullable self-reference)
- same `invoiceId`, `memberId` and `organizationId` as the payment it reverses

The original row is **never updated and never deleted**. In particular it keeps `status = SUCCESS`,
because it did succeed — money genuinely changed hands, and rewriting that to `REFUNDED` destroys
the fact an audit trail exists to preserve. "Has this payment been refunded?" is answered by the
existence of rows pointing at it, not by a flag on it.

A negative row rather than a separate `Refund` table, because 1.16.2's rollup is then a plain
`SUM` over one table. With a second table, every balance in the system becomes a two-source sum,
and the first place that forgets the second source over-reports revenue and nobody notices. The
payment history a receipt wants — receipts and reversals in one chronological list — falls out of
the same choice for free.

**Partial and repeated refunds are allowed**, capped cumulatively: the sum of refunds against a
payment can never exceed it, or `REFUND_EXCEEDS_PAYMENT` (409). A refund row cannot itself be
refunded (`INVALID_REFUND_TARGET`) — reversing a reversal is a new payment, not a refund.

**Effect on the parent invoice: nothing special.** The refund row is part of the same invoice's
`SUM`, so `amountPaid` falls, `amountPending` rises, and the status function re-runs — a fully
refunded `PAID` invoice returns to `UNPAID`, a partly refunded one to `PARTIALLY_PAID`.
`amountTotal` does not move: the member was still billed that much, and the invoice is the bill,
not the balance. That refunds need no special case in the invoice logic is the strongest argument
that the rollup rule in 1.16.2 is the right one.

**Every refund writes an `AuditLog` row in the same transaction**, so there is no such thing as a
refund without its audit entry:

| column        | value                                                              |
| ------------- | ------------------------------------------------------------------ |
| `entityType`  | `"Payment"`                                                        |
| `entityId`    | the **original** payment's id — so "what happened to this payment?" hits the `[organizationId, entityType, entityId]` index |
| `action`      | `"REFUND"`                                                         |
| `actorUserId` | from the JWT — never from the request body                          |
| `beforeJson`  | the original payment plus the invoice's amounts/status before        |
| `afterJson`   | the refund row's id and amount plus the invoice's amounts/status after |

This is the first use of `AuditLog`; it has been dead schema since Phase 1. Phase 6 audits refunds
only. Auditing every mutation across every module is a cross-cutting concern that deserves its own
design pass, not an ad-hoc helper grown one call site at a time.

#### 1.16.4 Invoice numbering — a locked counter row, allocated inside the invoice's own transaction

**Format: `INV-{YYYY}-{NNNNNN}`** — e.g. `INV-2026-000123`. Sequential **per organization, per
year**, resetting to `000001` each January, zero-padded to six digits and simply growing longer
past 999,999. The year is the UTC year, consistent with 1.15's calendar handling. Per-organization
because two tenants sharing a number line would leak volume to each other; per-year because that is
how every accountant expects to file them.

**Allocation uses a dedicated counter row, not `MAX(invoiceNumber) + 1`.** A `MAX` scan can only be
made safe by locking a range of the invoices index, gets slower as the table grows, and quietly
reuses a number if a row ever disappears. Instead, a small `invoice_sequences` table keyed
`(organizationId, year)` holds `nextValue`, and the invoice transaction:

1. takes the organization write lock (the Locked Decision 1.3 `SELECT ... FOR UPDATE` pattern),
2. `SELECT ... FOR UPDATE`s — or inserts — the `(organizationId, year)` sequence row,
3. formats the number from `nextValue` and increments it,
4. inserts the invoice,
5. commits.

Two properties fall out of doing all of that in **one** transaction. Concurrent creators serialize
on step 2, so no two invoices can be handed the same number. And a transaction that fails at step 4
rolls the increment back with it, so the sequence has **no gaps** — which matters, because a
missing invoice number is the kind of thing an auditor asks about.

Lock ordering is fixed at **organization first, then sequence**, and every path that needs both
takes them in that order. Membership sales already hold the organization lock before they raise an
invoice; a path that grabbed the sequence first would deadlock against them under load.

The cost is that invoice creation serializes within an organization for the length of its
transaction. That is the right trade at this scale — invoices are raised by staff at a counter, not
by a public checkout — and it is the same reasoning that made the org lock acceptable in 1.3.

`@@unique([organizationId, invoiceNumber])` stays on the table as a backstop: if the locking is
ever wrong, the second insert fails loudly instead of producing two `INV-2026-000123`s. This is
**not** a reversal of Locked Decision 1.3. That decision is about columns on soft-deletable tables,
where a deleted row keeps its value "taken" forever; invoices are append-only and have no
`deletedAt` (1.4), so a real database constraint is simply correct here and carries none of the
problems 1.3 was solving.

### 1.17 Attendance semantics

Attendance looks like the simplest table in the schema — a member, a branch, a timestamp — and that
is exactly why it needs deciding up front. Every ambiguity here resolves itself silently in
whichever direction the first implementation happens to go, and the resulting data is *plausible*
rather than obviously broken, so nobody notices until a report is built on it in Phase 8.

The Phase 7 scope note said "shows a warning but is still allowed — decide and document actual
behavior here once built." That is settled below, along with two questions it implies and one it
depends on.

#### 1.17.1 Check-in without an active membership — a recorded override, not a block

**Allowed, but never by accident, and never invisibly.**

A hard block is the wrong answer for a reason that has nothing to do with being lenient: the
software does not know enough to refuse. The member paying for their renewal at the counter right
now, the walk-in on a trial, the member whose freeze the desk forgot to lift, the corporate guest —
all of them are legitimately in the building, and none of them has an `ACTIVE` membership row at
the moment the button is pressed. A system that refuses them does not stop them entering. It stops
them being *recorded*: staff either invent a membership to get past the dialog, or shrug and let
them in unlogged. Both outcomes are worse than the thing the block was protecting, because the
attendance table stops being a record of who was in the gym — which is its only job, and the thing
Phase 8's dashboard and Phase 10's reports will be built on.

So the record follows reality, and the exception is made legible rather than prevented. This is the
same shape as Locked Decision 1.8: the system records what is true and lets staff decide what
should happen about it.

**Deliberate at the API, not just in the UI.** `POST /attendance` with a member who has no covering
membership returns **409 `MEMBERSHIP_NOT_ACTIVE`**, carrying the reason and the member's most recent
term so the desk can see *why*. Recording it anyway requires re-submitting with an explicit
`override: true`. The front desk sees this as a confirmation dialog naming the problem; a script, a
mistyped member id, or a future kiosk sees a refusal it has to consciously override. The Phase 6
principle applies unchanged — the dialog is a courtesy, the server is the control — and here it
also means an override cannot happen through a client that simply forgot to check.

**Every override is stamped on the row.** Two nullable columns carry it:

| column           | when covered            | when overridden                |
| ---------------- | ----------------------- | ------------------------------ |
| `membershipId`   | the term that covered it | `NULL`                         |
| `overrideReason` | `NULL`                  | why it wasn't covered          |

Exactly one of the two is set, which makes "visits outside a valid membership" a `WHERE
overrideReason IS NOT NULL` rather than a reconstruction from dates. `overrideReason` is an enum,
not a boolean, because "no membership at all" and "membership is frozen" are different business
problems: the first is someone training for free, the second is usually a desk that forgot to
unfreeze. The values are `NO_MEMBERSHIP`, `EXPIRED`, `FROZEN`, `CANCELLED` and `NOT_STARTED` (a
renewal bought early that hasn't begun yet — `isUpcoming` in 1.15.3 terms).

`membershipId` is worth having on its own account, not just as the inverse of the flag: it is the
snapshot-link pattern from 1.16, and it answers "how many visits did this term get?" without
re-deriving term boundaries at report time.

**Who let them in is recorded too.** `markedByUserId` holds the acting staff member from the JWT,
never from the body. An override is an accountability question, and the answer should not require
correlating timestamps against shift rosters. It is nullable only because a Phase 13 QR/kiosk
check-in has no staff actor — a `NULL` there will mean "self-service", not "unknown".

**No new permission.** Overriding stays on `attendance.mark`. A separate `attendance.override` key
would put the decision above the only role that is ever standing at the door when it needs making,
and the front desk would route around it by not recording the visit — the exact failure this
decision exists to avoid. The override is *logged*, not *escalated*.

Deliberately **not** written to `AuditLog`: 1.16.3 introduced that table for refunds and said
auditing every mutation deserves its own design pass rather than an ad-hoc helper grown one call
site at a time. An override is a first-class attendance fact, so it belongs in columns on the
attendance row where reports can group by it, not in a JSON blob that has to be parsed to be
counted.

#### 1.17.2 Duplicate check-ins — one per member per day, and the second is not an error

**A member has at most one attendance row per calendar day (1.17.4's definition of a day), enforced
by `@@unique([memberId, attendanceDate])`.**

The alternative — allow many, dedupe with a cooldown window — was rejected because a cooldown is a
tuning knob nobody can set correctly. Too short and a double-click still lands twice; too long and
a genuine second visit is refused. It also makes "how many people came today?" a `COUNT(DISTINCT
memberId)` in every query that ever asks, and the first place that forgets the `DISTINCT`
over-reports attendance.

A unique constraint rather than a check-then-insert, for the Phase 1 duplicate-phone reason: two
taps on a slow connection are genuinely concurrent, and under REPEATABLE READ both transactions see
no existing row. The constraint is the thing that actually holds. Unlike 1.3's phone case there is
no soft-delete complication — attendance rows are never deleted — so a real database constraint is
straightforwardly correct here.

**The second check-in returns `200` with the original row, not a `409`.** This is the deliberate
part. A duplicate is overwhelmingly a double-click or a member re-presenting their card, and the
useful response is not an error but the fact: *"Aarav checked in at 7:04 AM."* The response carries
`alreadyCheckedIn: true` so the UI can say exactly that, and the operation is idempotent — the same
request repeated any number of times leaves one row and returns the same answer. Reserving `409`
for genuine conflicts (`MEMBERSHIP_NOT_ACTIVE`) keeps error codes meaningful rather than making the
front desk learn which red dialogs matter.

Consequence worth naming: a member who genuinely trains twice in one day is recorded once. That is
the right trade for a visit-count metric, and the check-in *time* stays that of the first visit,
which is the one that answers "when does this member come to the gym?".

#### 1.17.3 Branch scoping — the branch where it happened, not the member's home branch

Attendance is stamped with **the branch the check-in occurred at**, which is not necessarily the
member's `branchId`. A member registered at Andheri who trains at Bandra was at Bandra, and Bandra's
daily count is wrong if the row says otherwise. Since Phase 8's dashboard is per-branch and a
branch manager's first question is "how busy were we today", getting this backwards would make the
number quietly useless.

Resolution follows the Phase 2 tenant rule exactly — derived from the JWT, never trusted from the
client:

- **Branch-scoped staff** (RECEPTIONIST, and any user with a `branchId`) always stamp their own
  branch. A `branchId` in the request body is ignored if it matches and rejected if it doesn't,
  the same treatment Phase 2 gives a smuggled `organizationId`.
- **Org-wide staff** (OWNER/ADMIN/MANAGER with `branchId = null`) must name a `branchId`
  explicitly, validated as belonging to their organization. There is no default: guessing the
  member's home branch would fabricate exactly the fact this decision is trying to get right.

Reads are scoped the same way — a branch-scoped user's attendance list is their branch's,
regardless of what they ask for — matching how Phase 4 scoped members and Phase 6 scoped invoices.

**Known limit, accepted:** because Phase 4 scopes *member search* to the caller's branch, a
receptionist at Bandra cannot find an Andheri member to check in at all. Cross-branch visits
therefore need an org-wide user today. Widening member search for check-in specifically would punch
a hole in the Phase 4 boundary for a case no gym has asked for yet; revisit when one does. The
column semantics above are correct now either way, so the fix stays a permissions change rather
than a data migration.

#### 1.17.4 What "a day" means — the organization's local calendar day

1.17.2 is meaningless without this, and the honest answer is not the one 1.15 uses.

Membership terms are stored at **UTC midnight** because they are contractual calendar dates a human
typed: "runs to 30 April" is the same 30 April everywhere, and normalising to UTC keeps it from
drifting. An attendance day is the opposite kind of thing — it is *derived from an instant*, and
mapping an instant to a day is only meaningful in the gym's own timezone.

Taking the UTC day would be actively wrong here, not merely inelegant. IST is UTC+5:30, so a 5:00 AM
check-in — an ordinary opening-time slot for an Indian gym — is 23:30 UTC on the *previous* day. The
early-morning batch would file under yesterday, and 1.17.2's one-per-day rule would let the same
member check in at 5:00 and again at 6:00 the same morning, because those are two different UTC
days.

So `organizations.timezone` is added (IANA name, `NOT NULL`, defaulting to `Asia/Kolkata`), and the
attendance date is the local calendar day in that zone:

```
attendanceDate = the YYYY-MM-DD that `checkedInAt` falls on, in the organization's timezone
```

Both are stored: `checkedInAt` as the exact `DATETIME` (when they arrived) and `attendanceDate` as a
`DATE` (which day it counts as). Storing the derived column rather than computing it per query is
what lets the unique constraint and the per-day indexes exist at all — MySQL cannot index a
timezone conversion, and a `WHERE` clause that converts on every row cannot use an index either.
Denormalised, yes, but derived once at write time from a value that never changes.

Conversion uses `Intl.DateTimeFormat` with the IANA zone, which is in the Node standard library —
no date dependency is added for this. Membership terms keep their UTC handling: they are a different
kind of date and 1.15 is not being reopened. The overlap is limited to *comparing* an attendance
date against a term's start/end, which is a date-to-date comparison and needs no conversion.

This closes the "per-organization timezones are deferred" note in `apps/api/src/utils/dates.ts` for
attendance specifically. Phase 8's "today's revenue" widgets should use the same column.

### 1.18 Dashboard & aggregate semantics

Every number on a dashboard is an answer to a question nobody wrote down. "Revenue this month" has
at least four defensible definitions, and the one that gets implemented is usually just whichever
column the first query happened to reach for. That is tolerable in a list view, where the rows are
right there to check against — but an aggregate is a single number with no visible working, so a
wrong definition is indistinguishable from a right one until someone reconciles it against a bank
statement six months later.

These are also the first queries in the system that read across every module at once, which makes
them the first place a missed `WHERE` leaks one branch's numbers into another's total.

#### 1.18.1 Revenue is cash collected, dated by `payment.paidAt`, net of refunds

**`SUM(payments.amount)` over the month, not `SUM(invoices.amountTotal)`.**

The two differ whenever a bill is raised in one month and paid in another, which for a gym is most
of them — a membership sold on the 28th and paid on the 2nd is March money by the invoice and April
money by the payment. Cash basis is the right default here because it is the number the owner can
check: it should agree with what actually arrived, and an accrual figure never will.

It also falls out of Locked Decision 1.16.3 for free. A refund is a negative payment row with its
own `paidAt`, so summing payments nets refunds automatically, and it dates the reduction to the
month the money went *back* rather than retroactively editing the month it came in. A March payment
refunded in April leaves March's reported revenue exactly as it was reported in March, which is the
property that makes a monthly figure trustworthy at all — last month's number must not move.

Excluded from the sum: `FAILED` and `PENDING`. Neither is written by any code path today, and the
exclusion is written as `NOT IN (FAILED, PENDING)` rather than `IN (SUCCESS, REFUNDED)` for the same
reason 1.16.2 gives — a status added by a future payment-gateway phase should not silently count as
money in the bank before someone decides it does.

Deliberately *not* filtered by member status: an archived member's payments stay in the revenue for
the month they paid. The money arrived. Excluding it would make historical totals depend on
present-day admin housekeeping.

**The month is the organization's local month** (`Asia/Kolkata` by default), not the UTC one — the
same reasoning as 1.17.4, applied to a coarser boundary. `paidAt` is an instant, and under a UTC
month every payment taken between midnight and 05:30 IST on the 1st files under the previous month.
Boundaries are computed in the org's zone and converted to UTC instants for the query, so the index
on `paidAt` is still usable.

#### 1.18.2 Which branch earned it — stamped at the till, not derived from the member

This is the one that required a schema change, and the reason is that the alternative silently
destroys information.

`Payment` and `Invoice` have no `branchId`. Phase 6 scoped both by joining through
`member.branchId`, with the rationale that "a denormalized copy could drift". For an access-control
list — *whose bills am I allowed to see* — that is correct, and it stays. For revenue attribution —
*which branch earned this money* — it is wrong, because **`member.branchId` is editable**. Moving a
member from Andheri to Bandra retroactively moves every payment they have ever made from Andheri's
revenue to Bandra's. Andheri's March figure changes in June, with no money having moved, and there
is no record anywhere of where it was actually taken.

That last clause is what makes this urgent rather than a nice-to-have. Most deferred decisions can
be revisited later with the same information available; this one cannot. Once a member transfers,
the branch that took their money is gone from the database, and no later migration can recover it.
It has to be recorded before the rows accumulate, or not at all.

So `branchId` is added to both tables, `NOT NULL`, stamped at write time and never updated:

| row | stamped from |
| --- | --- |
| invoice for a membership term | the membership's `branchId` — the branch that sold it |
| ad-hoc invoice | the member's branch at the moment it was raised |
| payment | the invoice it pays down |
| refund | the payment it reverses |

The Phase 6 "drift" objection does not survive contact with this distinction. A denormalized copy
drifts when it is *tracking* a mutable source and falls behind. This is not tracking anything: it is
a snapshot of a fact at a point in time, exactly like `priceAtPurchase` in 1.15.3 and exactly like
attendance's branch in 1.17.3. A snapshot cannot drift from a source it was never following.

Existing rows are backfilled from `member.branchId` — the best available estimate, and honest about
being one. That number is correct for every member who has never transferred and unverifiable for
any who has, which is the whole argument for stamping it going forward.

**Reads keep both rules, because they answer different questions.** Invoice and payment *lists* stay
scoped through the member: a receptionist needs to see and collect on the outstanding bills of a
member who is now theirs, whoever raised them. Revenue *aggregates* use the stamped column. The
visible consequence is that a transferred member's old bills appear in their new branch's list but
in their old branch's revenue, which is correct in both places.

#### 1.18.3 "Total members" and "active members" count different things, and neither is `MemberStatus`

- **Total members** — on the books: `deletedAt IS NULL AND status != ARCHIVED`. This deliberately
  matches the members list's default filter so that the dashboard and the list agree. A dashboard
  that says 247 above a list that says 245 destroys confidence in both, and the discrepancy is
  never the interesting thing on the screen.
- **Active members** — members with a membership *covering today*: an `ACTIVE` term whose
  `startDate <= today <= endDate`. Counted distinctly, since 1.15.4's plan changes can leave a
  member briefly holding more than one row.

Note what "active" is **not**: it is not `MemberStatus.ACTIVE`. That column is an administrative
label a receptionist sets by hand, and it says nothing about whether anyone has paid. The gap
between the two figures is the actual business question the widget exists to surface — people on
the books who are not currently paying — so collapsing them into one number would hide exactly the
thing worth looking at. The UI labels the second one with its definition rather than trusting the
word "active" to carry it.

Both are counted by `member.branchId` — a headcount is a question about who belongs to a branch,
unlike revenue, which is about where a transaction happened.

#### 1.18.4 "Expiring soon" is seven days, because thirty would return everyone

The obvious window is 30 days. It is also useless: the common gym plan *is* 30 days, so a 30-day
window returns essentially the entire active roster and the widget degenerates into a second copy
of the active-members count.

The number is worth having only if it is a worklist — the renewals someone should be calling about
this week — so the default window is **7 days, inclusive of today**, and it is overridable per
request (`?expiringWithinDays=`, capped at 90) for the manager who wants a longer horizon.

Criteria: `status = ACTIVE` and `endDate` between today and today + 6. `FROZEN` terms are excluded
even when their `endDate` falls inside the window: under 1.15.2 a frozen clock is paused, so the
stored `endDate` is not a date anything will actually happen on. `CANCELLED` and `EXPIRED` are
excluded for the obvious reason.

Scoped by **`member.branchId`**, not `membership.branchId`. This is a call list, not an attribution
question: after a transfer, the branch the member belongs to now is the one that should ring them,
even though the term (and its revenue) still belongs to the branch that sold it.

Membership dates are UTC midnights (1.15), so this comparison uses `todayUtc()`, not the gym-local
day 1.18.1 uses for money. Two different clocks in one response is uncomfortable, but it is a
consequence of the two kinds of date in 1.17.4 and the alternative — picking one clock and applying
it to both — would make one of the two wrong.

#### 1.18.5 Outstanding fees come from the cached rollup, not a re-sum

`SUM(invoices.amountPending) WHERE amountPending > 0`, reusing the column 1.16.2 already maintains
inside every payment transaction rather than re-deriving it from payment rows at read time. The
rollup is recomputed as a `SUM` on every write and is the number the invoice list and the member's
billing panel already display, so reading it here keeps the dashboard and those screens in
agreement by construction.

Cancelled invoices are excluded automatically and not by a special case: Phase 6's cancellation
zeroes `amountPending` precisely so that a voided bill leaves every "who owes us money" surface at
once. Phase 8 is the second such surface, and it inherits the fix for free — which is the argument
for having fixed it in the data rather than in the invoice list's `WHERE` clause. There is a test
asserting a cancelled invoice contributes nothing here, because "it happens to work" and "it is
guaranteed to work" are different states.

Scoped by **`member.branchId`**, matching the invoice *list* rather than the stamped
`invoice.branchId`. Outstanding is "who at this desk do we still need to collect from", and a
transferred member's open bill moves with them so the new branch can chase it. The money already
collected against that bill stays in the old branch's revenue (1.18.2). The two numbers answering
two different questions is the whole point of stamping the branch at write time.

No aging buckets (30/60/90 days). There is no `dueDate` on an invoice, so every bucket boundary
would be invented from `createdAt`, and an invoice raised today for a term starting next month is
not overdue. Deferred until invoices have due dates.

#### 1.18.6 The dashboard degrades per widget; it is not one permission

The dashboard is the landing page for **every** role — it is the index route, with no permission
gate. Putting `reports.view` in front of it would greet a RECEPTIONIST and a TRAINER with "not
available for your role" as their home screen, since neither holds it in the Section 4.2 matrix.

Widening `reports.view` to those roles is the wrong fix in the other direction: it would put monthly
revenue on the front desk's screen, which is a decision no gym owner asked for.

So each widget is gated on the permission for **the data underneath it**, and the endpoint computes
and returns only the widgets the caller is entitled to:

| widget | permission |
| --- | --- |
| total members, active members | `members.view` |
| monthly revenue, revenue trend | `reports.view` |
| outstanding fees | `invoices.view` |
| expiring memberships | `memberships.view` |
| today's attendance | `attendance.view` |

Revenue is gated on `reports.view` rather than `payments.view` on purpose. Phase 6 gave the front
desk `payments.view` so they can answer "what has this member already paid?" at the counter; summing
every payment in the gym into a monthly figure is a different job, and putting it on the landing
page of a role that holds the ledger-lookup key would be the too-broad counterpart of the
too-narrow bugs in Phases 6 and 7. `reports.view` is already on OWNER / ADMIN / MANAGER / ACCOUNTANT
and already *not* on RECEPTIONIST / TRAINER, which is the split this widget needs.

A TRAINER therefore lands on member counts and today's attendance (they hold `members.view` and
`attendance.view`); a RECEPTIONIST sees members, expiring terms, outstanding fees and the register
but no revenue; an ACCOUNTANT sees the money and the people it attaches to, and not the register.
The permitted set is resolved from the caller's role in one query, and an unpermitted widget is
**absent from the response payload**, not sent-and-hidden — a number the client never receives
cannot be revealed by a devtools panel. The endpoint itself has no permission gate: a role that
holds none of the keys above gets an empty `widgets` object rather than "not for your role" as
their home screen.

This is the rule that makes an aggregate endpoint safe in general: *a dashboard may never expose a
figure the caller could not have computed from the pages they are already allowed to open.*
`reports.view` keeps its meaning for the dedicated reporting section in Phase 11, which is a
different screen with exports and date ranges.

Noted for the record: this is the third instance of the same too-narrow-RBAC shape, after Phase 6's
ACCOUNTANT-without-`members.view` and Phase 7's RECEPTIONIST-without-`attendance.view`. The pattern
is that permissions get written from the perspective of the role's *primary* job and then break on
the screens that combine jobs. Aggregate screens combine every job at once, which is why the fix
here is structural rather than another entry in the matrix.

#### 1.18.7 Reports never write

No `sweepExpired`, no lazy status fixes, no counters — a read of the dashboard leaves the database
byte-for-byte unchanged. Correctness comes from date predicates instead: "active" is
`status = ACTIVE AND startDate <= today <= endDate`, so a stale `ACTIVE` row whose term has passed
is excluded by the dates whatever its status column says.

This is the same conclusion Phase 7 reached for attendance (Section 9, 2026-09-07) and for the same
underlying reason: a module whose clock differs from the memberships module's must not be the one
deciding when a term ends. Here the difference is 1.18.1's local month against 1.15's UTC day. It
also means the dashboard cannot deadlock against a write transaction or make a page load slower the
first time it runs after midnight.

### 1.19 Trainer roster semantics

Section 4.2 has said since Phase 1 that a TRAINER's `attendance.view` is "own sessions only,
enforced in service logic, not just RBAC", and that `members.view` is "read-only, assigned members
only". Until now that sentence has been a comment. The permission middleware cannot express it:
`requirePermission("attendance.view")` is a yes/no on a key, and a trainer and a receptionist both
hold that key. The restriction that actually matters is *which rows come back*. Leaving it as a
comment is the opposite of the too-narrow bugs in Phases 6 and 7 — the key is granted, the filter
is assumed, and the trainer sees the whole gym.

#### 1.19.1 Own-roster is a service-layer filter, not a permission key and not a role-name check

`attendance.view` and `members.view` stay the same keys. The middleware still only checks that the
key is present. The members, attendance and dashboard services then ask one extra question:

> Does this caller hold `attendance.view` and **not** hold `attendance.mark`?

If no, nothing changes — a receptionist, manager, owner still sees their (branch-scoped) register
and roster. If yes, every read is restricted to members currently assigned to a `TrainerProfile`
owned by `auth.userId`.

That discriminator is permission-based on purpose. Section 8 forbids `isAdmin`-style role-name
checks, and `role.name === "TRAINER"` would miss a custom "coach" role that holds the same two
keys. A receptionist who holds `attendance.mark` is the front desk even if someone also attached a
profile to them. An accountant holds `members.view` but not `attendance.view`, so they are not
own-rostered — they still see the whole (read-only) member list, which is the Phase 6 correction.

**The safe empty set.** A caller who matches the discriminator but has no `TrainerProfile`, or a
profile with no assignments, sees **zero rows**, not the unfiltered gym. An unprofiled trainer
account is a hole until someone creates the profile; showing them everyone until that happens is
exactly the leak this rule exists to close. `GET` by id of a member or attendance row outside the
roster returns **404**, not 403, so the endpoint is not an existence oracle — the same answer
Phase 4 gives a receptionist asking about another branch.

The dashboard inherits this. A trainer's "members on the books" and "checked in today" are counts
over their roster, or they would be a second, wider copy of the same leak on the home screen.

Writes are unaffected: a trainer does not hold `attendance.mark` or `members.create`, so the
middleware already refuses those. Own-roster is a read filter.

#### 1.19.2 Assignment is a current ACL, not a coaching history

A member is on a trainer's roster through `TrainerAssignment` (`trainerProfileId`, `memberId`),
unique as a pair. Many-to-many: a member can have a PT and a yoga instructor, a trainer can have
many members. Assigning is `trainers.manage`; the acting staff member is recorded as
`assignedByUserId`.

Unassigning drops the trainer's access to that member, **including past check-ins**. The register
is a worklist ("who of mine came in"), not a ledger of who coached a session. Stamping a trainer
on the attendance row would be the 1.18.2 move, and it is the wrong one here: there is no session
or class object to stamp against yet, and `markedByUserId` is already the desk, not the coach.
Revisit if Phase 9's "classes" ever grow a real session table.

Archived members cannot be assigned. Reassigning an already-assigned pair is a no-op (200), not a
409 — two managers clicking the same name is not a conflict.

#### 1.19.3 A TrainerProfile is 1:1 with a User, and it is what makes a roster exist

The Section 5 sketch is kept: `userId` unique, optional `specialization`, optional
`commissionPct`. Two columns the sketch omitted, added because every other tenant table has them
and because 1.19.1 has to look the profile up by user:

- `organizationId` — tenant queries must not have to join through `users` to stay in-org.
- `updatedAt` — the profile is editable.

`commissionPct` is stored and validated (0–100, two decimals) and **not computed against**. Phase
11 is where money that is not a member payment shows up; inventing a commission run here would be
a third revenue definition next to 1.18.1.

A profile can be created only for a live user in the same organization who does not already have
one, and whose role holds `attendance.view` and does not hold `trainers.manage`. The second clause
stops an owner or manager being filed as a trainer, which would either no-op (they hold
`attendance.mark`, so own-roster would not apply) or confuse the staff list. The first clause is
what "existing User with TRAINER role" in the Phase 9 DoD actually means, without reading the role
name.

Managers do not hold `users.manage`, so they cannot list staff in order to pick a user. Eligible
candidates are therefore a trainers-module read (`GET /trainers/candidates`), gated on
`trainers.manage`, returning only users who could still receive a profile. That is the same
too-narrow shape as ACCOUNTANT-without-`members.view`: the job "attach a profile to an existing
trainer" requires seeing the trainer, and widening `users.manage` to managers would hand them
every colleague's email and role.

There is no `trainers.view` key. A trainer does not need the staff directory; their roster *is*
the members list, already filtered. Creating the key so they can open `/trainers` and see one row
(themselves) would be a screen without a job.

#### 1.19.4 Classes are not in this phase

The Phase 9 goal line says "assignment to members/classes". There is no `Class` table in Section 5
and no session object to assign. Member assignment is the whole of "own sessions" until a later
phase introduces classes; "sessions" in 4.2 is read as "the members I am responsible for", not as
a timetable.

### 1.20 Lead lifecycle semantics

The Section 5 sketch is a row with a status string. That is not a pipeline. Memberships already
learned (1.15.1) that an unstated graph is an implied graph, and implied graphs disagree under
two concurrent clicks. This is the graph, written down before the table.

Numbered 1.20, not 1.19: 1.19 is the trainer roster. The Phase 10 prompt reused 1.19 by
oversight; the locked-decision sequence is not rewritten.

#### 1.20.1 The pipeline is directed, with one recovery edge

Statuses, in order: `NEW` → `CONTACTED` → `TRIAL_SCHEDULED`, then either `CONVERTED` or `LOST`.

`PATCH` may move a lead **forward**, including skipping a step (a walk-in who books a trial the
same afternoon is `NEW → TRIAL_SCHEDULED`; forcing a fake `CONTACTED` would be a screen without a
job). Any open status may move to `LOST`. Same-status is a no-op (200).

Backward moves among the open statuses are refused. Overshooting is a data-entry mistake; the
fix is not a second, quieter graph of "undo" edges that two staff would use differently.

`CONVERTED` is **terminal**, like `CANCELLED` on a membership. It is not a `PATCH` target. The
only writer is `POST /leads/:id/convert`. A converted lead is the audit of how this member
arrived, and editing it as if they were still a prospect would fork the person.

`LOST` is **recoverable**, unlike `CANCELLED`. "Lost" means we stopped chasing, not that a
contract ended. The only recovery edge is `LOST → CONTACTED`: they are back in the conversation,
not a fresh unknown (`NEW`) and not magically trial-ready (`TRIAL_SCHEDULED`). Convert is
refused from `LOST`; reopen first. That keeps "they walked in and joined" and "they ghosted and
called back" as different paths.

As data:

```
NEW:              CONTACTED, TRIAL_SCHEDULED, LOST
CONTACTED:        TRIAL_SCHEDULED, LOST
TRIAL_SCHEDULED:  LOST
LOST:             CONTACTED
CONVERTED:        (none)
```

#### 1.20.2 Conversion creates a Member in the same transaction

Converting is allowed from any **open** status (`NEW`, `CONTACTED`, `TRIAL_SCHEDULED`). A same-day
signup never had a trial, and requiring `TRIAL_SCHEDULED` would invent one.

The convert endpoint creates a `Member` (first name, last name, phone, branch — the lead's single
`name` is a CRM label, not a member record) and sets `status = CONVERTED` and `convertedMemberId`
in the **same transaction**. A converted lead without a member, or a member whose originating
lead still says `CONTACTED`, is the membership-without-invoice shape from Phase 6; the two
outcomes are "member and converted lead" or "neither".

The lead's phone is the member's phone. If that number already belongs to someone on the books,
conversion is 409 `DUPLICATE_PHONE` and names them — Locked Decision 1.3 is not waived because
the write came from CRM. Linking the lead onto an existing member without creating one is a
later addendum, not invented here.

After conversion the lead is read-only: `PATCH` and a second convert are 409 `LEAD_CONVERTED`.
The member is the live record; the lead is how they arrived.

Gated on `leads.manage` alone. Conversion *is* the job of this module; requiring `members.create`
as well would be the too-narrow shape (a role that can run the pipeline but cannot finish it).
Receptionist and manager already hold both; a future sales role should not need a second key to
complete the one action the pipeline exists for.

#### 1.20.3 Branch scoping is the member rule; assignment is a worklist hint

`branchId` and `assignedToUserId` are both optional on the row.

A branch-scoped caller (the front desk) sees **all leads at their branch**, not only the ones
assigned to them. Members in Phase 4 are not "the receptionist's own members"; leads are the
same job, earlier. Filtering the register to `assignedToUserId = me` would hide unassigned
walk-ins from the person who took them — the too-narrow bug, again. `assignedToUserId` is a
follow-up owner, filterable on the list, never an ACL.

Unattributed leads (`branchId` null) are Instagram-shaped: not yet a branch's. Only org-wide
staff see them. A branch-scoped caller creating a lead is stamped with their branch; they cannot
leave it null and cannot name another branch. GET by id outside the caller's branch is **404**,
not 403.

`assignedToUserId`, when set, must be a live user in the same organization whose role holds
`leads.manage`. Managers do not hold `users.manage`, so eligible assignees are
`GET /leads/assignees`, gated on `leads.manage` — the same candidates shape as 1.19.3.

#### 1.20.4 Duplicate phones block a second *open* lead, not a second enquiry ever

Members (1.3) refuse a second active member with the same phone. Leads are not members: a lost
enquiry in March and a new Instagram DM in September are two cycles, and collapsing them would
rewrite the old campaign's source and dates.

App-layer uniqueness, same org lock as 1.3: no two leads in `NEW` / `CONTACTED` /
`TRIAL_SCHEDULED` may share a phone inside one organization. `LOST` and `CONVERTED` do not occupy
the slot, so a returning number can open a new lead. No `@@unique` and no `deletedAt` — leads are
status-driven, like memberships.

An open lead whose phone already belongs to an active member is allowed (shared numbers, a spouse
calling, a number we have not matched). Conversion is where 1.3 fires.

### 1.21 Expense semantics

The Section 5 sketch is a row with an amount and a nullable branch. That is enough to store a
receipt and not enough to put one on a P&L. Revenue already has a definition (1.18.1); expenses
have to live in the same one, or "revenue vs expenses" is two numbers from two calendars.

#### 1.21.1 Null-branch expenses are org-level, not allocated

`branchId` is nullable on purpose: rent is a branch's, a software subscription is the gym's.

A **branch-scoped P&L** (an org-wide caller naming a branch, or a future branch-scoped holder of
`reports.view`) includes only expenses stamped to that branch. Org-level rows (`branchId` null)
are **excluded**, not split across branches. Allocating a ₹6,000 Zoom bill 50/50 would invent a
cost-allocation scheme nobody asked for, and it would make a branch's figure depend on how many
siblings it has. The stamp is the fact; no stamp means "not a branch's".

The **org-wide P&L** (no branch named) includes everything: every branch's rows plus the
unattributed ones. That is the only screen on which a software subscription appears.

The expense **list** follows the same rule as leads (1.20.3): a branch-scoped caller sees their
branch's rows and cannot see or create unattributed ones. Org-wide staff see all, and may leave
`branchId` null. GET by id outside the caller's branch is **404**.

This is the 1.18.2 instinct applied to costs: stamped at write time, never inherited, never
guessed. The difference is that costs are allowed to have no branch; revenue is not, because a
payment is taken at a till.

#### 1.21.2 Category is a closed set, because reports group by it

Free-text `category` would make "Rent" and "rent" and "RENT " three bars on the P&L within a
month. The report exists to group; a field the report groups by cannot be a typo surface.

`ExpenseCategory` is an enum: `RENT`, `UTILITIES`, `SALARIES`, `EQUIPMENT`, `MARKETING`,
`SOFTWARE`, `MAINTENANCE`, `SUPPLIES`, `PROFESSIONAL_FEES`, `OTHER`. The UI is a select. Grouping
is exact. A gym that needs a eleventh bucket adds a value in a later phase rather than opening
the column to strings.

`OTHER` is the escape hatch so the closed set does not refuse a real cost. Notes carry the
detail; the bar stays `OTHER`.

#### 1.21.3 Expenses are a book the accountant maintains, not a cash-collected fact

Payments are append-only because a refunded rupee is a customer-facing event with its own row
(1.16.3), and because last month's revenue must not move (1.18.1). Expenses are neither. There is
no member receipt, no till, no reversal that a customer could dispute. A duplicate rent line or a
slipped extra zero is a data-entry mistake, and inventing a reversal ritual for it would be
ceremony without a job.

So an expense is **editable and hard-deletable** after creation. Amount, category, date, branch,
payee and notes may all change. `createdByUserId` is who first filed it and is not rewritten.
There is no `deletedAt`, no status, no audit-log-on-correction, no negative "reversal" row.

The P&L is **live**. Editing a March rent line in June changes March's figure. That is the
opposite of 1.18.1 on purpose: revenue is "what the bank received that month" and must be
stable; expenses are "what we currently believe we spent", and a correction is a better number,
not a second history. A period-close that freezes a month is a later addendum, not invented here.

A future date is allowed (prepaid rent, an annual subscription). Amount is strictly positive —
to undo, edit or delete; a negative expense would be a second, quieter refund.

#### 1.21.4 The P&L window is 1.18.1's gym-local month

`GET /reports/profit-loss?from=YYYY-MM&to=YYYY-MM`. Both default to the organization's current
local month. `from` and `to` are inclusive. A range longer than 24 months is refused so a
`?from=2000-01` cannot become "sum the gym".

Revenue in that window is **the same sum as the dashboard widget**: `SUM(payments.amount)` where
`paidAt` is inside `localMonthBounds` and status is not `FAILED`/`PENDING` (1.18.1), attributed
by the stamped `payment.branchId` (1.18.2). Expenses in that window are rows whose `expenseDate`
(a calendar date the human typed, stored as `DATE`) falls on a day of those local months.

Two clocks, same as the dashboard: payments are instants mapped into the gym's month;
`expenseDate` is already a civil date, so "March" is `2026-03-01 <= expenseDate < 2026-04-01`.
Picking UTC months here would make the P&L disagree with the home screen about the same March.

The report never writes (1.18.7). It is gated on `reports.view`, not `expenses.manage`: a manager
who can see monthly revenue must be able to see it net of costs, and the line items stay on the
expenses screen behind `expenses.manage` (Section 4.2: ACCOUNTANT / OWNER / ADMIN). A figure on
the P&L is an aggregate the caller could not drill into if they lack `expenses.manage`, and that
is acceptable — the same split 1.18.6 already made between `reports.view` and `payments.view`.

Net is `revenue - expenses`, as a fixed-2 string, possibly negative. Category totals are the
expense side only.

### 1.22 Notification automation semantics

The Section 5 sketch is a template and a log. That is enough to remember that a message existed
and not enough to run a nightly job twice without texting someone twice. Redis/BullMQ is the
first piece of infrastructure that is not MySQL; it does not get to invent a second clock, a
second "soon", or an unspoken retry policy.

#### 1.22.1 One intended send per (event, entity, channel, gym-local day)

If the nightly job runs twice on the same gym-local day — a retry, a manual trigger, a tick that
fires four times during the 21:00 hour, clock skew between API processes — it must not enqueue a
second SMS for the same membership or invoice.

The lock is a unique constraint on `NotificationLog`:
`(organizationId, event, entityId, channel, localDate)`. `localDate` is the organization's
civil date at `asOf` (1.17.4), stored as `DATE`. The scan inserts a `QUEUED` row first; a unique
violation means "already intended today" and is a skip, not an error. Only then is a BullMQ job
added, with `jobId = log.id`, so Redis cannot hold a second copy of the same row either.

A membership that sits in the expiry window for seven days can be notified on each of those
seven local days. That is a reminder, not a one-shot, and it is the same reason the unique key
includes the date rather than being `(event, entityId)` forever. Re-running *today* does not
duplicate; tomorrow is a new fact.

`entityId` is the membership id (`MEMBERSHIP_EXPIRING`) or the invoice id (`PAYMENT_DUE`). The
channel is part of the key so an org that later adds an EMAIL template does not collide with
today's SMS. This phase seeds one SMS template per event; PUSH is in the enum and unused.

A `QUEUED` row whose enqueue to Redis failed is deleted so the next scan can try again. A
worker that sees a log already `SENT` returns success without sending — jobs are retried, rows
are not.

#### 1.22.2 "Expiring soon" is the dashboard's seven days

The nightly expiry scan uses the **same predicate as 1.18.4**: `status = ACTIVE`, `startDate <=
today <= endDate`, `endDate <= today + 6`, `FROZEN`/`CANCELLED`/`EXPIRED` excluded, archived
members excluded. `today` is `todayUtc()` because membership dates are UTC midnights (1.15),
exactly as the widget. A 3-day notification window would make the dashboard and the SMS
disagree about who is "soon", and a 30-day window is the same degeneration 1.18.4 already
refused.

It is not overridable per request on the scan. The widget's `?expiringWithinDays=` is a manager
looking further ahead; a member SMS is not a worklist the manager is holding. Changing the
number later is an addendum, not a query parameter.

`PAYMENT_DUE` is every invoice with `amountPending > 0` against a live (not archived) member.
Cancelled invoices are already `amountPending = 0` (Phase 6); they do not need a special case.
There is no extra "due in N days" on invoices — outstanding is outstanding.

#### 1.22.3 Failures retry three times, then the log is FAILED

BullMQ's defaults are not a decision. A send job has `attempts: 3` and exponential backoff
starting at **10 seconds** (`NOTIFICATION_BACKOFF_MS`, overridable so tests are not a 30-second
sleep). The sender in this phase is log-only: it writes the rendered body at `info` and
succeeds. A test can inject a sender that throws; that is how retry is proven, not hoped.

While attempts remain, the log stays `QUEUED`. After the last attempt fails, the worker's
`failed` handler sets `status = FAILED` and stores `lastError`. There is no automatic re-queue
the next night for a FAILED row of the same local date — the unique key still holds, so the
scan skips it. A later local day is a new attempt. That is deliberate: a broken template should
not page Redis every 15 minutes for the rest of the evening.

Password-reset email is **not** moved onto this queue. There is still no transport (the Phase 2
log-only reset stays); wiring it here would pretend Phase 12 delivered email when it delivered
a pino line.

#### 1.22.4 Nightly means 21:00 at the gym, not UTC midnight

A repeatable BullMQ tick fires every 15 minutes. For each `ACTIVE` organization it asks: is the
gym-local hour 21? If yes, it runs that org's scan for that local date. Two orgs in
`Asia/Kolkata` and `Pacific/Honolulu` are not scanned at the same UTC instant; an IST gym at
21:00 is 09:30 in Honolulu, and Honolulu is not "nightly" yet.

Hour 21, not a one-minute window: a 15-minute tick would otherwise miss 21:00 exactly. The
unique key makes running four times between 21:00 and 21:59 harmless.

The tick is *when*. The expiry predicate is still `todayUtc()` (1.22.2). Two clocks in one
pipeline, same as the dashboard: money and attendance are gym-local; membership terms are UTC
midnights. Collapsing them would make the SMS disagree with the widget about the same "today".

Operators (and the verification harness) do not wait until 21:00. `POST /notifications/run`
scans the caller's org immediately, still under `notifications.manage`, still writing through
the same unique key. The tick is the unattended path; the POST is the same function with the
hour check skipped.

`notifications.manage` stays OWNER/ADMIN as 4.2 wrote it. The log is an ops/history screen, not
the front desk's call list — the desk already has the dashboard widget. Not widened in this
phase.

### 1.23 Member portal semantics

Phase 13's original line was "DB changes: none (read-only consumer of existing API)." That cannot
survive contact with "a member can log in." Members have no password, staff JWTs carry `userId` +
`roleId`, and every existing list endpoint is a staff worklist gated on `members.view` /
`memberships.view` / `payments.view`. Handing a member those keys would let them list the gym.
The Flutter app is a new *audience*, not a new skin on the admin API.

#### 1.23.1 A member is not a User

Section 8 forbids merging User, Member, and Trainer. A User has a Role and a permission set; a
Member has a phone and a term. Portal login does not mint a User row and does not grant any
Section 4.2 key.

Login identifier is **phone + password + organizationSlug**. Phone is the per-org unique handle
(1.3); email is optional and not unique enough to be a login. `organizationSlug` is required
the same way Phase 2 needed it for an email that exists in two gyms — phones collide across
tenants even more often.

OTP is not a substitute: Phase 12's sender is still log-only. There is no SMS to receive a code.

#### 1.23.2 `passwordHash` on Member, and its own refresh table

`members.passwordHash` is nullable. Null means "portal not enabled" — login does the same dummy
bcrypt compare as a missing staff user so the timing does not reveal whether the phone exists.
Setting a hash is what turns a gym record into a login. This phase seeds it from fixtures; there
is no self-serve "set my password" screen yet.

Staff `refresh_tokens.userId` stays `NOT NULL`. Weakening that column to also mean "or a member"
would make every staff auth query a special case. Members get `member_refresh_tokens`, same
shape (familyId, tokenHash CHAR(64), reuse revokes the family). Two audiences, two tables.

Access JWT `type` is `member_access` and the claims are `{ memberId, organizationId }`. A staff
token (`type: access`, `userId`, `roleId`) is rejected on member routes; a member token is
rejected on staff routes. The middleware split is the whole ACL.

#### 1.23.3 Self-scope, not a permission key

`GET /me`, `GET /me/memberships`, `GET /me/attendance`, `GET /me/payments` take the member id
from the token and nowhere else. A `memberId` in the query string is ignored. There is no
"view another member" call for this audience to get wrong. Status, `daysRemaining`, outstanding
balances are the same computed fields the admin API already returns — Dart displays them.

#### 1.23.4 Refresh on Flutter — memory + secure storage, not a cookie

Admin-web puts the refresh token in an httpOnly cookie because the browser has a cookie jar the
page script cannot read (Phase 3). Flutter does not. On mobile there is no document.cookie; on
web, Dart is not same-origin with the API (admin-web is `localhost:5173`, the member app is
`localhost:8080`), so the existing cookie (`path=/api/v1/auth`, `SameSite=Lax`) would not be a
reliable session even if we tried.

The member login/refresh responses therefore return `refreshToken` in the JSON body. The Dart
client:

- holds the **access** token in memory only (a Riverpod notifier) — never `shared_preferences`,
  never `localStorage` in the clear;
- writes the **refresh** token to `flutter_secure_storage`;
- on a 401, single-flights one `POST /auth/member/refresh` with that token in the body (the
  same family-reuse rule as Phase 2: two parallel refreshes would kill the session);
- on cold start, reads storage and refreshes before painting the shell.

On Android/iOS that storage is Keystore/Keychain. On **web** `flutter_secure_storage` encrypts
into `localStorage` with Web Crypto. That is not httpOnly: XSS on the Flutter origin can read
it. Stated, not pretended otherwise. Mitigation is the same pair as admin-web where it still
applies — short-lived access token in memory, refresh rotation that revokes the family on
replay — plus the member app being a read-only client. Phase 14's native builds get the
stronger store without an API change.

Staff login is unchanged: still cookie-only, still no refresh token in JSON.

#### 1.23.5 CORS is a list

`CORS_ORIGIN` is a comma-separated allowlist so admin-web (`:5173`) and the member app (`:8080`)
can both send credentialed requests. A single origin would force one of the two local apps to
lose CORS the day the other starts. `localhost` and `127.0.0.1` are different origins to the
browser — both must be listed, or a Flutter `web-hostname` of one will fail CORS against a
`.env` that only named the other.

### 1.24 Super Admin / SaaS semantics

Implemented as slices **15.1–15.13** (Section 7). Phase 15 is **Done** (2026-09-14) —
Section **10.20** checked after Super Admin headed Chrome and admin-web 3–13 re-verification.
Gym-member
`Payment` / `Invoice` rows stay gym billing (Phase 6). They are not the Vedafit software
subscription. Seed still creates Demo Gym + OWNER; public signup and Super Admin create also
call `provisionOrganization`.

#### 1.24.1 A platform operator is not a gym User

Section 8 forbids merging User, Member, and Trainer. A gym `User` always carries `organizationId`
+ `roleId` (Phase 2 JWT `type: access`). A `Member` carries `memberId` + `organizationId`
(`type: member_access`, 1.23.2). A Super Admin who could log in as Demo Gym OWNER would be
cross-tenant by construction.

Phase 15 adds a **third audience**: platform operators. Tables (migrated in 15.1):
`platform_users` + `platform_refresh_tokens` (same family/reuse shape as staff and member
refresh tables). Access JWT `type: platform_access` with `{ platformUserId }` and **no**
`organizationId`. Middleware: `authenticatePlatform` — staff and member tokens are 401 on
platform routes; platform tokens are 401 on staff and member routes. Do not add `isAdmin` /
`isSuperAdmin` on `User` (Section 8).

Seed one platform operator for local dev (email + password), analogous to 1.7's gym OWNER — not
a Demo Gym staff row.

#### 1.24.2 Minimal viable "sign up a new gym"

Self-serve creation is **one transaction**, reusing the same provisioning the seed script already
does by hand:

1. `Organization` (unique `slug`, status `ACTIVE` or `SUSPENDED` only — do not invent a third
   `OrganizationStatus` in the first slice; trial lives on the **subscription** row, 1.24.4).
2. Default `Branch` (name from the form or `"Main Branch"`).
3. Permission catalog already global; `syncOrganizationRoleMatrix` for this org.
4. `User` with role **OWNER**, email + password from the form. This is a gym staff account,
   not a platform user and not a `Member`.
5. Default notification templates (`ensureDefaultTemplates`).
6. A `OrganizationSubscription` row on the default SaaS plan (trial or paid stub — 1.24.4).

If any step fails, none of it commits. The new OWNER then uses **existing** `POST /auth/login`
with `organizationSlug` (Phase 2). No new staff-auth protocol. Members are not created at
signup; the gym adds members through admin-web as today.

Public route: rate-limited `POST /api/v1/platform/signup` (gym name, slug, timezone,
owner name/email/password). Slug collision → `DUPLICATE_ORGANIZATION_SLUG`. Platform operators
can also provision an org (same service, authenticated). `organizationService.create` remains
for incomplete test tenants; live create goes through `provisionOrganization`.

#### 1.24.3 Tenant isolation does not change

`organizationId` still comes from the staff or member JWT, never from the body (Section 6).
Org A's OWNER cannot read org B. Platform list/detail endpoints are the only cross-tenant
reads, and they require `platform_access`. `OrganizationStatus.SUSPENDED` already blocks staff
and member login (`ACCOUNT_INACTIVE`). Phase 15 uses that switch; it does not bypass it.

#### 1.24.4 SaaS plan, subscription, limits — not gym invoices

Separate from Phase 6 gym payments:

- **SaaS plan catalog** (platform-owned): name, price snapshot fields, interval, entitlement
  JSON or columns (`maxBranches`, `maxStaff`, `maxMembers`, module toggles e.g. leads/trainers).
- **Organization subscription**: `organizationId`, `planId`, status
  `TRIAL | ACTIVE | PAST_DUE | CANCELLED`, period end. One live subscription per org.
- **First billing provider: manual / log-only.** Super Admin marks a subscription paid or
  expired. No Stripe (or other PSP) in the first slice — same instinct as Phase 12's log-only
  sender. A PSP is a later slice once money actually moves to Vedafit.
- Enforce entitlements on **write** (create branch / user / member) with a dedicated error
  code, not only by hiding admin-web nav. Read-only access can remain while `PAST_DUE` if we
  choose that in implementation; login block stays tied to `OrganizationStatus.SUSPENDED`.

Feature flags for MVP **are the plan entitlements**, not a LaunchDarkly-style per-request flag
service. Do not build a generic flag product in the first slice.

#### 1.24.5 Super Admin surface

New origin, not a permission on gym admin-web (an OWNER must not stumble into fleet controls).
Shipped: `apps/super-admin` (Vite + React, `:5174`). Screens: login (platform user), org list,
org detail (status, subscription, OWNER email), create, suspend/restore, assign plan, read-only
catalog. Platform mutations write `platform_audit_logs` (15.11) — not gym `audit_logs`. There
is no Super Admin audit page and no `GET /platform/audit-logs` in v1.

#### 1.24.6 What Phase 15 will not do in the first build

- Production deploy, DNS, HTTPS, Play/App Store listing.
- iOS.
- Charging gyms via Stripe.
- Member self-serve org signup (members are not gyms).
- Merging the three JWT audiences.
- UI polish of the member app.

#### 1.24.7 Implementation order

Shipped as 15.1–15.13 (Section 7 / 10.19). This list is history, not a start signal:

1. Platform identity (table + JWT + middleware + seed operator) and tests that staff/member
   tokens cannot call platform routes.
2. Extract seed provisioning into a transactional `provisionOrganization` used by seed, signup,
   and platform create.
3. Public signup + rate limit + OWNER can log in through existing staff auth.
4. SaaS plan + subscription rows; manual status changes; entitlement checks on writes.
5. Super-admin UI: list / suspend / assign plan; audit.
6. Only then: PSP billing, if still wanted.

The long-form implementation plan (tables, endpoints, slices, DoD, open decisions) is
**Section 10**. Slices 15.1–15.13 are implemented; Phase 15 DoD (**10.20**) is checked.

---

## 2. Repository Structure (final)

Matches the original spec's tree with one deviation (Prisma location, per 1.6):

```
gym-management-platform/
├── apps/
│   ├── admin-web/          React + TypeScript + Vite
│   ├── member-app/         Flutter (added Phase 13+)
│   └── api/
│       ├── prisma/
│       │   ├── schema.prisma
│       │   ├── seed.ts
│       │   └── migrations/
│       └── src/            (structure per original spec, Section 4 there)
├── packages/
│   ├── shared-config/      shared eslint/tsconfig for admin-web + api
│   └── api-contract/       (empty until OpenAPI is introduced, later)
├── infrastructure/
│   ├── docker/
│   └── deployment/
├── docs/
│   ├── architecture/       ← this file lives here
│   ├── api/
│   ├── database/
│   └── decisions/
├── .github/workflows/      CI (Phase 0)
├── .env.example
├── .gitignore
├── pnpm-workspace.yaml
└── README.md
```

`apps/api/src/*` and `apps/admin-web/src/*` internal structure: unchanged from the original spec
(Sections 4's two structure blocks) — feature-based, not type-based.

---

## 3. Phase 1 Database Schema (full, as it will actually be migrated)

```prisma
// ── Enums ────────────────────────────────────────────────
enum OrganizationStatus { ACTIVE SUSPENDED }
enum BranchStatus       { ACTIVE INACTIVE }
enum UserStatus         { ACTIVE INACTIVE }
enum MemberStatus       { ACTIVE INACTIVE ARCHIVED }
enum MembershipPlanStatus { ACTIVE INACTIVE }
enum MembershipStatus   { ACTIVE EXPIRED FROZEN CANCELLED }
enum PaymentMethod      { CASH CARD UPI BANK_TRANSFER OTHER }
enum PaymentStatus      { SUCCESS FAILED REFUNDED PENDING }
enum InvoiceStatus      { DRAFT UNPAID PARTIALLY_PAID PAID CANCELLED }

// ── Core tenancy ─────────────────────────────────────────
model Organization {
  id        String             @id @db.Char(26)
  name      String
  slug      String             @unique
  email     String
  phone     String?
  status    OrganizationStatus @default(ACTIVE)
  createdAt DateTime           @default(now())
  updatedAt DateTime           @updatedAt

  branches Branch[]
  users    User[]
  roles    Role[]
  members  Member[]
  plans    MembershipPlan[]
  // ... other org-scoped relations
}

model Branch {
  id             String       @id @db.Char(26)
  organizationId String
  name           String
  address        String?
  phone          String?
  status         BranchStatus @default(ACTIVE)
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt

  organization Organization @relation(fields: [organizationId], references: [id])
  @@index([organizationId])
}

// ── Staff / RBAC ─────────────────────────────────────────
model User {
  id             String     @id @db.Char(26)
  organizationId String
  branchId       String?    // nullable: OWNER/ADMIN/ACCOUNTANT are usually org-wide
  name           String
  email          String
  passwordHash   String
  roleId         String
  status         UserStatus @default(ACTIVE)
  deletedAt      DateTime?
  createdAt      DateTime   @default(now())
  updatedAt      DateTime   @updatedAt

  organization        Organization          @relation(fields: [organizationId], references: [id])
  role                 Role                 @relation(fields: [roleId], references: [id])
  refreshTokens        RefreshToken[]
  passwordResetTokens  PasswordResetToken[]

  @@index([organizationId, email]) // NOT unique — see Locked Decisions 1.3
}

model Role {
  id             String   @id @db.Char(26)
  organizationId String
  name           String   // OWNER/ADMIN/MANAGER/RECEPTIONIST/TRAINER/ACCOUNTANT, or custom later
  createdAt      DateTime @default(now())

  organization Organization     @relation(fields: [organizationId], references: [id])
  users        User[]
  permissions  RolePermission[]

  @@unique([organizationId, name])
}

model Permission {
  id          String @id @db.Char(26)
  key         String @unique // e.g. "members.create"
  description String?

  roles RolePermission[]
}

model RolePermission {
  roleId       String
  permissionId String

  role       Role       @relation(fields: [roleId], references: [id])
  permission Permission @relation(fields: [permissionId], references: [id])

  @@id([roleId, permissionId])
}

// ── Members & memberships ────────────────────────────────
model Member {
  id             String       @id @db.Char(26)
  organizationId String
  branchId       String
  firstName      String
  lastName       String
  phone          String
  email          String?
  dateOfBirth    DateTime?
  status         MemberStatus @default(ACTIVE)
  deletedAt      DateTime?
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt

  organization Organization      @relation(fields: [organizationId], references: [id])
  branch       Branch            @relation(fields: [branchId], references: [id])
  memberships  Membership[]
  payments     Payment[]
  invoices     Invoice[]
  attendances  Attendance[]
  documents    MemberDocument[]

  @@index([organizationId, phone]) // NOT unique — see Locked Decisions 1.3
}

model MembershipPlan {
  id             String               @id @db.Char(26)
  organizationId String
  name           String
  price          Decimal              @db.Decimal(10, 2)
  durationDays   Int
  status         MembershipPlanStatus @default(ACTIVE)
  createdAt      DateTime             @default(now())
  updatedAt      DateTime             @updatedAt

  organization Organization @relation(fields: [organizationId], references: [id])
  memberships  Membership[]
}

model Membership {
  id                     String           @id @db.Char(26)
  organizationId         String
  branchId               String
  memberId               String
  planId                 String
  priceAtPurchase        Decimal          @db.Decimal(10, 2) // snapshot — see rationale below
  durationDaysAtPurchase Int              // snapshot
  startDate              DateTime
  endDate                DateTime
  status                 MembershipStatus @default(ACTIVE)
  createdAt              DateTime         @default(now())
  updatedAt              DateTime         @updatedAt

  member   Member         @relation(fields: [memberId], references: [id])
  plan     MembershipPlan @relation(fields: [planId], references: [id])
  payments Payment[]

  @@index([organizationId, endDate]) // expiry queries
}

// ── Money ─────────────────────────────────────────────────
// payment & invoice: no deletedAt, no free-form updatedAt mutation of amounts.
// Corrections happen via new rows (refund/reversal) + AuditLog, per spec.
// NOTE: amended in Phase 6 (refundOfPaymentId, membershipId, notes, InvoiceSequence) and again
// in Phase 8 — `branchId` stamped at write time on both tables (Locked Decision 1.18.2), because
// deriving attribution from `member.branchId` lets a transfer rewrite historical revenue.
model Payment {
  id             String        @id @db.Char(26)
  organizationId String
  branchId       String        // the till that took the money; never updated (1.18.2)
  memberId       String
  membershipId   String?
  invoiceId      String?
  amount         Decimal       @db.Decimal(10, 2) // negative on a refund row (1.16.3)
  method         PaymentMethod
  status         PaymentStatus @default(SUCCESS)
  refundOfPaymentId String?
  paidAt         DateTime      @default(now())
  createdAt      DateTime      @default(now())

  member     Member      @relation(fields: [memberId], references: [id])
  membership Membership? @relation(fields: [membershipId], references: [id])
  invoice    Invoice?    @relation(fields: [invoiceId], references: [id])

  @@index([organizationId, branchId, paidAt])
}

model Invoice {
  id             String        @id @db.Char(26)
  organizationId String
  branchId       String        // selling branch for a term, member's branch for an ad-hoc bill
  memberId       String
  membershipId   String?
  invoiceNumber  String        // INV-2026-000123 — Locked Decision 1.16.4
  amountTotal    Decimal       @db.Decimal(10, 2)
  amountPaid     Decimal       @db.Decimal(10, 2) @default(0)
  amountPending  Decimal       @db.Decimal(10, 2)
  status         InvoiceStatus @default(DRAFT)
  notes          String?
  createdAt      DateTime      @default(now())
  updatedAt      DateTime      @updatedAt

  member   Member    @relation(fields: [memberId], references: [id])
  payments Payment[]

  @@unique([organizationId, invoiceNumber])
  @@index([organizationId, branchId, amountPending])
}

// Amended in Phase 7 — see Locked Decision 1.17 and the Section 9 entry.
model Attendance {
  id             String   @id @db.Char(26)
  organizationId String
  branchId       String   // where the check-in happened, not the member's home branch (1.17.3)
  memberId       String
  checkedInAt    DateTime @default(now()) // the instant
  attendanceDate DateTime @db.Date        // the org-local day it counts as (1.17.4)
  // Exactly one of these two is set (1.17.1).
  membershipId   String?
  overrideReason AttendanceOverrideReason?
  markedByUserId String?  // null is reserved for self-service check-in (Phase 13)

  member Member @relation(fields: [memberId], references: [id])

  @@unique([memberId, attendanceDate]) // one visit per member per day (1.17.2)
  @@index([memberId, checkedInAt])
  @@index([organizationId, branchId, attendanceDate]) // the daily register
  @@index([organizationId, attendanceDate])
}

model MemberDocument {
  id         String   @id @db.Char(26)
  memberId   String
  fileName   String
  fileUrl    String
  fileType   String
  fileSize   Int
  uploadedBy String
  createdAt  DateTime @default(now())

  member Member @relation(fields: [memberId], references: [id])
}

// ── Auth support tables ──────────────────────────────────
// NOTE: both token models below were amended in Phase 2 — `familyId` added to RefreshToken, and
// `tokenHash` narrowed to Char(64) + @unique on both. Left as originally written here on purpose;
// see Section 9 (2026-09-06) for why, and apps/api/prisma/schema.prisma for the current shape.
model RefreshToken {
  id        String    @id @db.Char(26)
  userId    String
  tokenHash String
  expiresAt DateTime
  revokedAt DateTime?
  createdAt DateTime  @default(now())

  user User @relation(fields: [userId], references: [id])
  @@index([userId])
}

model PasswordResetToken {
  id        String    @id @db.Char(26)
  userId    String
  tokenHash String
  expiresAt DateTime
  usedAt    DateTime?
  createdAt DateTime  @default(now())

  user User @relation(fields: [userId], references: [id])
  @@index([userId])
}

// ── Audit ─────────────────────────────────────────────────
model AuditLog {
  id             String   @id @db.Char(26)
  organizationId String
  actorUserId    String?
  entityType     String   // e.g. "Payment", "Membership"
  entityId       String
  action         String   // e.g. "REFUND", "STATUS_CHANGE"
  beforeJson     Json?
  afterJson      Json?
  createdAt      DateTime @default(now())

  @@index([organizationId, entityType, entityId])
}
```

**Why the `priceAtPurchase` / `durationDaysAtPurchase` snapshot on `Membership`:** if a
`MembershipPlan`'s price changes later, existing memberships must not silently reprice. The plan
relation stays (for reporting/analytics on "which plan"), but the commercial terms actually agreed
at purchase time are frozen on the `Membership` row itself.

---

## 4. RBAC Seed Catalog (seeded in Phase 1)

### 4.1 Permission keys (initial set — grows per phase, never shrinks)
`organizations.update`, `branches.manage`, `users.manage`, `roles.manage`,
`members.create`, `members.view`, `members.update`, `members.archive`,
`membership-plans.view`, `membership-plans.manage`,
`memberships.view`, `memberships.create`, `memberships.freeze`, `memberships.cancel`,
`memberships.renew`,
`payments.create`, `payments.view`, `payments.refund`,
`invoices.view`, `invoices.manage`,
`attendance.mark`, `attendance.view`,
`trainers.manage` (Phase 9), `leads.manage` (Phase 10), `expenses.manage` (Phase 11),
`reports.view`, `settings.manage`, `notifications.manage` (Phase 12)

### 4.2 Default role → permission matrix
- **OWNER** — every permission, always. Not editable via UI.
- **ADMIN** — everything except `organizations.update` (owner-only) and `roles.manage`.
- **MANAGER** — `members.*`, `membership-plans.*`, `memberships.*`, `payments.create`,
  `payments.view`, `invoices.view`, `invoices.manage`, `attendance.*`, `reports.view`,
  `trainers.manage`, `leads.manage`. Notably **not** `payments.refund`: raising a bill is running
  the gym, returning money is handling the books (1.16.1).
- **RECEPTIONIST** — `members.create`, `members.view`, `members.update`, `membership-plans.view`,
  `memberships.view`, `memberships.create`, `memberships.renew`, `payments.create`,
  `payments.view`, `invoices.view`, `attendance.mark`, `attendance.view`, `leads.manage`. Notably
  **not** `memberships.freeze` / `memberships.cancel` / `payments.refund` — those give away time or
  money.
- **ACCOUNTANT** — `payments.*`, `invoices.*`, `membership-plans.view`, `memberships.view`,
  `members.view` (an invoice is raised against a member, so the role that raises them has to be
  able to look one up — read only), `expenses.manage`, `reports.view`.
- **TRAINER** — `attendance.view` (own sessions only, enforced in service logic, not just RBAC),
  `members.view` (read-only, assigned members only).

This matrix is seeded per-organization at org-creation time (each org gets its own `Role` rows so
future custom roles/permission tweaks per-org are possible without a schema change).

---

## 5. Future Schema Sketches (designed now, not migrated until their phase)

Kept here so Phase 1's schema doesn't need breaking changes when these phases arrive.

```prisma
// Phase 9 — migrated as `trainer_profiles` plus `trainer_assignments` (1.19). Sketch left
// here so the original Section 5 design is still readable; the shipped columns add
// organizationId and updatedAt, and assignment is a separate many-to-many ACL table.
model TrainerProfile {
  id             String   @id @db.Char(26)
  userId         String   @unique // 1:1 with User — trainer is a User with role TRAINER
  specialization String?
  commissionPct  Decimal? @db.Decimal(5, 2)
  createdAt      DateTime @default(now())
}

// Phase 10 — migrated as `leads` with a `LeadStatus` enum and unique `convertedMemberId` (1.20).
// Sketch left `status` as a free string; the graph is Locked Decision 1.20.1. Phone uniqueness
// is app-layer on *open* leads only (1.20.4), not `@@unique`.
model Lead {
  id               String    @id @db.Char(26)
  organizationId   String
  branchId         String?
  name             String
  phone            String
  source           String?   // e.g. "walk-in", "referral", "instagram"
  status           String    // NEW / CONTACTED / TRIAL_SCHEDULED / CONVERTED / LOST
  assignedToUserId String?
  followUpAt       DateTime?
  convertedMemberId String?
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt
}

// Phase 11 — migrated as `expenses` with an `ExpenseCategory` enum (1.21.2), a civil DATE
// `expenseDate` (1.21.4), and `updatedAt` because the row is a live book (1.21.3). Sketch left
// `category` as a free string; grouping a P&L by typos is not a report. No `deletedAt`.
model Expense {
  id             String   @id @db.Char(26)
  organizationId String
  branchId       String?
  category       String
  amount         Decimal  @db.Decimal(10, 2)
  expenseDate    DateTime
  paidTo         String?
  notes          String?
  createdByUserId String
  createdAt      DateTime @default(now())
}

// Phase 12
model NotificationTemplate {
  id             String   @id @db.Char(26)
  organizationId String
  event          String   // e.g. "MEMBERSHIP_EXPIRING", "PAYMENT_DUE"
  channel        String   // SMS / EMAIL / PUSH
  body           String
}

model NotificationLog {
  id             String    @id @db.Char(26)
  organizationId String
  memberId       String?
  event          String
  channel        String
  status         String    // QUEUED / SENT / FAILED
  sentAt         DateTime?
  createdAt      DateTime  @default(now())
}
```

Phase 12 implemented this sketch with Locked Decision 1.22: `event`/`channel`/`status` are
enums (`NotificationEvent`, `NotificationChannel`, `NotificationLogStatus`), plus
`NotificationEntityType` so the scan can tell a membership id from an invoice id. The log gained
`entityId`, `localDate` (civil `DATE`), rendered `body`, `lastError`, `updatedAt`, and a unique
key on `(organizationId, event, entityId, channel, localDate)` — that key is the idempotency lock
(1.22.1), not a nice-to-have index. Templates gained `updatedAt` and a unique on
`(organizationId, event, channel)`.

---

## 6. API Conventions (unchanged from original spec, restated for completeness)

Base path: `/api/v1/`

Success: `{ "success": true, "data": {}, "message": "..." }`
Error: `{ "success": false, "error": { "code": "MEMBER_NOT_FOUND", "message": "..." } }`
Pagination: `{ "success": true, "data": [], "pagination": { "page": 1, "limit": 20, "total": 248, "totalPages": 13 } }`

List endpoint query params (Locked Decision 1.9): `page`, `limit`, `search`, `status`, `sortBy`,
`sortOrder`.

Multi-tenancy: `organizationId`/`branchId` are **always** derived from the authenticated JWT server-side.
Any value for these in a request body/query is ignored or validated-and-rejected — never trusted.
This is enforced in `tenant.middleware.ts`, before any module route handler runs.

---

## 7. Phase-by-Phase Plan

Each phase lists: Goal, Depends on, Scope, DB changes, Definition of Done, Status.

### Phase 0 — Repo & tooling setup
**Depends on:** nothing
**Goal:** A working monorepo skeleton with CI, linting, and env validation, before any feature code.
**Scope:**
- `pnpm-workspace.yaml`, root `package.json`, `packages/shared-config` (eslint + tsconfig base)
- `apps/api` and `apps/admin-web` scaffolded (empty Express app / empty Vite app)
- `.env.example` per app, zod-validated `env.ts`
- `.github/workflows/ci.yml`: lint + typecheck + test on push/PR
- `.gitignore`, root `README.md`
**DB changes:** none
**Definition of Done:**
- [x] `pnpm install` works from repo root — verified with both `pnpm install` and
  `pnpm install --frozen-lockfile` (the exact command CI uses), both exit 0.
- [x] `pnpm -F api dev` boots an empty Express server — verified: booted the real
  `tsx watch src/server.ts` process, then `curl http://localhost:4000/api/v1/health`
  returned `{"success":true,"data":{"status":"ok","uptimeSeconds":...},"message":"API is healthy"}`,
  and an unknown route returned the standard 404 error envelope.
- [x] `pnpm -F admin-web dev` boots an empty Vite app — verified: booted the real `vite` dev
  server, then rendered the page in headless Chrome (`--dump-dom`) and confirmed the actual
  React output (`<h1>Gym Management — Admin</h1>...`) appears in the DOM, not just that Vite
  serves static HTML.
- [ ] CI workflow runs and passes on an empty PR — **not verified**. This repo has no GitHub
  remote yet, so no real GitHub Actions run could be triggered. What *was* verified: every
  individual step the workflow runs (`pnpm install --frozen-lockfile`, `pnpm --filter="./apps/*" run lint`,
  `... run typecheck`, `... run test`) was executed locally, in that order, and all passed. Leaving
  this box unchecked on purpose until an actual PR run on GitHub confirms it — check this once
  the repo is pushed and a PR is opened.
- [x] Env var validation throws a clear error if a required var is missing — verified for both
  apps, at the actual runtime layer (not just unit tests):
  - `apps/api`: ran the real `tsx src/server.ts` process with `PORT` removed from `.env` → process
    crashed immediately (exit code 1) with `Error: Invalid or missing environment variables: - PORT: ...`,
    before ever calling `app.listen`.
  - `apps/admin-web`: ran the real `vite` dev server with `VITE_API_URL` removed from `.env`,
    loaded the page in headless Chrome → browser console showed
    `Uncaught Error: Invalid or missing environment variables: ...` and `<div id="root">` stayed
    empty (React never rendered), confirming the fail-fast check actually runs before app boot,
    not just in an isolated unit test.
  - Both apps also have unit tests (`env.test.ts`) codifying this behavior for regression safety.

**Status:** Done (except the CI-on-a-real-PR box — see above; revisit once this repo has a remote)

### Phase 1 — Backend foundation + core modules
**Depends on:** Phase 0
**Goal:** Express + Prisma + MySQL wired up with logging, error handling, security middleware, and the
Organization/Branch/User/Role/Permission modules — no auth yet, just CRUD + schema.
**Scope:**
- Prisma schema (Section 3 above), initial migration, seed script (Section 1.7 + Section 4)
- Pino logging, centralized `error.middleware.ts`, `error-codes.ts` (1.10)
- Helmet, CORS, rate limiting, input validation middleware (Zod schemas per module)
- Modules: `organizations`, `branches`, `users`, `roles`, `permissions` (CRUD, no auth guard yet —
  auth lands Phase 2)
- Shared list-endpoint helper implementing pagination/filter/sort convention (1.9)
- ID-generation Prisma Client Extension (1.2)
- Vitest + Supertest set up, first tests written against these modules
**DB changes:** full Phase 1 schema (Section 3) migrated
**Definition of Done:**
- [x] `pnpm prisma migrate dev` runs clean from empty DB — verified: ran
  `pnpm exec prisma migrate dev --name init` against a fresh `gym_dev` database, applied cleanly
  (17 tables created, incl. `_prisma_migrations`). A second migration
  (`char_columns_binary_collation`) was required and applied on top — see "Deviations" below.
  Also ran `prisma migrate deploy` against a second database (`gym_test`) to confirm both
  migrations replay cleanly on an independent empty DB, not just the one they were authored
  against.
- [x] Seed script creates one org + branch + OWNER user + full permission catalog + role
  matrix — verified by running `pnpm exec prisma db seed` and then querying `gym_dev` directly
  with the `mysql` CLI (not just trusting the script's own log output):
  - `organizations`: 1 row (`demo-gym`, status `ACTIVE`)
  - `branches`: 1 row (`Main Branch`, linked to the org above)
  - `permissions`: 26 rows (full Section 4.1 catalog)
  - `roles` × `role_permissions` per-org matrix, permission counts per role verified against
    Section 4.2's spec exactly: OWNER 26, ADMIN 24 (all minus `organizations.update` +
    `roles.manage`), MANAGER 16, RECEPTIONIST 7, ACCOUNTANT 7, TRAINER 2
  - `users`: 1 row (`owner@demo-gym.test`, role `OWNER`, `passwordHash` length 60 — a real
    bcrypt hash, not plaintext)
  - Re-ran the seed a second time and re-checked row counts — identical (1/1/26/6/1) — confirming
    it's idempotent, not additive on re-run.
- [x] CRUD endpoints for org/branch/user/role/permission smoke-tested via curl — verified: booted
  the real `tsx watch src/server.ts` process against `gym_dev` and, for every one of the 5
  modules, exercised create → list → get-by-id → update via real `curl` requests (not just unit
  tests), including negative cases: duplicate org slug (409), duplicate role name (409),
  duplicate user email (409), unknown permission key on role create (400), 404 after a user
  soft-delete, and a global 404 for the intentionally-nonexistent `POST /permissions` (no write
  endpoint on that module by design — it's a seeded catalog). Cleaned up the smoke-test org
  afterward so `gym_dev` is left with only clean seed data.
- [x] Generated IDs are lowercase ULIDs, confirmed via a test — `src/lib/id.test.ts` asserts
  `generateId()` output is exactly 26 chars, equals its own `.toLowerCase()`, matches the
  Crockford-base32 pattern, and that 1000 calls produce 1000 unique values. Every module test
  additionally asserts the same pattern on real API-created IDs (e.g.
  `organization.test.ts`'s "happy path" test).
- [x] Duplicate-phone/email race test proves service-layer transaction check works (1.3) — see
  "Deviations" below for an important implementation detail (row-locking) this uncovered.
  `user.test.ts`'s race-condition test fires two truly concurrent (`Promise.all`) `POST`s with
  the same org+email and asserts exactly one `201` / one `409 DUPLICATE_EMAIL` — not a soft "at
  least one succeeds" check. Re-ran this specific test 5 times in isolation
  (`vitest run -t "race condition"`) to rule out flakiness: 5/5 passed. Also confirmed via a
  direct DB query inside the test that exactly one row exists afterward, not just that the HTTP
  responses looked right. Member/phone gets the equivalent test when the Member module is built
  in Phase 4 (Member doesn't exist yet in Phase 1's scope).
- [x] Unit/integration tests passing in CI — not "CI" literally yet (no GitHub remote, same
  caveat as Phase 0), but ran `pnpm --filter api run lint`, `run typecheck`, and `run test`
  (the exact commands `ci.yml` runs) locally: all pass. Full suite: **39/39 tests passing**
  across 8 test files (health, env, id, organizations, branches, roles, permissions, users).

**Deviations from the plan as originally written (see Section 9 for the dated log entry):**
- **Collation:** Prisma's MySQL migrator created every `@db.Char(26)` column with the connector's
  default `utf8mb4_unicode_ci` collation, not `utf8mb4_bin` as Locked Decision 1.2 requires
  (schema.prisma has no collation attribute to set this directly). Fixed with a hand-written
  second migration (`char_columns_binary_collation`) that `ALTER TABLE ... MODIFY`s all 44
  id/FK columns across all 16 affected tables to `utf8mb4_bin`, leaving every other column
  untouched. Verified after the fact via `information_schema.COLUMNS`: all 44 columns confirmed
  `utf8mb4_bin`; foreign key count unchanged (21) before/after, confirming no relations broke.
- **Row-locking on user creation:** a plain "check-then-insert inside a transaction" (Option 1's
  literal description) does not actually close the race under MySQL's default REPEATABLE READ
  isolation — two truly concurrent transactions can both see "no existing row" and both insert.
  `userService.create`/`.update` now also take an InnoDB `SELECT ... FOR UPDATE` lock on the
  parent `Organization` row for the duration of the transaction, serializing concurrent
  writes *for that organization only* (cheap — user creation is low-frequency, admin-driven
  traffic). This is what makes the race test above deterministic rather than flaky. Still no
  DB-level `@@unique` — this is a concurrency-control detail on top of Option 1, not a reversal
  of it. The same pattern should be reused for `Member.phone` in Phase 4.
- **Local MySQL, no Docker in this sandbox:** the sandbox has no Docker and the system's MySQL
  service is AppArmor-confined (can't use a custom datadir under `$HOME`) with no known root
  password. Added `infrastructure/docker/docker-compose.yml` as the primary/normal path for any
  real machine, and `apps/api/scripts/dev-mysql-sandbox.sh` as a no-Docker fallback that runs an
  unprivileged `mysqld` under `/tmp` (allowed by the AppArmor profile) on the same port (3307),
  so `DATABASE_URL` is identical either way. See README.md.
- **Table naming:** every model has `@@map("snake_case_plural")` (e.g. `Organization` →
  `organizations`) for conventional MySQL table names — a cosmetic addition, not a schema
  decision reversal.

**Status:** Done

### Phase 2 — Auth, RBAC enforcement, tenant middleware
**Depends on:** Phase 1
**Goal:** Real login, JWT issuance/refresh, permission-based route guards, and the multi-tenancy
middleware that makes `organizationId`/`branchId` trustworthy everywhere downstream.
**Scope:**
- `auth` module: `POST /login`, `POST /refresh`, `POST /logout`, `GET /me`,
  `POST /forgot-password`, `POST /reset-password`
- `RefreshToken` + `PasswordResetToken` tables wired up; refresh rotation-on-use with reuse detection
  (if a revoked/already-used refresh token is presented again, revoke the whole token family)
- Access token: short-lived JWT (contains `userId`, `organizationId`, `branchId`, `roleId`)
- Refresh token: httpOnly cookie for admin-web
- Login rate limiting / lockout after N failed attempts
- `tenant.middleware.ts`: derives org/branch from JWT, rejects any client-supplied org/branch claim
- `permission.middleware.ts`: checks JWT's role → permission before handler runs
**DB changes:** one migration beyond Phase 1 — `refresh_tokens.familyId`, plus `tokenHash`
narrowed to `CHAR(64)` + `UNIQUE` on both token tables. The original "none beyond Phase 1" estimate
missed that family-wide revocation needs a column to group a rotation chain by. See Section 9
(2026-09-06) and the Deviations note below.
**Definition of Done:**
- [x] Login returns access token + sets httpOnly refresh cookie — verified against a live server,
  not just supertest. `curl -D -` on `POST /api/v1/auth/login` with the seeded OWNER returned
  `HTTP/1.1 200` and the header
  `Set-Cookie: refresh_token=dMVkpDMJ...; Path=/api/v1/auth; Expires=Tue, 06 Oct 2026 11:46:00 GMT; HttpOnly; SameSite=Lax`
  alongside `{"accessToken":"eyJ...","tokenType":"Bearer","expiresIn":900}`. The decoded JWT
  payload was `{userId, organizationId, branchId: null, roleId, type:"access", iat, exp}` with
  `exp - iat = 900`. Confirmed the raw cookie value appears nowhere in `refresh_tokens`
  (`SELECT COUNT(*) WHERE tokenHash = '<raw>'` → 0) and that `sha256(raw)` equals the stored
  `tokenHash` exactly.
- [x] `/auth/me` returns `{ user, organization, branches }` — verified against the real seeded
  `owner@demo-gym.test`. Top-level `data` keys were exactly `['branches','organization','user']`;
  `user.role.name` was `OWNER` with all 26 catalog permission keys; `organization.slug` was
  `demo-gym`; `branches` contained the seeded `Main Branch`. No `passwordHash` in the payload.
- [x] Refresh rotation + reuse detection covered by a test — and re-verified live with DB
  inspection at each step. After rotating R1→R2 the family held `[REVOKED, LIVE]`. Replaying the
  spent R1 returned 401 `TOKEN_REUSE_DETECTED` and left the family at `[REVOKED, REVOKED]` with
  `COUNT(*) WHERE revokedAt IS NULL` = 0 — R2 was revoked at the replay timestamp despite never
  having been presented, which is the part that distinguishes family revocation from simply
  rejecting the replayed token. Presenting the legitimate R2 afterwards also returned
  `TOKEN_REUSE_DETECTED`. A separate test confirms a *second* login (different family) survives,
  so revocation is family-scoped rather than user-wide.
- [x] Cross-tenant test: org A's token cannot read/write org B's data — exercised on **four**
  modules, 12 method/path combinations (organizations GET+PATCH, branches GET/POST/GET-by-id,
  users GET/POST/GET-by-id/DELETE, roles GET/POST/GET-by-id). All 12 returned 403 `ORG_MISMATCH`,
  live and in supertest. Post-run row counts in org B were unchanged. Also verified that an
  `organizationId` smuggled in the request **body** or **query string** — on the caller's own,
  legitimate URL — is rejected with `ORG_MISMATCH`, while the identical request without the
  smuggled claim returns 200.
- [x] Permission-denied test: RECEPTIONIST role blocked from an ADMIN-only route — a real
  RECEPTIONIST login (whose `/auth/me` showed exactly the 7 keys the Section 4.2 matrix grants)
  got 403 `PERMISSION_DENIED` with message `This role lacks the required permission: users.manage`
  on both `POST` and `GET /organizations/:id/users`, and on `POST /branches` for
  `branches.manage`. The user it tried to create does not exist in the DB. The same `POST /users`
  as OWNER returned 201, proving the route works and it is the permission that blocked it.
- [x] Rate limiting confirmed on login endpoint — by actually hammering it, not by reading the
  middleware. Eight wrong-password requests to one address produced
  `401, 401, 401, 401, 401, 429, 429, 429` with `RateLimit-Remaining` counting `4→3→2→1→0`. A
  ninth request with the **correct** password still returned 429 (the limiter runs ahead of the
  handler), while a different account from the same IP logged in with 200 in the same window.

**Deviations (see Section 9 for the decision-log entries):**
- `refresh_tokens.familyId` added (the "no DB changes" estimate was wrong).
- `POST /api/v1/organizations` and `GET /api/v1/organizations` (list-all) removed from the HTTP
  API; org creation stays a seed-script/Phase-15 concern.
- Account lockout is implemented as IP+email rate limiting with an in-memory store, not a
  persisted per-account counter.
- Login accepts an optional `organizationSlug`, because email is unique per-org, not globally.
- `forgot-password` returns the reset token outside production, since there's no mail transport
  until Phase 12.

**Status:** Done

### Phase 3 — Admin: login screen, layout, shell
**Depends on:** Phase 2
**Goal:** Admin-web can log in and shows an authenticated shell (sidebar/topbar), nothing else yet.
**Scope:**
- `features/auth` (login form, RHF + Zod validation)
- TanStack Query client, Axios/fetch wrapper with refresh-on-401 interceptor
- Zustand store for current user/org/branch context (populated from `/auth/me`)
- `components/layout` (sidebar, topbar), `app/router` with protected-route wrapper
- React Testing Library set up (1.11), first component tests
**DB changes:** none
**Definition of Done:**

All four items were verified in a real Chrome (`puppeteer-core` driving the system browser)
against the real API and the real MySQL database — `apps/admin-web/e2e/phase3-verify.ts`,
**51 checks, 0 failures**. Screenshots in `apps/admin-web/e2e/screenshots/`. The API was run with
`JWT_ACCESS_TTL=5s` so the token-expiry step exercised a genuine expiry rather than a simulated
401.

- [x] Can log in with seeded OWNER user and land on an empty dashboard shell — typing
  `owner@demo-gym.test` into the real form produced `POST /auth/login → 200` followed by
  `GET /auth/me → 200`, and the URL moved from `/login` to `/`. The rendered shell read
  `Demo Gym` / `OWNER` / `1 branch`, all sourced from the live `/auth/me` payload rather than
  anything hardcoded. The refresh cookie was confirmed `HttpOnly`, `SameSite=Lax`, path-scoped to
  `/api/v1/auth`, and unreadable from `document.cookie`; `localStorage` and `sessionStorage` were
  both empty of anything token-shaped.
- [x] Refreshing the page preserves session (via refresh cookie) — a real `page.reload()` landed
  back on `/` with the shell intact and the login form absent. The boot sequence on the wire was
  exactly `POST /auth/refresh → 200`, then `GET /auth/me`, with **one** refresh call, not two,
  under React StrictMode.
- [x] Logging out clears session and redirects to login — clicking the real Sign out button sent
  `POST /auth/logout → 200`, cleared the `refresh_token` cookie (verified via CDP, not
  `document.cookie`), emptied the store, and navigated to `/login`. Revisiting `/` afterwards
  redirected again, with the boot refresh rejected `401`.
- [x] Protected routes redirect unauthenticated users to login — a cold visit to `/` with no
  cookie redirected to `/login` after the boot refresh was rejected; no app shell was ever
  rendered. Covered in jsdom too, including the bootstrapping window and mid-session ejection.

**Also verified beyond the stated DoD:**
- Refresh-on-401 interceptor, against a genuinely expired token: the wire showed
  `GET /auth/me → 401`, `POST /auth/refresh → 200`, `GET /auth/me → 200` — exactly three calls,
  and the calling code received the retried response as if nothing had happened.
- Single-flight refresh under three parallel 401s: exactly **one** `POST /auth/refresh`, all
  three callers resolved 200, and the session survived. Confirmed in the database afterwards —
  the login's token family held exactly 4 rows (1 login + 3 rotations: reload, expiry, burst),
  all `revokedAt` set after logout. A duplicate refresh would have tripped Phase 2's
  reuse detection and revoked the family mid-run.
- Brand palette (Section 1.14) read back as **computed** CSS, not as class names in JSX:
  `rgb(0, 0, 0)` body, `rgb(31, 31, 31)` login card and sidebar, `rgb(201, 255, 31)` submit
  button and active nav pill, `rgb(233, 255, 165)` subtitles, `rgb(254, 249, 245)` headings and
  labels — matching `#000000 / #1F1F1F / #C9FF1F / #E9FFA5 / #FEF9F5` exactly.
- 46 React Testing Library / Vitest tests across login form validation and submission, the
  protected-route guard, the interceptor, the layout shell, and the session store — plus the
  existing 78 API tests still green.

**Deviations (see Section 9 for the decision-log entries):**
- Access token is held in memory only and never persisted, so every cold load spends one
  speculative `POST /auth/refresh`.
- Refresh is single-flight, which is a correctness requirement rather than an optimization.
- Verification tooling (`puppeteer-core` + `apps/admin-web/e2e/`) added as a devDependency,
  excluded from `pnpm test` and from CI.
- `GET /auth/me` is served with Express's default `ETag`, so repeat calls return `304` on the
  wire. Noted, not changed — an API concern, logged in Section 9.

**Status:** Done

### Phase 4 — Admin: Members module
**Depends on:** Phase 3
**Goal:** Full member CRUD from the UI, exercising the pagination/filter convention end to end.
**Scope:**
- API: `members` module list/search/filter/create/edit/view/archive endpoints
- Admin: `features/members` — list table, search/filter bar, create/edit form, detail view, archive action
- `member_documents` deferred (needs object storage — not yet)
**DB changes:** none beyond Phase 1
**Definition of Done:**

Verified by clicking through the real UI in a real Chrome against the real API, with every
mutation read back out of MySQL using the `mysql` client rather than the API that wrote it —
`apps/admin-web/e2e/phase4-verify.ts`, **51 checks, 0 failures**. Fixtures (a real branch-scoped
RECEPTIONIST login and a known 7-member dataset) come from `apps/api/scripts/phase4-fixtures.ts`.

- [x] Create/edit/archive a member through the UI, confirmed in DB — a member typed into the real
  form produced a row with a lowercase ULID id, `status = ACTIVE` and `deletedAt = NULL`; editing
  the surname through the form changed `lastName` in the database and moved `updatedAt` past
  `createdAt`; archiving through the confirmation dialog set `status = ARCHIVED` while leaving
  `deletedAt = NULL`, and the member dropped out of the default list while staying reachable.
  Final table state after the run:
  `Meera Iyer-Nair / +919888810001 / ARCHIVED`, `Walkin Signup / +919888820001 / ACTIVE`,
  `Returning Member / +919888810001 / ACTIVE`.
- [x] Search + status filter + pagination all work together — `?search=Singh&status=INACTIVE&limit=1&sortBy=firstName&sortOrder=asc`
  against a 7-member fixture set (4 non-archived Singhs, 2 of them INACTIVE) returned "2 members
  matching your filters", "Page 1 of 2", and `Divya Singh` alone on page 1. Clicking Next gave
  `Esha Singh` with search and status still in the URL. Reversing only `sortOrder` put `Esha` on
  page 1, which is what proves the sort is applied across the filtered set before it is cut into
  pages rather than within a page. The filtered total was cross-checked against the equivalent
  `SELECT COUNT(*)`, and archived members were shown to be reachable only via `?status=ARCHIVED`.
- [x] Duplicate-phone attempt shows a friendly error — submitting a phone already held by an
  active member returned 409 `DUPLICATE_PHONE` from the service-layer transaction check, rendered
  as *"Phone number +919888810001 already belongs to Meera Iyer-Nair"* attached to the phone field
  (`aria-invalid="true"`, focus moved there) rather than only as a banner. The form stayed put and
  the database still held exactly one row for that number. Also covered in the API suite by a
  concurrent-create race test that confirms exactly one of two simultaneous inserts wins.
- [x] RBAC: RECEPTIONIST can create/view members but not archive — signed in as a real
  `reception@demo-gym.test` session: listed members, created one that was confirmed in the
  database, and saw an Edit button but no Archive button. Firing the archive request anyway
  through the app's own axios instance (bypassing the UI entirely, carrying the receptionist's
  real token) returned 403 `PERMISSION_DENIED`, and the member's row was unchanged.

**Also verified beyond the stated DoD:**
- Archiving frees the phone number: a new member was created through the UI with the archived
  member's number, leaving two rows sharing it — the older `ARCHIVED`, the newer `ACTIVE`.
- Branch scoping: a branch-scoped user sees only their own branch's members even when they name
  no branch at all, and is refused (`BRANCH_MISMATCH`) for naming another one.
- Brand palette on the new screens as computed CSS: `rgb(31, 31, 31)` filter bar and table header,
  `rgb(201, 255, 31)` ACTIVE badge text and Add member button, `rgb(233, 255, 165)` subtitle.
- 38 API tests and 33 React Testing Library tests for the module, on top of the existing suites —
  116 API and 87 admin-web tests green overall.

**Deviations (see Section 9 for the decision-log entries):**
- Archive is a `status` transition; `deletedAt` is deliberately left untouched.
- `POST /:memberId/archive` rather than `DELETE /:memberId`.
- Member list and reads are branch-scoped for branch-scoped users.
- Phone duplicate detection is exact-string; E.164 normalization deferred.
- `status: ARCHIVED` is rejected by the update endpoint.

**Status:** Done

### Phase 5 — Memberships (plans, renewals, freeze, cancel, trials)
**Depends on:** Phase 4
**Goal:** Members can be enrolled in plans; the full membership lifecycle works.
**Scope:**
- API: `membership-plans` CRUD; `memberships` create/renew/upgrade/downgrade/freeze/cancel
- Snapshot pricing logic (`priceAtPurchase`/`durationDaysAtPurchase`) implemented on create
- Lazy expiry computation (1.8) implemented in the read path
- Admin: `features/membership-plans`, `features/memberships` (assign plan, renew, freeze/cancel actions)
**DB changes:** ~~none beyond Phase 1~~ — three columns on `memberships` (`frozenAt`,
`totalFrozenDays`, `previousMembershipId`), required by the semantics locked in 1.15. See the
Deviations note below and Section 9.
**Definition of Done:**

Verified in a real Chrome against the real API, with every mutation read back out of MySQL with
the `mysql` client rather than the API that wrote it — `apps/admin-web/e2e/phase5-verify.ts`,
**87 checks, 0 failures**. Fixtures (a branch-scoped RECEPTIONIST login, six purpose-named members
and a known plan) come from `apps/api/scripts/phase5-fixtures.ts`.

- [x] Assigning a plan creates a Membership with a frozen price/duration snapshot — a plan typed
  into the real form (`E2E Gold`, ₹1,000 / 30 days) stored as `1000.00` `DECIMAL(10,2)` and was
  then sold through the sell-membership form. The row carried `priceAtPurchase = 1000.00`,
  `durationDaysAtPurchase = 30`, `startDate = today`, `endDate = today + 29` (inclusive term),
  `status = ACTIVE`, `totalFrozenDays = 0`, `previousMembershipId = NULL`, and a `branchId`
  inherited from the member rather than supplied by the client.
- [x] Changing a plan's price afterward does not affect already-issued memberships — the plan was
  edited through the UI to ₹2,500 / 60 days. The issued membership still read `1000.00` / `30` /
  the same `endDate` in the database, and its detail page still displayed **₹1,000.00**. Renewing
  it then produced a *second* row at `2500.00` / `60`, starting the day after the first term ended
  and chained by `previousMembershipId`, while the original row stayed `ACTIVE` at its own price —
  two term rows for the member, not one edited row. That is the price rise reaching the member at
  their next term and never retroactively.
- [x] Freeze/cancel/renew transitions all update status correctly, with invalid transitions
  rejected — freeze set `status = FROZEN` and stamped `frozenAt`; the detail page then reported a
  *paused* countdown (87 days, not the 80 it would have drained to). After the freeze was backdated
  seven days (the harness's only write, standing in for elapsed time), unfreeze returned the row to
  `ACTIVE`, cleared `frozenAt`, recorded `totalFrozenDays = 7`, and pushed `endDate` out by exactly
  seven days — with the original term still reconstructible as `endDate - totalFrozenDays`, and the
  UI stating the new end date. On a `CANCELLED` term the UI offers no Renew/Freeze/Cancel button,
  and firing all four illegal transitions anyway through the app's own axios instance returned
  409 `INVALID_MEMBERSHIP_TRANSITION` each time (renew, freeze, re-cancel, and unfreeze-something-
  never-frozen), with the row unchanged after all four.
- [x] A membership whose `endDate` has passed displays as EXPIRED on read, without a cron job —
  a term that ended a month ago was forced back to `ACTIVE` with direct SQL, then left alone for
  five seconds: still `ACTIVE`, because nothing is scheduled to touch it. Loading its detail page
  flipped it to `EXPIRED` and persisted that, one read being enough. It was then absent from
  `?status=ACTIVE`, present in `?status=EXPIRED`, and still offered Renew (`EXPIRED` is a legal
  renewal source per 1.15.3).

**Also verified beyond the stated DoD:**
- Mid-term plan change (1.15.4): the confirmation names the exact cost — *"90 unused days will be
  forfeited — no refund or credit"* — and on confirm the old row went `CANCELLED` while the new one
  started **today** (not at the old term's end) with the new plan's snapshot and its own chain link.
- RBAC per Section 4.2 with a real `reception@demo-gym.test` session: reads the plan catalog but is
  offered no add/edit/retire control, and a forced plan create returns 403 `PERMISSION_DENIED`;
  sells a membership that lands in the database with the right snapshot; is offered **Renew** but
  not Freeze, Cancel or Change plan. Forcing freeze, cancel and change-plan through the app's own
  axios instance returned 403 `PERMISSION_DENIED` three times with the row unchanged, while renew
  returned 201 and produced a new term row.
- Brand palette on the new screens as computed CSS: `rgb(0, 0, 0)` page background, `rgb(31, 31, 31)`
  table header, `rgb(201, 255, 31)` primary action and ACTIVE badge text.
- 47 new API tests (34 memberships, 13 plans) and 28 new React Testing Library tests — 163 API and
  115 admin-web tests green overall, with `pnpm -r lint` and `pnpm -r typecheck` clean.

**Deviations (see Section 9 for the decision-log entries):**
- Three columns added to `memberships`, against this phase's "no DB changes" line.
- Freeze/unfreeze and cancel are separate permissions from create/renew, and the Section 4.2
  matrix gained `membership-plans.view` / `memberships.view` / `memberships.renew`.
- Mid-term plan change is `POST /:membershipId/change-plan`, gated on two permissions at once.
- Lazy expiry writes on read (`GET` is not side-effect free).
- Term boundaries are inclusive UTC calendar dates.

**Status:** Done

### Phase 6 — Payments + Invoices
**Depends on:** Phase 5
**Goal:** Record payments against invoices, generate invoices, handle refunds without hard deletes.
**Scope:**
- API: `invoices` (create, view, list), `payments` (create, view, refund)
- Invoice numbering: per-org sequential human-readable number (e.g. `INV-2026-000123`), generated
  inside a transaction to avoid collisions
- Refund = new `Payment` row with negative/adjustment semantics + `AuditLog` entry, never edits/deletes
  the original payment
- Admin: `features/payments`, `features/invoices` — payment history, pending fees, refund action, receipts
**DB changes:** ~~none beyond Phase 1~~ — `invoices.membershipId`, `invoices.notes`,
`payments.refundOfPaymentId`, and a new `invoice_sequences` table, all required by the semantics
locked in 1.16. See the Deviations note below and Section 9.
**Definition of Done:**

Verified in a real Chrome against the real API, with every mutation read back out of MySQL with
the `mysql` client rather than the API that wrote it — `apps/admin-web/e2e/phase6-verify.ts`,
**95 checks, 0 failures**. Fixtures (an ACCOUNTANT and a branch-scoped RECEPTIONIST login, six
purpose-named members and a known plan) come from `apps/api/scripts/phase6-fixtures.ts`.

- [x] Creating a membership generates an invoice with correct amountTotal/Paid/Pending — selling
  `P6 Gold` through the real sell-membership form wrote an invoice in the same transaction:
  `amountTotal = 1000.00` (the membership's *snapshot* price, not the plan's current one),
  `amountPaid = 0.00`, `amountPending = 1000.00`, `status = UNPAID` (never `DRAFT`),
  `membershipId` pointing at the term it bills, notes reading `Membership — P6 Gold`, and an
  invoice number matching `INV-YYYY-NNNNNN`.
- [x] Partial payments correctly update `amountPaid`/`amountPending` and invoice status — three
  instalments were typed into the real form against a ₹1,000 invoice. ₹300 (cash) →
  `300.00`/`700.00`/`PARTIALLY_PAID`; ₹250.50 (UPI) → `550.50`/`449.50`/`PARTIALLY_PAID`; the exact
  remainder ₹449.50 (card) → `1000.00`/`0.00`/`PAID`. MySQL held **three payment rows, not one
  edited row**, with amounts `300.00,250.50,449.50` and methods `CASH,UPI,CARD` — and the screen
  said the same thing each time ("₹700.00 still outstanding", then "settled in full"). Overpaying
  was refused with 409 `PAYMENT_EXCEEDS_INVOICE` naming the real balance, leaving `amountPaid` at
  `0.00` and **no payment row written at all**.
- [x] Refund flow never deletes a payment row; AuditLog entry created — a ₹400 partial refund
  against a ₹1,000 cash payment added **one new row** (`amount = -400.00`, `status = REFUNDED`,
  `refundOfPaymentId` → the original, same invoice, same method) while the original row was
  re-read from MySQL and found byte-identical: same `amount`, still `SUCCESS`, `refundOfPaymentId`
  still `NULL`, **even `paidAt` unchanged**. The invoice rolled back `1000.00`/`600.00`/`400.00`
  and `PAID → PARTIALLY_PAID`, with `amountTotal` untouched. The `AuditLog` row carried
  `action = REFUND`, `entityId` = the *original* payment, `actorUserId` = the signed-in accountant,
  the right `organizationId`, a `beforeJson` holding the pre-refund amount/status/`alreadyRefunded`,
  and an `afterJson` holding the refunded amount, the typed reason, and the invoice's new status
  and balance. A second refund of ₹700 was capped at the ₹600 remaining (409
  `REFUND_EXCEEDS_PAYMENT`) with no second row written.
- [x] ACCOUNTANT role can refund; RECEPTIONIST cannot (per matrix) — with a real
  `reception@demo-gym.test` session the payment history is readable (that is how the counter
  answers "how much do I owe?") but there is no Refund button and no Raise invoice button. Forcing
  both through the app's own axios instance returned 403 `PERMISSION_DENIED`, and afterwards MySQL
  showed **no refund row, no audit entry**, and the invoice still `PAID` at `800.00`. The other
  half of the matrix works too: the same receptionist recorded a ₹300 payment that settled a bill.

**Also verified beyond the stated DoD:**
- Concurrent invoice numbering (1.16.4): ten invoice creations fired simultaneously through the
  browser's own axios instance all succeeded, returned **ten distinct numbers**, and those numbers
  were **contiguous** — the locked counter left no gaps and no collisions. Every invoice number in
  the org remained unique, and the counter sat above every number issued. The same race is covered
  at the API level in `invoice.test.ts` with a ten-way `Promise.all`.
- Cancelling as the correction path: the amount billed is immutable, so a wrong bill is cancelled
  and reissued. An untouched invoice cancelled cleanly and then took no payments — the UI hid the
  button *and* the server returned 409 `INVOICE_NOT_PAYABLE`. An invoice with money against it is
  offered no cancel at all.
- Forfeiture is stated in money (1.16.1): the mid-term plan-change warning reads *"30 unused days
  will be forfeited, worth ₹1,000.00 at this term's rate — no refund or credit is issued
  automatically"*, and MySQL confirmed **no credit row was written behind the scenes**.
- The payments ledger at `/payments` showed every receipt and every refund in MySQL (6 and 1), with
  a net total matching `SUM(amount)` exactly (₹2,700.00) — refunds netted against receipts rather
  than hidden.
- A member's own page reports their balance: "Nothing outstanding" for a settled member, and
  "₹1,000.00 outstanding" for one with an unpaid term.
- Brand palette on the new screens as computed CSS: `rgb(0, 0, 0)` page background, `rgb(31, 31, 31)`
  filter bar, `rgb(201, 255, 31)` primary action, `rgb(254, 249, 245)` invoice numbers.
- 47 new API tests (invoices + payments) and 34 new React Testing Library tests — **210 API and 149
  admin-web tests green** overall, with lint and typecheck clean.

**Deviations (see Section 9 for the decision-log entries):**
- Three columns and a table added, against this phase's "no DB changes" line.
- The Section 4.2 matrix gained `invoices.view`/`invoices.manage` for MANAGER,
  `payments.view`/`invoices.view` for RECEPTIONIST, and `members.view` for ACCOUNTANT.
- Cancelling an invoice zeroes `amountPending`, so a voided bill leaves the pending-fees list.
- Selling, renewing or changing a plan raises the invoice inside the membership's own transaction.

**Status:** Done

### Phase 7 — Attendance (manual)
**Depends on:** Phase 4
**Goal:** Front-desk can mark attendance manually; QR check-in deferred.
**Scope:**
- API: `attendance` mark/list (by member, by date range, by branch)
- Admin: `features/attendance` — manual check-in search + button, daily attendance list
**DB changes:** four columns on `attendances`, one on `organizations`, one new enum — see the
Section 9 entry. The original "none beyond Phase 1" did not survive Locked Decision 1.17.
**Definition of Done:**

Verified in a real Chrome against the real API, with every check-in read back out of MySQL with
the `mysql` client rather than the API that wrote it — `apps/admin-web/e2e/phase7-verify.ts`,
**88 checks, 0 failures**. Fixtures (a branch-scoped RECEPTIONIST and TRAINER login, a second
branch, and eight members covering every membership state) come from
`apps/api/scripts/phase7-fixtures.ts`.

- [x] Marking attendance for a member with an active membership works — a real check-in through
  the search-and-press panel produced a row whose `membershipId` is the covering term's id,
  `overrideReason` NULL, `branchId` the desk's branch and `markedByUserId` the receptionist's own
  id. The panel confirmed it with the arrival time in the gym's timezone.
- [x] Marking attendance for a member with no active membership is a **recorded override, not a
  block** (1.17.1) — and the behaviour the original spec left open is now decided. All five
  uncovered states were exercised end to end: expired, frozen, cancelled, not-yet-started and no
  membership at all. Each was refused first with 409 `MEMBERSHIP_NOT_ACTIVE` and a message naming
  the specific problem, wrote nothing, and was recorded only after the confirm — landing in MySQL
  with the matching `overrideReason`, a NULL `membershipId`, and the staff member who allowed it.
  Backing out of the prompt left no row. The stale `ACTIVE` row behind the expired case was never
  rewritten: attendance reads memberships, it does not retire them.
- [x] Duplicate check-ins are a no-op (1.17.2) — a second press returned the original row with
  "already checked in today at 1:17 pm", no error, and MySQL still held one row with its original
  `checkedInAt`. Three *simultaneous* check-ins through the app's own axios instance produced
  201/409/409 and exactly one row, so the unique index is what decides it rather than a
  check-then-insert that both transactions would pass.
- [x] Attendance list filterable by branch/date — the register's row count matched the database's
  for the day, the headcount banner moved with it, overrides-only filtered five from seven, an
  empty day says so, and every filter is in the URL so a day can be shared and survives paging.
- [x] Branch scoping is the branch the check-in happened at (1.17.3) — a member registered at
  `P7 Bandra` checked in at Main Branch produced a row stamped Main Branch, demonstrably different
  from their home branch. An org-wide caller who named no branch was refused with `BRANCH_REQUIRED`
  rather than having one guessed.
- [x] RBAC per the Section 4.2 matrix — a real TRAINER session read the register but got no
  check-in panel and no search box; forcing a check-in through the app's own axios instance
  returned 403 `PERMISSION_DENIED` and wrote nothing. A real RECEPTIONIST marked, overrode and read.
  An ACCOUNTANT got the not-for-your-role screen and no sidebar entry.
- [x] Brand palette applied — computed styles, not class names: page background `rgb(0, 0, 0)`,
  panel and filter bar `rgb(31, 31, 31)`, check-in button and "Covered" badge `rgb(201, 255, 31)`,
  filter text `rgb(254, 249, 245)`. Override badges are deliberately amber, the one place the
  screen departs from the palette so an exception cannot be mistaken for a normal visit.

Also covered by 34 API tests (`attendance.test.ts`) and 13 component tests
(`AttendancePage.test.tsx`). Whole suite: 244 API, 162 admin-web, lint and typecheck clean.

**Deviations (see Section 9 for the decision-log entries):**
- Six schema additions, against this phase's original "no DB changes" line.
- `organizations.timezone` exists now; the attendance day is org-local, not UTC.
- The Section 4.2 matrix gained `attendance.view` for RECEPTIONIST.
- Attendance deliberately does **not** run the Locked Decision 1.8 expiry sweep.
- The shared `useUrlListParams` hook gained extra-key support and stopped wiping unknown params.

**Status:** Done

### Phase 8 — Dashboard (real data)
**Depends on:** Phases 5, 6, 7
**Goal:** Replace placeholder dashboard with real revenue/members/attendance/pending-payments/expiring-memberships widgets.
**Scope:**
- API: `reports` module — aggregate queries backing each widget
- Admin: `features/dashboard` with Recharts visualizations
**DB changes:** `branchId` on `invoices` and `payments`, plus four dashboard indexes — see the
Section 9 entry. The original "none beyond Phase 1" did not survive Locked Decision 1.18.2.
**Definition of Done:**

Verified in a real Chrome against the real API, with every widget number read off the rendered
page and the equivalent aggregate run against MySQL with the `mysql` client — a different driver
from the Prisma client that served the API. `apps/admin-web/e2e/phase8-verify.ts`, **55 checks,
0 failures**. Fixtures (a second branch, members covering every headcount case, a collected
payment, a refund, a failed payment, an unpaid invoice, a cancelled invoice, a 7-day expiry and a
frozen term whose stored `endDate` also falls inside the window) come from
`apps/api/scripts/phase8-fixtures.ts`.

- [x] All five widgets match hand-written SQL, org-wide — OWNER on "All branches": members on the
  books 35 (12 with cover today), cash collected this gym-local month ₹6,777.00, outstanding
  ₹2,795.00 across 14 open invoices, 1 term expiring in 7 days (Sia Soon), 9 check-ins today. Each
  number was the same as `COUNT`/`SUM` against MySQL, not as the API that wrote the page.
- [x] Branch scoping is real, not a filter that "mostly" works — OWNER switching the topbar to
  Main Branch vs P8 Andheri produced two dashboards that disagree (33 members / ₹6,000.00 vs
  1 member / ₹777.00) and each still matched its own SQL. Andheri's ₹777 is the payment stamped
  at that branch, not derived from the member. A branch-scoped RECEPTIONIST is pinned: no picker,
  Main Branch numbers only, and a smuggled `branchId` is 403 `BRANCH_MISMATCH` at the API.
- [x] Transfer does not rewrite history (1.18.2) — moving Mehul Mover from Main to Andheri with a
  direct `UPDATE` dropped Main's headcount 33→32 and raised Andheri's 1→2, while Main's revenue
  stayed ₹6,000.00. Outstanding follows the member the other way, which is the other half of the
  same decision and is covered by the API suite.
- [x] Cancelled invoices and failed payments stay out — the cancelled fixture has
  `amountPending = 0` so it cannot land in outstanding, and a `FAILED` ₹50 row exists so the
  revenue deny-list is being tested rather than vacuously true. Refunds net automatically because
  they are negative payment rows.
- [x] RBAC degrades per widget (1.18.6), not behind one `reports.view` gate — a real TRAINER
  session sees members and today's attendance and nothing about money; a real RECEPTIONIST sees
  members, outstanding, expiring and the register, and no revenue; a real ACCOUNTANT sees the
  money and the people it attaches to, and not the register. Unpermitted widgets are absent from
  the JSON, not sent-and-hidden.
- [x] Brand palette as computed CSS — page background `rgb(0, 0, 0)`, heading `rgb(254, 249, 245)`,
  metric values `rgb(201, 255, 31)`. The revenue chart paints with the same green.

Also covered by 14 API tests (`report.test.ts`), month-boundary unit tests in `dates.test.ts`
(including the 02:00 IST-on-the-1st case UTC would file under the previous month, and a DST month
in `America/New_York`), and 7 component tests (`DashboardPage.test.tsx`). Whole suite: 270 API,
169 admin-web, lint and typecheck clean.

**Deviations (see Section 9 for the decision-log entries):**
- `branchId` on `invoices` and `payments`, against this phase's original "no DB changes" line.
- Lists still scope through the member; aggregates use the stamped column. Two different answers
  on purpose.
- The dashboard endpoint has no `requirePermission`; widgets the caller cannot see are omitted.
- Reports never write, including never running the 1.8 expiry sweep.
- Two clocks in one response: gym-local month for money, UTC day for membership terms.

**Status:** Done

### Phase 9 — Trainers
**Depends on:** Phase 8
**Goal:** Trainer profiles, assignment to members/classes.
**Scope:** `TrainerProfile` table (Section 5) migrated; API + Admin `features/trainers`.
**DB changes:** add `TrainerProfile`
**Definition of Done:**
- [x] Existing User with TRAINER role can have a TrainerProfile created/edited — eligibility is
  permission-based (`attendance.view` without `trainers.manage`), not `role.name === "TRAINER"`.
  Creating through the form for `coach@demo-gym.test` wrote a `trainer_profiles` row with
  specialization `Yoga` and `commissionPct = 8.00` (`DECIMAL(5,2)`). Editing the demo trainer
  changed specialization to `Hypertrophy` in MySQL and left the user row untouched. Assigning
  Zoya Outsider inserted a `trainer_assignments` row; unassigning deleted it.
- [x] Trainer's own attendance/schedule view respects `attendance.view` (own-only) restriction —
  enforced as a service-layer query filter (`resolveOwnRoster` in `own-roster.ts`), not by the
  RBAC middleware. A real TRAINER session shows Kiran Assigned and, while assigned, Zoya
  Outsider; a hand-written SQL join on `trainer_assignments` returns the same two names. After
  unassign, Zoya's already-recorded check-in drops from the trainer's register and member list
  but stays on the receptionist's. A trainer with a profile and no assignments sees the empty
  set, not the gym. GET by id outside the roster is 404. RECEPTIONIST / TRAINER / ACCOUNTANT
  GET `/trainers` is 403 `PERMISSION_DENIED`.
**Status:** Done

Verified 2026-09-08 against live Chrome + the `mysql` client (47 harness checks, 0 failed), plus
16 API tests (`trainer.test.ts`) covering create/duplicate/ineligible-owner/candidates, edit,
idempotent assign, archived 404, unassign, own-roster (trainer vs receptionist vs accountant vs
empty), dashboard count, RBAC and cross-tenant, and 5 component tests
(`TrainersListPage.test.tsx`, `TrainerDetailPage.test.tsx`) plus own-roster copy on
`MembersListPage` / `AttendancePage`. Whole suite: 286 API, 174 admin-web.

**Deviations (see Section 9 for the decision-log entries):**
- `TrainerAssignment` table in addition to `TrainerProfile`.
- `organizationId` and `updatedAt` on the profile, against the Section 5 sketch.
- `GET /trainers/candidates` so a manager can pick a user without holding `users.manage`.
- No `trainers.view` key — a trainer's roster is the already-filtered members list.
- Classes deferred; "own sessions" means currently assigned members (1.19.4).
- Own-roster also filters the dashboard members and attendance widgets, and outstanding/expiring
  if those keys are ever held together with the discriminator.

### Phase 10 — Leads / CRM
**Depends on:** Phase 8
**Goal:** Track prospective members through a simple pipeline; convert to Member.
**Scope:** `Lead` table (Section 5) migrated; API + Admin `features/leads`.
**DB changes:** add `Lead`
**Definition of Done:**
- [x] Lead CRUD works with status pipeline (NEW → CONTACTED → TRIAL_SCHEDULED → CONVERTED/LOST)
- [x] Converting a lead creates a Member and links `convertedMemberId`
**Status:** Done

Verified 2026-09-08 against live Chrome + the `mysql` client (42 harness checks, 0 failed), plus
14 API tests (`lead.test.ts`) covering create/open-phone uniqueness, skip-forward, illegal
backward 409, LOST→CONTACTED recovery, convert-from-NEW, convert-from-LOST 409, convert duplicate
member phone 409, converted lead PATCH 409, second convert 409, converted-phone reopen, branch
404, RBAC and cross-tenant, and 5 component tests (`LeadsListPage.test.tsx`,
`LeadDetailPage.test.tsx`). Whole suite: 300 API, 179 admin-web.

A backward `PATCH TRIAL_SCHEDULED → CONTACTED` is 409 `INVALID_LEAD_TRANSITION` and the MySQL
status is unchanged. Convert through the form inserted `members.firstName = Zoya`,
`lastName = Convert`, `phone = +919222200009`, stamped `leads.convertedMemberId`, and a second
convert / a PATCH on that row are both 409 `LEAD_CONVERTED`. RECEPTIONIST GET `/leads` is 200;
TRAINER and ACCOUNTANT are 403 `PERMISSION_DENIED`.

**Deviations (see Section 9 for the decision-log entries):**
- Locked Decision numbered **1.20**, not 1.19 — 1.19 is the trainer roster.
- `LeadStatus` enum and an enforced transition graph, against the Section 5 `status String`.
- `convertedMemberId` unique. No `@@unique` on phone (1.20.4).
- `GET /leads/assignees` so a manager can assign without holding `users.manage`.
- Conversion gated on `leads.manage` alone, not also `members.create`.
- `COLLATE utf8mb4_bin` on every new `CHAR(26)`, same errno 3780 trap as prior phases.

### Phase 11 — Expenses + Reports
**Depends on:** Phase 8
**Goal:** Track operational costs; extend reports with profit/loss-style views.
**Scope:** `Expense` table (Section 5) migrated; API + Admin `features/expenses`, extended `features/reports`.
**DB changes:** add `Expense`
**Definition of Done:**
- [x] Expense CRUD works, scoped by branch where applicable
- [x] Reports show revenue vs. expenses for a date range
**Status:** Done

Verified 2026-09-08 against live Chrome + the `mysql` client (36 harness checks, 0 failed), plus
9 API tests (`expense.test.ts`) covering create (fixed-2, org-level null branch, zero/unknown
category 400), live-book PATCH/DELETE, 404, RBAC (ACCOUNTANT/OWNER/ADMIN 200; MANAGER/
RECEPTIONIST/TRAINER 403), an isolated-tenant P&L that equals 2000 − 900 = 1100 org-wide and
hides SOFTWARE from the branch figure, manager-can-read-P&L, and a 24-month/backwards window
400, plus 3 component tests (`ExpensesListPage.test.tsx`, `ProfitLossPage.test.tsx`). Whole
suite: 312 API, 182 admin-web.

Creating `P11 New Fan` through the form inserted `expenses.amount = 2500.00`, `category =
EQUIPMENT` on the main branch; editing rewrote the same id to `2750.50`; hard-delete removed
the row from MySQL. Org-wide P&L expenses `12450.50` and net `−12450.50` matched
`SUM(expenses.amount)` for gym-local September (revenue `0.00` matched `SUM(payments.amount)`
the same way — this gym_dev had no collected payments in the current local month). Filtering
the P&L to Main Branch dropped SOFTWARE and Andheri's UTILITIES; the remaining `10750.50`
matched SQL restricted to `expenses.branchId = Main`. ACCOUNTANT and OWNER GET `/expenses` is
200; MANAGER GET `/reports/profit-loss` is 200 and GET `/expenses` is 403
`PERMISSION_DENIED`; RECEPTIONIST and TRAINER are 403 on both.

**Deviations (see Section 9 for the decision-log entries):**
- Locked Decision numbered **1.21**.
- `ExpenseCategory` enum against the Section 5 `category String`.
- `updatedAt`; no `deletedAt` — live book, not append-only payments (1.21.3).
- `expenseDate` is a civil `DATE`, not a DateTime instant (1.21.4).
- `GET /reports/profit-loss` is the date-range report; gated on `reports.view`, not
  `expenses.manage`.
- `COLLATE utf8mb4_bin` on every new `CHAR(26)`, same errno 3780 trap as prior phases.

### Phase 12 — Notifications + Automation (Redis/BullMQ introduced here)
**Depends on:** Phase 11
**Goal:** Proactive expiry/payment-due notifications — the first real background-job use case.
**Scope:**
- `NotificationTemplate`/`NotificationLog` tables (Section 5) migrated
- Redis + BullMQ introduced now (not before): a nightly job scans for expiring memberships/pending
  payments and queues notification jobs
- `services/notification/` and `services/queue/` added to `apps/api/src`
- Admin `features/notifications` shows log/history (log-only sender; no SMS/email/WhatsApp)
**DB changes:** add `NotificationTemplate`, `NotificationLog`
**Definition of Done:**
- [x] BullMQ worker processes a queued notification job end-to-end (log-only sender is fine initially)
- [x] Nightly job correctly identifies memberships expiring in N days
- [x] Admin: `features/notifications` shows notification log/history
**Status:** Done

Verified 2026-09-08 against live Chrome + the `mysql` client (23 harness checks, 0 failed), plus
4 API tests (`notification.test.ts`) covering RBAC (OWNER/ADMIN 200; MANAGER/RECEPTIONIST/
TRAINER/ACCOUNTANT 403 on GET `/logs` and POST `/run`), gym-local 21:00 IST selecting an IST org
and not a Honolulu org at the same UTC instant, a real BullMQ worker marking two queued jobs
`SENT` (expiring ACTIVE membership + unpaid invoice; FROZEN inside the window and a +20-day term
and a cancelled invoice excluded), a second scan on the same local day skipped=2 with still two
rows, and a throwing sender marking `FAILED` after three attempts with `lastError` set, plus 1
component test (`NotificationsPage.test.tsx`). Whole suite: 317 API, 183 admin-web.

Clicking **Run nightly scan** on `/notifications` queued two jobs; the worker wrote both log
rows to `SENT` with the rendered SMS body in MySQL (`MEMBERSHIP_EXPIRING` for Expiry Soon,
`PAYMENT_DUE` for Owing Balance). Frozen Hold and Far Away were absent. Running the scan again
the same gym-local day reported skipped and left the log at two rows. OWNER GET
`/notifications/logs` is 200; MANAGER, RECEPTIONIST, TRAINER and ACCOUNTANT are 403
`PERMISSION_DENIED` and do not see the nav item.

**Deviations (see Section 9 for the decision-log entries):**
- Locked Decision numbered **1.22**.
- `NotificationEvent` / `NotificationChannel` / `NotificationLogStatus` /
  `NotificationEntityType` enums against the Section 5 `String`s.
- Unique `(organizationId, event, entityId, channel, localDate)` as the idempotency lock
  (mapped `notification_logs_idempotency_key` — MySQL's 64-char identifier limit).
- Rendered `body`, `lastError`, `updatedAt` on the log; `updatedAt` on the template.
- `POST /notifications/run` (202) skips the 21:00 hour check so operators and the harness
  are not waiting until evening; the tick still uses gym-local hour 21.
- Nightly is a 15-minute tick that asks each ACTIVE org "is it 21:00 in *your* zone?", not
  UTC midnight and not one fire-and-forget for the whole fleet.
- Send jobs: `attempts: 3`, exponential backoff from 10s — not BullMQ's defaults.
- Log-only sender; password-reset email is **not** moved onto this queue.
- Login rate limiter stays in-process; Redis arriving here does not silently migrate every
  earlier "when Redis exists" comment.
- `COLLATE utf8mb4_bin` on every new `CHAR(26)`, same errno 3780 trap as prior phases.
- Redis: docker-compose service plus `apps/api/scripts/dev-redis-sandbox.sh` (unpacks the
  Ubuntu .deb + liblzf/jemalloc under `/tmp`) and a CI Redis service on 6379.

### Phase 13 — Member Flutter app (Web/Chrome first)
**Also called:** Flutter Member Web.
**Depends on:** Phase 12 (API considered stable — in practice, could start once Phases 4-7 are solid;
revisit this dependency once Admin is far enough along)
**Goal:** Thin Flutter client: login, home, membership, attendance, payments, profile.
**Scope:**
- Flutter project scaffolded in `apps/member-app`
- Riverpod, Dio, GoRouter, Freezed + json_serializable per spec
- Hand-synced Dart models against the API (OpenAPI still deferred per spec)
- `flutter_secure_storage` for refresh token
**DB changes:** none (read-only consumer of existing API)
**Definition of Done:**
- [x] Member can log in and see their own membership/attendance/payment history on Web/Chrome
- [x] No business logic duplicated in Flutter (all computed values come from the API)
**Status:** Done

Verified 2026-09-08 against live Chrome (`http://127.0.0.1:8080`) + the `mysql` client + the
live API. Flutter **3.44.9** / Dart **3.12.2**; `flutter doctor` clean for Flutter + Chrome
(Android SDK present; Linux desktop missing clang/cmake/ninja — unused; no iOS toolchain on
this host). A bare `flutter create` scaffold built (`flutter build web --release`) and served
on Chrome **before** any feature screens. Widget test: login heading. `flutter analyze`: 0
errors.

Alice Portal (`+919111100001`) signed in through the Flutter form (phone + password +
`demo-gym`). Home showed **Hello Alice Portal**, **P13 Portal Gold · ACTIVE**, **11 day(s)
remaining · ends 2026-09-18**, **Outstanding ₹1500.00** — matching MySQL
(`memberships.status = ACTIVE`, `invoices.amountPending = 1500.00` on the PARTIALLY_PAID
row). Membership listed the same term at `₹2000.00`. Attendance: one **2026-09-08 Covered
visit**. Payments: **₹500.00 · UPI SUCCESS** only — Bob Other's `₹111.00` payment and
`₹9999.00` outstanding were absent. Profile: Alice Portal / `+919111100001` / Demo Gym /
Main Branch. A full reload restored Alice via `POST /auth/member/refresh` (200 from origin
`http://127.0.0.1:8080`) then `GET /auth/member/me` — not bounced to Sign in. The
puppeteer harness (`pnpm e2e:member`) is best-effort: headless Chrome often does
not paint CanvasKit, so `document.body.innerText` stays empty. The headed Chrome
session is the UI proof; API/SQL self-scope was also confirmed with curl + mysql.
Staff JWT on
`GET /me` is 401; Alice's member JWT on staff `GET /members` is 401. Replay of a spent
refresh token is 401. `passwordHash` is not on any member JSON.

**Deviations (see Section 9 for the decision-log entries):**
- Locked Decision numbered **1.23**. The original "DB changes: none" did not survive "a
  member can log in."
- `members.passwordHash` (nullable) + `member_refresh_tokens` (own family/reuse table).
  Staff `refresh_tokens.userId` stays NOT NULL.
- Member JWT `type: member_access` (`memberId`, `organizationId`). Routes:
  `POST /auth/member/login|refresh|logout`, `GET /auth/member/me`, `GET /me/*`.
- Member login/refresh return `refreshToken` in JSON. Staff login stays cookie-only.
- `CORS_ORIGIN` is a comma-separated allowlist; `localhost` and `127.0.0.1` are both listed
  for `:5173` and `:8080`.
- `pnpm-workspace.yaml` is explicit (`apps/api`, `apps/admin-web`, `packages/*`) so Flutter
  is not a JS workspace package.
- Freezed pinned to **2.5.7** / `freezed_annotation` 2.4.4 — not the 4.0-dev line.
- `flutter_secure_storage` on web encrypts into `localStorage`. Not httpOnly. Stated in
  1.23.4.
- Login fields are `ExcludeSemantics` on web so the CanvasKit a11y `<input>` overlay cannot
  wipe the Dart controllers. Demo Alice credentials are pre-filled on the form.
- `MaterialApp.router` stays mounted during session restore. A splash-only
  `MaterialApp(home: …)` has no `/login` route; Flutter Web then throws
  "Could not navigate to initial route" when the URL is `/#/login`.
- Member login rate limiter is in-process (phone-keyed), same store as Phase 2. Redis is
  not a license to rewrite auth.
- `COLLATE utf8mb4_bin` on every new `CHAR(26)`, same errno 3780 trap as prior phases.

### Phase 14 — Android / iOS packaging and runtime verification
**Depends on:** Phase 13
**Goal:** Ship installable native builds and prove the member app runs on a real device.
**Scope:** Android toolchain + signed APK/AAB + physical-device runtime; iOS project exists but
cannot be verified on this Linux host. No new member features. No UI polish.
**DB changes:** none
**Definition of Done (original boxes — still the phase gate; neither is fully true):**
- [ ] Signed Android build installs and runs **against production API**
- [ ] iOS build runs on a real device or TestFlight

**Android verification checklist (LAN ≠ production):**
- [x] Android build / toolchain (Flutter 3.44.9, Android SDK 36.1.0, compileSdk 37)
- [x] Signed fat **APK** (`apksigner` v2, CN=Vedafit local upload)
- [x] Signed **AAB** artifact exists (`app-release.aab`, ~48 MB, 2026-09-09 14:29) — Play pipeline
  proof, not a store upload
- [x] Android runtime on a **physical phone** (emulator abandoned)
- [x] Member authentication (Alice Portal, `+919111100001` / `demo-gym`)
- [x] Secure storage / session restore after **force-stop** (Keystore) — **PASS**
  on a real Android device: user did not sign out; Vedafit was force-stopped and
  reopened; Alice's session restored to Home (no login screen). Does **not**
  prove production API, HTTPS, iOS, or TestFlight.
- [x] API connectivity over LAN (`http://10.45.182.169:4000/api/v1`) — **not production**
- [x] Membership screen (live data, MySQL-matched)
- [x] Attendance screen (live data, MySQL-matched)
- [x] Payments screen (live data, MySQL-matched; Bob's ₹111 absent)
- [x] Home / Profile regression on device
- [x] Web: Phase 13 headed-Chrome proof still stands; `flutter build web --release` was produced
  during packaging. Headed Chrome was **not** re-run on 2026-09-09.

**iOS checklist:**
- [x] `apps/member-app/ios/` inspected (Flutter `create` tree: `Runner.xcodeproj`, default
  bundle display name "Member App")
- [ ] Real device or TestFlight — **blocked** (`flutter build ios` is not a subcommand on Linux;
  no Xcode)

**Production:**
- [ ] No production API URL exists in this repo. No host, DNS, or HTTPS deployment. Do not treat
  `10.45.182.169` or `192.168.1.19` as production.

**Status:** In progress — **not Done.**

Verified 2026-09-09 on this Linux host (Flutter 3.44.9 / Dart 3.12.2, Android
SDK 36.1.0 + platform 37):

- `flutter analyze`: 0 errors. `flutter test`: 2 passed (login heading + debug
  API URL default).
- Gradle: Cursor injects `GRADLE_USER_HOME=/tmp/cursor-sandbox-cache/…`, which
  re-downloads the distribution. `apps/member-app/tool/with-host-gradle.sh`
  forces `$HOME/.gradle`. Rebuild of the fat release APK completed in **~98s**
  then **~62s** with no Gradle zip re-download.
- Signed **fat** release APK (arm/arm64/x64) for **physical-device sideload**.
  First bake used `192.168.1.19`; that APK timed out on the phone after DHCP
  moved this laptop to **`10.45.182.169`**. Current build:
  ```
  ./tool/with-host-gradle.sh build apk --release \
    --dart-define=API_URL=http://10.45.182.169:4000/api/v1
  ```
  → `build/app/outputs/flutter-apk/app-release.apk` (51.5 MB / 50M on disk).
  `apksigner` v2, signer CN=Vedafit local upload. Copy:
  `outputs/vedafit-member-lan-10.45.182.169-release.apk`.
  `/mnt/user-data/outputs` could not be created (root-owned `/mnt`, sudo
  needs a password) — use the repo `outputs/` path.
- API explicitly binds `0.0.0.0:4000`. `curl http://10.45.182.169:4000/api/v1/health`
  is 200 from this machine. **LAN IP is not a production API.** Architecture of the
  test: phone and laptop on the same Wi‑Fi; Flutter → HTTP → `10.45.182.169:4000` →
  Express → MySQL. Future production is Flutter → HTTPS → a public hostname. That
  hostname is **not invented here**.
- Pixel_6 AVD abandoned: unresponsive `adb` and too heavy next to MySQL/Redis/
  API/Cursor.
- Physical phone (WhatsApp sideload), Alice Portal, screenshots 2026-09-09 ~20:21 IST
  matched MySQL + `GET /me/*`:
  - Home: Hello Alice Portal, Demo Gym, `P13 Portal Gold · ACTIVE`, 10 day(s)
    remaining · ends 2026-09-18, Outstanding ₹1500.00
  - Membership: `P13 Portal Gold · ACTIVE`, `2026-09-03 → 2026-09-18`, 10 day(s)
    left · ₹2000.00
  - Attendance: `2026-09-08` Covered visit
  - Payments: `₹500.00 · UPI` SUCCESS (ISO timestamp `2026-09-08T17:44:44.588Z`).
    Not Bob's ₹111.00 CASH / ₹9999 outstanding.
  - Profile: Alice Portal, `+919111100001`, Demo Gym, Main Branch
- Force-stop → reopen (Keystore session restore): **PASS**, reported 2026-09-09.
  User did not tap Sign out. Vedafit was force-stopped on a real Android phone
  and reopened; existing Alice session restored and Home opened without the
  login screen. This is device Keystore persistence, not production API or iOS.
- UI polish is explicitly deferred (not this phase).
- `flutter build ios` is not a subcommand on Linux.

**Deviations (see Section 9):**
- `compileSdk = 37` (`flutter_secure_storage` 11).
- Debug Android API default is `10.0.2.2`, not `localhost`.
- Release requires `--dart-define=API_URL`.
- Signing via gitignored `android/key.properties`; example file committed.
- Cleartext HTTP is permitted on the **release** APK so a LAN `http://`
  sideload can connect (Android 9+). That is **not** production HTTPS and is
  not a substitute for a deployed API.
- DoD is split in the checklist above: LAN install/run is evidenced; "against
  production API" and iOS stay **unchecked**. Phase 14 stays In progress.

### Phase 15 — Super Admin / SaaS layer
**Depends on:** Phase 14 (or earlier, if prioritized sooner — it's additive, not blocking).
Additive means it does not *require* iOS or a production API. It does **not** mean later
slices start automatically.
**Goal:** Organizations become self-serve: subscriptions, billing, feature flags, real onboarding.
**Scope (planned — see Locked Decision 1.24):**
- Third auth audience: platform operators (`platform_access` JWT), not a gym `User` and not a `Member`
- Atomic org provisioning: Organization + default Branch + role matrix + OWNER `User` +
  notification templates + subscription stub
- Public gym signup + Super Admin provision; OWNER then uses existing `POST /auth/login`
- SaaS plan catalog + `OrganizationSubscription`; entitlements as write-time limits
- Manual / log-only billing first (no PSP in slice 1)
- Super-admin surface (new origin, not gym admin-web)
- Audit of platform mutations
- Tenant isolation unchanged (JWT `organizationId`)
**DB changes:** 15.1 `platform_users` + `platform_refresh_tokens`. 15.5 added `saas_plans`,
`saas_plan_entitlements`, `organization_subscriptions`. Write-time entitlement checks are **15.6 Done**.
**Definition of Done (planned; identity + provisioning + signup + catalog are in; the rest stay open):**
- [x] Platform operator can sign in; staff and member JWTs cannot call platform routes (15.1)
- [x] A new gym can be created via public signup atomically with an OWNER who logs in
      through Phase 2 staff auth (15.4). Super Admin create is 15.8.
- [x] Demo-gym seed remains valid (15.3); a second provisioned/signup org cannot read another
      org (`ORG_MISMATCH`)
- [x] Plan entitlements reject over-limit writes (15.6)
- [x] Super Admin can list orgs, suspend/restore (`OrganizationStatus`), assign a plan
      (API: 15.7–15.8; Super Admin UI: 15.9 Done)
- [x] No Stripe/PSP required for the first Done of this phase
**Status:** **Done** (2026-09-14). Slices **15.1–15.13** implemented; Section **10.20** checked.
“Later” items (PSP, OpenAPI, iOS, production host) stay out of this DoD.
Full plan: **Section 10**.

#### Phase 15.1 — Platform identity
**Status:** Done (2026-09-09)

Separate `PlatformUser` / `platform_access` JWT / `platform_refresh` cookie. No `isSuperAdmin`
on gym `User`. No SaaS tables, no Super Admin UI, no signup.

**Tables** (`20260909153000_platform_identity_phase15_1`):
- `platform_users`: `id` CHAR(26) PK, `name`, `email` UNIQUE (utf8mb4_bin), `passwordHash`
  VARCHAR(60), `status` ACTIVE/INACTIVE, timestamps. No `organizationId`, no `deletedAt`.
- `platform_refresh_tokens`: same family/hash/revoke shape as staff and member refresh tables.
  FK `platformUserId` → `platform_users`. Raw token never stored (SHA-256 hex UNIQUE).

**JWT:** `type: platform_access`, claim `{ platformUserId }` only. Staff `authenticate` and
member `authenticateMember` reject it (`INVALID_TOKEN`). `authenticatePlatform` rejects staff
and member tokens.

**Cookie:** `platform_refresh`, httpOnly, SameSite=Lax, Path=`/api/v1/auth/platform` (not
staff `refresh_token` / Path=`/api/v1/auth`). Secure only in production. Body `refreshToken`
accepted for tests; cookie wins if both present.

**Endpoints:**
| Method | Route | Auth | Notes |
|---|---|---|---|
| POST | `/api/v1/auth/platform/login` | public, rate-limit IP+email | access JWT + cookie; dummy bcrypt on unknown email |
| POST | `/api/v1/auth/platform/refresh` | cookie or body | rotate family; reuse → `TOKEN_REUSE_DETECTED` |
| POST | `/api/v1/auth/platform/logout` | cookie or body | revoke family; idempotent |
| GET | `/api/v1/auth/platform/me` | `authenticatePlatform` | `{ user: { id, name, email, status } }` |

**Audit:** staff/member login already use **pino**, not `audit_logs` (that table requires
`organizationId` and is used for gym payments). 15.1 matches that: login success/failure,
reuse, and logout are logger events. No `platform_audit_logs` table yet (Section 10.6 still
plans it for later mutations).

**Seed:** `platform@vedafit.test` / `SEED_PLATFORM_PASSWORD` or `ChangeMe123!`.

**Tests (executed):** `platform-auth.test.ts` 17 passed. Also executed: `auth.test.ts` 35
passed, `portal.test.ts` 5 passed, `member.test.ts` 38 passed (includes tenant isolation).
`pnpm typecheck` clean. `pnpm lint` 0 errors (pre-existing unused-var warning in
`trainer.test.ts`, untouched). Flutter `flutter test` 2 passed. Admin-web
`session.store.test.ts` (7) + `api-client.test.ts` (14) passed; vitest then crashed in
tinypool teardown (unrelated worker bug). Full admin-web e2e harness was **not** re-run.
Headed Chrome / phone were **not** re-run in 15.1.

**Files:** schema + migration; `jwt.ts`; `auth.middleware.ts`; `platform-auth.service.ts`;
`auth.controller.ts` / `routes` / `schema` / `rate-limit`; `seed.ts`; `.env.example`;
`test/helpers/auth.ts`; `platform-auth.test.ts`. No new npm/pub dependencies.

**Deviations from Section 10:** none material. `platform_audit_logs` deferred (auth matches
existing staff/member logging). No Super Admin app.

**Planned implementation order:** Section 10.19. 15.2 and 15.3 are Done below.

#### Phase 15.2 — Platform permission is identity
**Status:** Done (2026-09-10) — **no extra tables and no new code.**

Section 10.2 / 10.19: every `platform_users` row is a full operator. There is no
`platform_roles` / `platform_permissions` matrix in v1. `authenticatePlatform` from 15.1 **is**
the permission check (“is a platform user”). Gym staff tokens stay 401 on platform routes;
platform tokens stay 401 on staff/member routes. Building a permission catalog here would have
been infra-before-need.

#### Phase 15.3 — Canonical organization provisioning
**Status:** Done (2026-09-10)

One application-layer workflow for creating a gym tenant. Seed, later public signup (15.4), and
later Super Admin create (15.8) must call this — not copy org bootstrap.

**Public HTTP:** none. `POST /api/v1/platform/signup` is still 404. No Super Admin UI.

**Canonical functions** (`apps/api/src/modules/organizations/organization-provisioning.service.ts`):
- `provisionOrganization(input)` — hashes the OWNER password and syncs the global permission
  catalog **outside** the tenant transaction (catalog is shared; bcrypt is slow), then
  `prisma.$transaction` for the tenant writes.
- `provisionOrganizationInTransaction(tx, input, passwordHash)` — inner write path so a later
  slice (15.5) can attach `organization_subscriptions` in the **same** transaction without
  rewriting bootstrap.

**Created atomically (Prisma `$transaction`):**
1. `organizations` (unique `slug`, status `ACTIVE`, timezone default `Asia/Kolkata`)
2. default `branches` row (`"Main Branch"` unless `branchName` is passed)
3. `syncOrganizationRoleMatrix` (six default gym roles + mappings; catalog already global)
4. OWNER `User` — gym staff row, `branchId` null, `hashPassword` / existing `User` model
5. `ensureDefaultTemplates` (existing Phase 12 SMS templates only)

**Not created (deferred by Section 10.19):** SaaS subscription, members, extra staff, gym
invoices/payments, extra branches. There is no org “settings” table in the current schema; org
fields on `Organization` are the defaults.

**OWNER rules:** not a `platform_users` row; no `isSuperAdmin`; no `platform_access` JWT. Login
is existing `POST /api/v1/auth/login` (`type: access`).

**Duplicates:** existing slug → 409 `DUPLICATE_ORGANIZATION_SLUG` (`AppError.conflict`). Does
not create a second org. Owner email uniqueness remains the existing per-org app rule (1.3);
two gyms may share an owner email.

**Rollback:** if a later step in the same `$transaction` throws, Prisma rolls back. Tests force
a throw after the inner provision and assert no org/user rows remain.

**Seed:** if `demo-gym` is missing, `prisma/seed.ts` calls `provisionOrganization` with the
existing Demo Gym / OWNER fixture values. If it already exists, seed **does not** call
provision (would 409); it refreshes catalog/matrix/templates and backfills OWNER only if
missing. Alice/Bob and other fixture members are not rewritten. Platform operator seed stays
the 15.1 path (separate table).

**Not forced through provision:** `createTestTenant` / `organizationService.create` still build
incomplete orgs for tests (no OWNER). Routing every test tenant through provision would change
user counts and mix fixture emails with OWNER rows.

**Schema / migration:** none.

**Tests (executed 2026-09-10):** `organization-provisioning.test.ts` 7 passed.
Regressions in the same vitest run: `auth.test.ts` 35, `platform-auth.test.ts` 17,
`portal.test.ts` 5, `member.test.ts` 38, `organization.test.ts` 7. **109 passed / 0 failed.**
`pnpm typecheck` clean. `pnpm lint` 0 errors (pre-existing unused-var warning in
`trainer.test.ts`, untouched). `pnpm prisma:seed` on gym_dev: Demo Gym already present →
refresh path; org id, staff emails, Alice Portal `+919111100001`, Bob Other `+919111100002`
unchanged.

**Files:** `organization-provisioning.service.ts`; `organization-provisioning.test.ts`;
`prisma/seed.ts`; `rbac-catalog.ts` and `services/notification/templates.ts` accept an optional
`TransactionClient`; comment on `organization.controller.ts`. No Flutter / admin-web / Super
Admin app changes.

**Deviations from Section 10:** 10.4 step 6 (`organization_subscriptions`) is **not** in this
slice — Section 10.19 puts it in 15.5. `provisionOrganizationInTransaction` is the extension
point. 10.4’s `SELECT … FOR UPDATE` on the org row is not used here: the org and first OWNER
are inserted in one transaction; the global uniqueness race is the slug (unique +
`DUPLICATE_ORGANIZATION_SLUG`). Staff `userService` still uses the row lock when adding later
users. Email verification still deferred. No signup route.

**Next slice:** **15.4** was implemented — see below.

#### Phase 15.4 — Public gym signup
**Status:** Done (2026-09-10)

Public, unauthenticated `POST /api/v1/platform/signup`. Reuses `provisionOrganization` (15.3).
No Super Admin UI, no Flutter/admin-web signup page, no SaaS subscription row (15.5).

**Endpoint:** public. No staff / member / platform JWT required. Not a permission bypass.

**Body** (Zod `.strict()` — extra keys like `organizationId`, `role`, `status`, `subscription`
are rejected as `VALIDATION_ERROR`):

| Field | Required | Rules |
|---|---|---|
| `name` | yes | gym name, trim, 1–255 |
| `slug` | yes | `^[a-z0-9-]+$`, 1–100, globally unique |
| `email` | yes | gym contact email |
| `phone` | no | 1–30 |
| `timezone` | no | 1–64; default `Asia/Kolkata` on the org row |
| `branchName` | no | default `"Main Branch"` |
| `owner.name` | yes | 1–255 |
| `owner.email` | yes | email, lowercased |
| `owner.password` | yes | same complexity as password reset: 8+, lower, upper, digit, max 200 |

The client cannot choose OWNER role, permissions, org status, or SaaS plan. Server creates those.

**Success:** `201` `{ success, data: { organization, branch, owner: { id, name, email } }, message }`.
No password, no hash, no access/refresh token, no `platform_refresh` cookie. Message tells the
OWNER to sign in at `POST /api/v1/auth/login`.

**Auth after signup:** existing staff login. JWT `type: access` with the new `organizationId`.
Not `platform_access`. OWNER is a gym `User`, not a `platform_users` row.

**Duplicates:** existing slug → 409 `DUPLICATE_ORGANIZATION_SLUG`. Owner email is per-org (1.3);
the same email may own two different slugs. Duplicate HTTP signup does not overwrite Demo Gym.

**Rate limit:** `express-rate-limit`, in-process memory (not Redis, not multi-instance).
- key: `signup:${req.ip}`
- window: `SIGNUP_RATE_LIMIT_WINDOW_MINUTES` (default 15)
- limit: `SIGNUP_RATE_LIMIT_MAX` (default 5)
- successful **and** failed/invalid requests count (org-spam brake)
- 429 `RATE_LIMIT_EXCEEDED`
- limiter runs before Zod
- does not change staff/member/platform login limiters

**Audit:** pino `ORG_SIGNUP` with `{ organizationId, slug, ownerEmail }` after commit. No
plaintext password. No `platform_audit_logs` table (15.11). Gym `audit_logs` not used (would
need a staff actor).

**Transaction:** signup → `provisionOrganization` → one Prisma `$transaction` (15.3). Forced
failure after the inner writes leaves no org/owner.

**Schema / migration:** none. Env defaults only (`SIGNUP_RATE_LIMIT_*`).

**Tests (executed 2026-09-10):** `platform.signup.test.ts` 14 passed (happy path, staff login
`type: access`, platform login 401, duplicate slug, shared owner email on two orgs, invalid
email/password/slug, missing fields, rejected role/status/organizationId, IP rate limit 429,
rollback, tenant `ORG_MISMATCH`, existing staff/member/platform smoke).
`organization-provisioning.test.ts` 7 passed. `env.test.ts` 6 passed.
Regressions: `auth.test.ts` 35, `platform-auth.test.ts` 17, `portal.test.ts` 5,
`member.test.ts` 38, `organization.test.ts` 7. **102 passed / 0 failed** in the regression run;
signup+provision+env **27 passed**. `pnpm typecheck` clean. `pnpm lint` 0 errors (pre-existing
`trainer.test.ts` unused-var warning).

**Files:** `modules/platform/platform.{schema,service,controller,routes,rate-limit}.ts`;
`platform.signup.test.ts`; `app.ts` mount; `config/env.ts` + `.env.example`; comment change in
`organization-provisioning.test.ts` (signup is no longer 404).

**Deviations from Section 10:** 10.4/10.7 step “trial subscription” and platform audit row are
**not** in this slice (15.5 / 15.11). Success `owner` includes `id` and `name` as well as
`email`. Password complexity matches **reset-password** (stronger than authenticated
`createUserSchema` min-8) because this endpoint is public. No auto-login (10.4).

**Next slice:** **15.5** was implemented — see below.

#### Phase 15.5 — SaaS plans, entitlements, Demo Gym backfill
**Status:** Done (2026-09-10)

Platform software catalog. **Not** gym `Payment` / `Invoice` / `Membership`. No PSP, no Super
Admin UI, no write-time `assertEntitlement` (15.6), no `platform_audit_logs` (15.11).

**Migration:** `20260910154500_saas_plans_phase15_5` (applied on gym_dev and gym_test; no reset).
CHAR(26) columns are `utf8mb4_bin`.

**Tables:**

| Table | Purpose |
|---|---|
| `saas_plans` | `id`, unique `code`, `name`, `description?`, `priceMonthly`/`priceYearly` Decimal(10,2), `currency` CHAR(3) default INR, `trialDays`, `isActive`, timestamps |
| `saas_plan_entitlements` | `id`, `planId`, `key`, `valueType` BOOLEAN\|LIMIT\|UNLIMITED, `intValue?`, `boolValue?`, unique `(planId, key)` |
| `organization_subscriptions` | one live row per org (`organizationId` UNIQUE), `planId`, `status` TRIAL\|ACTIVE\|PAST_DUE\|CANCELLED, `billingInterval` MONTHLY\|YEARLY, `priceSnapshot`, period start/end |

**Seeded plans (10.11 codes):**

| code | members.max | branches.max | staff.max | leads | trainers |
|---|---|---|---|---|---|
| `trial` | 50 | 1 | 3 | false | false |
| `starter` | 200 | 1 | 8 | true | true |
| `growth` | UNLIMITED | 5 | UNLIMITED | true | true |

Also on every plan: `reports.enabled` true, `notifications.enabled` true,
`whatsapp.enabled` false, `online_payments.enabled` false, `storage.max` 0, `monthly_sms.max` 0.
Prices are INR **stubs 0.00** (catalog columns exist; not a commercial price list).

**Provisioning:** `provisionOrganization` syncs the SaaS catalog, then attaches a subscription
in the same tenant transaction. Public signup still cannot send plan/status; default is `trial`
+ `TRIAL` + `SAAS_TRIAL_DAYS` (default 14). Seed first-time Demo Gym passes `growth` + `ACTIVE`
+ `YEARLY`.

**Demo Gym backfill:** existing `demo-gym` with no subscription gets `growth` / `ACTIVE`. Other
orgs missing a row get the same (10.18). Re-seed does not duplicate plans, entitlements, or
subscriptions and does not rewrite Alice/Bob.

**Service (read-only):** `getOrganizationSaasSnapshot(organizationId)` — caller must pass JWT /
provisioned org id. No HTTP plan/subscription APIs (15.8). Gym staff `GET /platform/plans` is
still 404.

**Tests (executed 2026-09-10):** `saas-catalog.test.ts` 6 passed. Also
`organization-provisioning.test.ts` 7, `platform.signup.test.ts` 14, `env.test.ts` 6
(**33 passed** in that run). Regressions: `auth.test.ts` 35, `platform-auth.test.ts` 17,
`portal.test.ts` 5, `member.test.ts` 38, `organization.test.ts` 7 (**102 passed**).
`pnpm typecheck` clean. `pnpm lint` 0 errors (pre-existing `trainer.test.ts` warning).
`pnpm prisma migrate deploy` applied 15.5. `pnpm prisma:seed` twice on gym_dev: Demo Gym org
id unchanged; Alice `+919111100001` / Bob `+919111100002` unchanged; memberships 6, payments 2,
attendances 4 unchanged; one `growth`/`ACTIVE` subscription (same id on second seed);
3 plans, 33 entitlements.

**Files:** `schema.prisma`; migration above; `modules/saas/saas-catalog.ts`;
`saas-entitlements.service.ts`; `saas-catalog.test.ts`; `organization-provisioning.service.ts`;
`prisma/seed.ts`; `config/env.ts` + `.env.example` (`SAAS_TRIAL_DAYS`).

**Deviations:** prices stored as 0.00 stubs (10.6 columns required; 10.11 gives no INR amounts).
No `legacy` plan — Demo Gym uses documented `growth`. No `assertEntitlement` (15.6). No
`ManualBillingProvider` (10.14 / later).

**Next slice:** **15.6** `assertEntitlement` on member/user/branch/lead writes. Do not start
without explicit approval.

#### Phase 15.6 — SaaS entitlement enforcement
**Status:** Done (2026-09-10)

Write-time `assertEntitlement` on member / staff / branch / lead creates. Reuses the 15.5 catalog
and `getOrganizationSaasSnapshot`. No billing, no Super Admin UI, no suspension (15.7), no
`/auth/me` entitlements map (15.10), no trainers/reports/whatsapp gates.

**Helper:** `assertEntitlement(organizationId, key, { delta?: number, db? })` in
`saas-entitlements.service.ts`.

1. Load the org's `organization_subscriptions` row (caller must pass JWT / provisioned org id).
2. Resolve the plan + requested entitlement.
3. Missing snapshot or missing key: fail closed (`PLAN_LIMIT_REACHED` for `*.max`, else
   `FEATURE_DISABLED`).
4. `UNLIMITED` → allow. `BOOLEAN` → require `boolValue === true`. `LIMIT` →
   `COUNT + delta` (default 1) vs `intValue`.
5. Errors are `AppError` 403. Details are `{ key }` only — no plan/subscription/Prisma ids.

**Keys enforced in this slice (10.19):**

| Key | Type | When |
|---|---|---|
| `members.max` | LIMIT / UNLIMITED | `memberService.create` and `createMemberInTransaction` (lead convert) |
| `staff.max` | LIMIT / UNLIMITED | `userService.create` |
| `branches.max` | LIMIT / UNLIMITED | `branchService.create` |
| `leads` | BOOLEAN | `leadService.create` only — no numeric lead cap |

Not enforced here: `trainers`, `reports.enabled`, `notifications.enabled`, `whatsapp.enabled`,
`online_payments.enabled`, `storage.max`, `monthly_sms.max`.

**Usage counts (server-side COUNT, never a client count):**

- `members.max`: `Member` rows with `deletedAt IS NULL` and `status != ARCHIVED`
- `staff.max`: gym `User` rows with `deletedAt IS NULL` (includes OWNER and INACTIVE). Does
  **not** count `platform_users` or `members`
- `branches.max`: all `Branch` rows for that `organizationId`

Organization id always comes from authenticated scope / JWT. Client `organizationId` /
`planId` / `subscriptionId` / entitlement values are ignored for the decision. Extra
`organizationId` in the body/URL still hits existing `403 ORG_MISMATCH`.

**Transactions / concurrency:** each create already (or now) runs inside `prisma.$transaction`
after `SELECT id FROM organizations WHERE id = ? FOR UPDATE` (same org-row lock as 1.3 phone /
email uniqueness). COUNT + insert therefore serialize per organization under InnoDB
REPEATABLE READ. This is not a SERIALIZABLE guarantee across every table; it is the same
org-row lock the write paths already used. Direct Prisma inserts (seed / some tests) bypass
the helper by design.

**HTTP:** success envelopes unchanged. Violations:

```
403 { "success": false, "error": { "code": "PLAN_LIMIT_REACHED" | "FEATURE_DISABLED", "message": "..." } }
```

**Fixtures:** `createTestTenant` attaches `growth` / `ACTIVE` (Demo Gym shape) so existing
suites are not fail-closed by a missing subscription. Public signup / `provisionOrganization`
still default to `trial` / `TRIAL`.

**Tests (executed 2026-09-10):** `saas-entitlements.test.ts` 8 passed (member/staff/branch
boundaries, leads boolean, trial limits, tenant isolation, growth-fixture member create).
Regressions: `saas-catalog.test.ts` 6, `organization-provisioning.test.ts` 7,
`platform.signup.test.ts` 14, `auth.test.ts` 35, `platform-auth.test.ts` 17, `portal.test.ts` 5,
`member.test.ts` 38, `organization.test.ts` 7, `user.test.ts` 9, `branch.test.ts` 5,
`lead.test.ts` 14. `pnpm typecheck` clean. `pnpm lint` 0 errors (pre-existing
`trainer.test.ts` warning). No new migration.

**Deviations:** no Redis cache (10.12 correctness first). Fail-closed when an org has no
subscription (test tenants now get `growth` so they are not bricked). Lead convert asserts
`members.max` via `createMemberInTransaction`; it does not re-check the `leads` boolean
(convert is not a new lead). Entitlement tests create throwaway `limit-*` plans and delete
them in `afterAll` so the 15.5 catalog uniqueness assertion stays exact.

**Next slice:** **15.7** PATCH org status; confirm staff refresh re-reads org status. Do not
start without explicit approval.

#### Phase 15.7 — Organization suspend / restore + staff refresh re-check
**Status:** Done (2026-09-10)

Platform `PATCH` of `organizations.status` and gym-auth refresh that re-reads that field.
Does **not** add org list/detail/subscription APIs (15.8), Super Admin UI (15.9),
`/auth/me` entitlements (15.10), or `platform_audit_logs` (15.11). No billing.

**Lifecycle (10.13):** two layers stay separate.

- `organizations.status`: `ACTIVE` ↔ `SUSPENDED` only
- `organization_subscriptions.status`: unchanged by this route (`TRIAL` / `ACTIVE` / `PAST_DUE` /
  `CANCELLED`)

`PAST_DUE` does **not** block login. Only `OrganizationStatus.SUSPENDED` does.

**API:** `PATCH /api/v1/platform/organizations/:organizationId/status`

- `authenticatePlatform` only. No `tenantScope`.
- URL `organizationId` is a **resource id** (10.5), not a tenant claim.
- Body (strict): `{ "status": "ACTIVE" | "SUSPENDED" }`. Extra `planId` / `subscriptionId` /
  `organizationId` → 400 `VALIDATION_ERROR`.
- Unknown org → 404 `ORGANIZATION_NOT_FOUND`.
- Staff or member JWT → 401.
- Writes `organizations.status` only via `organizationService.setStatus`. Success envelope
  unchanged (`{ success, data: organization, message }`).
- Gym OWNER `PATCH /organizations/:id` (existing `organizations.update`) is unchanged.

**Auth after suspend:**

| Audience | Login | Refresh | Existing access JWT |
|---|---|---|---|
| Staff | 403 `ACCOUNT_INACTIVE` (already in 15.1-era login) | **15.7:** 403 `ACCOUNT_INACTIVE`, family revoked | valid until TTL (~15m) — `authenticate` does not re-read org status |
| Member | 403 `ACCOUNT_INACTIVE` (already) | 403 `ACCOUNT_INACTIVE` (already) | valid until TTL |
| Platform | unaffected | unaffected | unaffected |

Staff refresh change is in `auth.service.refresh` (10.21.7). Member and platform refresh
paths were not redesigned.

**Tests (executed 2026-09-10):** `platform.organization-status.test.ts` 7 passed. Regressions:
`auth.test.ts` 35, `platform-auth.test.ts` 17, `portal.test.ts` 5, `organization.test.ts` 7,
`member.test.ts` 38, `user.test.ts` 9, `branch.test.ts` 5, `lead.test.ts` 14,
`organization-provisioning.test.ts` 7, `platform.signup.test.ts` 14, `saas-catalog.test.ts` 6,
`saas-entitlements.test.ts` 8 (**165 passed** in that run, plus the 7 new tests in a
separate file run). `pnpm typecheck` clean. `pnpm lint` 0 errors (pre-existing
`trainer.test.ts` warning).

**Files:** `platform.routes.ts`, `platform.controller.ts`, `platform.schema.ts`,
`organization.service.ts` (`setStatus`), `auth.service.ts` (refresh org check),
`platform.organization-status.test.ts`, `app.ts` (mount comment).

**No migration.** `OrganizationStatus` already existed.

**Deviations:** no Super Admin UI in this slice (15.9). `platform_audit_logs` arrived in 15.11.
**2026-09-13:** tenant `PATCH /organizations/:id` no longer accepts `status`. Gym OWNER
contact-field updates still work; suspend/restore is platform-only.

**Next slice:** **15.8** Platform org list/detail/subscription APIs + dashboard counts. Do
not start without explicit approval.

#### Phase 15.8 — Platform org list/detail/subscription APIs + dashboard
**Status:** Done (2026-09-13)

Authenticated platform fleet APIs. No Super Admin UI (15.9), no `/auth/me` entitlements
(15.10), no `platform_audit_logs` (15.11), no POST/PATCH plan catalog editor, no billing.

**Auth:** `authenticatePlatform` on every route below. No `tenantScope`. URL
`organizationId` is a resource id (10.5). Staff / member / missing JWT → 401.

**Endpoints (10.7 + 10.19 + Phase 15 “Super Admin create is 15.8”):**

| Method | Route | Notes |
|---|---|---|
| GET | `/api/v1/platform/organizations` | 1.9 `page`/`limit`/`search`/`status`/`sortBy`/`sortOrder`. `status` = `OrganizationStatus`. Each item includes `subscription: { status, planCode, currentPeriodEnd }` |
| GET | `/api/v1/platform/organizations/:organizationId` | org + OWNER `{ email }` + subscription + entitlement snapshot |
| POST | `/api/v1/platform/organizations` | same body as public signup; `provisionOrganization`; Trial; no tokens |
| PATCH | `/api/v1/platform/organizations/:organizationId/subscription` | `planId` and/or `status` (`TRIAL`\|`ACTIVE`\|`PAST_DUE`\|`CANCELLED`) and/or `currentPeriodEnd` |
| GET | `/api/v1/platform/plans` | catalog + entitlements; prices are stored INR **0.00 stubs** |
| GET | `/api/v1/platform/dashboard` | `organizationsByStatus`, `trialsEnding`, `signupsThisPeriod` |

15.7 `PATCH …/status` is unchanged.

**List response:** `{ success, data: items, pagination: { page, limit, total, totalPages } }`.
`limit` max 100 (existing helper). Search is name/slug/email. No password hashes.

**Detail:** no member/staff lists, no branches, no refresh tokens. Entitlements from
`getOrganizationSaasSnapshot`. Missing org → 404 `ORGANIZATION_NOT_FOUND`.

**Subscription PATCH:** updates `organization_subscriptions` only. Changing plan resolves
`saas_plans` by id and snapshots price from the existing `billingInterval`. Does **not**
change `organizations.status` and does not auto-suspend. Extra `organizationId` /
entitlement values → 400. Unknown plan → 404 `SAAS_PLAN_NOT_FOUND`. Missing subscription
→ 404 `ORGANIZATION_SUBSCRIPTION_NOT_FOUND`.

**Dashboard interpretation:** `trialsEnding` = TRIAL rows with `currentPeriodEnd` on or
before today+14d UTC. `signupsThisPeriod` = orgs created in the current UTC calendar month.
10.7 did not specify the windows.

**Not implemented (later slices / 10.7 leftover):** `POST/PATCH /platform/plans`,
`GET /platform/audit-logs`, Super Admin Vite app, billing.

**Tests (executed 2026-09-13):** `platform.organizations.test.ts` 7 passed.
`saas-catalog.test.ts` 6 passed (staff `GET /platform/plans` now 401 `INVALID_TOKEN` because
the route exists; audience still rejected). Regressions: `auth.test.ts` 35,
`platform-auth.test.ts` 17, `portal.test.ts` 5, `member.test.ts` 38, `user.test.ts` 9,
`branch.test.ts` 5, `lead.test.ts` 14, `organization.test.ts` 7,
`organization-provisioning.test.ts` 7, `platform.signup.test.ts` 14,
`platform.organization-status.test.ts` 7, `saas-entitlements.test.ts` 8 (**166 passed**).
`pnpm typecheck` clean. `pnpm lint` 0 errors (pre-existing `trainer.test.ts` warning).

**Files:** `platform.routes.ts`, `platform.controller.ts`, `platform.schema.ts`,
`platform.service.ts`, `platform.organizations.test.ts`, `error-codes.ts`,
`saas-catalog.test.ts` (staff 401), `app.ts` comment.

**No migration.**

**Deviations:** dashboard windows as above. `GET /platform/me` stays at
`/auth/platform/me` (15.1). Plan create/replace omitted (not in the 10.19 15.8 line).
No audit rows (15.11).

**Next slice:** **15.9** `apps/super-admin` Vite app. Do not start without explicit approval.

#### Phase 15.9 — Super Admin UI (`apps/super-admin`)
**Status:** Done (2026-09-13)

Separate Vite app on `:5174`. Login, dashboard, organization list/detail/create,
suspend/restore, assign plan, read-only SaaS catalog. No routes in `apps/admin-web`.
No 15.10 `/auth/me` entitlements, no 15.11 audit page, no plan CRUD, no billing.

**Auth / session:** platform login / refresh / logout / me only. Access token is memory-only.
Refresh uses the httpOnly `platform_refresh` cookie via `POST /auth/platform/refresh`
(`withCredentials`). No staff `/auth/login` or `/auth/refresh`. Session user is
`{ id, name, email, status }` only — no `organizationId`, no `isSuperAdmin`. URL
`organizationId` is a resource id for `GET/PATCH /platform/organizations/:id`.

**Pages:** `/login`, `/` (dashboard), `/organizations`, `/organizations/new`,
`/organizations/:organizationId`, `/plans`. No members, payments, or audit screens.

**Consumed APIs:**
`POST/GET /auth/platform/{login,refresh,logout,me}`,
`GET /platform/dashboard`,
`GET/POST /platform/organizations`,
`GET /platform/organizations/:organizationId`,
`PATCH …/status` (ACTIVE|SUSPENDED, confirmation),
`PATCH …/subscription` (`planId` / `status` / `currentPeriodEnd` only; plans from
`GET /platform/plans`),
`GET /platform/plans` (read-only).

Create body matches `platformSignupSchema`. Entitlement snapshot is display-only.

**Tests (executed 2026-09-13):** `pnpm --filter super-admin test` **46 passed**
(11 files). `pnpm --filter super-admin typecheck` clean.
`pnpm --filter super-admin lint` 0 errors / 0 warnings.

**Demo Gym (read-only, no reset):** `demo-gym` ACTIVE + `growth` / ACTIVE subscription.
Alice `+919111100001` and Bob `+919111100002` still ACTIVE.

**Files:** new `apps/super-admin/**`. Workspace: `pnpm-workspace.yaml`, root
`package.json` (`dev:super-admin`), `pnpm-lock.yaml`. CORS: `apps/api/.env.example`
(+ local `.env`) includes `http://localhost:5174` and `http://127.0.0.1:5174`.

**No migration. No API route/schema changes.**

**Deviations:**
- Tailwind is used (10.21.2: plan said no Tailwind; match admin-web, which already uses it).
- Headed Chrome pass ran **2026-09-13** (`pnpm --filter super-admin e2e`, 40 passed / 0 failed)
  against real API + MySQL: platform cookie login, org list, create, suspend/restore, assign
  plan. Demo Gym was not suspended or replanned. RTL (10.17 login + org list) still holds.
- Organization create UI is included (15.8 API; 10.8 tree listed list/detail/status/subscription).
- Audit page omitted (15.11 / `GET /platform/audit-logs` does not exist).
- Super Admin does **not** yet share admin-web `DataTable` / `SELECT_CONTROL_CLASS` / collapsible
  shell — responsive retrofit is queued, not started.

**Next slice:** **15.10** usage via COUNT; optional `/auth/me` entitlements for gym admin.
Do not start without explicit approval.

#### Phase 15.10 — Usage via COUNT + gym `/auth/me` entitlements
**Status:** Done (2026-09-13)

Gym staff `GET /api/v1/auth/me` now includes an informational SaaS snapshot. Usage remains
server-side `COUNT(*)` inside `assertEntitlement` (15.6). No `usage_counters` table. No
admin-web UI work (10.12: entitlements map is optional v1 and not required for DoD).
No `platform_audit_logs` (15.11), no billing, no plan CRUD.

**Audience:** staff JWT (`authenticate` / `type: access`) only. Snapshot is loaded with
`getOrganizationSaasSnapshot(auth.organizationId)` — JWT org id, never a body/query
`organizationId`. Missing subscription → `saas: null` (fail closed; no invented Trial/Growth).

**Existing `/auth/me` fields unchanged:** `user`, `organization`, `branches`.

**Added field:**

```
saas: null | {
  subscription: { id, status },
  plan: { id, code, name },
  entitlements: { [key]: { valueType, intValue, boolValue } }
}
```

Entitlements are a key-keyed map (10.12). Informational only — write paths still call
`assertEntitlement`. No passwordHash / refresh token. Member `GET /auth/member/me` and
platform `GET /auth/platform/me` unchanged (no `saas`).

**Tests (executed 2026-09-13):** `auth.test.ts` **38 passed** (was 35; +3 SaaS `/me` cases,
existing `/me` keys now include `saas`). Regressions: `platform-auth.test.ts` 17,
`portal.test.ts` 5, `member.test.ts` 38, `saas-entitlements.test.ts` 8,
`saas-catalog.test.ts` 6, `organization-provisioning.test.ts` 7, `organization.test.ts` 7,
`platform.signup.test.ts` 14, `platform.organization-status.test.ts` 7,
`platform.organizations.test.ts` 7, `user.test.ts` 9, `branch.test.ts` 5, `lead.test.ts` 14
(**182 passed** including the 38 auth tests). `pnpm --filter api typecheck` clean.
`pnpm --filter api lint` 0 errors (pre-existing `trainer.test.ts` warning).

**Demo Gym (read-only, no reset):** `demo-gym` ACTIVE + `growth` / ACTIVE. Alice
`+919111100001` and Bob `+919111100002` still ACTIVE. Membership rows for those members
unchanged (count 2).

**Files:** `auth.service.ts`, `saas-entitlements.service.ts` (`toGymAuthSaas`),
`auth.test.ts`.

**No migration. No admin-web / super-admin / member-app changes.**

**Deviations:** none beyond using the existing snapshot helper's plan/subscription ids in
the public map (10.12 named only “entitlements map”; subscription + plan are included so
the gym client can display current plan without a second API). Usage counts are **not**
returned on `/auth/me` — 15.10's “COUNT not a counter table” is the existing 15.6 write
path, not a new usage payload.

**Next slice:** **15.11** `platform_audit_logs` on mutations. Do not start without
explicit approval.

#### Phase 15.11 — `platform_audit_logs` on mutations
**Status:** Done (2026-09-13)

Append-only platform fleet audit table + write path. Verify column in 10.19 is **mysql row**.
No `GET /platform/audit-logs` (10.7 leftover). No Super Admin audit page. No gym
`audit_logs` writes. No billing / plan CRUD / `PLAN_ENTITLEMENTS_CHANGED` /
`PLATFORM_LOGIN_FAILED` (optional in 10.15).

**Table** (`20260913143000_platform_audit_logs_phase15_11`):
`id`, `platformUserId?`, `organizationId?`, `entityType`, `entityId`, `action`,
`beforeJson?`, `afterJson?`, `createdAt`. CHAR ids `utf8mb4_bin`. Indexes:
`(organizationId, createdAt)`, `(action, createdAt)`, `platformUserId`,
`(entityType, entityId)`. No `deletedAt`. No FKs (same as gym `audit_logs`).
`organizationId` is a **target/resource** id, not a tenant claim.

**Events written (10.15 / 10.7):**

| Action | Mutation | Actor |
|---|---|---|
| `ORG_SIGNUP` | `POST /platform/signup` | `platformUserId` null |
| `ORG_PROVISIONED` | `POST /platform/organizations` | platform JWT |
| `ORG_SUSPENDED` | `PATCH …/status` → SUSPENDED | platform JWT |
| `ORG_ACTIVATED` | `PATCH …/status` → ACTIVE | platform JWT |
| `PLAN_CHANGED` | `PATCH …/subscription` when `planId` actually changes | platform JWT |
| `SUBSCRIPTION_CHANGED` | every successful `PATCH …/subscription` | platform JWT |

Actor is `getPlatformAuth().platformUserId` only. Schemas stay `.strict()` — body
`platformUserId` / `actorId` → 400. Passwords, hashes, and tokens are not stored.
Signup/provision `afterJson` is `{ organization: { id, slug, status }, owner: { email },
subscription: { planCode, status } }`. Status diffs are `{ status }`. Subscription diffs
are plan id/code, status, period end, price snapshot.

**Atomicity:** signup/create write the row inside `provisionOrganization`'s transaction
(`afterProvision` hook). Status and subscription updates wrap the mutation + audit in
`prisma.$transaction`. Failed lookups (404) write nothing.

**Tests (executed 2026-09-13):** `platform.audit.test.ts` **6 passed**. Regressions:
`auth.test.ts` 38, `platform-auth.test.ts` 17, `portal.test.ts` 5, `member.test.ts` 38,
`saas-entitlements.test.ts` 8, `saas-catalog.test.ts` 6, `organization-provisioning.test.ts` 7,
`organization.test.ts` 7, `platform.signup.test.ts` 14, `platform.organization-status.test.ts` 7,
`platform.organizations.test.ts` 7, `user.test.ts` 9, `branch.test.ts` 5, `lead.test.ts` 14
(**188 passed** including the 6 new tests). `pnpm --filter api typecheck` clean.
`pnpm --filter api lint` 0 errors (pre-existing `trainer.test.ts` warning).

**Demo Gym (read-only, no reset):** `demo-gym` ACTIVE + `growth` / ACTIVE. Alice
`+919111100001` and Bob `+919111100002` still ACTIVE. Memberships 2, payments 2,
attendances 4 unchanged. `platform_audit_logs` exists; gym_dev has 0 rows (no live
platform mutations on that database).

**Files:** `schema.prisma`, `20260913143000_platform_audit_logs_phase15_11/migration.sql`,
`platform-audit.ts`, `platform.service.ts`, `platform.controller.ts`,
`organization-provisioning.service.ts` (`afterProvision`), `platform.audit.test.ts`.

**Deviations:** `GET /platform/audit-logs` and Super Admin audit UI omitted (10.19 15.11
is write-path / mysql row; 10.7 list endpoint stays leftover). `PLAN_ENTITLEMENTS_CHANGED`
and `PLATFORM_LOGIN_FAILED` not written (no plan editor; login failures already rate-limited).

**Next slice:** **15.12** tests listed in 10.17 + gym regression. Do not start without
explicit approval.

#### Phase 15.12 — Tests listed in 10.17 + gym regression
**Status:** Done (2026-09-13)

Verification / regression slice only. No new endpoints, models, screens, or migrations.
Verify column in 10.19 is **CI**.

**Gap fill (tests that did not already exist as a named 10.17 case):**
- `apps/api/src/modules/platform/phase15.regression.test.ts` — platform JWT on
  `GET /members` → 401; Demo Gym `owner@demo-gym.test` staff login; `afterProvision`
  throw after org insert leaves zero leftover tenant rows; Gym B via
  `POST /platform/signup` → OWNER B login → create member → Demo Gym cannot read Gym B
  (`ORG_MISMATCH`) and reverse; Alice `/me` stays Demo Gym; Bob row unchanged; SaaS
  signup does not write gym `Payment`/`Invoice`.
- `apps/super-admin/src/features/auth/LoginPage.test.tsx` — Super Admin login RTL
  (platform `/auth/platform/login` + `/auth/platform/me`; memory access token; no
  staff `/auth/login`).
- `platform.signup.test.ts` leftover checks after forced rollback (branch / role /
  subscription counts stay 0).

**Already covered (not duplicated):** `platform-auth.test.ts` (login + audience 401s),
`saas-entitlements.test.ts` (`members.max = 1` → `PLAN_LIMIT_REACHED`),
`platform.organization-status.test.ts` (suspend / refresh / restore / data kept),
`platform.organizations.test.ts` (operator lists orgs; OWNER 401),
`member.test.ts` (cross-org `ORG_MISMATCH`), `payment.test.ts` / `invoice.test.ts`.

**Tests (executed 2026-09-13):**
- API `pnpm --filter api test` — **31 files, 401 passed**
- admin-web RTL `pnpm --filter admin-web test` — **24 files, 183 passed**; typecheck
  clean; lint 0 errors after the hooks fix below
- super-admin `pnpm --filter super-admin test` — **11 files, 45 passed**; typecheck
  clean; lint 0 errors
- member-app `flutter test` — **2 passed**; `flutter analyze` — 2 pre-existing **info**
  (`prefer_initializing_formals` in `api_client.dart`). No new screens. Optional
  `ACCOUNT_INACTIVE` unit test **not** added (no mapped message exists).

**E2E:** 10.17 cross-gym flow ran as Supertest in `phase15.regression.test.ts` (CI).
**2026-09-13 headed re-run:** `phase3`–`phase7` and `phase11` passed against the post-SaaS
API. `phase8`/`9`/`10`/`12`/`13` did not finish clean that day (Section 9).
**2026-09-14 close-out:** those five were diagnosed and re-run green. None were Phase 15
regressions (Section 9, 2026-09-14). 10.20’s “existing e2e still pass” box is **checked**.

**CI:** `.github/workflows/ci.yml` already runs lint + typecheck + `pnpm --filter="./apps/*" run test`
(api, admin-web, super-admin) against MySQL 3307 + Redis. New Vitest files are picked
up automatically. No workflow change. GitHub Actions was **not** run here (no push).
Flutter is outside the pnpm workspace, so it is not in CI.

**Minimal product fix:** `MembersListPage.tsx` — `useSessionStore` after `&&` failed
`react-hooks/rules-of-hooks` (would fail CI lint). Split into two unconditional hook
calls. Behavior unchanged.

**Demo Gym (gym_dev, read-only):** `demo-gym` ACTIVE; `owner@demo-gym.test` live
`POST /auth/login` → 200; Alice `+919111100001` and Bob `+919111100002` ACTIVE.
Payments 2, attendances 4. No gym_dev reset.

**Deviations:** 2026-09-13 Chrome re-run was partial; closed 2026-09-14 (Section 9).
No Flutter `ACCOUNT_INACTIVE` mapping test (optional; no mapped message).

**Next slice:** **15.13** was the last implementation slice (Done 2026-09-13).

#### Phase 15.13 — Production hardening (CORS, cookie Secure, env)
**Status:** Done (2026-09-13)

Configuration / validation only. **Not** cloud deploy. No production hostname invented.
No migration. No Helmet / rate-limit / forgot-password / member-cookie changes.

**CORS:** `CORS_ORIGIN` remains a comma-separated allowlist with `credentials: true`.
`loadEnv` now rejects `*` (alone or as a list entry) because credentialed wildcard CORS
is invalid. Local example origins unchanged (admin-web `:5173`, super-admin `:5174`,
Flutter Web `:8080`, both `localhost` and `127.0.0.1`).

**Cookies:** Staff `refresh_token` and platform `platform_refresh` still httpOnly,
SameSite=Lax, distinct paths. `Secure` remains `NODE_ENV === "production"` (helpers
`isRefreshCookieSecure` / `staffRefreshCookieOptions` / `platformRefreshCookieOptions`
so production can be asserted without mutating process env). Member refresh stays JSON
`refreshToken` + `member_access`; no member cookie.

**Env:** Existing schema unchanged except the wildcard refine. Stale “admin-web only”
CORS comment corrected. `.env.example` comments describe the allowlist and Secure gate.

**Tests (executed 2026-09-13):**
- API `pnpm --filter api test` — **33 files, 408 passed** (was 401; +7: env wildcard
  3, CORS HTTP 3, cookie Secure 1).
- `env.test.ts` **9**, `test/cors.test.ts` **3**, `auth.cookies.test.ts` **1**,
  `auth.test.ts` **38**, `platform-auth.test.ts` **17**, `portal.test.ts` **5**,
  `phase15.regression.test.ts` **4**.
- admin-web **24 files, 183 passed**; typecheck clean; lint 0 errors.
- super-admin **11 files, 45 passed**; typecheck clean; lint 0 errors.
- member-app `flutter test` **2 passed**; `flutter analyze` 2 pre-existing **info**.
- `pnpm --filter api typecheck` clean. API lint **0 errors** (pre-existing
  `trainer.test.ts` unused-var warning).

**CI:** existing workflow already runs `pnpm --filter="./apps/*" run test`. New
Vitest files are included. GitHub Actions was **not** run (no push). No deploy job.

**Files:** `env.ts`, `env.test.ts`, `auth.controller.ts`, `auth.cookies.test.ts`,
`test/cors.test.ts`, `portal.test.ts` (member JSON / no cookie), `vitest.config.ts`
(two localhost origins for CORS HTTP tests), `apps/api/.env.example`.

**Deviations:** none. Production Secure is proven via exported option helpers +
Set-Cookie serialization, not by flipping the process `NODE_ENV` for the live app.

**Next:** Phase 15 is **Done** (2026-09-14). Do not start “later” (PSP, OpenAPI, iOS,
production host) or Phase 16 without explicit approval. Super Admin responsive retrofit
and admin-web Slices 3/5 stay queued — write a plan first; Super Admin mobile use is
an open question (10.22).

---

## 8. Explicit Don'ts (carried over from original spec, unchanged)

- Don't put React or Flutter code inside the backend repo folder.
- Don't let either frontend talk to MySQL directly — always Frontend → API → DB.
- Don't put business logic (expiry calculation, pricing, etc.) in Flutter or React — backend owns it.
- Don't use `isAdmin`; use role → permission.
- Don't merge User, Member, Trainer into one giant table.
- Don't store uploaded files in MySQL — use object storage (once you actually need uploads).
- Don't hard-delete payments — refund/reverse and audit.
- Don't build Redis/BullMQ, OpenAPI generation, or object storage before there's a concrete feature
  that needs them.
- Don't add `@@unique` constraints on columns that coexist with `deletedAt` without re-reading
  Section 1.3 first.

---

## 9. Decision Changes Log

- **2026-09-15:** Locked Decision **1.14 amended, not rewritten.** Dark palette hex values
  are unchanged. Light mode is an **additive** `data-theme` mapping of the same brand
  through semantic CSS variables (duplicated in both apps; no `packages/ui`). Dark remains
  the default; first visit without `localStorage` is dark; **no** `prefers-color-scheme`.
  Keys: `vedafit.admin.theme` (admin-web) and `vedafit.platform.theme` (Super Admin) —
  separate origins, separate preferences. **Accent rule:** lime `#C9FF1F` is fill-only
  (buttons, active-nav fill, Recharts stroke) with black label; it is never light-mode
  body / link / heading / metric text (`--color-accent-text` `#3D4D00`, **8.89:1** on
  cream). **Slice 0 muted fix** is part of the same record: stop faking muted with
  `brand-white/40` (~3.6:1); dark muted is solid `#C9C4BF` (**12.13:1** on black); light
  muted is solid `#5C5854` (**6.74:1** on cream). Chart ticks follow that muted token
  (**7.05:1** on white) after `rgba(20,20,20,0.55)` failed AA at **4.03:1**. Warning /
  danger light variants `#92400E` / `#9B1C1C`. Super Admin reuses the locked Slice A
  tokens, not a second palette. **Slice C Done:** `pnpm e2e:theme` is a dual-origin
  smoke (not a third copy of A/B). It proves, in one Chrome session, that the two keys
  do not leak across `:5173` / `:5174`, that both CSS copies still resolve to the locked
  light RGBs, and that a sampled dark+light AA pass holds on both apps. **47/0**.
  Per-app matrices stay on `e2e:slice-a` (**45/0**) and `e2e:slice-b` (**33/0**). Super
  Admin 375 layout remains the queued 10.22 retrofit — not this work.
- **2026-09-15:** Slice **B** light/dark **Done** on **super-admin**. Same locked tokens
  as Slice A — not a second palette. `data-theme` inline script, dark default, no
  `prefers-color-scheme`. Topbar `theme-toggle` persists `vedafit.platform.theme`
  (not `vedafit.admin.theme`). Lime `#C9FF1F` fill-only; light org links / ACTIVE
  `#3D4D00` **8.89:1** on cream; muted `#5C5854` **6.74:1**; TRIAL `#92400E`
  **6.78:1**; plan codes **7.05:1** on white cards. `pnpm e2e:slice-b` **33/0**;
  Phase 15 dark **40/0**. Screenshots: orgs / org detail / SaaS plans at
  375 / 768 / 1440, both modes (375 is cramped; 10.22 SA-1 still gated). Slice
  **C** shipped the same day (see the 1.14 amendment entry).
- **2026-09-15:** Slice **A** chart-tick follow-up. Planned `rgba(20, 20, 20, 0.55)`
  on cream composites to **~4.03:1** — under AA for 12px ticks (not large text).
  Ticks now paint solid `--color-fg-muted` (`#5C5854` / `rgb(92, 88, 84)`):
  **7.05:1** on the white widget (`rgb(255, 255, 255)`). Line stroke stays lime
  fill. `pnpm e2e:slice-a` **45/0**.
- **2026-09-15:** Slice **A** light/dark **Done** on **admin-web only**. Semantic CSS
  variables + `data-theme` (inline script, dark default, no `prefers-color-scheme`).
  Topbar `theme-toggle` persists `vedafit.admin.theme`. Lime `#C9FF1F` stays fill-only;
  light headings/links/metrics use `#3D4D00` (`rgb(61, 77, 0)`, **8.89:1** on cream).
  Muted `#5C5854` **6.74:1**; warning `#92400E` **6.78:1**; danger `#9B1C1C` **7.79:1**.
  Recharts reads CSS vars (lime stroke, fg ticks). `pnpm e2e:slice-a` **44/0**; Phase 3
  **51/0**; Phase 8 **56/0**. Slices **B/C** not started.
- **2026-09-15:** Slice **0** contrast fix **Done** (dark only, both apps). `brand.white-muted`
  `#C9C4BF` locked in headed Chrome as `rgb(201, 196, 191)` — **12.13:1** on `rgb(0, 0, 0)`
  for Memberships phone, “days left”, and search placeholders (admin-web + Super Admin
  Organizations). Replaced `text-brand-white/40`, `/30`, and `placeholder:…/40` (including
  receding StatusBadge `ARCHIVED` / `CANCELLED` / `LOST`). Light-mode Slices **A/B/C** not
  started. Super Admin 10.22 and admin-web Slices 3/5 still queued.
- **2026-09-15:** Contrast + light/dark **plan** written as **Section 11**. Not implemented.
  1.14 stays the dark default. Failing copy is `brand-white/40` and `/30` (~3.6:1 and
  ~2.4:1 on `#000`). Lime `#C9FF1F` as text on cream is ~1.1:1 — light mode keeps lime as
  **button fill** with black label, not as body text. Super Admin 10.22 and admin-web
  Slices 3/5 are unchanged (not this work).
- **2026-09-14:** Phase 15 **Done.** Section **10.20** checked. Super Admin headed Chrome
  (`pnpm --filter super-admin e2e`, **40/0**, 2026-09-13) plus a full admin-web **3–13**
  re-verification (2026-09-14) meet the same bar as prior phases. The five 2026-09-13
  failures were **not Phase 15 regressions** — each had a proven, pre-existing cause:
  - **Phase 8** TRAINER widget: harness SQL counted the gym-wide (branch) headcount;
    `report.service` applies Phase 9 own-roster (`resolveOwnRoster`). Evidence: roster **1**
    vs gym-wide **41**. `assertEntitlement` and `/auth/me` `saas` are not on that path.
  - **Phase 9** assign timeout: search `"Zoya"` hit leftover **Zoya Convert** (`+9192222…`)
    from a prior Phase 10 convert; the first `assign-button` wrote that assignment, so the
    roster never showed **Zoya Outsider**. Trainer assign has no entitlement check.
  - **Phase 10** fixture FK: `member.deleteMany` on `+9192222…` convert leftovers (and the
    Phase 9 wrong assignment) without walking invoices / payments / memberships /
    `trainer_assignments` / notification logs / portal tokens. Same teardown class as
    Phases 5/6, not a Phase 15 schema change.
  - **Phase 12** SENT wait: BullMQ had already written `MEMBERSHIP_EXPIRING:SENT` and
    `PAYMENT_DUE:SENT` in MySQL while the harness waited on a stale React Query list
    (crowded leftover history / 429 on refetch). `notificationService.run` does not call
    `assertEntitlement`. Demo Gym stayed `growth` / `ACTIVE`.
  - **Phase 13** Flutter: `flutter run -d web-server` prints `Waiting for connection from
    debug service…` as its steady state; HTTP `:8080` was already 200. Puppeteer
    `waitUntil: "load"` never resolves against that debug server; `domcontentloaded` +
    headed Chrome is the honest ready check.
  Closing counts (re-run 2026-09-14 unless noted): Super Admin **40/0** (13th);
  admin-web 8 **56/0**, 9 **47/0**, 10 **42/0**, 12 **24/0**, 13 **20/0**; 3–7 and 11
  already green on the 13th. Tenant org-status PATCH (`.strict()`, 400 if `status` is
  smuggled) and the TTL-after-suspend tradeoff stay as recorded 2026-09-13. Super Admin
  responsive retrofit and admin-web Slices 3/5 stay **queued** — 10.22 is design only;
  Super Admin mobile use is an open question before any UI work.
- **2026-09-13:** Section **1.24** and **Section 10** titles said “design only / not
  implemented” after 15.1–15.13 had already shipped. Corrected the headers to match Section 7.
  No semantic change to the locked decisions.
- **2026-09-13:** Slices **15.6–15.13** were implemented on 2026-09-10 / 2026-09-13 (full
  write-ups in Section 7) but were missing dated Section 9 lines. Brief backfill: **15.6**
  write-time `assertEntitlement` on member/staff/branch/lead creates; **15.7** platform
  `PATCH …/status` plus staff refresh re-reads org status; **15.8** platform org
  list/detail/create/subscription + dashboard; **15.9** `apps/super-admin` on `:5174`;
  **15.10** informational `saas` on staff `GET /auth/me`; **15.11** `platform_audit_logs`;
  **15.12** 10.17 regression tests; **15.13** CORS `*` rejected, cookie Secure helpers.
  Phase 15 stays In progress; 10.20 unchecked.
- **2026-09-13:** Tenant `PATCH /organizations/:organizationId` no longer accepts `status`.
  Suspend/restore is exclusively `PATCH /platform/organizations/:id/status`. A gym OWNER
  sending `{ status: "SUSPENDED" }` (alone or with a name change) gets 400 `VALIDATION_ERROR`
  and the row stays `ACTIVE`. Contact-field updates (`name`, `email`, `phone`) are unchanged.
- **2026-09-13:** Access-token TTL after suspend — **accepted tradeoff, not changed.** Staff
  and member refresh already return 403 `ACCOUNT_INACTIVE` and revoke the family (15.7).
  Existing access JWTs remain valid until their normal TTL (~15m). Shortening the global TTL
  would add refresh traffic for every gym and would not uniquely solve suspension. A denylist
  or `authenticate` re-read of `OrganizationStatus` would close the window; that is a later
  slice if wanted, not this pass.
- **2026-09-13:** Super Admin headed Chrome harness added (`apps/super-admin/e2e/phase15-verify.ts`).
  The skipped 10.19 “headed browser” column for 15.9 is now executed (**40 passed / 0 failed**).
  Admin-web Chrome re-run against the post-SaaS API: **phase3 51/0** (login, refresh, `/auth/me`
  including the SaaS `saas` field), **4 52/0, 5 87/0, 6 95/0, 7 88/0, 11 36/0**. Phase 8
  TRAINER widget step timed out (own-roster vs gym-wide SQL — Phase 9 leftover, not a SaaS
  `/auth/me` break; OWNER/RECEPTIONIST widgets still matched SQL). Phase 9 assign step timed
  out; Phase 10 fixture FK on leftover converted members; Phase 12 worker did not mark SENT
  in 15s; Phase 13 Flutter web-server never became ready. **10.20 e2e box stays unchecked.**
  Super Admin responsive retrofit and admin-web Slices 3/5 stay queued.
- **2026-09-05:** Locked Decision 1.2 (ULID, `utf8mb4_bin` collation) is implemented via a
  second, hand-written migration (`char_columns_binary_collation`) rather than a schema.prisma
  attribute, because Prisma has no collation attribute for MySQL columns and its migrator
  defaults to `utf8mb4_unicode_ci`. No change to the decision itself, just to how it's applied.
  See Phase 1's "Deviations" note for details.
- **2026-09-05:** Locked Decision 1.3 (app-layer uniqueness enforcement) is strengthened with an
  InnoDB `SELECT ... FOR UPDATE` lock on the parent `Organization` row for the duration of the
  create/update transaction, in `userService`. Plain "check inside a transaction" (Option 1 as
  literally described) does not close the race under MySQL's default REPEATABLE READ isolation —
  two concurrent transactions can both see "no existing row." The row lock serializes
  create/update calls per-organization, which is what the Phase 1 race-condition test actually
  needed to be deterministic instead of flaky. No DB-level `@@unique` was added — this is a
  concurrency-control detail layered on top of Option 1, not a reversal of it. Apply the same
  pattern to `memberService` in Phase 4.
- **2026-09-06:** Phase 2's "DB changes: none beyond Phase 1" was wrong. Revoking a whole token
  *family* on reuse requires something to group a rotation chain by, and the Phase 1
  `RefreshToken` model has no such column — only `userId`, which would make revocation user-wide
  and log a user out of every device because one session leaked. Added a
  `refresh_tokens.familyId CHAR(26)` column (+ index) in migration `refresh_token_family`; a fresh
  login starts a new family and every rotation inherits it. The same migration narrows
  `tokenHash` on both token tables to `CHAR(64)` (SHA-256 hex) with a `UNIQUE` index, so
  lookup-by-hash is one index hit. `COLLATE utf8mb4_bin` is set explicitly, for the same reason as
  the Phase 1 collation migration. No change to any locked decision — this is the schema Section 3
  should have specified for the behaviour Phase 2 already required.
- **2026-09-06:** Removed `POST /api/v1/organizations` and `GET /api/v1/organizations` (list-all)
  from the HTTP API. Both were built in Phase 1 before auth existed, and neither survives contact
  with Section 6: a list-all endpoint is cross-tenant by construction, and an unauthenticated
  create endpoint lets anyone mint an organization. Since Locked Decision 1.7 already says orgs
  are bootstrapped by the seed script until Phase 15, they had no legitimate caller.
  `organizationService.create`/`list` are unchanged and still used by the seed script, the tests,
  and (later) the Phase 15 super-admin layer. Consequence: an unknown organization id now returns
  403 `ORG_MISMATCH` rather than 404 `ORGANIZATION_NOT_FOUND`, because the tenant guard rejects it
  before any lookup happens — which is the better answer anyway, since the 404 was an existence
  oracle for arbitrary org ids.
- **2026-09-06:** "Lockout after N failed attempts" is implemented as rate limiting keyed on
  **IP + submitted email** with `express-rate-limit`, not as a persisted per-account lockout
  counter. Rationale: an IP-only counter locks out an entire gym whose staff share one NAT
  address, and a persisted per-account counter is itself a denial-of-service vector (anyone who
  knows an email can lock its owner out). Only *failed* attempts consume budget
  (`skipSuccessfulRequests`), so normal use is never throttled. Known limit, accepted for now: the
  default store is per-process memory, so counters reset on restart and are not shared across
  instances. Swap in a Redis store in Phase 12, when Redis arrives for a feature that actually
  needs it (Section 8 forbids introducing it earlier).
- **2026-09-06:** `POST /auth/login` accepts an optional `organizationSlug`. Locked Decision 1.3
  makes `email` unique per organization, not globally, so an email alone can legitimately match
  users in several orgs. The endpoint verifies the password against every candidate: no match →
  401, exactly one → logged in, more than one → 409 `AMBIGUOUS_LOGIN` listing the slugs to retry
  with. This keeps the common case a plain email + password form instead of forcing a tenant
  selector into the Phase 3 login screen.
- **2026-09-06:** `POST /auth/forgot-password` returns the raw reset token in its response when
  `NODE_ENV` is `development` or `test` (an explicit allowlist, not `!== "production"`). There is
  no mail transport until Phase 12, and a reset flow that can't be exercised end-to-end is one
  nobody discovers is broken. Delete this branch when Phase 12 wires real email.
- **2026-09-06:** `tenant.middleware.ts` is applied twice on the branch routes — once at
  `/:organizationId` on the parent router, and again at `/:branchId` inside `branchRouter`.
  Express only populates the path params matched up to a middleware's own mount point, so the
  parent-level guard cannot see a `:branchId` deeper in the path. Without the second application a
  branch-scoped user could read a sibling branch; a test caught this and now covers it.
- **2026-09-06:** The admin-web access token is held **in memory only** (a field on the Zustand
  session store) and is never written to `localStorage`, `sessionStorage`, or a readable cookie.
  Phase 2 put the refresh token in an httpOnly cookie specifically so that an XSS foothold cannot
  walk away with a durable session; parking the access token somewhere script-readable would hand
  most of that protection back for the sake of saving one request. Consequence: a page reload
  always starts with no token, so `App` boots by trading the refresh cookie for a new one. Also
  means multiple tabs each hold their own access token, which is fine — they share the cookie.
- **2026-09-06:** Every cold load spends one **speculative** `POST /auth/refresh`, even for a
  visitor who has never logged in (it returns 401 and the app renders the login screen). The
  alternative — a readable "am I logged in?" flag in `localStorage` — reintroduces client-side
  session state that can disagree with the server, to save one short request on the anonymous
  path only. Revisit if the login screen's time-to-interactive ever becomes a real complaint.
- **2026-09-06:** `refreshAccessToken()` is **single-flight**: concurrent callers share one
  in-flight promise, reset once it settles. This is a correctness requirement, not an
  optimization. Phase 2 revokes an entire refresh-token family when a spent token is replayed, and
  two parallel refreshes send the same cookie — the second one *is* a replay, so the API would
  correctly revoke the family and sign the user out. React 18 StrictMode double-invokes effects in
  development, so without this the app would log developers out on most cold loads. Verified in
  the browser: three concurrent 401s produced exactly one refresh call. If the API ever moves to a
  grace window on rotation, this stays anyway — it is also just fewer requests.
- **2026-09-06:** `useSessionBootstrap` deliberately has **no cleanup/cancellation**. The first
  implementation aborted its in-flight bootstrap on unmount; under StrictMode the simulated
  unmount cancelled the only run the `useRef` guard would ever allow, and the app hung on
  "Restoring session" forever. Caught by the browser harness, not by the jsdom tests. Because the
  result lands in a global store rather than component state, a late write is harmless.
- **2026-09-06:** Real-browser verification tooling added at `apps/admin-web/e2e/`, driven by
  `puppeteer-core` (a devDependency; unlike `puppeteer` it bundles no Chromium and drives the
  system Chrome). Excluded from `pnpm test` — `vitest.config.ts` only collects
  `src/**/*.test.{ts,tsx}` — and not wired into CI. jsdom cannot honestly verify computed CSS,
  httpOnly cookie behaviour, session survival across a reload, or a genuinely expired JWT, all of
  which are Phase 3 DoD items. Kept out of CI so a browser dependency can't make the pipeline
  flaky; it is a reproducible manual verification transcript, run via `pnpm e2e`.
- **2026-09-06:** Observed, not changed: `GET /auth/me` is served with Express's default `ETag`,
  so a repeat request returns `304 Not Modified` on the wire and the browser serves the cached
  body. Functionally correct (each call still revalidates), but it does leave authenticated
  response bodies in the browser's HTTP cache. Worth sending `Cache-Control: no-store` on
  `/auth/*` — an API change, so it is not being made during a frontend phase. Fold into the next
  API-side phase.
- **2026-09-06:** Archiving a member sets `status = ARCHIVED` and leaves `deletedAt` **NULL**.
  The `Member` model carries both, and Phase 4 had to pick which one "archive" means. A soft
  delete would hide the record from every read path, which defeats the point: archiving exists so
  a lapsed member's history stays readable and they can be found again if they come back —
  `?status=ARCHIVED` lists them and their detail page still loads. `deletedAt` is left for a real
  erasure path (a GDPR-style request), which no phase currently exposes. Locked Decision 1.3's
  uniqueness check tests for *both* (`deletedAt IS NULL AND status <> 'ARCHIVED'`), so a phone
  number frees up on archive and the check stays correct if a later phase does start writing
  `deletedAt`. Verified in the browser: after archiving, the number was reusable and the two rows
  coexist.
- **2026-09-06:** Archive is `POST /members/:memberId/archive`, not `DELETE /members/:memberId` —
  a deliberate break from the users module, which uses `DELETE` for its soft delete. Since this
  archive is a status transition and not a delete, `DELETE` would misdescribe it, and a named
  sub-resource leaves room for `POST /:memberId/restore` later without reusing a verb misleadingly.
  Its own permission (`members.archive`) hangs off that route, which is what lets the Section 4.2
  matrix grant a RECEPTIONIST `members.update` without also granting archive.
- **2026-09-06:** `PATCH /members/:memberId` rejects `status: "ARCHIVED"` with a validation error;
  it accepts only `ACTIVE`/`INACTIVE`. Without that, `members.update` would be a back door around
  `members.archive` and the RBAC split above would be decorative.
- **2026-09-06:** Member reads and writes are **branch-scoped in the service layer** for a
  branch-scoped caller, not only in `tenant.middleware.ts`. The middleware rejects a caller who
  *names* another branch, but a receptionist who simply omits `branchId` would otherwise receive
  every member in the organization. `memberService` therefore forces `branchId` from the JWT for
  list/get/update/archive, and a member in another branch reads as 404 rather than 403, so the
  endpoint isn't an existence oracle. Phase 1's users module has no equivalent because it is
  gated on `users.manage`, which no branch-scoped role holds.
- **2026-09-06:** Duplicate-phone detection is an **exact string match** on the trimmed value, so
  `+91 98765 43210` and `+919876543210` are treated as different numbers. Normalizing to E.164
  would need either a stored normalized column or a scan, since the existing
  `@@index([organizationId, phone])` can't serve a computed comparison — real work for a problem
  that hasn't appeared yet. The `DUPLICATE_PHONE` message names the conflicting member, so the
  near-miss case is at least legible to staff. Revisit alongside Option 3 (generated column) in
  Locked Decision 1.3 if duplicates become a real-world nuisance.
- **2026-09-06:** The members list keeps its full filter state (`page`, `limit`, `search`,
  `status`, `sortBy`, `sortOrder`) in the URL query string rather than in component state, so a
  filtered view survives a reload, can be shared, and is restored when navigating back from a
  member's detail page. Unrecognised values fall back to defaults instead of being forwarded to
  the API. Every list screen in later phases should follow this.
- **2026-09-06:** `.github/workflows/ci.yml` gained a MySQL 8.0 service container (published on
  3307, matching `docker-compose.yml`), a `prisma generate` step before typecheck, a
  `prisma migrate deploy` step before the tests, and a guard step that fails the build if any
  `CHAR` column in the test schema is not `utf8mb4_bin`. Before this, CI ran `pnpm test` with no
  database at all — every Phase 1 API test would have failed on a real Actions run, and typecheck
  would have failed on the missing generated Prisma Client. Service containers accept no
  `command:`, so the server-level collation flags from `docker-compose.yml` are applied to the
  database with an `ALTER DATABASE` step instead.
- **2026-09-06:** Phase 5's "DB changes: none beyond Phase 1" was wrong, for the same reason
  Phase 2's was: the phase's own semantics need columns the Phase 1 schema doesn't have. Migration
  `membership_lifecycle_fields` adds three to `memberships` — `frozenAt DATETIME NULL` and
  `totalFrozenDays INT NOT NULL DEFAULT 0`, both required by the clock-pause freeze in 1.15.2
  (the shift is not derivable after the fact, and keeping the cumulative total is what makes the
  original commercial term reconstructible for disputes), and `previousMembershipId CHAR(26) NULL`
  self-referencing `memberships.id`, which makes the term chain from 1.15.3/1.15.4 navigable
  instead of inferred from adjacent dates. An `@@index([organizationId, memberId, status])`
  supports the overlap check on every sale. `COLLATE utf8mb4_bin` had to be written into the
  self-reference by hand — Prisma's migrator emitted `utf8mb4_unicode_ci` for the new column while
  the referenced `id` is already binary from Phase 1's collation migration, and MySQL refuses the
  foreign key (errno 3780) across mismatched collations. Same root cause as the Phase 1 entry.
- **2026-09-06:** The Section 4.2 matrix gained three permission keys during Phase 5:
  `membership-plans.view` and `memberships.view`, and `memberships.renew`. The original matrix
  listed only `.manage` for plans and `create`/`freeze`/`cancel` for memberships, which made every
  read implicitly public to any authenticated user and left a RECEPTIONIST — the role that
  actually works the front desk — unable to take a renewal. RECEPTIONIST now holds
  `membership-plans.view`, `memberships.view`, `memberships.create` and `memberships.renew`, and
  ACCOUNTANT holds the two read keys, matching its read-only reporting brief. Freeze and cancel
  stay with MANAGER and above: both move money-bearing dates, which is a decision the desk should
  escalate.
- **2026-09-06:** Every lifecycle action is a `POST` to a named sub-resource
  (`/renew`, `/change-plan`, `/freeze`, `/unfreeze`, `/cancel`) rather than `PATCH { status }`.
  The 1.15.1 transitions are not interchangeable status writes — freezing stamps a timestamp,
  unfreezing moves `endDate`, renewing inserts a row — so a generic status field would be both a
  lie about what happens and a back door around the permission split above. Upgrade and downgrade
  are one endpoint, not two: they are the same operation and differ only in which plan costs more.
  `change-plan` is gated on `memberships.cancel` **and** `memberships.create` together (a new
  `requireAllPermissions` helper), because it cancels a term and sells another in one transaction;
  granting it as a single key would have let a role cancel a membership through a route that
  doesn't say "cancel".
- **2026-09-06:** Lazy expiry (1.8) means `GET` requests on memberships **write**. Any read that
  touches an `ACTIVE` row whose `endDate` has passed flips it to `EXPIRED` and persists that,
  rather than computing a display value and leaving the stored status stale. Persisting is what
  keeps `?status=EXPIRED` filters, `COUNT`s and later phases' reports agreeing with what the
  detail page shows — a computed-only status would be correct on screen and wrong in every query
  that doesn't replicate the computation. The sweep is one `updateMany` over scalar columns before
  the read, so it is idempotent and safe to run concurrently. Trade-off accepted: reads are not
  side-effect free, and a membership's `updatedAt` can move without anyone editing it.
- **2026-09-06:** Membership terms are **inclusive UTC calendar dates**, handled through a new
  `apps/api/src/utils/dates.ts` rather than raw `Date` arithmetic. A 30-day term starting today
  ends on day 29, not day 30, because both endpoints are days of access — the alternative sells
  31 days of gym under a "30 day" label. All boundaries are normalized to UTC midnight so a server
  in IST and a browser in any zone agree on which day a term ends; with local-time dates, a term
  created at 23:00 IST would store the previous day in UTC and read back wrong. Renewal starts at
  `max(today, source.endDate + 1 day)`, so an early renewal stacks after the current term instead
  of overwriting paid days.
- **2026-09-06:** The URL-as-list-state pattern from Phase 4 was extracted into a shared
  `useUrlListParams` hook (`apps/admin-web/src/lib/url-list-params.ts`) when the plans and
  memberships lists became its second and third callers; `features/members/useListParams.ts` is
  now a thin config over it. Behaviour is unchanged and the Phase 4 regression tests still cover
  it — this is the "every list screen in later phases should follow this" note from the Phase 4
  entry being made structural instead of copied.
- **2026-09-06:** Phase 6's "DB changes: none beyond Phase 1" was wrong, for the third time and
  the same reason. Migration `payments_invoices_phase6` adds `payments.refundOfPaymentId CHAR(26)
  NULL` self-referencing `payments.id` — without it, 1.16.3's "a refund is a new row" has nothing
  tying the reversal to what it reverses, and the pair is only inferable from amounts and
  timestamps. It adds `invoices.membershipId CHAR(26) NULL` so a term-driven invoice says which
  term it bills, and `invoices.notes VARCHAR(500)` so an ad-hoc one says what it is for (the
  Phase 1 `Invoice` had no field answering "what is this charge?"). It also widens
  `invoiceNumber` to `VARCHAR(32)` and adds the org-scoped status/member indexes the list screens
  filter on. `COLLATE utf8mb4_bin` was written into both `CHAR(26)` columns by hand for the same
  errno 3780 reason as the Phase 1 and Phase 5 entries.
- **2026-09-06:** Invoice numbers are allocated from a dedicated `invoice_sequences` table
  (`organizationId`, `year`, `nextValue`), locked `FOR UPDATE` and incremented inside the same
  transaction that inserts the invoice — not from `MAX(invoiceNumber) + 1` or a `COUNT`. Under
  MySQL's default REPEATABLE READ, two concurrent creations both read the same maximum and both
  produce the same number; this is the identical race shape as the Phase 1 duplicate-phone
  problem, and it takes the identical fix. `@@unique([organizationId, invoiceNumber])` stays as a
  database-level backstop so the failure mode is a rejected write rather than two invoices sharing
  a number. Lock order is fixed — organization first, then sequence — so invoice creation can't
  deadlock against the member-uniqueness lock that also takes the organization row. Proven with a
  ten-way concurrent creation test at the API level and again through the browser: ten distinct,
  contiguous numbers both times. The counter is deliberately never rewound, so deleting rows (as
  the E2E fixtures do) leaves a gap in what exists while the *issued* sequence stays gapless.
- **2026-09-06:** Cancelling an invoice sets `amountPending` to zero as well as
  `status = CANCELLED`. Found by the Phase 6 browser pass: with the balance left in place, a
  voided bill still appeared on the "pending fees" screen the front desk uses to chase money, and
  still counted toward the member's outstanding total on their detail page. A cancelled invoice is
  owed nothing, so `amountPending` — which means "money still owed" everywhere else — has to say
  so. What *was* owed is still recoverable as `amountTotal - amountPaid`, since neither is ever
  rewritten. The rollup recompute honours the same rule, so the two paths can't disagree.
- **2026-09-06:** The Section 4.2 matrix gained five permission assignments during Phase 6.
  MANAGER holds `invoices.view` and `invoices.manage`, because selling a membership raises an
  invoice and a manager who cannot then see it cannot finish a job they already had permission to
  start. RECEPTIONIST holds `payments.view` and `invoices.view`: a front desk that can take a
  payment but cannot see the bill it pays down has no way to answer "how much do I owe?", which is
  the most common question at a gym counter. ACCOUNTANT holds `members.view` — an invoice is
  raised *against a member*, so the one role whose job is raising invoices has to be able to look
  one up; this was caught by the Phase 6 browser pass, where the member picker on the invoice form
  came back empty behind a 403. All three are read-widening only. `payments.refund` stays with
  ACCOUNTANT and OWNER: 1.16.1 deliberately keeps "runs the gym" and "returns money" apart, and
  that boundary is what stops a mid-term plan change from quietly moving money.
- **2026-09-06:** Selling, renewing or changing a plan raises the invoice **inside the
  membership's own transaction**, via a `raiseInvoice` helper the invoices module exports for the
  memberships module to call. A membership term that exists without the bill for it is a
  reconciliation problem someone finds at month end; making the two atomic means the only two
  outcomes are "term and invoice" or "neither". The cost is a module dependency edge from
  memberships to invoices, accepted over an event/outbox indirection that would buy nothing at
  this scale.
- **2026-09-06:** Overpayment is refused (409 `PAYMENT_EXCEEDS_INVOICE`) rather than credited
  forward or auto-refunded, and the error names the actual outstanding balance. The overwhelming
  cause of a payment larger than the bill is a slipped digit at the counter, and the cheapest
  correct response is to refuse it and show the operator the real number. Credit-forward needs a
  member-level credit balance that nothing else in the system has yet; deferred rather than
  invented here. Paying the *exact* remainder is allowed — only strictly more is refused.
- **2026-09-07:** Phase 7's "DB changes: none beyond Phase 1" did not survive Locked Decision 1.17.
  `attendances` gained `attendanceDate` (`DATE`), `membershipId`, `overrideReason` (a new
  `AttendanceOverrideReason` enum) and `markedByUserId`; `organizations` gained `timezone`. The
  original four-column `Attendance` could record *that* someone came in and nothing about whether
  they were entitled to, which is the entire question 1.17.1 exists to answer. It also had no
  `organizationId` foreign key and no index supporting "today, at this branch" — the one query the
  table exists for. Migration `20260907001500_attendance_phase7` spells out
  `CHARACTER SET utf8mb4 COLLATE utf8mb4_bin` on every new `CHAR(26)`, the same Phase 1 collation
  trap that bit Phases 5 and 6.
- **2026-09-07:** **An attendance day is the organization's local calendar day, not the UTC one**
  (1.17.4), which is a deliberate departure from the UTC-midnight convention Section 9's Phase 5
  entry locked in for membership terms. The two are different kinds of date: a term boundary is
  typed by a human and means the same 30 April everywhere, while an attendance day is derived from
  an instant and only means anything in the gym's zone. Under UTC, a 5:00 AM IST check-in — an
  ordinary opening slot — files under yesterday, and 1.17.2's one-per-day rule would let the same
  member check in at 5:00 and again at 6:00 the same morning. `organizations.timezone` (IANA,
  default `Asia/Kolkata`) is therefore added, closing the "per-organization timezones are deferred"
  note in `utils/dates.ts` for attendance specifically. Conversion uses `Intl`, so no date
  dependency was added. The derived day is *stored* as a column rather than computed per query,
  because MySQL cannot index a timezone conversion and neither can a `WHERE` clause that performs
  one. The organization's timezone is also now returned by `/auth/me`, since the browser's zone is
  not the gym's either.
- **2026-09-07:** A check-in with no covering membership is **allowed as a recorded override, and
  requires an explicit `override: true` on a second request** (1.17.1). The alternative reading of
  the original spec's "shows a warning but is still allowed" — warn in the UI and let the first
  request through — was rejected because it puts the whole decision in the client. A mistyped
  member id, a script, or a Phase 13 kiosk would then create overrides nobody chose. Refusing once
  with 409 `MEMBERSHIP_NOT_ACTIVE` makes the exception deliberate at the layer that can enforce it,
  which is the same "the dialog is a courtesy, the server is the control" line Phase 6 drew around
  refunds. A hard block was rejected for the opposite reason: it does not stop anyone entering the
  building, it only stops them being recorded, and unrecorded visits corrupt the table more than
  recorded overrides do.
- **2026-09-07:** The Section 4.2 matrix gained `attendance.view` for RECEPTIONIST. The original
  matrix gave the front desk `attendance.mark` alone, which is the same shape of too-narrow
  definition as Phase 6's ACCOUNTANT-without-`members.view`: the daily register is the desk's own
  screen, and a role that can mark attendance but not read it cannot answer "has she already come
  in today?" — the question the register exists for. Caught before writing the module this time
  rather than in the browser pass. Reads stay branch-scoped by the usual rule.
- **2026-09-07:** Attendance deliberately does **not** run the Locked Decision 1.8 lazy-expiry
  sweep, unlike every other module that reads a membership. Two reasons, and the second is the
  binding one. It is unnecessary — coverage is decided by a `startDate`/`endDate` predicate on top
  of `status = ACTIVE`, so a stale `ACTIVE` row whose term has passed cannot wave anyone through
  regardless of what its status column says. And it would be wrong: the sweep's clock is
  `todayUtc()` while attendance's is the gym's local day, and sweeping on the local clock would
  flip terms to `EXPIRED` up to a day before the memberships module agrees they have ended. The
  first draft did sweep, and the API test suite caught it. Attendance reads memberships; it does
  not get to retire them.
- **2026-09-07:** A repeat check-in returns **200 with the existing row**, not a 409. A duplicate is
  overwhelmingly a double-click or a member re-presenting their card, and the useful answer is the
  fact ("checked in at 7:04 AM") rather than an error. Reserving 4xx for the one thing that really
  is a conflict — an uncovered member — keeps the front desk able to tell which red dialogs matter.
  The rule is enforced by `@@unique([memberId, attendanceDate])` rather than a check-then-insert,
  for the Phase 1 duplicate-phone reason: two taps on a slow connection are genuinely concurrent.
  Unlike 1.3's phone case there is no soft-delete complication, so a real constraint is simply
  correct here. Consequence accepted: a member who trains twice in one day is recorded once, and
  the stored time is the first arrival.
- **2026-09-07:** `useUrlListParams` gained an `extraKeys` option and stopped rebuilding the query
  string from empty. It previously constructed a fresh `URLSearchParams` containing only the
  Section 1.9 six, so any filter a screen owned itself was silently wiped the moment someone paged
  or typed — attendance's `date` would have snapped back to today mid-browse. It now starts from
  the current URL and deletes or sets only the keys it owns. Latent bug rather than a new one: no
  existing screen had extra keys to lose.
- **2026-09-07:** `useMemberList` gained an optional `enabled` flag so the check-in panel can be
  search-first. Without it the panel fetched a page of arbitrary members on mount, which is not an
  answer to "who is standing in front of me" and is a wasted request on every visit to the screen.
- **2026-09-07:** Raised the API suite's `testTimeout` to 30s. Not a Phase 7 change in substance —
  the auth login tests do real bcrypt work against a real database, and the 5s default is
  calibrated for pure-logic tests. Three of them timed out during a full `pnpm -r test` (which runs
  admin-web's 162 tests on the same cores) and passed in isolation moments later. Left unraised
  this is a CI flake that reports as a failure, which is worse than a slow test.
- **2026-09-07:** Phase 8's "DB changes: none beyond Phase 1" did not survive Locked Decision 1.18.2.
  `invoices` and `payments` gained a `NOT NULL branchId`, stamped at write time and never updated,
  because `member.branchId` is editable and deriving revenue from it lets a transfer rewrite
  history. Existing rows were backfilled from the membership's branch where there is one, else the
  member's current branch — the best available estimate, and honest about being one. Migration
  `20260907120000_money_branch_attribution_phase8` adds the column nullable → backfills → sets
  `NOT NULL`, and spells out `CHARACTER SET utf8mb4 COLLATE utf8mb4_bin` on the `CHAR(26)` so the
  FK against `branches.id` does not hit Phase 1's collation trap. Four indexes were added with it
  (`payments` by org/branch/`paidAt`, `invoices` by org/branch/`amountPending`, `members` by
  org/branch/status, `memberships` by org/branch/status/`endDate`) because these are the exact
  (org, branch, range) shapes the widgets filter on.
- **2026-09-07:** Invoice and payment *lists* still scope through `member.branchId`; revenue
  *aggregates* use the stamped column. A transferred member's old bills appear in their new
  branch's collection worklist and in their old branch's monthly revenue. Both are the right
  answer to the question that screen is asking. Collapsing them into one rule would make either
  the till or the chase-list wrong.
- **2026-09-07:** The dashboard endpoint has no `requirePermission`. Putting `reports.view` in
  front of `/` would greet a RECEPTIONIST and a TRAINER with "not for your role" as their home
  screen; widening that key to those roles would put monthly revenue on the front desk. Each
  widget is gated on the permission for the data underneath it, and an unpermitted widget is
  **absent from the payload**, not sent-and-hidden. Third instance of the too-narrow-RBAC shape
  (after Phase 6's ACCOUNTANT-without-`members.view` and Phase 7's RECEPTIONIST-without-
  `attendance.view`); the structural fix this time is per-widget gating rather than another
  matrix edit.
- **2026-09-07:** Reports never write, including never running the Locked Decision 1.8 expiry
  sweep. Same reason as attendance: the dashboard's money clock is the gym-local month and the
  memberships module's is UTC midnight, so sweeping here would expire terms up to a day early.
  Coverage is a date predicate (`ACTIVE` and `startDate <= today <= endDate`), so a stale
  `ACTIVE` row cannot inflate the active-members count regardless.
- **2026-09-07:** Two clocks in one dashboard response, deliberately. Revenue uses the gym-local
  month (1.18.1, same reasoning as 1.17.4); expiring terms and "active today" use `todayUtc()`
  because membership dates are UTC midnights (1.15). Picking one clock and applying it to both
  would make one of the two wrong. The 02:00 IST-on-the-1st payment that UTC would file under
  August is covered by a unit test against `localMonthBounds`.
- **2026-09-08:** Phase 9's "DB changes: add `TrainerProfile`" grew a second table,
  `trainer_assignments`. The Section 5 sketch is 1:1 with User and has no place to hang "which
  members is this trainer responsible for", and putting `trainerId` on `members` would make the
  roster a single pointer — a member cannot have both a PT and a yoga instructor. Assignment is
  a current ACL, not a coaching history (1.19.2): unassigning drops access including past
  check-ins. Stamping a trainer on the attendance row would be the 1.18.2 move and is the wrong
  one here — there is no session object to stamp against, and `markedByUserId` is already the
  desk. `COLLATE utf8mb4_bin` was written into every new `CHAR(26)` by hand, same errno 3780
  trap as Phases 1/5/6/7.
- **2026-09-08:** `TrainerProfile` gained `organizationId` and `updatedAt` against the Section 5
  sketch. Tenant queries must not have to join through `users` to stay in-org, and the profile
  is editable. `commissionPct` is stored and validated (0–100, two decimals) and **not computed
  against** — Phase 11 is where money that is not a member payment gets a definition.
- **2026-09-08:** Own-roster is a **service-layer query filter**, not a new permission key and
  not `role.name === "TRAINER"` (1.19.1). `requirePermission("attendance.view")` is a yes/no;
  a trainer and a receptionist both hold that key, so middleware cannot express "own sessions
  only". The discriminator is: holds `attendance.view` and does **not** hold `attendance.mark`.
  Empty profile or empty assignments returns **zero rows**, not the unfiltered gym — the
  opposite of the too-narrow bugs in Phases 6 and 7, and the failure this phase exists to close.
  GET by id outside the roster is 404, not 403. The dashboard members and attendance widgets
  inherit the same filter so the home screen is not a second, wider copy of the leak.
- **2026-09-08:** Managers do not hold `users.manage`, so they cannot list staff in order to
  pick a user for a profile. Eligible candidates are a trainers-module read
  (`GET /trainers/candidates`), gated on `trainers.manage`, returning only users who could still
  receive a profile. Same too-narrow shape as ACCOUNTANT-without-`members.view`. There is no
  `trainers.view` key: a trainer's roster *is* the members list.
- **2026-09-08:** Classes are not in this phase (1.19.4). The goal line said "assignment to
  members/classes"; there is no `Class` table in Section 5. "Own sessions" in 4.2 is read as
  "the members I am responsible for" until a later phase introduces a session object.
- **2026-09-08:** Phase 10's Section 5 sketch is a row with a status string. That is not a
  pipeline. `status` is a `LeadStatus` enum with a directed graph (1.20.1): forward including
  skips, any open status → `LOST`, `LOST → CONTACTED` as the only recovery, `CONVERTED` terminal
  and convert-endpoint-only. Backward among open statuses is 409 `INVALID_LEAD_TRANSITION`. The
  prompt numbered this 1.19; 1.19 is already the trainer roster, so it is **1.20**.
- **2026-09-08:** Conversion creates the Member and stamps `convertedMemberId` in the **same
  transaction** (1.20.2), gated on `leads.manage` alone. Requiring `members.create` as well would
  be the too-narrow shape (a role that can run the pipeline but cannot finish it). `LOST` cannot
  convert; reopen first. After convert the lead is read-only (409 `LEAD_CONVERTED`). Locked
  Decision 1.3 is not waived: a phone already on the books is 409 `DUPLICATE_PHONE` and the lead
  stays open. Linking onto an existing member is deferred.
- **2026-09-08:** Branch scoping for leads is the member rule (1.20.3): a receptionist sees **all
  leads at their branch**, not assigned-to-me. `assignedToUserId` is a worklist hint, filterable,
  never an ACL. Unattributed leads (`branchId` null) are org-wide only. GET by id outside the
  caller's branch is 404. Managers do not hold `users.manage`, so eligible assignees are
  `GET /leads/assignees`, gated on `leads.manage` — same candidates shape as 1.19.3.
- **2026-09-08:** Duplicate lead phones block a second **open** lead, not a second enquiry ever
  (1.20.4). `LOST` and `CONVERTED` do not occupy the slot. No `@@unique` and no `deletedAt`. An
  open lead whose phone already belongs to a member is allowed; conversion is where 1.3 fires.
  `COLLATE utf8mb4_bin` on every new `CHAR(26)` in `20260908120000_leads_phase10`, same errno
  3780 trap as Phases 1/5/6/7/9.
- **2026-09-08:** Phase 11's Section 5 sketch is a row with a free-text `category` and no
  `updatedAt`. That cannot feed a P&L. `category` is an `ExpenseCategory` enum (1.21.2) because
  the report groups by it, and "Rent" / "rent" / "RENT " as three bars is not a report. The UI
  is a select; `OTHER` plus notes is the escape hatch. `updatedAt` is present because an
  expense is a **live book** (1.21.3): editable and hard-deletable, no `deletedAt`, no reversal
  row. That is the opposite of 1.16.3/1.18.1 on purpose — a payment is a customer-facing cash
  fact that must not move; a slipped extra zero on rent is a data-entry mistake, and inventing
  a reversal ritual for it would be ceremony without a job. The P&L is live: editing March in
  June changes March. Amount is strictly positive. `expenseDate` is a civil `DATE` the human
  typed, not an instant, so "March" is `>= 2026-03-01 AND < 2026-04-01` in the gym's calendar
  (1.21.4), the same local-month window as dashboard revenue. `GET /reports/profit-loss` is
  gated on `reports.view`, not `expenses.manage`: a manager who can see monthly revenue must
  be able to see it net of costs, and the line items stay behind `expenses.manage` (4.2:
  ACCOUNTANT / OWNER / ADMIN). `COLLATE utf8mb4_bin` on every new `CHAR(26)` in
  `20260908180000_expenses_phase11`, same errno 3780 trap as Phases 1/5/6/7/9/10.
- **2026-09-08:** A null-branch expense is **org-level, not allocated** (1.21.1). A
  branch-scoped P&L includes only rows stamped to that branch; `branchId` null is excluded,
  never split across siblings. The org-wide P&L (no branch named) is the only screen on which
  a software subscription appears. Same stamp-at-write instinct as 1.18.2, with the difference
  that a cost is allowed to have no branch and a payment is not, because a payment is taken at
  a till. Proven in the browser: org-wide P&L showed Software; Main Branch's figure matched
  SQL restricted to `expenses.branchId = Main` and did not.
- **2026-09-08:** Phase 12's Section 5 sketch is a template and a log with string `event` /
  `channel` / `status`. That cannot be scanned twice without texting twice. `event`, `channel`
  and `status` are enums (`NotificationEvent`, `NotificationChannel`, `NotificationLogStatus`);
  `entityType` is a fourth (`MEMBERSHIP` | `INVOICE`) so `entityId` is not an untyped CHAR.
  The unique key `(organizationId, event, entityId, channel, localDate)` is the idempotency
  lock (1.22.1): insert `QUEUED` first, unique violation is a skip, then enqueue with
  `jobId = log.id`. Mapped `notification_logs_idempotency_key` because MySQL identifiers cap
  at 64 characters. `localDate` is the gym's civil `DATE` at `asOf` (1.17.4). A membership in
  the window for seven days can be reminded on each of those days; re-running *today* cannot.
  Rendered `body` is stored on the log so the history screen does not re-render against a
  template that has since changed. A `QUEUED` row whose Redis enqueue failed is deleted so
  the next scan can retry. `COLLATE utf8mb4_bin` on every new `CHAR(26)` in
  `20260908210000_notifications_phase12`, same errno 3780 trap as Phases 1/5/6/7/9/10/11.
- **2026-09-08:** "Expiring soon" for the SMS is the dashboard's seven days (1.22.2 = 1.18.4):
  `ACTIVE`, `startDate <= today <= endDate`, `endDate <= today + 6`, FROZEN/CANCELLED/EXPIRED
  and archived members excluded, `today` is `todayUtc()`. A 3-day or 30-day SMS window would
  disagree with the widget. `PAYMENT_DUE` is `amountPending > 0` against a live member;
  cancelled invoices are already pending 0. Not overridable on the scan.
- **2026-09-08:** BullMQ retries are a decision, not a default (1.22.3). Send jobs use
  `attempts: 3` and exponential backoff from 10 seconds (`NOTIFICATION_BACKOFF_MS`; tests
  force `1`). The log stays `QUEUED` until the last failure, then `FAILED` + `lastError`.
  FAILED for that local date is not re-queued — the unique key still holds. The sender is
  log-only (pino `info`). Password-reset email is **not** moved onto this queue: there is
  still no mail transport, and wiring it here would pretend Phase 12 delivered email. The
  Phase 2 `NODE_ENV` allowlist that returns the raw reset token stays.
- **2026-09-08:** Nightly means 21:00 **at the gym**, not UTC midnight (1.22.4). A repeatable
  tick fires every 15 minutes (`upsertJobScheduler`, so a `tsx watch` restart does not throw).
  For each `ACTIVE` org the tick asks whether the gym-local hour is 21; IST 21:00 is not
  Honolulu 21:00. Hour 21, not a one-minute window, because a 15-minute tick would otherwise
  miss 21:00 exactly. Two clocks: the scheduler is gym-local; the expiry predicate is still
  `todayUtc()` so the SMS agrees with the widget. `POST /notifications/run` skips the hour
  check (ops + harness). `notifications.manage` stays OWNER/ADMIN as 4.2 wrote it — not
  widened to MANAGER; the desk already has the dashboard widget.
- **2026-09-08:** Redis arriving for notifications does **not** migrate the login rate
  limiter onto a Redis store. That limiter is still in-process memory (the 2026-09-06 note
  said "swap in Phase 12"). Moving it now would be a behaviour change on the auth path that
  this phase does not verify. Same reason Section 8 forbade introducing Redis early: a
  feature that needs it is not a license to rewrite every comment that mentioned it.
- **2026-09-08:** Added `apps/api/scripts/dev-redis-sandbox.sh` and a `redis` service in
  `infrastructure/docker/docker-compose.yml` as two equivalent ways to get local Redis —
  same split as MySQL. The sandbox unpacks Ubuntu's `redis-server` .deb plus `liblzf1` /
  `libjemalloc2` under `/tmp` (the binary is dynamically linked; extracting only the server
  package left `liblzf.so.1` unresolved). CI gained a Redis 7 service on 6379. Test queues
  use prefix `gym-test` so they cannot consume a `pnpm dev` worker.
- **2026-09-08:** Phase 13's original "DB changes: none (read-only consumer of existing API)"
  cannot survive "a member can log in." Members had no password; staff JWTs carry `userId` +
  `roleId`; every staff list is gated on `members.view` / `payments.view` and would leak the
  gym. Locked Decision **1.23**: a member is not a User (Section 8). Login is phone +
  password + `organizationSlug`. `members.passwordHash` is nullable — null means portal not
  enabled, and login does the same dummy bcrypt compare as a missing staff user. Setting a
  hash is what turns a gym record into a login. OTP is refused: Phase 12's sender is still
  log-only.
- **2026-09-08:** Staff `refresh_tokens.userId` stays `NOT NULL`. Members get
  `member_refresh_tokens` with the same family/reuse rules (1.23.2). Weakening the staff
  column to also mean "or a member" would make every staff auth query a special case. Access
  JWT `type` is `member_access`; claims are `{ memberId, organizationId }`. A staff token is
  rejected on `/me`; a member token is rejected on staff routes. The middleware split is the
  whole ACL — no Section 4.2 key is granted.
- **2026-09-08:** `GET /me`, `/me/memberships`, `/me/attendance`, `/me/payments`,
  `/me/profile` take the member id from the token only (1.23.3). A `memberId` query string
  is ignored. Status, `daysRemaining`, outstanding are the admin API's computed fields —
  Dart displays them.
- **2026-09-08:** Flutter has no cookie jar and is not same-origin with the API
  (`:8080` vs `:4000` / admin `:5173`), so the Phase 3 httpOnly refresh cookie cannot be
  the member session (1.23.4). Member login/refresh return `refreshToken` in JSON. Access
  token lives in a Riverpod notifier (memory only). Refresh token lives in
  `flutter_secure_storage`; 401s single-flight `POST /auth/member/refresh`; cold start
  reads storage and refreshes. On web that plugin encrypts into `localStorage` — not
  httpOnly; XSS on the Flutter origin can read it. Stated. Native Keystore/Keychain is
  Phase 14 without an API change. Staff login is unchanged (cookie-only, no refresh in
  JSON).
- **2026-09-08:** `CORS_ORIGIN` is a comma-separated allowlist (1.23.5). `localhost` and
  `127.0.0.1` are different origins; both are listed for admin-web (`:5173`) and the
  member app (`:8080`). A single origin would force one local app to lose CORS the day
  the other starts.
- **2026-09-08:** `pnpm-workspace.yaml` no longer globs `apps/*`. Flutter is not a Node
  package; `pnpm install` must not try to treat `apps/member-app` as one. Freezed is
  pinned to 2.5.x because `flutter pub add freezed` resolved `^4.0.0-dev.3`.
- **2026-09-08:** Flutter web CanvasKit mounts a parallel a11y `<input>` tree when
  semantics are enabled. Writing those DOM nodes (or mounting an empty password overlay)
  does not update — and can wipe — the Dart `TextEditingController`s. Login fields are
  `ExcludeSemantics`; the e2e harness clicks **Sign in** against the pre-filled Alice
  controllers rather than setting `input.value`. A splash-only `MaterialApp(home: …)`
  has no `/login` route — Flutter Web then throws on `/#/login` — so
  `MaterialApp.router` stays mounted and the splash is a `builder` overlay. Linux
  desktop and iOS toolchains were not verified in this sandbox; Chrome was, and is
  this phase's target.
- **2026-09-08:** Redis arriving in Phase 12 still does not migrate the login rate
  limiter. Member login has its own in-process limiter keyed on phone. Same reason as
  the 2026-09-08 Phase 12 note: new infrastructure is not a license to rewrite auth.
- **2026-09-09:** Phase 14 Android packaging. `flutter_secure_storage` 11 compiles against
  SDK 37, so `compileSdk = 37` (backward compatible). `INTERNET` is on the **main**
  manifest — Flutter's template only put it on debug/profile, which would ship a
  release APK that cannot call the API. Cleartext on **release** was added the
  same day for LAN sideload (`http://192.168.1.19`); see the later 2026-09-09
  note. It is not production HTTPS.
- **2026-09-09:** `localhost` is the emulator itself. Debug Android defaults to
  `http://10.0.2.2:4000/api/v1`. Web debug still uses `localhost`. Release with an
  empty `API_URL` throws at process start so a Play build cannot silently target
  loopback. No production URL is invented. Native Android does not use CORS.
- **2026-09-09:** Release signing reads gitignored `android/key.properties` + `.jks`.
  `key.properties.example` is committed. Without the properties file, release is
  still debug-signed so local `flutter build apk` works. The local upload keystore
  is for pipeline proof, not a Play App Signing key.
- **2026-09-09:** Phase 14 Android verification dropped the Pixel_6 AVD (unresponsive
  `adb`, too heavy next to MySQL/Redis/API/Cursor) and switched to **sideload of a
  signed fat APK onto a physical phone on the same Wi‑Fi**. That is a legitimate
  — arguably better — test of Keystore-backed `flutter_secure_storage` and real
  network behaviour. It is **not** "runs against production API": the baked URL
  is `http://192.168.1.19:4000/api/v1` (this laptop's LAN address). No production
  host is invented. DoD box 1 stays split: install/run pending phone confirmation;
  production API stays unchecked. iOS still requires macOS + Xcode.
- **2026-09-09:** Cursor sets `GRADLE_USER_HOME=/tmp/cursor-sandbox-cache/…`,
  which re-downloads Gradle's distribution. `apps/member-app/tool/with-host-gradle.sh`
  runs Flutter with `env -i` and `GRADLE_USER_HOME=$HOME/.gradle`. A subsequent
  fat release APK built in ~98s with no zip re-download.
- **2026-09-09:** `app.listen(PORT)` without a host is usually all-interfaces in
  Node, but Phase 14 now binds **`0.0.0.0:4000` explicitly** so a phone can reach
  the API over LAN. `curl http://192.168.1.19:4000/api/v1/health` is 200.
- **2026-09-09:** A release APK talking to LAN `http://` needs cleartext
  (Android 9+). `usesCleartextTraffic` + `network_security_config` allow HTTP on
  this sideload build. That is for local-network verification, not a production
  HTTPS policy. Revisit when a real TLS API exists.
- **2026-09-09:** Phone sideload of `outputs/vedafit-member-lan-192.168.1.19-release.apk`
  showed `DioException [connection timeout]` / `SocketException errno 110` to
  `192.168.1.19` (the `:60616` in that error is the phone's ephemeral source
  port, not the API port). Cause: this laptop's Wi‑Fi address had changed to
  **`10.45.182.169`**. Rebuilt
  `outputs/vedafit-member-lan-10.45.182.169-release.apk`. DHCP/LAN IP is not a
  production host; DoD "against production API" still unchecked.
- **2026-09-09:** Physical-phone confirmation: the `10.45.182.169` signed APK
  installed (WhatsApp sideload, unknown sources) and Alice Portal reached Home
  and Profile with live API data. That satisfies **installs and runs** for
  Android on this host. It does **not** satisfy "against production API" (still
  this laptop on LAN HTTP). iOS still requires macOS + Xcode. Phase 14 stays
  In progress / Not Done. UI look-and-feel is deferred, not a DoD item.
- **2026-09-09:** Same phone session, later screenshots (~20:21 IST) matched
  MySQL + portal API for **Membership**, **Attendance**, and **Payments** (Alice
  ₹500 UPI only; Bob ₹111 absent). Home/Profile still matched. **Force-stop
  session restore was not in that screenshot set** — still unverified. Documentation
  reconciliation: added a top-of-file phase tracker (Phases 14–15 were already in
  Section 7 ~line 2600 of the working tree, easy to miss after Sections 1–6).
  git HEAD of this file is still the Phase 4 commit. Locked Decision **1.24**
  records Phase 15 architecture without migrating tables or writing SaaS code.
- **2026-09-09:** Phase **15.1** (platform identity) implemented. Tables
  `platform_users` + `platform_refresh_tokens` (migration
  `20260909153000_platform_identity_phase15_1`). JWT `platform_access`, cookie
  `platform_refresh`. No `isSuperAdmin`, no SaaS catalog, no Super Admin UI.
  Auth events logged with pino like staff/member login — gym `audit_logs` left
  org-scoped. Phase 15 is In progress; later slices not started.
- **2026-09-10:** Phase **15.2** recorded as Done with no extra tables: platform
  permission is `authenticatePlatform` from 15.1 (every `platform_users` row is
  a full operator). Phase **15.3** implemented `provisionOrganization` /
  `provisionOrganizationInTransaction` (one Prisma `$transaction` for org +
  Main Branch + role matrix + OWNER gym `User` + default notification templates).
  Seed uses it only when `demo-gym` is missing; re-runs refresh catalog/matrix
  and do not rewrite Alice/Bob. No HTTP signup, no SaaS subscription rows, no
  new migration. Phase 15 stays In progress; next slice is 15.4.
- **2026-09-10:** Phase **15.4** implemented `POST /api/v1/platform/signup`
  (public, IP rate-limited, Zod `.strict()`). Calls `provisionOrganization`;
  OWNER then uses `POST /auth/login` (`type: access`). No platform user/token,
  no SaaS subscription, no Super Admin UI, no new migration. Phase 15 stays
  In progress; next slice is 15.5.
- **2026-09-10:** Phase **15.5** added `saas_plans`, `saas_plan_entitlements`,
  `organization_subscriptions` (migration `20260910154500_saas_plans_phase15_5`).
  Seed catalog `trial` / `starter` / `growth`. Demo Gym backfilled to `growth`
  ACTIVE. Signup attaches `trial` TRIAL in the provision transaction. No
  write-time enforcement, no PSP, no Super Admin UI. Phase 15 stays In progress;
  next slice is 15.6.
- **2026-09-09:** Phase 15 **implementation plan** written as Section 10 (design
  only). No migrations, no `apps/super-admin`, no schema.prisma changes, no
  behavior change in api/admin-web/member-app. Logged-in Android screenshots are
  not a force-stop session-restore proof — that box stays open until explicitly
  reported. Production API and iOS remain later work, not this plan's first slice.
- **2026-09-05:** Added `apps/api/scripts/dev-mysql-sandbox.sh` and
  `infrastructure/docker/docker-compose.yml` as two equivalent ways to get a local MySQL for
  development — not present in the original plan, added because this sandbox has neither Docker
  nor usable root MySQL credentials. Not a decision reversal, just local dev tooling. See
  README.md "Local database".

---

## 10. Phase 15 Implementation Plan

**Status of this section:** written 2026-09-09 as design, before 15.1. Slices **15.1–15.13**
are implemented (Section 7). Phase 15 is **Done** (2026-09-14); **10.20** is checked.

This plan extends Locked Decision **1.24**. It fits the code that exists today:
`authenticate` / `authenticateMember`, `tenantScope`, `requirePermission`, nested
`/api/v1/organizations/:organizationId/*`, gym `User`+`Role`+`Permission`, member
`member_access` JWTs, Phase 6 gym `Payment`/`Invoice`, Phase 12 BullMQ, seed-script org
bootstrap (1.7). It does **not** replace those.

### 10.1 Architecture

```
                         PLATFORM (Vedafit)
                    platform_users + saas_plans
                    JWT type: platform_access
                    UI: apps/super-admin (new origin)
                              │
              provisionOrganization()  (one DB transaction)
                              │
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
       GYM A               GYM B               GYM C
   organizations          (same)              (same)
   OrganizationStatus     ACTIVE | SUSPENDED
          │
   branches, users, roles, members,
   membership_plans, memberships,
   invoices, payments, attendances, …
          │
     staff JWT type: access          member JWT type: member_access
     UI: apps/admin-web              UI: apps/member-app
```

Rules that do not change:
- Section 6: `organizationId` / `branchId` from the **staff or member** JWT, never trusted
  from body/query/URL for tenant callers.
- Section 8: no `isAdmin`; no merging User / Member / Trainer; no gym frontend talking to MySQL.
- Gym `MembershipPlan` / `Membership` / `Invoice` / `Payment` remain **member-to-gym** billing.
  SaaS money is a different catalog (10.11, 10.14).
- `POST /organizations` stays absent on the gym API (removed 2026-09-06). Signup lives under
  `/api/v1/platform/…`.

### 10.2 Actors

| Actor | Table today | JWT `type` | Org in token | UI |
|---|---|---|---|---|
| Platform operator (Super Admin) | **new** `platform_users` | `platform_access` | **none** | `apps/super-admin` |
| Gym OWNER / ADMIN / MANAGER / RECEPTIONIST / TRAINER / ACCOUNTANT | `users` + `roles` | `access` | `organizationId`, `branchId` nullable | `apps/admin-web` |
| Gym member | `members` | `member_access` | `organizationId` | `apps/member-app` |

A Super Admin is **not** a gym `User` and **not** a `Member`. Putting `role = SUPER_ADMIN` on
`users` would make every platform action look tenant-scoped and would require punching a hole
in `tenantScope`. Rejected (1.24.1).

Phase 15 v1: **every `platform_users` row is a full operator.** No `platform_roles` /
`platform_permissions` tables until there is a second kind of platform staff (support vs
billing). That is infra-before-need; add it later without changing JWT `type`.

**Impersonation** (mint a staff JWT for a gym as a platform user): **out of Phase 15.** If
ever added, it is a dedicated audited endpoint, not “reuse OWNER login.”

### 10.3 Authentication

Reuse bcrypt (`hashPassword` / `verifyPassword`, 10 rounds), ULID ids, SHA-256 `tokenHash`
CHAR(64), refresh **family** + reuse-revokes-family (Phase 2 / 1.23.2).

**Platform JWT claims:** `{ type: "platform_access", platformUserId }`. No `organizationId`,
no `roleId`. Verify with `verifyPlatformAccessToken` (new, parallel to `verifyMemberAccessToken`).
Staff `authenticate` must keep rejecting this type; `authenticateMember` likewise; new
`authenticatePlatform` rejects `access` and `member_access`.

**Session:** Super-admin is a **browser** app on a **new origin** (proposed `http://localhost:5174`
in dev). Staff already uses an httpOnly cookie (`path=/api/v1/auth`). Use a **distinct**
httpOnly cookie name, e.g. `platform_refresh`, `path=/api/v1/auth/platform`, `SameSite=Lax`,
`Secure` in production. Do not put platform refresh in JSON unless we later ship a native
platform app. Add the super-admin origin to `CORS_ORIGIN`.

**Endpoints (all under `/api/v1/auth/platform`, not mixed into staff `/auth/login`):**

| Method | Route | Actor | Notes |
|---|---|---|---|
| POST | `/auth/platform/login` | public | email + password; rate-limit IP+email like staff |
| POST | `/auth/platform/refresh` | cookie | rotate family |
| POST | `/auth/platform/logout` | cookie or body | revoke family |
| GET | `/auth/platform/me` | `authenticatePlatform` | operator profile |

Staff `/auth/login` and member `/auth/member/login` **unchanged**. Failed platform login does
not consume staff lockout budget.

**Password reset for platform users:** not in first slices. Seed one operator
(`PLATFORM_OPERATOR_EMAIL` / password in `.env.example`). Forgot-password can copy staff
flow later (still log-only mail, Phase 12).

### 10.4 Organization provisioning

Extract seed’s org+branch+matrix+OWNER+templates into `provisionOrganization(input)` used by
seed, public signup, and platform-create. **One Prisma transaction.** Partial rows are a bug.

**Created atomically:**

1. `organizations` — name, slug, email, phone?, timezone (default `Asia/Kolkata`), status
   `ACTIVE` (trial is on the subscription, not a new `OrganizationStatus`).
2. `branches` — one row, name `"Main Branch"` unless signup sends `branchName`.
3. `syncOrganizationRoleMatrix(organizationId)` — existing helper.
4. `users` — OWNER, email+password from the form, `deletedAt` null. Uniqueness: same 1.3
   app-layer rule (`organizationId`+email), plus `SELECT … FOR UPDATE` on the org row.
5. `ensureDefaultTemplates(organizationId)` — existing.
6. `organization_subscriptions` — default SaaS plan, status `TRIAL`, `currentPeriodEnd` =
   now + trial days (default 14, env-configurable).

**Not created:** members, gym memberships, gym invoices, payments, extra branches, extra staff.

**Slice 15.3 implements steps 1–5 only.** **15.5 adds step 6** in the same
`provisionOrganization` transaction (default `trial` / `TRIAL`; seed Demo Gym uses `growth` /
`ACTIVE`). Do not invent a parallel bootstrap.

**Signup fields:** gym `name`, `slug` (`^[a-z0-9-]+$`, globally unique — already
`organizations.slug @unique`), gym `email`, `phone?`, `timezone?`, owner `name`, owner
`email`, owner `password` (same strength rules as staff users). Email verification:
**not required in v1** (Phase 12 sender is log-only). Document as a later slice.

**Failure:** any unique/validation error rolls back the transaction. Slug taken →
`DUPLICATE_ORGANIZATION_SLUG` (exists). Owner email collision is only within the new org, so
it cannot clash with Demo Gym’s `owner@demo-gym.test` unless they pick the same slug.

**After success:** OWNER uses existing `POST /auth/login` with `organizationSlug`. No platform
JWT is issued to the gym owner.

### 10.5 Tenant isolation

Current `tenantScope` (after `authenticate`) compares URL/body/query `organizationId` to
`req.auth.organizationId` and branch-scoped `branchId` to `req.auth.branchId`. Nested gym
routers stay that way.

| Caller | How org is chosen | Cross-tenant |
|---|---|---|
| Super Admin | URL `/platform/organizations/:id` after `authenticatePlatform`. **Must not** run `tenantScope` (that helper calls `getAuth()` / staff JWT). | List/detail/suspend/assign-plan only. Cannot call gym nested routes with a platform token. |
| OWNER / ADMIN | JWT org; URL must match | 403 `ORG_MISMATCH` |
| MANAGER / RECEPTIONIST / TRAINER | JWT org + often `branchId` | 403 `ORG_MISMATCH` / `BRANCH_MISMATCH` |
| ACCOUNTANT | JWT org, `branchId` null (org-wide) | cannot see other orgs |
| Member | token `memberId`+`organizationId`; `/me/*` ignores query member ids (1.23.3) | Alice never sees Bob-in-other-gym or Bob-in-same-gym extras already proven |

Platform token on `/api/v1/organizations/:id/members` → 401 (staff `authenticate` rejects
`platform_access`). Staff token on `/api/v1/platform/organizations` → 401.

Gym OWNER **cannot** list all organizations. That is why `GET /organizations` was removed.

### 10.6 Database changes

**Do not create** a second `organizations` or `branches`. **Do not** add `isSuperAdmin` on
`users`. **Do not** make `audit_logs.organizationId` mean “platform” by stuffing a fake org.

`OrganizationStatus` stays **`ACTIVE | SUSPENDED`**. Commercial trial/past-due lives on the
subscription (10.13). Do not add PENDING/TRIAL/ARCHIVED to that enum in v1.

**Tables justified for v1:**

#### `platform_users`
Purpose: third audience. PK `id` CHAR(26). Columns: `email` (unique, utf8mb4_bin), `name`,
`passwordHash` VARCHAR(60), `status` enum ACTIVE/INACTIVE, `createdAt`, `updatedAt`.
**No `deletedAt` in v1** unless we need the same 1.3 pattern; email unique is global, so
soft-delete would re-open 1.3 — prefer INACTIVE over delete. No `organizationId`.

#### `platform_refresh_tokens`
Same shape as `refresh_tokens` / `member_refresh_tokens`: `id`, `platformUserId`, `familyId`,
`tokenHash` CHAR(64) UNIQUE, `expiresAt`, `revokedAt?`, `createdAt`. Indexes on user and family.

#### `saas_plans`
Platform catalog. PK `id`. `code` UNIQUE (e.g. `starter`, `growth`), `name`, `description?`,
`priceMonthly` Decimal(10,2), `priceYearly` Decimal(10,2), `currency` CHAR(3) default `INR`,
`trialDays` Int, `isActive` Boolean, `createdAt`, `updatedAt`. No `organizationId`.
**No plan versioning table in v1** — changing price does not rewrite history; subscriptions
store `planId` + **price snapshots** (`priceMonthlyAtPurchase`, interval) so old gyms keep
their deal. Versioning table is a later slice if we need formal v2 SKUs.

#### `saas_plan_entitlements`
PK `id`. `planId` FK, `key` VARCHAR(64) (e.g. `members.max`), `valueType` enum
`BOOLEAN | LIMIT | UNLIMITED`, `intValue?`, `boolValue?`. Unique `(planId, key)`.
This is the feature-flag **and** limit store. No separate `feature_flags` table in v1.

#### `organization_subscriptions`
PK `id`. `organizationId` UNIQUE (one live commercial row per gym — historical rows wait until
we have SaaS invoices). `planId` FK, `status` `TRIAL | ACTIVE | PAST_DUE | CANCELLED`,
`billingInterval` `MONTHLY | YEARLY`, `priceSnapshot` Decimal(10,2), `currentPeriodStart`,
`currentPeriodEnd`, `createdAt`, `updatedAt`. No `deletedAt`.

**Tables deferred (not in v1 migration):**
- `platform_roles` / `platform_permissions` — single operator type
- `organization_entitlements` overrides — change the gym’s **plan** instead
- `feature_flags` generic service
- `usage_counters` — v1 enforces by `COUNT(*)` in the same transaction as create
- `saas_invoices` / `saas_payments` — billing **interface** exists (10.14); rows wait until a
  provider or Super Admin “issue invoice” slice
- extra `platform_audit_logs` vs extending gym `audit_logs`: gym `audit_logs.organizationId` is
  **required**. Platform fleet actions have no gym. **v1: `platform_audit_logs`**
  (`id`, `platformUserId?`, `organizationId?`, `entityType`, `entityId`, `action`, `beforeJson`,
  `afterJson`, `createdAt`). Do not write platform events into gym `audit_logs`.

All new CHAR(26) columns: `utf8mb4_bin` (same errno 3780 trap).

### 10.7 API changes

Prefix **`/api/v1/platform`**. Gym tree **`/api/v1/organizations/:organizationId/…`** unchanged.
Do not add `/api/v1/saas` as a second prefix unless it is an alias; keep SaaS under platform.

**Public**

| Method | Route | Actor | Body | Success | Tenant | Audit |
|---|---|---|---|---|---|---|
| POST | `/platform/signup` | none (rate-limited IP) | 10.4 fields | `{ organization, branch, owner: { email } }` no password | creates org | platform audit `ORG_SIGNUP` (actor null) |

**Platform auth** — 10.3.

**Platform authenticated** (`authenticatePlatform` only):

| Method | Route | Permission v1 | Actions |
|---|---|---|---|
| GET | `/platform/me` | any operator | profile |
| GET | `/platform/organizations` | any | paginated list (1.9 params) + subscription status |
| GET | `/platform/organizations/:organizationId` | any | org + OWNER email + subscription + entitlement snapshot |
| POST | `/platform/organizations` | any | same as signup, actor = operator |
| PATCH | `/platform/organizations/:organizationId/status` | any | `ACTIVE` \| `SUSPENDED` only |
| PATCH | `/platform/organizations/:organizationId/subscription` | any | assign `planId`, set status TRIAL/ACTIVE/PAST_DUE/CANCELLED, period end |
| GET | `/platform/plans` | any | list SaaS plans + entitlements |
| POST | `/platform/plans` | any | create plan (v1; can freeze after seed) |
| PATCH | `/platform/plans/:planId` | any | name/price/active; entitlement replace |
| GET | `/platform/audit-logs` | any | filter by org, action, date |
| GET | `/platform/dashboard` | any | counts: orgs by status, trials ending, signups this period |

No gym nested routes on this router. Request `organizationId` in platform URLs is a **resource
id**, not a tenant claim — the operator has no home org.

**Gym-side entitlement errors** (existing routes, new check inside services): create member /
user / branch returns 403 `PLAN_LIMIT_REACHED` or 403 `FEATURE_DISABLED` with the entitlement
key. Staff JWT still supplies org.

**Not reopened:** `GET /api/v1/organizations` (list-all) for staff.

### 10.8 React Super Admin architecture

**Separate application:** `apps/super-admin`. Add to `pnpm-workspace.yaml` next to `admin-web`.
Same stack as gym admin: React 18, Vite, TypeScript, React Router, TanStack Query, Zustand,
Zod, Axios, `@gym/shared-config`. **Do not introduce Tailwind in v1** — gym admin-web does not
use it; it uses the 1.14 brand primitives. Copy `components/ui` only if extracted to
`packages/`; otherwise duplicate the small set (Button, TextField) rather than merging route
trees.

**Why not a route group inside `admin-web`:** OWNER sessions are cookie-scoped to staff auth.
A `/platform` route on the same origin would mix cookies, CORS, and navigation. An OWNER must
not “discover” fleet admin. Separate origin (`:5174`) + `platform_refresh` cookie.

Proposed tree:

```
apps/super-admin/src/
  app/router.tsx
  features/auth/          login
  features/dashboard/
  features/organizations/ list, detail, status, subscription
  features/plans/
  features/audit/
  lib/api-client.ts       platform cookie credentials
```

Pages: Login, Dashboard, Organizations, Organization detail, Plans, Audit logs.
No members/payments screens (those stay gym admin-web).

### 10.9 Existing React Admin impact

`apps/admin-web` remains gym staff only. No Super Admin links in the sidebar.

Optional later (not v1 DoD): hide nav items when entitlements disable `leads.manage` etc. —
**cosmetic**. Enforcement is API-side (10.12). If we hide nav without API checks, curl still
works; if we check API without hiding nav, the UI shows a 403. Do both eventually; API first.

Regression: Demo Gym OWNER login, members, sell membership, payments — existing e2e scripts
must still pass.

### 10.10 Flutter member application

No new member features in Phase 15. No SaaS checkout in the app.

If `OrganizationStatus` is `SUSPENDED`: member login already returns 403 `ACCOUNT_INACTIVE`
(`member-auth.service.ts`). Refresh of an existing session should fail the same way (already
checks org status on refresh). After suspend, Alice sees login or a 403 — not Demo Gym data.
Do **not** add a custom “gym closed” marketing screen in v1 unless the API already returns a
stable error code the app can display (it does: `ACCOUNT_INACTIVE`).

`PAST_DUE` subscription **does not** by itself block member login in v1 (10.13). Only
`SUSPENDED` org status does.

### 10.11 SaaS plans

Distinct from `membership_plans` (gym product Alice buys).

v1 seed catalog (adjustable, not a pricing promise):

| code | intent | members.max | branches.max | staff.max | leads | trainers |
|---|---|---|---|---|---|---|
| `trial` | default signup | 50 | 1 | 3 | false | false |
| `starter` | paid stub | 200 | 1 | 8 | true | true |
| `growth` | paid stub | UNLIMITED | 5 | UNLIMITED | true | true |

Booleans also: `reports.enabled`, `notifications.enabled` (maps to existing modules).
`whatsapp.enabled`, `online_payments.enabled`, `storage.max`, `monthly_sms.max`: **define keys
now, default disabled / 0**, do not build WhatsApp or object-storage in Phase 15.

Pricing: Decimal INR on the plan; billing interval on the subscription. Super Admin can mark
ACTIVE without a PSP (10.14).

### 10.12 Entitlements

Helper `assertEntitlement(organizationId, key, { delta?: number })` called **inside the write
transaction** of `memberService.create`, `userService.create`, `branchService.create`, and
module entrypoints (`leadService.create` if `leads` boolean is false).

Types: BOOLEAN (feature on/off), LIMIT (compare COUNT + delta), UNLIMITED (skip).
Frontend checks are insufficient. Error codes: `FEATURE_DISABLED`, `PLAN_LIMIT_REACHED`.

Read path: gym admin-web may GET `/auth/me` later extended with an entitlements map — **optional
v1**. Not required for DoD if 403s are correct.

### 10.13 Organization lifecycle

Two layers. Do not collapse them into one enum.

**A. `organizations.status` (exists):** `ACTIVE` ↔ `SUSPENDED`.

**B. `organization_subscriptions.status` (new):** `TRIAL` → `ACTIVE` → `PAST_DUE` → `CANCELLED`
(and Super Admin may set these directly in v1).

| State | Staff login | Member login | Gym API writes | Data | Nightly notifications |
|---|---|---|---|---|---|
| New org, sub TRIAL, org ACTIVE | yes | yes (once members exist) | yes, within limits | kept | yes |
| sub ACTIVE, org ACTIVE | yes | yes | yes | kept | yes |
| sub PAST_DUE, org ACTIVE | yes (v1) | yes | **optional read-only** — v1 default: writes still allowed for 7 days then Super Admin suspends. **Decision 10.21.** | kept | yes |
| org SUSPENDED (any sub) | 403 ACCOUNT_INACTIVE | 403 ACCOUNT_INACTIVE | 401/403 on new tokens; old access JWT until TTL (15m) — refresh must re-check org status (already true for members; **verify staff refresh** in slice 15.7) | kept, not deleted | skip org in scan |
| sub CANCELLED, org still ACTIVE | treat as PAST_DUE until suspend | same | same | kept | skip or warn |
| PENDING / ARCHIVED | **no row** / **out of v1** | — | — | — | — |

No hard-delete of gym financial rows (Section 8).

### 10.14 Billing abstraction

v1: **no Stripe/Razorpay**. Interface in code (not necessarily a table):

```
BillingProvider {
  recordManualPayment(subscriptionId, amount, note)
  markPastDue(subscriptionId)
  // later: createCheckout, handleWebhook
}
```

v1 implementation: `ManualBillingProvider` that only updates `organization_subscriptions`
and writes `platform_audit_logs`. Gym `payments` / `invoices` **must not** be written.

Future PSP: new provider + `saas_invoices` table. Webhooks are a later slice (signature
verify, idempotency key). Do not put PSP secrets in the member or gym admin apps.

### 10.15 Audit / security

Gym refunds stay on `audit_logs` (org-scoped, `actorUserId`).

Platform events on `platform_audit_logs`: `ORG_SIGNUP`, `ORG_PROVISIONED`, `ORG_SUSPENDED`,
`ORG_ACTIVATED`, `SUBSCRIPTION_CHANGED`, `PLAN_CHANGED`, `PLAN_ENTITLEMENTS_CHANGED`,
`PLATFORM_LOGIN_FAILED` (optional, rate-limit already exists). **No impersonation event**
because impersonation is forbidden.

Security: three JWT types remain mutually exclusive; cookie names distinct; signup rate
limit; slug uniqueness; passwords hashed; platform list endpoints never return
`passwordHash`; CORS allowlist grows by one origin.

### 10.16 Background jobs

Phase 12 already has a 15-minute tick. **v1 DoD does not require new BullMQ jobs.** Super
Admin can expire trials by hand. When jobs are added (later slice):

- trial `currentPeriodEnd` passed → subscription PAST_DUE (or SUSPEND — 10.21)
- PAST_DUE grace end → `organizations.status = SUSPENDED`
- reminder notifications: **not** gym member SMS; optional platform email (log-only)

Do not reuse `MEMBERSHIP_EXPIRING` templates for SaaS.

### 10.17 Testing

API (Vitest/Supertest), same as every module:
- platform login happy path; staff JWT on platform route 401; member JWT 401; platform JWT on
  `/members` 401
- signup transaction: force a failure after org insert (test hook or unique collision) → zero
  leftover orgs/users
- second org cannot `GET` Demo Gym members (`ORG_MISMATCH`)
- Super Admin `GET /platform/organizations` sees both; gym OWNER cannot
- `members.max = 1` then second member → `PLAN_LIMIT_REACHED`
- suspend org → staff + member login 403; data still in MySQL
- Demo Gym seed still logs in (`owner@demo-gym.test`)
- gym payment/refund tests still pass (no write to gym invoices from SaaS)

admin-web: existing RTL + e2e harnesses.
super-admin: login + org list RTL when the app exists.
member-app: no new screens; optional unit test that 403 ACCOUNT_INACTIVE is shown if we add a
mapped message.

e2e: provision gym B via signup, OWNER B login, create member, prove Alice (gym A) portal
unchanged.

### 10.18 Migration strategy

Additive only. Existing `organizations` / `users` / `members` / gym billing tables untouched
except **new FKs from `organization_subscriptions.organizationId`**.

Backfill: after migrate, for every existing org (Demo Gym) insert one `organization_subscriptions`
row on `growth` or a `legacy` plan with UNLIMITED limits so **no gym is bricked** by
`members.max = 0`. Seed `platform_users` one operator. Seed `saas_plans` catalog.

Rollback: drop new tables; gym app behaves as today. Do not require a down-migration that
deletes gym data.

Staff and member login paths unchanged; they do not read `saas_plans` until entitlement
helpers are wired. **Wire entitlements in a slice after backfill** so Demo Gym is unlimited
before limits go live.

### 10.19 Implementation slices

Each slice independently verifiable. Stop between slices for review.

| Slice | What | Verify |
|---|---|---|
| 15.1 | `platform_users` + refresh table + JWT + middleware + seed operator | login/refresh/logout; wrong JWT type 401 |
| 15.2 | Platform permission = “is a platform user” (no extra tables) | — |
| 15.3 | `provisionOrganization` extracted; seed uses it | `pnpm prisma:seed` still creates Demo Gym |
| 15.4 | `POST /platform/signup` + rate limit | second gym; OWNER logs in via staff auth |
| 15.5 | `saas_plans` + entitlements + backfill Demo Gym unlimited | Demo Gym member create still works |
| 15.6 | `assertEntitlement` on member/user/branch/lead writes | limit test |
| 15.7 | PATCH org status; confirm staff **refresh** re-reads org status | suspend blocks both audiences |
| 15.8 | Platform org list/detail/subscription APIs + dashboard counts | curl/harness |
| 15.9 | `apps/super-admin` Vite app: login, list, suspend, assign plan | headed browser |
| 15.10 | Usage via COUNT not a counter table; optional `/auth/me` entitlements for gym admin | — |
| 15.11 | `platform_audit_logs` on mutations | mysql row |
| 15.12 | Tests listed in 10.17 + gym regression | CI |
| 15.13 | Production hardening (CORS, cookie Secure, env) — **not** cloud deploy | — |
| later | PSP, saas_invoices, platform roles, OpenAPI, iOS, production host | out of Phase 15 DoD |

**Progress (2026-09-14):** 15.1–15.13 Done (15.2 is identity-as-permission, no extra tables).
15.9 headed Chrome (`pnpm --filter super-admin e2e`, 40/0). Admin-web 3–13 re-verified
green; the five 2026-09-13 failures were pre-existing harness/fixture issues (Section 9).
**10.20 checked. Phase 15 Done.** Super Admin responsive retrofit and admin-web Slices 3/5
stay queued (10.22). Do not start “later” items or Phase 16 without approval.

### 10.20 Definition of Done

Not “it compiles.” Phase 15 is Done when **all** of these are true. **Checked 2026-09-14.**

- [x] Migration applied; Demo Gym + Alice/Bob fixtures still work
- [x] Platform operator can sign in; staff/member JWTs cannot call `/platform/*`
- [x] `POST /platform/signup` creates org+branch+OWNER+matrix+templates+trial subscription in
      one transaction; a forced failure leaves nothing
- [x] New OWNER logs in through **existing** `POST /auth/login`
- [x] Super Admin lists both gyms; gym A staff cannot read gym B
- [x] Members remain self-scoped (`/me/*`)
- [x] Entitlements enforced server-side (`PLAN_LIMIT_REACHED` / `FEATURE_DISABLED`)
- [x] Super Admin can suspend/restore; suspended gym staff and members cannot log in
- [x] Platform mutations write `platform_audit_logs`
- [x] Gym `Payment`/`Invoice` rows are unchanged by SaaS actions
- [x] `apps/admin-web` existing e2e still pass
- [x] `apps/member-app` still builds; no required new member screens
- [x] No Stripe/PSP required
- [x] No `isSuperAdmin` on `users`

### 10.21 Risks and decisions requiring approval

1. **PAST_DUE write policy** — keep writes vs read-only vs auto-suspend after N days (10.13).
2. **Tailwind on super-admin** — plan says **no**; match admin-web. Override only if you want a
   different visual system.
3. **Platform roles** — v1 all operators are equal. Approve before adding a matrix.
4. **Email verification at signup** — deferred (no real mailer). Approve if you want to block
   login until verify while mail is still log-only (weak).
5. **Impersonation** — forbidden in Phase 15. Do not add a “login as OWNER” button.
6. **OpenAPI / `packages/api-contract`** — still empty by spec. Do not introduce OpenAPI only
   for this phase; keep hand-synced DTOs (admin-web types, Dart Freezed) as today.
7. **Staff refresh vs SUSPENDED** — confirm `auth.service.refresh` loads organization status
   (members already do). If it does not, slice 15.7 must add it — that is a small gym-auth
   change in service of SaaS lifecycle, not a redesign.
8. **Starting Phase 15 while Phase 14 DoD is open** — allowed (additive) but **not automatic**.
   Production API and iOS stay their own later work. Android force-stop session restore is
   still a Phase 14 checkbox, not a Phase 15 item.
9. **Super Admin on a phone** — `apps/super-admin` is a backoffice fleet tool (list orgs,
   suspend, assign plan). If operators only ever use it at a desk, the responsive retrofit
   can stay deferred indefinitely. Do not spend the Wave 1/2 copy without answering this.

### 10.22 Queued UI (design only — do not start)

Written 2026-09-14 after Phase 15 close-out. **Not started.** Same pattern as the admin-web
responsive pass: plan first, then an explicit go.

**Gate (answer before any Super Admin UI work):** is Super Admin expected on a phone at all?
A yes means copy admin-web’s already-shipped primitives (`DataTable`, `SELECT_CONTROL_CLASS`
/ `form-control`, collapsible `AppShell`) onto `:5174` so native `<select>` / raw tables /
a non-collapsing rail are not the phone experience. A no (desk-only backoffice) is a
legitimate reason to leave Super Admin at desktop indefinitely and pick admin-web Slices
3/5 (dashboard type scale, form density) as polish on a surface that already works on
mobile.

**If the gate is yes — Super Admin retrofit (preferred order only after that yes):**

| Slice | Scope | Proof |
|---|---|---|
| SA-1 | Shell: collapsible sidebar + drawer at ~375, persist collapse at 768/1440. Reuse admin-web `useSidebarNav` pattern, do not invent a second rail. | Super Admin e2e still 40/0; add a narrow-viewport smoke (login + org list visible, no horizontal page scroll). |
| SA-2 | Lists: wrap org / plan tables in the shared `DataTable` (sticky first column, overflow fade). Do not rewrite rows into cards. | Existing `data-testid`s stay on the `<table>`; headed list/suspend/assign still match MySQL. |
| SA-3 | Forms + filters: `SELECT_CONTROL_CLASS` / `TextField` already used in admin-web; Super Admin `Select` must not stay a naked native control. | Create-org + assign-plan still work in the existing Super Admin harness. |

**If the gate is no — admin-web Slices 3/5 instead:**

| Slice | Scope | Proof |
|---|---|---|
| AW-3 | Dashboard type scale (widget values / headings at 375 without overflow). | `pnpm e2e:dashboard` still matches SQL; visual check at 375. |
| AW-5 | Form density (stacked labels, no clipped primary actions on member/plan/trainer create). | Existing phase 4–6 / 9 harnesses still green. |

**Do not:** start PSP, OpenAPI, Phase 16, or Super Admin `DataTable` imports until the
gate is answered. Do not treat this subsection as approval to code.

End of Section 10. Phase 15 is **Done**. Do not start “later” items or Phase 16
without explicit approval.

---

## 11. Contrast + light/dark theme

Written **2026-09-15** from the Gym Admin Memberships + Super Admin Organizations screenshots
and a repo-wide audit of `brand-white/*` opacity. **Slices 0, A, B, and C Done** (same day).
Amends Locked Decision **1.14**; do not silently rewrite the original palette list.

Two pieces, different sizes. **Slice 0 ships even if light mode is later declined.**

### 11.1 What is actually failing (measured, not eyeballed)

1.14 tokens in use: `brand.black` `#000000`, `brand.black-88` `#1F1F1F`, `brand.white`
`#FEF9F5`. Muted copy is **alpha on those**, not a named muted token. Compositing
`brand.white` onto `brand.black` (sRGB, WCAG 2 relative luminance):

| Utility | ≈ result on `#000` | Contrast vs `#000` | vs `#1F1F1F` | AA normal (4.5:1) |
|---|---|---|---|---|
| `text-brand-white` | `#FEF9F5` | ~19.5:1 | ~16:1 | pass |
| `text-brand-white/70` | ~`#B2AFAE` | ~9.5:1 | ~8:1 | pass |
| `text-brand-white/50` | ~`#7F7C7A` | ~5.1:1 | ~5.0:1 | pass (tight) |
| `text-brand-white/40` | ~`#656362` | **~3.6:1** | **~3.1:1** | **fail** |
| `placeholder:text-brand-white/40` | same | **~3.6:1** | **~3.1:1** | **fail** |
| `text-brand-white/30` | ~`#4C4A49` | **~2.4:1** | **~2.1:1** | **fail** |

Screenshot hits that are `/40` (or equivalent):

- Member **phone under the name** (`MembershipsListPage` `text-xs text-brand-white/40`)
- **“N days left”** on the term cell (same file)
- Search **placeholder** — `TextField` `placeholder:text-brand-white/40` in **both** apps
  (“Member name or phone”, “Name, slug, or email”)

Same `/40` (and `/30` decorative em-dashes) also appear on StatusBadge `ARCHIVED` /
`CANCELLED` / `LOST`, AssignMember empty hint, Super Admin plan codes, dashboard widget
hints, invoice “no pending” amounts. Table chrome `text-brand-white/50` on `text-xs`
headers is ~5:1 — keep, do not treat as the bug.

`brand.green` `#C9FF1F` on `#000` is fine as a **fill** (primary Button already uses
`text-brand-black` on the lime). `#C9FF1F` as **text on `#FEF9F5`** is ~**1.1:1** — unusable.
Light mode **must not** paint lime copy on cream.

### 11.2 Slice 0 — contrast fix (both apps, dark only)

**Goal:** every muted/secondary string meets AA against its real background. No theme
toggle yet. 1.14 hex values stay; we stop faking muted with low alpha.

**Mechanism:** add one **solid** muted color to the Tailwind theme (not an opacity):

- `brand.white-muted`: `#C9C4BF` — **locked 2026-09-15** headed Chrome: computed
  `rgb(201, 196, 191)` on `rgb(0, 0, 0)` = **12.13:1** (AA 4.5:1). Phone, days-left,
  and both search placeholders. Not an opacity of `brand.white`.

Replace:

- `text-brand-white/40`, `/30`, and placeholder `/40` → `text-brand-white-muted` /
  `placeholder:text-brand-white-muted`
- StatusBadge receding states (`ARCHIVED`, `CANCELLED`, `LOST`) that use `/40` → the
  same muted solid
- Leave `/50` headers and `/70` secondary cells unless a computed check shows a
  `black-88` stack that drops under 4.5

**Touch count (today):** `text-brand-white/30|/40` in **~18 files** (admin-web ~12,
super-admin ~6) plus **both** `TextField.tsx` copies. `brand-white/` overall is ~50 files
because `/10` borders and `/5` hover are **not** text contrast — do not mass-replace those
in Slice 0.

**Shared `TextField` / `StatusBadge`:** two copies (no shared UI package). Change both.

**Do not in Slice 0:** light mode, `data-theme`, Recharts rewrite, member-app, Super Admin
responsive (10.22 still gated).

**Verify Slice 0:** headed Chrome on Memberships + Super Admin Organizations. Helper on the
existing e2e `computed()` path: parse `color` + `backgroundColor` (walk ancestors if
transparent) and assert ratio ≥ 4.5 for phone, “days left”, and `::placeholder`.
Screenshots: those two screens at 1440. Existing phase 3/8 harnesses still expect
`BRAND_RGB.white` on headings — those stay.

### 11.3 Light mode — amend 1.14, do not overwrite it

1.14 stays the **dark** theme (default). Light is an **additive** mapping of the same
brand into semantic tokens. Dated Section 9 entry when implementation starts.

**Default:** dark. First visit without `localStorage` is dark so every existing e2e stays
deterministic. **Do not** follow `prefers-color-scheme` on first paint (would flake
harnesses and surprise a product that has only ever been black).

**Toggle:** `data-theme="dark" | "light"` on `<html>`. Tiny inline script in each
`index.html` **before** React (same reason `body` is already `@apply bg-brand-black` —
avoid a white flash). Persist `localStorage` key:

- admin-web: `vedafit.admin.theme` (`"light"` | `"dark"`) — sibling of
  `vedafit.admin.sidebarCollapsed`
- super-admin: `vedafit.platform.theme` — **not** the same key (separate origin, separate
  preference)

Toggle control: icon button on the **Topbar**, right of the branch picker / left of Sign
out, `aria-pressed`, `data-testid="theme-toggle"`. Not in the sidebar (collapse already
lives there).

**Tokens (CSS variables on `:root` / `[data-theme="light"]`).** Tailwind maps utilities to
`var(...)`, not to `brand.black` in components:

| Token | Dark (1.14) | Light |
|---|---|---|
| `--color-bg` | `#000000` | `#FEF9F5` |
| `--color-surface` | `#1F1F1F` | `#FFFFFF` (or 4% tint of black on cream) |
| `--color-fg` | `#FEF9F5` | `#141414` |
| `--color-fg-muted` | Slice 0 `#C9C4BF` | `#5C5854` (**6.74:1** on cream, locked 2026-09-15) |
| `--color-border` | white @ 10–20% | black @ 10–15% |
| `--color-accent` | `#C9FF1F` | **same lime as fill only** |
| `--color-accent-fg` | `#000000` | `#000000` (text **on** the lime button) |
| `--color-accent-text` | `#C9FF1F` (links on black) | `#3D4D00` (**8.89:1** on cream; not lime) |
| `--color-danger` | today’s `red-300` | `#9B1C1C` (**7.79:1** on cream) |
| `--color-warning` | today’s `amber-300` | `#92400E` (**6.78:1** on cream) |

Components use `bg-bg`, `text-fg`, `text-fg-muted`, `border-border`, `bg-accent`,
`text-accent-fg` — **not** `bg-brand-black` / `text-brand-white` once Slice A/B migrate
them. `brand.*` remains in `tailwind.config.ts` as the **source values** for the dark
theme variables so 1.14 stays the named palette.

**Accent decision (locked for this plan, confirm in Slice A with computed CSS):**

- Primary **buttons stay lime** in both themes (`bg-accent` + `text-accent-fg` black). That
  already matches `Button` primary today and still works on cream (black on `#C9FF1F` is
  ~12:1).
- **Do not** use lime for body/link/heading text in light mode.
- Sidebar active state in light: lime fill + black label, or a 15% lime wash +
  `accent-text` — pick whichever computed pair is ≥4.5:1.

**Tailwind:** v3 `theme.extend.colors` → `{ bg: "var(--color-bg)", ... }`. No
`darkMode: 'class'` parallel system; one `data-theme` attribute is enough. Do not
introduce a third Tailwind `dark:` namespace that would drift from the tokens.

**FOUC:** inline script sets `data-theme` from localStorage; `index.css` default
`:root` is dark (1.14).

### 11.4 What has to change (scale)

There is **no shared component package**. Super Admin copied `Button` / `TextField` /
`Select` / `StatusBadge` / shell. Token CSS can be duplicated in both `index.css` files
(same as today’s duplicated `tailwind.config.ts` palette) — **do not** extract
`packages/ui` in this work.

| Area | Admin-web | Super-admin |
|---|---|---|
| `index.css` + `index.html` script | 1 | 1 |
| `tailwind.config.ts` | 1 | 1 |
| `useTheme` + Topbar toggle | new hook next to `useSidebarNav` | copy; own storage key |
| Primitives (`Button`, `TextField`, `Select`, `StatusBadge`, `DataTable`, `form-control`, `Spinner`, `ConfirmDialog`) | ~8 files | ~7 files (no DataTable / form-control yet) |
| Shell (`AppShell`, `Sidebar`, `Topbar`) | 3 | 3 |
| Feature pages using `bg-brand-*` / `text-brand-*` | **~35** under `src/features` | **~8** |
| Login | 1 | 1 |
| Hardcoded Recharts `CHART` RGB in `DashboardPage` | **must** read `getComputedStyle` / CSS vars — today it bypasses Tailwind | Super Admin dashboard has no Recharts (flag if that changes) |
| e2e `BRAND_RGB` + phase 3/4/… heading color asserts | keep as **dark-theme** expectations; new `e2e:theme` | Super Admin e2e 40/0 stays dark unless the new harness sets the key |

Roughly **~55 admin-web files** and **~20 super-admin files** if Slice A/B replace
`brand-black` / `brand-white` utilities. Slice 0 is the small `/30|/40` set only.

### 11.5 Slice order

| Slice | Scope | Proof |
|---|---|---|
| **0** | **Done 2026-09-15.** Solid `white-muted` `#C9C4BF` + replace failing `/30|/40` + placeholders + receding badges in **both** apps | Headed Chrome: **12.13:1** (`rgb(201, 196, 191)` on `rgb(0, 0, 0)`) for phone, days-left, both placeholders. `pnpm e2e:contrast` 8/0. No toggle. |
| **A** | **Done 2026-09-15.** CSS variables + `data-theme` + admin-web migration + Topbar toggle + persist + Recharts from tokens | `vedafit.admin.theme` survives reload. Dark still 1.14 RGB. Light: phone **6.74:1**, heading **17.62:1**, accent-text **8.89:1**, lime button fill unchanged. Chart stroke lime. Ticks were planned as `rgba(20,20,20,0.55)` (**4.03:1**, fail); locked to solid `fg-muted` `#5C5854` **7.05:1** on white. `pnpm e2e:slice-a` **45/0**. Phase 3 **51/0**, Phase 8 **56/0**. |
| **B** | **Done 2026-09-15.** Same tokens + toggle on super-admin (`vedafit.platform.theme`) | Phase 15 **40/0** in dark. Light: heading **17.62:1**, org link / ACTIVE **8.89:1**, placeholder **6.74:1**, TRIAL **6.78:1**, plan code **7.05:1**. Lime fill unchanged. `pnpm e2e:slice-b` **33/0**. Screenshots orgs / org detail / plans at 375/768/1440 both modes. |
| **C** | **Done 2026-09-15.** Combined `e2e:theme` smoke across both apps | Dual-origin, one Chrome session. **Adds** key isolation (`vedafit.admin.theme` vs `vedafit.platform.theme` do not leak across `:5173` / `:5174`) and token parity (both CSS copies still resolve to the locked light RGBs). **Does not** redo A/B’s per-app matrix (chart ticks, status variants, 375/768/1440 shots). Sampled computed contrast both themes both apps + persist. `pnpm e2e:theme` **47/0**. |

Do **not** one giant pass across both apps. Slices 0 → A → B → C shipped in that order.

### 11.6 Out of scope / flags noticed in this audit

- **Member Flutter app:** out. Different renderer; 1.14 there is a Dart `theme.dart`.
- **Admin-web Slices 3/5** (dashboard type scale, form density at 375): still queued (10.22).
  This work does not retune font sizes by breakpoint except where a contrast class sits on
  the same node. “Typography according to screen size” is that other track.
- **Super Admin responsive (10.22):** still gated on “is this used on a phone?”. Light mode
  on a non-collapsing rail at 375 will look cramped; do not pretend Slice B is a mobile
  retrofit.
- **e2e will go red** if light becomes default or if phase 3 asserts `BRAND_RGB.white` after
  components switch tokens without keeping dark values identical.
- **`text-amber-300` / `text-red-300`:** Slice A maps these to `--color-warning` / `--color-danger`.
  Light locked `#92400E` / `#9B1C1C` (6.78:1 / 7.79:1 on cream).
- **Browser autofill / native `<select>`** still ignore CSS in some engines; Slice 0
  cannot fix OS-drawn dropdowns.
- **No `packages/ui`.** Duplicating tokens is the existing architecture. Extracting a
  package would be a third project.
- **Favicon / `theme-color` meta:** not set per theme today; optional in A (`<meta name="theme-color">` from the bg token).

**Section 11 is Done.** Super Admin responsive (10.22 SA-1/2/3 — collapsible shell, DataTable,
shared select chrome) is the logical next UI pass; it is still gated and was not started here.

