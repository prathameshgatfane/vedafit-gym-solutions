# Super Admin browser verification

Real-Chrome, real-API, real-MySQL proof for the 15.9 surface. jsdom RTL is not a substitute.

Excluded from `pnpm test` and CI. `puppeteer-core` drives the machine Chrome.

```bash
cd apps/api && bash scripts/dev-mysql-sandbox.sh start
cd apps/api && pnpm dev
cd apps/super-admin && pnpm dev
cd apps/super-admin && pnpm e2e
```

Creates a namespaced org (`e2e-sa-<timestamp>`). Does **not** suspend or replan Demo Gym.
