/**
 * Phase 15.9 verification — real Chrome, real API, real MySQL.
 *
 * The skipped 10.19 column for Super Admin. jsdom RTL is not this script.
 *
 * Run with:
 *   1. MySQL up       (apps/api: bash scripts/dev-mysql-sandbox.sh start)
 *   2. API up         (apps/api: pnpm dev)
 *   3. Super Admin up (apps/super-admin: pnpm dev)  — :5174
 *   4. pnpm e2e
 *
 * Excluded from `pnpm test` and CI. Does not touch Demo Gym's status or plan.
 */
import type { Page } from "puppeteer-core";
import {
  APP_URL,
  check,
  checkEqual,
  formatCalls,
  forwardPageErrors,
  launch,
  queryOne,
  recordApiCalls,
  requireCell,
  screenshot,
  sleep,
  sqlString,
  step,
  summary,
} from "./lib/harness";

const PLATFORM_EMAIL = process.env.E2E_PLATFORM_EMAIL ?? "platform@vedafit.test";
const PLATFORM_PASSWORD = process.env.E2E_PLATFORM_PASSWORD ?? "ChangeMe123!";
const PLATFORM_COOKIE = "platform_refresh";
const STAFF_COOKIE = "refresh_token";

const SLUG = `e2e-sa-${Date.now()}`;
const ORG_NAME = `E2E Super Admin ${SLUG}`;
const ORG_EMAIL = `${SLUG}@vedafit.test`;
const OWNER_EMAIL = `owner-${SLUG}@vedafit.test`;

const OK = (status: number) => status === 200 || status === 304;

async function fillByLabel(page: Page, label: string, value: string) {
  const handle = await page.$(
    `::-p-xpath(//label[normalize-space()=${sqlString(label)}]/following-sibling::input)`,
  );
  if (!handle) throw new Error(`No input for label "${label}"`);
  await handle.click({ clickCount: 3 });
  await handle.type(value);
}

async function selectByLabel(page: Page, label: string, optionText: string) {
  const handle = await page.$(
    `::-p-xpath(//label[normalize-space()=${sqlString(label)}]/following-sibling::select)`,
  );
  if (!handle) throw new Error(`No select for label "${label}"`);
  const value = await handle.evaluate((el, text) => {
    const option = Array.from((el as HTMLSelectElement).options).find((o) => o.textContent?.trim() === text);
    return option?.value ?? "";
  }, optionText);
  if (!value) throw new Error(`No option "${optionText}" on "${label}"`);
  await handle.select(value);
}

function demoGymRow() {
  return queryOne("SELECT id, status FROM organizations WHERE slug = 'demo-gym'");
}

function orgBySlug(slug: string) {
  return queryOne(
    `SELECT o.id, o.name, o.status, o.slug, s.status AS subStatus, p.code AS planCode
     FROM organizations o
     LEFT JOIN organization_subscriptions s ON s.organizationId = o.id
     LEFT JOIN saas_plans p ON p.id = s.planId
     WHERE o.slug = ${sqlString(slug)}`,
  );
}

async function main(): Promise<number> {
  const demoBefore = demoGymRow();
  if (!demoBefore) {
    throw new Error("demo-gym is missing from gym_dev — seed before this harness.");
  }

  const browser = await launch();
  const page = await browser.newPage();
  const api = recordApiCalls(page);
  forwardPageErrors(page);

  try {
    step("1. Unauthenticated visit to / redirects to /login");
    await page.goto(`${APP_URL}/`, { waitUntil: "networkidle0" });
    await page.waitForSelector('input[type="password"]', { timeout: 10_000 });
    checkEqual("URL after visiting /", new URL(page.url()).pathname, "/login");
    check("login form is rendered", (await page.$('input[type="password"]')) !== null);
    check("app shell is NOT rendered", (await page.$('[data-testid="app-shell"]')) === null);
    console.log("  network:\n" + formatCalls(api.calls));
    console.log(`  screenshot: ${await screenshot(page, "01-login-redirect")}`);

    step("2. Platform login — cookie, not staff auth, not localStorage");
    api.reset();
    await page.type('input[type="email"]', PLATFORM_EMAIL);
    await page.type('input[type="password"]', PLATFORM_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForSelector('[data-testid="dashboard-heading"]', { timeout: 15_000 });

    checkEqual("URL after login", new URL(page.url()).pathname, "/");
    check("app shell rendered", (await page.$('[data-testid="app-shell"]')) !== null);
    check("sidebar rendered", (await page.$('[data-testid="app-sidebar"]')) !== null);
    check("topbar rendered", (await page.$('[data-testid="app-topbar"]')) !== null);

    const paths = api.calls.map((c) => `${c.method} ${c.path}`);
    check(
      "login hit POST /auth/platform/login then GET /auth/platform/me",
      paths.includes("POST /auth/platform/login") && paths.includes("GET /auth/platform/me"),
      paths.join(", "),
    );
    check("did not call staff POST /auth/login", !paths.includes("POST /auth/login"));
    check("did not call staff GET /auth/me", !paths.includes("GET /auth/me"));
    check(
      "platform login returned 200",
      api.calls.some((c) => c.method === "POST" && c.path === "/auth/platform/login" && c.status === 200),
    );

    const cookies = await browser.cookies();
    const platformCookie = cookies.find((c) => c.name === PLATFORM_COOKIE);
    const staffCookie = cookies.find((c) => c.name === STAFF_COOKIE);
    check(`${PLATFORM_COOKIE} cookie was set`, platformCookie !== undefined);
    check(`${PLATFORM_COOKIE} cookie is httpOnly`, platformCookie?.httpOnly === true);
    check(
      `${PLATFORM_COOKIE} cookie is SameSite=Lax`,
      platformCookie?.sameSite === "Lax",
      String(platformCookie?.sameSite),
    );
    check(
      `${PLATFORM_COOKIE} cookie is scoped to /api/v1/auth/platform`,
      platformCookie?.path === "/api/v1/auth/platform",
      String(platformCookie?.path),
    );
    check("staff refresh_token cookie was NOT set", staffCookie === undefined);

    const localToken = await page.evaluate(() => ({
      local: window.localStorage.getItem("accessToken") ?? window.localStorage.getItem("token"),
      session: window.sessionStorage.getItem("accessToken") ?? window.sessionStorage.getItem("token"),
      keys: Object.keys(window.localStorage),
    }));
    check("no access token in localStorage", localToken.local === null);
    check("no access token in sessionStorage", localToken.session === null);
    console.log("  network:\n" + formatCalls(api.calls));
    console.log(`  screenshot: ${await screenshot(page, "02-dashboard")}`);

    step("3. Organization list includes Demo Gym");
    api.reset();
    await page.click('[data-testid="app-sidebar"] a[href="/organizations"]');
    await page.waitForSelector('[data-testid="organizations-table"]', { timeout: 15_000 });
    const listText = await page.$eval('[data-testid="organizations-table"]', (el) => el.textContent ?? "");
    check("Demo Gym row is visible", listText.includes("Demo Gym") && listText.includes("demo-gym"));
    check(
      "list hit GET /platform/organizations",
      api.calls.some((c) => c.method === "GET" && c.path === "/platform/organizations" && OK(c.status)),
    );
    console.log("  network:\n" + formatCalls(api.calls));
    console.log(`  screenshot: ${await screenshot(page, "03-org-list")}`);

    step("4. Create organization through the form");
    api.reset();
    await page.click("[data-testid='new-organization']");
    await page.waitForSelector("[data-testid='create-organization']", { timeout: 10_000 });
    await fillByLabel(page, "Organization name", ORG_NAME);
    await fillByLabel(page, "Slug", SLUG);
    await fillByLabel(page, "Organization email", ORG_EMAIL);
    await fillByLabel(page, "Owner name", "E2E Platform Owner");
    await fillByLabel(page, "Owner email", OWNER_EMAIL);
    await fillByLabel(page, "Owner password", "ChangeMe123!");
    await page.click("[data-testid='create-organization']");
    await page.waitForSelector("[data-testid='org-name']", { timeout: 20_000 });

    const createdName = await page.$eval("[data-testid='org-name']", (el) => el.textContent?.trim());
    checkEqual("detail heading is the created name", createdName, ORG_NAME);
    check(
      "create hit POST /platform/organizations 201",
      api.calls.some((c) => c.method === "POST" && c.path === "/platform/organizations" && c.status === 201),
    );

    const created = orgBySlug(SLUG);
    check("created org exists in MySQL", created !== undefined);
    checkEqual("MySQL name", created?.name, ORG_NAME);
    checkEqual("MySQL org status after create", created?.status, "ACTIVE");
    checkEqual("MySQL subscription after create", created?.subStatus, "TRIAL");
    checkEqual("MySQL plan after create", created?.planCode, "trial");
    checkEqual("Demo Gym status unchanged after create", demoGymRow()?.status, demoBefore.status);
    console.log("  network:\n" + formatCalls(api.calls));
    console.log(`  screenshot: ${await screenshot(page, "04-org-created")}`);

    const organizationId = requireCell(created, "id");

    step("5. Suspend then restore — MySQL, not Demo Gym");
    api.reset();
    await page.click("[data-testid='org-status-action']");
    await page.waitForSelector("[data-testid='confirm-dialog']", { timeout: 5_000 });
    await page.click("[data-testid='confirm-accept']");
    await page.waitForFunction(
      () => document.querySelector("[data-testid='org-status']")?.textContent?.includes("SUSPENDED"),
      { timeout: 10_000 },
    );
    await sleep(200);

    const afterSuspend = orgBySlug(SLUG);
    checkEqual("MySQL status after suspend", afterSuspend?.status, "SUSPENDED");
    check(
      "suspend hit PATCH …/status",
      api.calls.some(
        (c) =>
          c.method === "PATCH" &&
          c.path === `/platform/organizations/${organizationId}/status` &&
          c.status === 200,
      ),
    );
    checkEqual("Demo Gym still ACTIVE after suspend", demoGymRow()?.status, "ACTIVE");
    console.log(`  screenshot: ${await screenshot(page, "05-org-suspended")}`);

    await page.click("[data-testid='org-status-action']");
    await page.waitForSelector("[data-testid='confirm-dialog']", { timeout: 5_000 });
    await page.click("[data-testid='confirm-accept']");
    await page.waitForFunction(
      () => document.querySelector("[data-testid='org-status']")?.textContent?.includes("ACTIVE"),
      { timeout: 10_000 },
    );
    await sleep(200);

    const afterRestore = orgBySlug(SLUG);
    checkEqual("MySQL status after restore", afterRestore?.status, "ACTIVE");
    checkEqual("Demo Gym still ACTIVE after restore", demoGymRow()?.status, "ACTIVE");
    console.log("  network:\n" + formatCalls(api.calls));
    console.log(`  screenshot: ${await screenshot(page, "06-org-restored")}`);

    step("6. Assign Starter plan — subscription only");
    api.reset();
    await page.waitForFunction(
      () => {
        const select = document.querySelector("label")?.parentElement?.querySelector("select");
        return Array.from(document.querySelectorAll("select option")).some((o) =>
          (o.textContent ?? "").includes("Starter (starter)"),
        );
      },
      { timeout: 10_000 },
    );
    await selectByLabel(page, "SaaS plan", "Starter (starter)");
    await page.click("[data-testid='assign-plan-submit']");
    await page.waitForSelector("[data-testid='confirm-dialog']", { timeout: 5_000 });
    await page.click("[data-testid='confirm-accept']");
    await page.waitForFunction(
      () => (document.body.textContent ?? "").includes("Starter (starter)"),
      { timeout: 10_000 },
    );
    await sleep(300);

    const afterPlan = orgBySlug(SLUG);
    checkEqual("MySQL plan after assign", afterPlan?.planCode, "starter");
    checkEqual("MySQL org status still ACTIVE after assign", afterPlan?.status, "ACTIVE");
    check(
      "assign hit PATCH …/subscription",
      api.calls.some(
        (c) =>
          c.method === "PATCH" &&
          c.path === `/platform/organizations/${organizationId}/subscription` &&
          c.status === 200,
      ),
    );

    const demoAfter = queryOne(
      `SELECT o.status, p.code AS planCode
       FROM organizations o
       LEFT JOIN organization_subscriptions s ON s.organizationId = o.id
       LEFT JOIN saas_plans p ON p.id = s.planId
       WHERE o.slug = 'demo-gym'`,
    );
    checkEqual("Demo Gym status at end", demoAfter?.status, "ACTIVE");
    checkEqual("Demo Gym plan at end", demoAfter?.planCode, "growth");
    console.log("  network:\n" + formatCalls(api.calls));
    console.log(`  screenshot: ${await screenshot(page, "07-plan-assigned")}`);

    step("7. Sign out clears the platform session");
    await page.click("[data-testid='sign-out']");
    await page.waitForSelector('input[type="password"]', { timeout: 10_000 });
    checkEqual("URL after sign out", new URL(page.url()).pathname, "/login");
    const cookiesAfter = await browser.cookies();
    check(
      "platform_refresh cookie gone or empty after logout",
      cookiesAfter.find((c) => c.name === PLATFORM_COOKIE) === undefined ||
        cookiesAfter.find((c) => c.name === PLATFORM_COOKIE)?.value === "",
    );
    console.log(`  screenshot: ${await screenshot(page, "08-signed-out")}`);
  } catch (error) {
    console.error("Harness crashed:", error);
    try {
      console.log(`  crash screenshot: ${await screenshot(page, "99-crash")}`);
    } catch {
      // page may already be closed
    }
    await browser.close();
    return 1;
  }

  await browser.close();
  return summary();
}

const code = await main();
process.exit(code);
