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
- Do not start a phase whose dependencies (listed under "Depends on") aren't `Done`.

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

Wired into `apps/admin-web`'s Tailwind config as named theme colors (`brand.black`,
`brand.black-88`, `brand.green`, `brand.green-muted`, `brand.white`) — never hardcoded as raw hex
in components — so the palette can be corrected in one place later without touching any component.
This is registered now (Phase 1) but **not applied to any UI yet** — Phase 3 (login screen/layout)
is the first phase that actually styles anything with it. Same "config now, features later" pattern
as the rest of Phase 0/1.

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
model Payment {
  id             String        @id @db.Char(26)
  organizationId String
  memberId       String
  membershipId   String?
  invoiceId      String?       // links a payment to the invoice it's paying down
  amount         Decimal       @db.Decimal(10, 2)
  method         PaymentMethod
  status         PaymentStatus @default(SUCCESS)
  paidAt         DateTime      @default(now())
  createdAt      DateTime      @default(now())

  member     Member      @relation(fields: [memberId], references: [id])
  membership Membership? @relation(fields: [membershipId], references: [id])
  invoice    Invoice?    @relation(fields: [invoiceId], references: [id])
}

model Invoice {
  id             String        @id @db.Char(26)
  organizationId String
  memberId       String
  invoiceNumber  String        // human-readable, e.g. INV-2026-000123 — see Phase 6 notes
  amountTotal    Decimal       @db.Decimal(10, 2)
  amountPaid     Decimal       @db.Decimal(10, 2) @default(0)
  amountPending  Decimal       @db.Decimal(10, 2)
  status         InvoiceStatus @default(DRAFT)
  createdAt      DateTime      @default(now())
  updatedAt      DateTime      @updatedAt

  member   Member    @relation(fields: [memberId], references: [id])
  payments Payment[]

  @@unique([organizationId, invoiceNumber])
}

model Attendance {
  id             String   @id @db.Char(26)
  organizationId String
  branchId       String
  memberId       String
  checkedInAt    DateTime @default(now())

  member Member @relation(fields: [memberId], references: [id])

  @@index([memberId, checkedInAt])
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
`membership-plans.manage`,
`memberships.create`, `memberships.freeze`, `memberships.cancel`, `memberships.renew`,
`payments.create`, `payments.view`, `payments.refund`,
`invoices.view`, `invoices.manage`,
`attendance.mark`, `attendance.view`,
`trainers.manage` (Phase 9), `leads.manage` (Phase 10), `expenses.manage` (Phase 11),
`reports.view`, `settings.manage`, `notifications.manage` (Phase 12)

### 4.2 Default role → permission matrix
- **OWNER** — every permission, always. Not editable via UI.
- **ADMIN** — everything except `organizations.update` (owner-only) and `roles.manage`.
- **MANAGER** — `members.*`, `membership-plans.manage`, `memberships.*`, `payments.create`,
  `payments.view`, `attendance.*`, `reports.view`, `trainers.manage`, `leads.manage`.
- **RECEPTIONIST** — `members.create`, `members.view`, `members.update`, `memberships.create`,
  `payments.create`, `attendance.mark`, `leads.manage`.
- **ACCOUNTANT** — `payments.*`, `invoices.*`, `expenses.manage`, `reports.view`.
- **TRAINER** — `attendance.view` (own sessions only, enforced in service logic, not just RBAC),
  `members.view` (read-only, assigned members only).

This matrix is seeded per-organization at org-creation time (each org gets its own `Role` rows so
future custom roles/permission tweaks per-org are possible without a schema change).

---

## 5. Future Schema Sketches (designed now, not migrated until their phase)

Kept here so Phase 1's schema doesn't need breaking changes when these phases arrive.

```prisma
// Phase 9
model TrainerProfile {
  id             String   @id @db.Char(26)
  userId         String   @unique // 1:1 with User — trainer is a User with role TRAINER
  specialization String?
  commissionPct  Decimal? @db.Decimal(5, 2)
  createdAt      DateTime @default(now())
}

// Phase 10
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

// Phase 11
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
**DB changes:** none beyond Phase 1 (RefreshToken/PasswordResetToken already exist)
**Definition of Done:**
- [ ] Login returns access token + sets httpOnly refresh cookie
- [ ] `/auth/me` returns `{ user, organization, branches }`
- [ ] Refresh rotation + reuse detection covered by a test
- [ ] Cross-tenant test: org A's token cannot read/write org B's data (any module)
- [ ] Permission-denied test: RECEPTIONIST role blocked from an ADMIN-only route
- [ ] Rate limiting confirmed on login endpoint
**Status:** Not started

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
- [ ] Can log in with seeded OWNER user and land on an empty dashboard shell
- [ ] Refreshing the page preserves session (via refresh cookie)
- [ ] Logging out clears session and redirects to login
- [ ] Protected routes redirect unauthenticated users to login
**Status:** Not started

### Phase 4 — Admin: Members module
**Depends on:** Phase 3
**Goal:** Full member CRUD from the UI, exercising the pagination/filter convention end to end.
**Scope:**
- API: `members` module list/search/filter/create/edit/view/archive endpoints
- Admin: `features/members` — list table, search/filter bar, create/edit form, detail view, archive action
- `member_documents` deferred (needs object storage — not yet)
**DB changes:** none beyond Phase 1
**Definition of Done:**
- [ ] Create/edit/archive a member through the UI, confirmed in DB
- [ ] Search + status filter + pagination all work together
- [ ] Duplicate-phone attempt shows a friendly error (service-layer check from 1.3 surfaced properly)
- [ ] RBAC: RECEPTIONIST can create/view members but not archive (per matrix in Section 4.2)
**Status:** Not started

### Phase 5 — Memberships (plans, renewals, freeze, cancel, trials)
**Depends on:** Phase 4
**Goal:** Members can be enrolled in plans; the full membership lifecycle works.
**Scope:**
- API: `membership-plans` CRUD; `memberships` create/renew/upgrade/downgrade/freeze/cancel
- Snapshot pricing logic (`priceAtPurchase`/`durationDaysAtPurchase`) implemented on create
- Lazy expiry computation (1.8) implemented in the read path
- Admin: `features/membership-plans`, `features/memberships` (assign plan, renew, freeze/cancel actions)
**DB changes:** none beyond Phase 1
**Definition of Done:**
- [ ] Assigning a plan creates a Membership with frozen price/duration snapshot
- [ ] Changing a plan's price afterward does not affect already-issued memberships (tested explicitly)
- [ ] Freeze/cancel/renew transitions all update status correctly, with invalid transitions rejected
  (e.g. can't renew a CANCELLED membership)
- [ ] A membership whose `endDate` has passed displays as EXPIRED on read, without a cron job
**Status:** Not started

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
**DB changes:** none beyond Phase 1
**Definition of Done:**
- [ ] Creating a membership generates an invoice with correct amountTotal/Paid/Pending
- [ ] Partial payments correctly update `amountPaid`/`amountPending` and invoice status
- [ ] Refund flow never deletes a payment row; AuditLog entry created
- [ ] ACCOUNTANT role can refund; RECEPTIONIST cannot (per matrix)
**Status:** Not started

### Phase 7 — Attendance (manual)
**Depends on:** Phase 4
**Goal:** Front-desk can mark attendance manually; QR check-in deferred.
**Scope:**
- API: `attendance` mark/list (by member, by date range, by branch)
- Admin: `features/attendance` — manual check-in search + button, daily attendance list
**DB changes:** none beyond Phase 1
**Definition of Done:**
- [ ] Marking attendance for a member with an active membership works
- [ ] Marking attendance for a member with no active membership shows a warning but is still allowed
  (front desk override) — decide and document actual behavior here once built
- [ ] Attendance list filterable by branch/date
**Status:** Not started

### Phase 8 — Dashboard (real data)
**Depends on:** Phases 5, 6, 7
**Goal:** Replace placeholder dashboard with real revenue/members/attendance/pending-payments/expiring-memberships widgets.
**Scope:**
- API: `reports` module — aggregate queries backing each widget
- Admin: `features/dashboard` with Recharts visualizations
**DB changes:** none beyond Phase 1 (may add indexes if aggregate queries are slow)
**Definition of Done:**
- [ ] All 5 widgets show real numbers matching manual DB queries
- [ ] Dashboard respects branch scoping (a branch-scoped user sees only their branch's numbers)
**Status:** Not started

### Phase 9 — Trainers
**Depends on:** Phase 8
**Goal:** Trainer profiles, assignment to members/classes.
**Scope:** `TrainerProfile` table (Section 5) migrated; API + Admin `features/trainers`.
**DB changes:** add `TrainerProfile`
**Definition of Done:**
- [ ] Existing User with TRAINER role can have a TrainerProfile created/edited
- [ ] Trainer's own attendance/schedule view respects `attendance.view` (own-only) restriction
**Status:** Not started

### Phase 10 — Leads / CRM
**Depends on:** Phase 8
**Goal:** Track prospective members through a simple pipeline; convert to Member.
**Scope:** `Lead` table (Section 5) migrated; API + Admin `features/leads`.
**DB changes:** add `Lead`
**Definition of Done:**
- [ ] Lead CRUD works with status pipeline (NEW → CONTACTED → TRIAL_SCHEDULED → CONVERTED/LOST)
- [ ] Converting a lead creates a Member and links `convertedMemberId`
**Status:** Not started

### Phase 11 — Expenses + Reports
**Depends on:** Phase 8
**Goal:** Track operational costs; extend reports with profit/loss-style views.
**Scope:** `Expense` table (Section 5) migrated; API + Admin `features/expenses`, extended `features/reports`.
**DB changes:** add `Expense`
**Definition of Done:**
- [ ] Expense CRUD works, scoped by branch where applicable
- [ ] Reports show revenue vs. expenses for a date range
**Status:** Not started

### Phase 12 — Notifications + Automation (Redis/BullMQ introduced here)
**Depends on:** Phase 11
**Goal:** Proactive expiry/payment-due notifications — the first real background-job use case.
**Scope:**
- `NotificationTemplate`/`NotificationLog` tables (Section 5) migrated
- Redis + BullMQ introduced now (not before): a nightly job scans for expiring memberships/pending
  payments and queues notification jobs
- `services/notification/` and `services/queue/` added to `apps/api/src`
**DB changes:** add `NotificationTemplate`, `NotificationLog`
**Definition of Done:**
- [ ] BullMQ worker processes a queued notification job end-to-end (log-only sender is fine initially)
- [ ] Nightly job correctly identifies memberships expiring in N days
- [ ] Admin: `features/notifications` shows notification log/history
**Status:** Not started

### Phase 13 — Member Flutter app (Web/Chrome first)
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
- [ ] Member can log in and see their own membership/attendance/payment history on Web/Chrome
- [ ] No business logic duplicated in Flutter (all computed values come from the API)
**Status:** Not started

### Phase 14 — Android, then iOS builds
**Depends on:** Phase 13
**Goal:** Ship installable builds.
**Scope:** Android APK/AAB build config, then iOS build config.
**DB changes:** none
**Definition of Done:**
- [ ] Signed Android build installs and runs against production API
- [ ] iOS build runs on a real device or TestFlight
**Status:** Not started

### Phase 15 — Super Admin / SaaS layer
**Depends on:** Phase 14 (or earlier, if prioritized sooner — it's additive, not blocking)
**Goal:** Organizations become self-serve: subscriptions, billing, feature flags, real onboarding.
**Scope:** New `super-admin` surface, organization self-signup (replaces the Phase 1 seed-script
bootstrap), subscription/billing entities, feature flag system.
**DB changes:** new tables for subscriptions/plans/feature flags (designed when this phase starts —
intentionally not speculated further here, per "don't build infra before you need it")
**Definition of Done:** (to be detailed when this phase starts)
**Status:** Not started

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
- **2026-09-05:** Added `apps/api/scripts/dev-mysql-sandbox.sh` and
  `infrastructure/docker/docker-compose.yml` as two equivalent ways to get a local MySQL for
  development — not present in the original plan, added because this sandbox has neither Docker
  nor usable root MySQL credentials. Not a decision reversal, just local dev tooling. See
  README.md "Local database".
