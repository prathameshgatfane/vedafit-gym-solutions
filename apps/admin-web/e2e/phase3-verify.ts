/**
 * Phase 3 verification — real Chrome, real API, real database.
 *
 * Run with:
 *   1. MySQL up            (apps/api: bash scripts/dev-mysql-sandbox.sh start)
 *   2. API up              (apps/api: JWT_ACCESS_TTL=5s pnpm dev)
 *   3. Admin web up        (apps/admin-web: pnpm dev)
 *   4. pnpm e2e
 *
 * The short JWT_ACCESS_TTL is what makes step 5 an honest test: the access token really does
 * expire mid-session, so the 401 the interceptor recovers from is genuine rather than simulated.
 *
 * Excluded from `pnpm test` and from CI on purpose (see vitest.config.ts).
 */
import {
  APP_URL,
  BRAND_RGB,
  check,
  checkEqual,
  computed,
  formatCalls,
  forwardPageErrors,
  launch,
  recordApiCalls,
  screenshot,
  sleep,
  step,
  summary,
} from "./lib/harness";

const OWNER_EMAIL = process.env.E2E_EMAIL ?? "owner@demo-gym.test";
const OWNER_PASSWORD = process.env.E2E_PASSWORD ?? "ChangeMe123!";

/** Long enough to outlive the API's JWT_ACCESS_TTL=5s in step 5. */
const TOKEN_TTL_WAIT_MS = 7000;

/**
 * Vite's dev server serves each source file at a stable URL, and the browser caches ES modules by
 * URL — so importing this path inside the page hands back the *same* module instance the running
 * app is using, with its real axios interceptors and real in-memory token.
 */
const API_CLIENT_MODULE = "/src/lib/api-client.ts";

/** Must match REFRESH_COOKIE_NAME in apps/api/src/modules/auth/auth.controller.ts. */
const REFRESH_COOKIE = "refresh_token";

/**
 * Express sends an ETag on JSON responses, so a repeated GET comes back 304 Not Modified on the
 * wire while the browser serves the cached body and the JS caller still sees a 200 with data.
 * Both mean "this request succeeded", so wire-level assertions accept either.
 */
const OK = (status: number) => status === 200 || status === 304;

async function main(): Promise<number> {
  const browser = await launch();
  const page = await browser.newPage();
  const api = recordApiCalls(page);
  forwardPageErrors(page);

  try {
    // ---------------------------------------------------------------------
    step("1. Unauthenticated visit to a protected route redirects to /login");
    // ---------------------------------------------------------------------
    await page.goto(`${APP_URL}/`, { waitUntil: "networkidle0" });
    // The redirect only happens once the boot refresh has been rejected, which is a render tick
    // after the network settles.
    await page.waitForSelector('input[type="password"]', { timeout: 10_000 });

    checkEqual("URL after visiting /", new URL(page.url()).pathname, "/login");
    check(
      "login form is rendered",
      (await page.$('input[type="password"]')) !== null,
    );
    check("app shell is NOT rendered", (await page.$('[data-testid="app-shell"]')) === null);
    console.log("  network:\n" + formatCalls(api.calls));
    console.log(`  screenshot: ${await screenshot(page, "01-login-redirect")}`);

    // ---------------------------------------------------------------------
    step("2. Brand palette renders as real computed CSS values (Section 1.14)");
    // ---------------------------------------------------------------------
    // Every value below is read back off the live element via getComputedStyle — i.e. what the
    // browser actually painted, after Tailwind resolved `brand-*` to the Section 1.14 hexes.
    checkEqual(
      "body background is brand.black #000000",
      await computed(page, "body", "background-color"),
      BRAND_RGB.black,
    );
    checkEqual(
      "login card surface is brand.black-88 #1F1F1F",
      await computed(page, "div.max-w-sm", "background-color"),
      BRAND_RGB.black88,
    );
    checkEqual(
      "heading text is brand.white #FEF9F5",
      await computed(page, "h1", "color"),
      BRAND_RGB.white,
    );
    checkEqual(
      "subtitle is brand.green-muted #E9FFA5",
      await computed(page, "div.max-w-sm > p", "color"),
      BRAND_RGB.greenMuted,
    );
    checkEqual(
      "field label is brand.white #FEF9F5",
      await computed(page, "form label", "color"),
      BRAND_RGB.white,
    );
    checkEqual(
      "submit button fill is brand.green #C9FF1F",
      await computed(page, 'button[type="submit"]', "background-color"),
      BRAND_RGB.green,
    );
    checkEqual(
      "submit button label is brand.black #000000",
      await computed(page, 'button[type="submit"]', "color"),
      BRAND_RGB.black,
    );

    // ---------------------------------------------------------------------
    step("3. Login with the seeded OWNER against the real API");
    // ---------------------------------------------------------------------
    api.reset();
    await page.type('input[type="email"]', OWNER_EMAIL);
    await page.type('input[type="password"]', OWNER_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForSelector('[data-testid="dashboard-heading"]', { timeout: 10_000 });

    checkEqual("URL after login", new URL(page.url()).pathname, "/");
    check("app shell rendered", (await page.$('[data-testid="app-shell"]')) !== null);
    check("sidebar rendered", (await page.$('[data-testid="app-sidebar"]')) !== null);
    check("topbar rendered", (await page.$('[data-testid="app-topbar"]')) !== null);

    const orgShown = await page.$eval('[data-testid="stat-organization"]', (el) => el.textContent);
    const roleShown = await page.$eval('[data-testid="stat-role"]', (el) => el.textContent);
    checkEqual("organization from /auth/me", orgShown, "Demo Gym");
    checkEqual("role from /auth/me", roleShown, "OWNER");

    const loginCalls = api.calls.map((c) => `${c.method} ${c.path}`);
    check(
      "login hit POST /auth/login then GET /auth/me",
      loginCalls.includes("POST /auth/login") && loginCalls.includes("GET /auth/me"),
      loginCalls.join(", "),
    );
    console.log("  network:\n" + formatCalls(api.calls));

    // Refresh cookie must be httpOnly — the whole reason the access token stays in memory.
    const cookies = await browser.cookies();
    const refreshCookie = cookies.find((c) => c.name === REFRESH_COOKIE);
    check(`${REFRESH_COOKIE} cookie was set`, refreshCookie !== undefined);
    check(`${REFRESH_COOKIE} cookie is httpOnly`, refreshCookie?.httpOnly === true);
    check(
      `${REFRESH_COOKIE} cookie is SameSite=Lax`,
      refreshCookie?.sameSite === "Lax",
      String(refreshCookie?.sameSite),
    );
    check(
      `${REFRESH_COOKIE} cookie is scoped to /api/v1/auth`,
      refreshCookie?.path === "/api/v1/auth",
      String(refreshCookie?.path),
    );

    // The access token must NOT be readable from storage.
    const storageLeak = await page.evaluate(() => {
      const all = [
        ...Object.entries(localStorage).map(([k, v]) => `local:${k}=${v}`),
        ...Object.entries(sessionStorage).map(([k, v]) => `session:${k}=${v}`),
      ];
      return all.filter((entry) => /eyJ|token/i.test(entry));
    });
    check(
      "no access token in localStorage/sessionStorage",
      storageLeak.length === 0,
      storageLeak.join(", ") || "storage clean",
    );
    check(
      "refresh cookie is not readable from document.cookie",
      !(await page.evaluate(() => document.cookie)).includes(REFRESH_COOKIE),
    );

    // Shell colours, computed.
    checkEqual(
      "sidebar surface is brand.black-88",
      await computed(page, '[data-testid="app-sidebar"]', "background-color"),
      BRAND_RGB.black88,
    );
    checkEqual(
      "topbar surface is brand.black",
      await computed(page, '[data-testid="app-topbar"]', "background-color"),
      BRAND_RGB.black,
    );
    checkEqual(
      "active nav pill is brand.green",
      await computed(page, 'nav a[aria-current="page"]', "background-color"),
      BRAND_RGB.green,
    );
    checkEqual(
      "dashboard subtitle is brand.green-muted",
      await computed(page, '[data-testid="dashboard-heading"] + p', "color"),
      BRAND_RGB.greenMuted,
    );
    console.log(`  screenshot: ${await screenshot(page, "02-dashboard")}`);

    // ---------------------------------------------------------------------
    step("4. Reload preserves the session via the httpOnly refresh cookie");
    // ---------------------------------------------------------------------
    api.reset();
    const reloadMark = Date.now();
    await page.reload({ waitUntil: "networkidle0" });
    await page.waitForSelector('[data-testid="dashboard-heading"]', { timeout: 10_000 });

    checkEqual("still on the dashboard after reload", new URL(page.url()).pathname, "/");
    check("app shell still rendered", (await page.$('[data-testid="app-shell"]')) !== null);
    check("login form not shown", (await page.$('input[type="password"]')) === null);

    const reloadCalls = api.since(reloadMark);
    const refreshOnBoot = reloadCalls.filter((c) => c.path === "/auth/refresh");
    check(
      "cold load exchanged the cookie via POST /auth/refresh",
      refreshOnBoot.length >= 1 && refreshOnBoot[0]?.status === 200,
    );
    checkEqual(
      "exactly one refresh on boot (single-flight holds under StrictMode)",
      refreshOnBoot.length,
      1,
    );
    check(
      "then re-hydrated context via GET /auth/me",
      reloadCalls.some((c) => c.path === "/auth/me" && OK(c.status)),
    );
    console.log("  network:\n" + formatCalls(reloadCalls));
    console.log(`  screenshot: ${await screenshot(page, "03-after-reload")}`);

    // ---------------------------------------------------------------------
    step("5. Expired access token: silent refresh + retry of the original request");
    // ---------------------------------------------------------------------
    console.log(`  waiting ${TOKEN_TTL_WAIT_MS}ms for the access token to actually expire...`);
    await sleep(TOKEN_TTL_WAIT_MS);

    api.reset();
    const expiryMark = Date.now();

    /*
     * Imported by its Vite dev URL, which resolves to the module instance the running app is
     * already using — same axios instance, same interceptors, same in-memory token. Nothing is
     * stubbed: if this resolved to a fresh copy, the store would hold no token and the call
     * would 401 twice instead of recovering.
     */
    const retryResult = await page.evaluate(async (moduleUrl) => {
      // The URL is passed in as a variable so TypeScript compiles this as a runtime import
      // instead of trying to resolve a browser path at build time.
      const mod = await import(/* @vite-ignore */ moduleUrl);
      const response = await mod.apiClient.get("/auth/me");
      return { status: response.status as number, email: response.data?.data?.user?.email as string };
    }, API_CLIENT_MODULE);

    const expiryCalls = api.since(expiryMark);
    console.log("  network:\n" + formatCalls(expiryCalls));

    checkEqual("caller received a successful response", retryResult.status, 200);
    checkEqual("caller got real data back", retryResult.email, OWNER_EMAIL);

    const sequence = expiryCalls.map((c) => `${c.method} ${c.path} ${c.status}`);
    check(
      "first attempt was rejected with 401",
      expiryCalls[0]?.path === "/auth/me" && expiryCalls[0]?.status === 401,
      sequence[0] ?? "(nothing)",
    );
    check(
      "interceptor silently refreshed",
      expiryCalls[1]?.path === "/auth/refresh" && expiryCalls[1]?.status === 200,
      sequence[1] ?? "(nothing)",
    );
    check(
      "original request was retried and succeeded",
      expiryCalls[2]?.path === "/auth/me" && OK(expiryCalls[2]?.status ?? 0),
      sequence[2] ?? "(nothing)",
    );
    checkEqual("exactly 3 calls — retried once, not looping", expiryCalls.length, 3);

    // ---------------------------------------------------------------------
    step("6. Concurrent 401s collapse into a single refresh (family-revocation safety)");
    // ---------------------------------------------------------------------
    console.log(`  waiting ${TOKEN_TTL_WAIT_MS}ms for the new access token to expire...`);
    await sleep(TOKEN_TTL_WAIT_MS);

    api.reset();
    const burstMark = Date.now();

    const burst = await page.evaluate(async (moduleUrl) => {
      const mod = await import(/* @vite-ignore */ moduleUrl);
      const responses = await Promise.all([
        mod.apiClient.get("/auth/me"),
        mod.apiClient.get("/permissions"),
        mod.apiClient.get("/auth/me"),
      ]);
      return responses.map((r: { status: number }) => r.status);
    }, API_CLIENT_MODULE);

    const burstCalls = api.since(burstMark);
    console.log("  network:\n" + formatCalls(burstCalls));

    check("all three concurrent requests succeeded", burst.every((s) => s === 200), burst.join(","));
    checkEqual(
      "exactly one POST /auth/refresh for three parallel 401s",
      burstCalls.filter((c) => c.path === "/auth/refresh").length,
      1,
    );
    check(
      "no refresh was rejected as a replayed token",
      burstCalls.filter((c) => c.path === "/auth/refresh").every((c) => c.status === 200),
    );
    check("session survived the burst", (await page.$('[data-testid="app-shell"]')) !== null);

    // ---------------------------------------------------------------------
    step("7. Logout clears state, revokes server-side, and redirects to /login");
    // ---------------------------------------------------------------------
    api.reset();
    const logoutMark = Date.now();
    await page.click('[data-testid="app-topbar"] button');
    await page.waitForSelector('input[type="password"]', { timeout: 10_000 });

    checkEqual("URL after sign out", new URL(page.url()).pathname, "/login");
    check("app shell gone", (await page.$('[data-testid="app-shell"]')) === null);
    check(
      "POST /auth/logout was sent",
      api.since(logoutMark).some((c) => c.path === "/auth/logout" && c.status === 200),
    );

    const afterLogoutCookies = await browser.cookies();
    const staleCookie = afterLogoutCookies.find(
      (c) => c.name === REFRESH_COOKIE && c.value !== "",
    );
    check("refresh cookie cleared", staleCookie === undefined, staleCookie?.value ?? "cleared");
    console.log("  network:\n" + formatCalls(api.since(logoutMark)));
    console.log(`  screenshot: ${await screenshot(page, "04-after-logout")}`);

    // ---------------------------------------------------------------------
    step("8. Protected route after logout redirects again (session really is gone)");
    // ---------------------------------------------------------------------
    api.reset();
    const revisitMark = Date.now();
    await page.goto(`${APP_URL}/`, { waitUntil: "networkidle0" });

    checkEqual("URL after revisiting /", new URL(page.url()).pathname, "/login");
    check("still no app shell", (await page.$('[data-testid="app-shell"]')) === null);
    const revisitCalls = api.since(revisitMark);
    check(
      "boot refresh was rejected — no usable refresh cookie remains",
      revisitCalls.some((c) => c.path === "/auth/refresh" && c.status === 401),
      formatCalls(revisitCalls).trim(),
    );
    check(
      "no /auth/me was attempted without a token",
      !revisitCalls.some((c) => c.path === "/auth/me"),
    );
    console.log("  network:\n" + formatCalls(revisitCalls));
    console.log(`  screenshot: ${await screenshot(page, "05-redirect-after-logout")}`);

    return summary();
  } finally {
    await browser.close();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error("\nHarness crashed:", error);
    process.exit(1);
  });
