/**
 * Phase 12 verification — real Chrome, real API, real Redis/BullMQ, real database.
 *
 * Run with:
 *   1. MySQL up      (apps/api: bash scripts/dev-mysql-sandbox.sh start)
 *   2. Redis up      (apps/api: bash scripts/dev-redis-sandbox.sh start)
 *   3. Migration     (apps/api: pnpm prisma migrate deploy)
 *   4. Fixtures      (apps/api: pnpm tsx scripts/phase12-fixtures.ts)
 *   5. API up        (apps/api: pnpm dev)
 *   6. Admin web up  (apps/admin-web: pnpm dev)
 *   7. pnpm e2e:notifications
 *
 * The claims this phase has to prove: a BullMQ worker processes a real queued job to SENT,
 * the nightly scan selects the 7-day expiry window (and not frozen / far / cancelled), a second
 * run on the same gym-local day does not insert a second log row, and `notifications.manage`
 * matches 4.2 (OWNER yes; manager/receptionist/accountant/trainer no).
 */
import type { Page } from "puppeteer-core";
import {
  APP_URL,
  BRAND_RGB,
  check,
  checkEqual,
  computed,
  forwardPageErrors,
  launch,
  queryDb,
  queryOne,
  requireCell,
  screenshot,
  sleep,
  sqlString,
  step,
  summary,
} from "./lib/harness";

const OWNER = { email: "owner@demo-gym.test", password: "ChangeMe123!" };
const MANAGER = { email: "manager@demo-gym.test", password: "ChangeMe123!" };
const RECEPTIONIST = { email: "reception@demo-gym.test", password: "ChangeMe123!" };
const TRAINER = { email: "trainer@demo-gym.test", password: "ChangeMe123!" };
const ACCOUNTANT = { email: "accounts@demo-gym.test", password: "ChangeMe123!" };

const MEMBER_PHONE_PREFIX = "+9190001";

async function login(page: Page, who: { email: string; password: string }) {
  await page.goto(`${APP_URL}/login`, { waitUntil: "networkidle0" });
  await page.waitForSelector('input[type="password"]');
  await page.type('input[type="email"]', who.email);
  await page.type('input[type="password"]', who.password);
  await page.click('button[type="submit"]');
  await page.waitForSelector('[data-testid="app-shell"]', { timeout: 10_000 });
}

async function logout(page: Page) {
  await page.click('[data-testid="sign-out"]');
  await page.waitForSelector('input[type="password"]', { timeout: 10_000 });
}

async function textOf(page: Page, selector: string): Promise<string> {
  return page.$eval(selector, (el) => (el.textContent ?? "").trim());
}

async function exists(page: Page, selector: string): Promise<boolean> {
  return (await page.$(selector)) !== null;
}

async function forceApiCall(
  page: Page,
  method: "get" | "post",
  path: string,
): Promise<{ status: number; code: string }> {
  return page.evaluate(
    async (moduleUrl: string, httpMethod: string, requestPath: string) => {
      const mod = await import(/* @vite-ignore */ moduleUrl);
      try {
        const res =
          httpMethod === "get"
            ? await mod.apiClient.get(requestPath)
            : await mod.apiClient.post(requestPath);
        return { status: res.status as number, code: "NONE" };
      } catch (error) {
        const err = error as {
          response?: { status?: number; data?: { error?: { code?: string } } };
        };
        return {
          status: err.response?.status ?? 0,
          code: err.response?.data?.error?.code ?? "NONE",
        };
      }
    },
    "/src/lib/api-client.ts",
    method,
    path,
  );
}

function orgId(): string {
  return requireCell(queryOne("SELECT id FROM organizations WHERE slug = 'demo-gym'"), "id");
}

function p12Logs() {
  return queryDb(
    `SELECT l.id, l.event, l.status, l.entityId, m.firstName, m.lastName
       FROM notification_logs l
       LEFT JOIN members m ON m.id = l.memberId
      WHERE m.phone LIKE ${sqlString(`${MEMBER_PHONE_PREFIX}%`)}
         OR l.body LIKE '%Expiry Soon%'
         OR l.body LIKE '%Owing Balance%'
      ORDER BY l.event`,
  );
}

async function main() {
  const browser = await launch();
  const page = await browser.newPage();
  forwardPageErrors(page);
  const organizationId = orgId();

  try {
    step("1. OWNER: notification history, brand palette, templates");
    await login(page, OWNER);
    await page.goto(`${APP_URL}/notifications`, { waitUntil: "networkidle0" });
    await page.waitForSelector("[data-testid='notifications-heading']");
    checkEqual(
      "heading uses brand white",
      await computed(page, "[data-testid='notifications-heading']", "color"),
      BRAND_RGB.white,
    );
    check("SMS templates are listed", (await textOf(page, "body")).includes("Membership expiring"));
    await screenshot(page, "phase12-01-empty");

    step("2. Run nightly scan — worker processes jobs to SENT");
    await page.click("[data-testid='run-nightly']");
    await page.waitForFunction(
      () => document.body.textContent?.includes("Queued") === true,
      { timeout: 15_000 },
    );
    const runText = await textOf(page, "[data-testid='run-result']");
    check("scan queued at least one job", /Queued [1-9]/.test(runText));

    // The worker claim is MySQL SENT, not the React Query poll. A crowded leftover
    // history page (or a 429 on refetch after back-to-back harnesses) leaves the
    // DOM stale while BullMQ has already written SENT — that is not Phase 15.
    const deadline = Date.now() + 45_000;
    let mysql = p12Logs();
    while (Date.now() < deadline) {
      mysql = p12Logs();
      if (mysql.length >= 2 && mysql.every((row) => row.status === "SENT")) break;
      await sleep(250);
    }
    check(
      "worker marked P12 logs SENT in MySQL",
      mysql.length >= 2 && mysql.every((row) => row.status === "SENT"),
      mysql.map((row) => `${row.event}:${row.status}`).join(", ") || "(none)",
    );

    await page.reload({ waitUntil: "networkidle0" });
    const search = await page.$('input[type="search"]');
    if (search) {
      await search.type("Expiry Soon");
      await sleep(500);
    }

    const rows = p12Logs();
    checkEqual("exactly two P12 notification logs", String(rows.length), "2");
    const events = rows.map((row) => row.event).sort();
    checkEqual("events are expiry + payment due", events.join(","), "MEMBERSHIP_EXPIRING,PAYMENT_DUE");
    check(
      "every P12 log is SENT",
      rows.every((row) => row.status === "SENT"),
    );
    check(
      "Frozen Hold was not notified",
      !rows.some((row) => row.firstName === "Frozen"),
    );
    check(
      "Far Away was not notified",
      !rows.some((row) => row.firstName === "Far"),
    );
    await screenshot(page, "phase12-02-sent");

    step("3. Re-running the same local day does not duplicate (1.22.1)");
    const before = rows.length;
    await page.click("[data-testid='run-nightly']");
    await page.waitForFunction(
      () => document.body.textContent?.includes("skipped") === true,
      { timeout: 10_000 },
    );
    const second = await textOf(page, "[data-testid='run-result']");
    check("second run reports skipped", second.includes("skipped"));
    checkEqual("still exactly two P12 logs", String(p12Logs().length), String(before));

    step("4. RBAC: notifications.manage is OWNER/ADMIN (4.2)");
    const ownerLogs = await forceApiCall(
      page,
      "get",
      `/organizations/${organizationId}/notifications/logs`,
    );
    checkEqual("OWNER GET /notifications/logs is 200", ownerLogs.status, 200);
    await logout(page);

    for (const [who, account] of [
      ["MANAGER", MANAGER],
      ["RECEPTIONIST", RECEPTIONIST],
      ["TRAINER", TRAINER],
      ["ACCOUNTANT", ACCOUNTANT],
    ] as const) {
      await login(page, account);
      check(`${who} does not see Notifications nav`, !(await exists(page, 'a[href="/notifications"]')));
      const denied = await forceApiCall(
        page,
        "get",
        `/organizations/${organizationId}/notifications/logs`,
      );
      checkEqual(`${who} GET /logs is 403`, denied.status, 403);
      checkEqual(`${who} code is PERMISSION_DENIED`, denied.code, "PERMISSION_DENIED");
      await logout(page);
    }
  } finally {
    await browser.close();
  }

  process.exit(summary());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
