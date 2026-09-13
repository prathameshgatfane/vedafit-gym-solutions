# Gym Management Platform

A multi-tenant gym management system: an Admin web app (React) backed by a Node.js/Express API,
with a Flutter member app to follow once the Admin + API surface is stable.

**Start here:** [`docs/architecture/DEVELOPMENT_PLAN.md`](docs/architecture/DEVELOPMENT_PLAN.md) is
the single source of truth for architecture decisions and the phase-by-phase build plan. Read it
before making any structural changes.

## Repository layout

```
apps/
  admin-web/   React + TypeScript + Vite (Admin dashboard)
  api/         Node.js + Express + TypeScript (REST API)
  member-app/  Flutter (added Phase 13+)
packages/
  shared-config/  Shared ESLint + TypeScript base config
docs/
  architecture/   Architecture decisions and the phase tracker (DEVELOPMENT_PLAN.md)
```

## Prerequisites

- Node.js 20.x
- pnpm 10.x (`corepack enable` or `npm i -g pnpm`)
- Flutter 3.44+ on `PATH` for `apps/member-app` (Web/Chrome). Android/iOS toolchains are
  Phase 14; this repo's sandbox verifies Chrome only.

## Getting started

```bash
pnpm install

# Run the API in dev mode
pnpm -F api dev

# Run the Admin web app in dev mode
pnpm -F admin-web dev

# Member Flutter app (Web/Chrome) — not a pnpm workspace package
cd apps/member-app && flutter run -d chrome --web-port 8080
```

Each app has its own `.env.example` — copy it to `.env` in the same directory before running:

```bash
cp apps/api/.env.example apps/api/.env
cp apps/admin-web/.env.example apps/admin-web/.env
```

### Local database (MySQL)

Preferred: Docker.

```bash
docker compose -f infrastructure/docker/docker-compose.yml up -d
```

If Docker isn't available (e.g. this sandbox — no Docker, and the system MySQL is AppArmor-confined
and has no known root credentials), use the no-Docker fallback instead. It runs an unprivileged
`mysqld` under `/tmp` on the same port (3307), so `DATABASE_URL` is identical either way:

```bash
apps/api/scripts/dev-mysql-sandbox.sh start   # init + start, creates gym_dev + gym_test
apps/api/scripts/dev-mysql-sandbox.sh status
apps/api/scripts/dev-mysql-sandbox.sh stop
```

### Local Redis (Phase 12)

The nightly notification job and the send worker need Redis. Same two paths as MySQL:
`docker compose` (service `redis` on 6379) or the no-Docker sandbox:

```bash
apps/api/scripts/dev-redis-sandbox.sh start   # unpacks the Ubuntu .deb under /tmp if needed
apps/api/scripts/dev-redis-sandbox.sh status
apps/api/scripts/dev-redis-sandbox.sh stop
```

`REDIS_URL` defaults to `redis://127.0.0.1:6379` either way. `pnpm test` for `apps/api` now
hits a real queue (prefix `gym-test`); Redis must be up or the Phase 12 tests hang on connect.

Then run migrations/seed:

```bash
pnpm --filter api prisma migrate dev
pnpm --filter api prisma db seed
```

The seed prints the bootstrap OWNER credentials. To get a token:

```bash
curl -X POST http://localhost:4000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"owner@demo-gym.test","password":"ChangeMe123!"}'
```

Every route outside `/api/v1/auth/*` and `/api/v1/health` needs
`Authorization: Bearer <accessToken>`. The refresh token is set as an httpOnly cookie scoped to
`/api/v1/auth`, so `curl -c/-b` (or `fetch(..., { credentials: "include" })`) is enough to keep a
session alive across `POST /api/v1/auth/refresh`.

## Common scripts (run from repo root)

```bash
pnpm lint        # lint all workspaces
pnpm typecheck    # typecheck all workspaces
pnpm test         # test all workspaces
```

Note: `pnpm test` for `apps/api` runs against a real MySQL database (`gym_test`) **and** a real
Redis on 6379 (Phase 12's BullMQ worker), so both sandboxes — or `docker compose` — must be up.

## Current status

Phases 0–13 done (admin API + admin-web through notifications, plus the member Flutter
portal on Web/Chrome). See
[`docs/architecture/DEVELOPMENT_PLAN.md`](docs/architecture/DEVELOPMENT_PLAN.md) for the
exact status of every phase.

Admin UI: API + `apps/admin-web` (`pnpm dev` in each), http://localhost:5173, seeded staff
above. Member portal: `cd apps/member-app && flutter run -d chrome --web-port 8080`, then
`+919111100001` / `ChangeMe123!` / `demo-gym` after `pnpm tsx scripts/phase13-fixtures.ts`
in `apps/api`. Phase 14 is Android/iOS builds.
