# Super Admin browser verification

Real-Chrome, real-API, real-MySQL proof for the 15.9 surface. jsdom RTL is not a substitute.

Excluded from `pnpm test` and CI. `puppeteer-core` drives the machine Chrome.

```bash
cd apps/api && bash scripts/dev-mysql-sandbox.sh start
cd apps/api && pnpm dev
cd apps/super-admin && pnpm dev
cd apps/super-admin && pnpm e2e

# Slice B — tokens + theme toggle (own key vedafit.platform.theme; not admin-web).
cd apps/super-admin && E2E_HEADFUL=1 pnpm e2e:slice-b
```

Creates a namespaced org (`e2e-sa-<timestamp>`). Does **not** suspend or replan Demo Gym.

`e2e:slice-b` asserts computed contrast in both themes, persist across reload, and writes
orgs / org detail / SaaS plans screenshots at 375 / 768 / 1440. It does not replace `pnpm e2e`.

Combined dual-origin smoke (Slice C) lives on admin-web: both apps must be up, then
`cd apps/admin-web && E2E_HEADFUL=1 pnpm e2e:theme`. That pass proves the two storage keys
do not leak across origins; it does not replace this harness.
