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

Four terminals, in order:

```bash
# 1. Database
cd apps/api && bash scripts/dev-mysql-sandbox.sh start

# 2. API — the short TTL is what makes the token-expiry step honest rather than simulated
cd apps/api && JWT_ACCESS_TTL=5s pnpm dev

# 3. Admin web
cd apps/admin-web && pnpm dev

# 4. Verification
cd apps/admin-web && pnpm e2e
```

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
