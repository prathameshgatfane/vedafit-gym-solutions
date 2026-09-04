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

## Getting started

```bash
pnpm install

# Run the API in dev mode
pnpm -F api dev

# Run the Admin web app in dev mode
pnpm -F admin-web dev
```

Each app has its own `.env.example` — copy it to `.env` in the same directory before running:

```bash
cp apps/api/.env.example apps/api/.env
cp apps/admin-web/.env.example apps/admin-web/.env
```

## Common scripts (run from repo root)

```bash
pnpm lint        # lint all workspaces
pnpm typecheck    # typecheck all workspaces
pnpm test         # test all workspaces
```

## Current status

Phase 0 (repo/tooling scaffold) — see [`docs/architecture/DEVELOPMENT_PLAN.md`](docs/architecture/DEVELOPMENT_PLAN.md)
for exact status of every phase. Database/Prisma/feature modules are not implemented yet (Phase 1+).
