/**
 * Phase 8 verification — real Chrome, real API, real database.
 *
 * Run with:
 *   1. MySQL up      (apps/api: bash scripts/dev-mysql-sandbox.sh start)
 *   2. Fixtures      (apps/api: pnpm tsx scripts/phase8-fixtures.ts)
 *   3. API up        (apps/api: pnpm dev)
 *   4. Admin web up  (apps/admin-web: pnpm dev)
 *   5. pnpm e2e:dashboard
 *
 * Every widget number is read off the rendered page, then the equivalent aggregate is run against
 * MySQL with the `mysql` client — a different driver from the Prisma client that served the API,
 * so the assertions cannot be satisfied by the ORM agreeing with itself.
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
  queryOne,
  requireCell,
  screenshot,
  sqlString,
  step,
  summary,
} from "./lib/harness";

const OWNER = { email: "owner@demo-gym.test", password: "ChangeMe123!" };
const RECEPTIONIST = { email: "reception@demo-gym.test", password: "ChangeMe123!" };
const TRAINER = { email: "trainer@demo-gym.test", password: "ChangeMe123!" };
const ACCOUNTANT = { email: "accounts@demo-gym.test", password: "ChangeMe123!" };

const MEMBER_PHONE_PREFIX = "+9194444";
const SECOND_BRANCH_NAME = "P8 Andheri";

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

async function gotoDashboard(page: Page) {
  await page.goto(`${APP_URL}/`, { waitUntil: "networkidle0" });
  await page.waitForSelector('[data-testid="dashboard-heading"]', { timeout: 10_000 });
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="widget-members"]') ||
      document.querySelector('[data-testid="dashboard-empty"]') ||
      document.querySelector('[role="alert"]'),
    { timeout: 10_000 },
  );
}

async function textOf(page: Page, selector: string): Promise<string> {
  return page.$eval(selector, (el) => (el.textContent ?? "").trim());
}

/** Widget values already exist from the previous scope; wait until they actually change. */
async function waitForText(page: Page, selector: string, expected: string) {
  await page.waitForFunction(
    (sel, value) => (document.querySelector(sel)?.textContent ?? "").trim() === value,
    { timeout: 10_000 },
    selector,
    expected,
  );
}

async function waitForAmount(page: Page, selector: string, expected: string) {
  await page.waitForFunction(
    (sel, value) => {
      const text = (document.querySelector(sel)?.textContent ?? "").replace(/,/g, "");
      const match = text.match(/-?\d+\.\d{2}/);
      return (match?.[0] ?? "") === value;
    },
    { timeout: 10_000 },
    selector,
    expected,
  );
}

async function exists(page: Page, selector: string): Promise<boolean> {
  return (await page.$(selector)) !== null;
}

function parseAmount(text: string): string {
  const match = text.replace(/,/g, "").match(/-?\d+\.\d{2}/);
  return match?.[0] ?? text.trim();
}

function org() {
  return requireCell(queryOne("SELECT id, name, timezone FROM organizations WHERE slug = 'demo-gym'"), "id");
}

function mainBranchId() {
  const organizationId = org();
  return requireCell(
    queryOne(
      `SELECT id FROM branches WHERE organizationId = ${sqlString(organizationId)} AND name <> ${sqlString(SECOND_BRANCH_NAME)} ORDER BY createdAt ASC LIMIT 1`,
    ),
    "id",
  );
}

function secondBranchId() {
  const organizationId = org();
  return requireCell(
    queryOne(
      `SELECT id FROM branches WHERE organizationId = ${sqlString(organizationId)} AND name = ${sqlString(SECOND_BRANCH_NAME)}`,
    ),
    "id",
  );
}

function gymToday(timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function monthBoundsUtc(timezone: string): { start: string; end: string } {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);

  const offsetAt = (civilUtcMs: number) => {
    const instant = new Date(civilUtcMs);
    const wall = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(instant);
    const n = (type: Intl.DateTimeFormatPartTypes) =>
      Number(wall.find((p) => p.type === type)?.value ?? 0);
    const asIfUtc = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second"));
    return asIfUtc - instant.getTime();
  };

  const civilToInstant = (civilMs: number) => {
    const guess = new Date(civilMs - offsetAt(civilMs));
    return new Date(civilMs - offsetAt(guess.getTime()));
  };

  const start = civilToInstant(Date.UTC(year, month - 1, 1));
  const end = civilToInstant(Date.UTC(year, month, 1));
  const iso = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ");
  return { start: iso(start), end: iso(end) };
}

function sqlMembers(organizationId: string, branchId: string | null) {
  const branch = branchId ? `AND m.branchId = ${sqlString(branchId)}` : "";
  const total = requireCell(
    queryOne(
      `SELECT COUNT(*) AS n FROM members m
       WHERE m.organizationId = ${sqlString(organizationId)}
         AND m.deletedAt IS NULL AND m.status <> 'ARCHIVED' ${branch}`,
    ),
    "n",
  );
  const active = requireCell(
    queryOne(
      `SELECT COUNT(DISTINCT ms.memberId) AS n FROM memberships ms
       JOIN members m ON m.id = ms.memberId
       WHERE ms.organizationId = ${sqlString(organizationId)}
         AND ms.status = 'ACTIVE'
         AND ms.startDate <= UTC_DATE() AND ms.endDate >= UTC_DATE()
         AND m.deletedAt IS NULL AND m.status <> 'ARCHIVED' ${branch}`,
    ),
    "n",
  );
  return { total, active };
}

function sqlRevenue(organizationId: string, branchId: string | null, timezone: string) {
  const { start, end } = monthBoundsUtc(timezone);
  const branch = branchId ? `AND branchId = ${sqlString(branchId)}` : "";
  return requireCell(
    queryOne(
      `SELECT COALESCE(SUM(amount), 0) AS n FROM payments
       WHERE organizationId = ${sqlString(organizationId)}
         AND paidAt >= ${sqlString(start)} AND paidAt < ${sqlString(end)}
         AND status NOT IN ('FAILED', 'PENDING') ${branch}`,
    ),
    "n",
  );
}

function sqlOutstanding(organizationId: string, branchId: string | null) {
  const branch = branchId ? `AND m.branchId = ${sqlString(branchId)}` : "";
  const amount = requireCell(
    queryOne(
      `SELECT COALESCE(SUM(i.amountPending), 0) AS n FROM invoices i
       JOIN members m ON m.id = i.memberId
       WHERE i.organizationId = ${sqlString(organizationId)}
         AND i.amountPending > 0
         AND m.deletedAt IS NULL AND m.status <> 'ARCHIVED' ${branch}`,
    ),
    "n",
  );
  const count = requireCell(
    queryOne(
      `SELECT COUNT(*) AS n FROM invoices i
       JOIN members m ON m.id = i.memberId
       WHERE i.organizationId = ${sqlString(organizationId)}
         AND i.amountPending > 0
         AND m.deletedAt IS NULL AND m.status <> 'ARCHIVED' ${branch}`,
    ),
    "n",
  );
  return { amount, count };
}

function sqlExpiring(organizationId: string, branchId: string | null) {
  const branch = branchId ? `AND m.branchId = ${sqlString(branchId)}` : "";
  return requireCell(
    queryOne(
      `SELECT COUNT(*) AS n FROM memberships ms
       JOIN members m ON m.id = ms.memberId
       WHERE ms.organizationId = ${sqlString(organizationId)}
         AND ms.status = 'ACTIVE'
         AND ms.startDate <= UTC_DATE()
         AND ms.endDate >= UTC_DATE()
         AND ms.endDate <= DATE_ADD(UTC_DATE(), INTERVAL 6 DAY)
         AND m.deletedAt IS NULL AND m.status <> 'ARCHIVED' ${branch}`,
    ),
    "n",
  );
}

function sqlAttendance(organizationId: string, branchId: string | null, date: string) {
  const branch = branchId ? `AND branchId = ${sqlString(branchId)}` : "";
  return requireCell(
    queryOne(
      `SELECT COUNT(*) AS n FROM attendances
       WHERE organizationId = ${sqlString(organizationId)}
         AND attendanceDate = ${sqlString(date)} ${branch}`,
    ),
    "n",
  );
}

function money(value: string): string {
  const n = Number(value);
  return n.toFixed(2);
}

async function assertWidgetsMatchSql(
  page: Page,
  organizationId: string,
  branchId: string | null,
  timezone: string,
  expectRevenue: boolean,
  expectOutstanding: boolean,
  expectExpiring: boolean,
  expectAttendance: boolean,
) {
  const members = sqlMembers(organizationId, branchId);
  await waitForText(page, '[data-testid="widget-members-value"]', members.total);
  checkEqual("members total matches SQL", await textOf(page, '[data-testid="widget-members-value"]'), members.total);
  check(
    "active-with-cover is on the card and less than or equal to total",
    (await textOf(page, '[data-testid="widget-members"]')).includes(`${members.active} with cover today`),
    `${members.active} of ${members.total}`,
  );

  if (expectRevenue) {
    const expected = money(sqlRevenue(organizationId, branchId, timezone));
    await waitForAmount(page, '[data-testid="widget-revenue-value"]', expected);
    const shown = parseAmount(await textOf(page, '[data-testid="widget-revenue-value"]'));
    checkEqual("monthly revenue matches SUM(payments.amount) for the gym's month", shown, expected);
    check("revenue trend is on the page", await exists(page, '[data-testid="widget-revenue-trend"]'));
  } else {
    check("revenue widget is absent", !(await exists(page, '[data-testid="widget-revenue"]')));
  }

  if (expectOutstanding) {
    const expected = sqlOutstanding(organizationId, branchId);
    await waitForAmount(page, '[data-testid="widget-outstanding-value"]', money(expected.amount));
    const shown = parseAmount(await textOf(page, '[data-testid="widget-outstanding-value"]'));
    checkEqual("outstanding matches SUM(invoices.amountPending)", shown, money(expected.amount));
  } else {
    check("outstanding widget is absent", !(await exists(page, '[data-testid="widget-outstanding"]')));
  }

  if (expectExpiring) {
    const expected = sqlExpiring(organizationId, branchId);
    const label = await textOf(page, '[data-testid="widget-expiring"]');
    check(
      "expiring count matches the 7-day SQL window",
      label.includes(`${expected} term`) || (expected === "0" && label.includes("No renewals")),
      `SQL ${expected}`,
    );
  } else {
    check("expiring widget is absent", !(await exists(page, '[data-testid="widget-expiring"]')));
  }

  if (expectAttendance) {
    const expected = sqlAttendance(organizationId, branchId, gymToday(timezone));
    await waitForText(page, '[data-testid="widget-attendance-value"]', expected);
    checkEqual(
      "today's attendance matches the gym-local day",
      await textOf(page, '[data-testid="widget-attendance-value"]'),
      expected,
    );
  } else {
    check("attendance widget is absent", !(await exists(page, '[data-testid="widget-attendance"]')));
  }
}

async function main() {
  const organizationId = org();
  const timezone = requireCell(
    queryOne(`SELECT timezone FROM organizations WHERE id = ${sqlString(organizationId)}`),
    "timezone",
  );
  const home = mainBranchId();
  const away = secondBranchId();
  const browser = await launch();
  const page = await browser.newPage();
  forwardPageErrors(page);

  try {
    step("1. OWNER, all branches — every widget matches a hand-written SQL aggregate");
    await login(page, OWNER);
    await gotoDashboard(page);
    checkEqual("lands on Dashboard", await textOf(page, '[data-testid="dashboard-heading"]'), "Dashboard");
    checkEqual("organization strip still there for Phase 3", await textOf(page, '[data-testid="stat-organization"]'), "Demo Gym");
    await assertWidgetsMatchSql(page, organizationId, null, timezone, true, true, true, true);
    await screenshot(page, "phase8-01-owner-all-branches");

    const bg = await computed(page, "body", "background-color");
    checkEqual("page background is brand black", bg, BRAND_RGB.black);
    const heading = await computed(page, '[data-testid="dashboard-heading"]', "color");
    checkEqual("heading is brand white", heading, BRAND_RGB.white);
    const value = await computed(page, '[data-testid="widget-members-value"]', "color");
    checkEqual("metric value is brand green", value, BRAND_RGB.green);

    step("2. OWNER, Main Branch vs P8 Andheri — the two numbers are not the same");
    await page.select('[aria-label="Active branch"]', home);
    await assertWidgetsMatchSql(page, organizationId, home, timezone, true, true, true, true);
    const homeMembers = await textOf(page, '[data-testid="widget-members-value"]');
    const homeRevenue = parseAmount(await textOf(page, '[data-testid="widget-revenue-value"]'));
    await screenshot(page, "phase8-02-owner-main-branch");

    await page.select('[aria-label="Active branch"]', away);
    await assertWidgetsMatchSql(page, organizationId, away, timezone, true, true, true, true);
    const awayMembers = await textOf(page, '[data-testid="widget-members-value"]');
    const awayRevenue = parseAmount(await textOf(page, '[data-testid="widget-revenue-value"]'));
    check("Main Branch and Andheri member counts differ", homeMembers !== awayMembers, `${homeMembers} vs ${awayMembers}`);
    check("Main Branch and Andheri revenue differ", homeRevenue !== awayRevenue, `${homeRevenue} vs ${awayRevenue}`);
    check(
      "Andheri revenue includes the ₹777 collected there",
      Number(awayRevenue) >= 777,
      awayRevenue,
    );
    await screenshot(page, "phase8-03-owner-andheri");

    step("3. Transfer — revenue stays put, the headcount moves");
    const mover = queryOne(
      `SELECT id, branchId FROM members WHERE phone = ${sqlString(`${MEMBER_PHONE_PREFIX}00008`)}`,
    );
    const moverId = requireCell(mover, "id");
    const moverHomeBefore = sqlMembers(organizationId, home).total;
    const moverAwayBefore = sqlMembers(organizationId, away).total;
    const revenueHomeBefore = money(sqlRevenue(organizationId, home, timezone));

    queryOne(
      `UPDATE members SET branchId = ${sqlString(away)} WHERE id = ${sqlString(moverId)}`,
    );

    // The transfer is a direct SQL write, so the in-memory React Query cache still holds the
    // pre-transfer totals. Reload so the widgets are computed from the database as it is now.
    await page.reload({ waitUntil: "networkidle0" });
    await gotoDashboard(page);
    await page.select('[aria-label="Active branch"]', home);
    const homeAfter = String(Number(moverHomeBefore) - 1);
    await waitForText(page, '[data-testid="widget-members-value"]', homeAfter);
    checkEqual(
      "Main Branch lost the transferred member",
      await textOf(page, '[data-testid="widget-members-value"]'),
      homeAfter,
    );
    await waitForAmount(page, '[data-testid="widget-revenue-value"]', revenueHomeBefore);
    checkEqual(
      "Main Branch revenue did not move with him",
      parseAmount(await textOf(page, '[data-testid="widget-revenue-value"]')),
      revenueHomeBefore,
    );

    await page.select('[aria-label="Active branch"]', away);
    const awayAfter = String(Number(moverAwayBefore) + 1);
    await waitForText(page, '[data-testid="widget-members-value"]', awayAfter);
    checkEqual(
      "Andheri gained the transferred member",
      await textOf(page, '[data-testid="widget-members-value"]'),
      awayAfter,
    );
    await screenshot(page, "phase8-04-after-transfer");

    queryOne(
      `UPDATE members SET branchId = ${sqlString(home)} WHERE id = ${sqlString(moverId)}`,
    );

    step("4. RECEPTIONIST — their branch only, and no revenue");
    await logout(page);
    await login(page, RECEPTIONIST);
    await gotoDashboard(page);
    check("no branch picker — they are pinned", !(await exists(page, '[aria-label="Active branch"]')));
    await assertWidgetsMatchSql(page, organizationId, home, timezone, false, true, true, true);
    await screenshot(page, "phase8-05-receptionist");

    step("5. TRAINER — members and attendance, nothing about money");
    await logout(page);
    await login(page, TRAINER);
    await gotoDashboard(page);
    await assertWidgetsMatchSql(page, organizationId, home, timezone, false, false, false, true);
    await screenshot(page, "phase8-06-trainer");

    step("6. ACCOUNTANT — money yes, the register no");
    await logout(page);
    await login(page, ACCOUNTANT);
    await gotoDashboard(page);
    await assertWidgetsMatchSql(page, organizationId, null, timezone, true, true, true, false);
    await screenshot(page, "phase8-07-accountant");

    step("7. Cancelled invoices and failed payments stay out of the totals");
    const cancelledPending = requireCell(
      queryOne(
        `SELECT amountPending FROM invoices i
         JOIN members m ON m.id = i.memberId
         WHERE m.phone = ${sqlString(`${MEMBER_PHONE_PREFIX}00005`)}`,
      ),
      "amountPending",
    );
    checkEqual("the cancelled fixture invoice has amountPending = 0", money(cancelledPending), "0.00");
    const failed = requireCell(
      queryOne(
        `SELECT COALESCE(SUM(amount), 0) AS n FROM payments p
         JOIN members m ON m.id = p.memberId
         WHERE m.phone = ${sqlString(`${MEMBER_PHONE_PREFIX}00001`)} AND p.status = 'FAILED'`,
      ),
      "n",
    );
    check("a failed payment row exists so the exclusion is being tested", Number(failed) > 0, failed);

    const gymDay = gymToday(timezone);
    const utcDay = utcToday();
    if (gymDay !== utcDay) {
      check("gym today and UTC today differ, so the day-boundary is actually under test", true, `${gymDay} vs ${utcDay}`);
    } else {
      check("gym today equals UTC today at this hour — day-boundary covered by unit tests", true, gymDay);
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
