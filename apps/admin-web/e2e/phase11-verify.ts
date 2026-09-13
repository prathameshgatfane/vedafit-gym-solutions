/**
 * Phase 11 verification — real Chrome, real API, real database.
 *
 * Run with:
 *   1. MySQL up      (apps/api: bash scripts/dev-mysql-sandbox.sh start)
 *   2. Migration     (apps/api: pnpm prisma migrate deploy)
 *   3. Fixtures      (apps/api: pnpm tsx scripts/phase11-fixtures.ts)
 *   4. API up        (apps/api: pnpm dev)
 *   5. Admin web up  (apps/admin-web: pnpm dev)
 *   6. pnpm e2e:expenses
 *
 * The claims this phase has to prove: an expense is a live book (create, edit, hard-delete
 * rewrite the same row), a null-branch cost is org-level and excluded from a branch P&L
 * (1.21.1), the revenue-vs-expenses report uses the gym-local month (1.21.4) and matches a
 * hand-written SQL sum, and `expenses.manage` matches the 4.2 matrix (accountant/owner yes;
 * manager has `reports.view` only). Confirmed on the rendered page and against MySQL with the
 * `mysql` client.
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
const ACCOUNTANT = { email: "accounts@demo-gym.test", password: "ChangeMe123!" };
const MANAGER = { email: "manager@demo-gym.test", password: "ChangeMe123!" };
const RECEPTIONIST = { email: "reception@demo-gym.test", password: "ChangeMe123!" };
const TRAINER = { email: "trainer@demo-gym.test", password: "ChangeMe123!" };

const PAYEE_PREFIX = "P11 ";
const CREATED_PAYEE = `${PAYEE_PREFIX}New Fan`;
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

async function textOf(page: Page, selector: string): Promise<string> {
  return page.$eval(selector, (el) => (el.textContent ?? "").trim());
}

async function exists(page: Page, selector: string): Promise<boolean> {
  return (await page.$(selector)) !== null;
}

async function setField(page: Page, label: string, value: string) {
  const handle = await page.$(
    `::-p-xpath(//label[text()=${sqlString(label)}]/following-sibling::input)`,
  );
  if (!handle) throw new Error(`No input for label "${label}"`);

  const isDate = await handle.evaluate((el) => (el as HTMLInputElement).type === "date");
  if (isDate) {
    await handle.evaluate((el, next) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(el, next);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }, value);
    return;
  }

  await handle.click({ count: 3 });
  await handle.type(value);
}

async function clickRowButton(page: Page, payee: string, label: string) {
  const clicked = await page.$$eval(
    "[data-testid='expense-row']",
    (rows, needle, buttonLabel) => {
      const row = rows.find((r) => r.textContent?.includes(needle));
      if (!row) return false;
      const button = [...row.querySelectorAll("button")].find(
        (b) => b.textContent?.trim() === buttonLabel,
      );
      if (!button) return false;
      (button as HTMLButtonElement).click();
      return true;
    },
    payee,
    label,
  );
  if (!clicked) throw new Error(`No "${label}" on the row for "${payee}"`);
}

async function forceApiCall(
  page: Page,
  method: "get" | "post" | "patch" | "delete",
  path: string,
  body?: Record<string, unknown>,
): Promise<{ status: number; code: string }> {
  return page.evaluate(
    async (
      moduleUrl: string,
      httpMethod: string,
      requestPath: string,
      requestBody: Record<string, unknown> | undefined,
    ) => {
      const mod = await import(/* @vite-ignore */ moduleUrl);
      try {
        const res =
          httpMethod === "get"
            ? await mod.apiClient.get(requestPath)
            : httpMethod === "patch"
              ? await mod.apiClient.patch(requestPath, requestBody)
              : httpMethod === "delete"
                ? await mod.apiClient.delete(requestPath)
                : await mod.apiClient.post(requestPath, requestBody);
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
    body,
  );
}

function parseAmount(text: string): string {
  const normalized = text.replace(/,/g, "").replace("−", "-").replace("₹", "");
  const match = normalized.match(/-?\d+\.\d{2}/);
  return match?.[0] ?? text.trim();
}

function moneyFromSql(n: string): string {
  return Number(n).toFixed(2);
}

function orgRow() {
  return queryOne("SELECT id, timezone FROM organizations WHERE slug = 'demo-gym'");
}

function orgId(): string {
  return requireCell(orgRow(), "id");
}

function gymTimezone(): string {
  return requireCell(orgRow(), "timezone");
}

function mainBranchId(): string {
  return requireCell(
    queryOne(
      `SELECT id FROM branches
        WHERE organizationId = ${sqlString(orgId())}
          AND name <> ${sqlString(SECOND_BRANCH_NAME)}
        ORDER BY createdAt ASC LIMIT 1`,
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

function gymMonth(timezone: string): { year: number; month: number; from: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  return { year, month, from: `${year}-${String(month).padStart(2, "0")}` };
}

function monthBoundsUtc(timezone: string): { start: string; end: string } {
  const { year, month } = gymMonth(timezone);
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

function expenseDateBounds(timezone: string): { start: string; end: string } {
  const { year, month } = gymMonth(timezone);
  const pad = (n: number) => String(n).padStart(2, "0");
  const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
  return {
    start: `${year}-${pad(month)}-01`,
    end: `${next.year}-${pad(next.month)}-01`,
  };
}

function sqlRevenue(organizationId: string, branchId: string | null, timezone: string) {
  const { start, end } = monthBoundsUtc(timezone);
  const branch = branchId ? `AND branchId = ${sqlString(branchId)}` : "";
  return moneyFromSql(
    requireCell(
      queryOne(
        `SELECT COALESCE(SUM(amount), 0) AS n FROM payments
         WHERE organizationId = ${sqlString(organizationId)}
           AND paidAt >= ${sqlString(start)} AND paidAt < ${sqlString(end)}
           AND status NOT IN ('FAILED', 'PENDING') ${branch}`,
      ),
      "n",
    ),
  );
}

function sqlExpenses(organizationId: string, branchId: string | null, timezone: string) {
  const { start, end } = expenseDateBounds(timezone);
  const branch = branchId ? `AND branchId = ${sqlString(branchId)}` : "";
  return moneyFromSql(
    requireCell(
      queryOne(
        `SELECT COALESCE(SUM(amount), 0) AS n FROM expenses
         WHERE organizationId = ${sqlString(organizationId)}
           AND expenseDate >= ${sqlString(start)} AND expenseDate < ${sqlString(end)}
           ${branch}`,
      ),
      "n",
    ),
  );
}

function expenseByPayee(payee: string) {
  const row = queryOne(
    `SELECT id, amount, category, branchId, paidTo, notes FROM expenses
      WHERE paidTo = ${sqlString(payee)}`,
  );
  return {
    id: requireCell(row, "id"),
    amount: moneyFromSql(requireCell(row, "amount")),
    category: requireCell(row, "category"),
    branchId: row?.branchId ?? "",
    paidTo: requireCell(row, "paidTo"),
    notes: row?.notes ?? "",
  };
}

async function main() {
  const browser = await launch();
  const page = await browser.newPage();
  forwardPageErrors(page);
  const organizationId = orgId();
  const branchId = mainBranchId();
  const timezone = gymTimezone();
  const today = gymToday(timezone);
  const month = gymMonth(timezone).from;

  try {
    step("1. ACCOUNTANT: expense list, brand palette, fixtures visible");
    await login(page, ACCOUNTANT);
    await page.goto(`${APP_URL}/expenses`, { waitUntil: "networkidle0" });
    await page.waitForSelector("[data-testid='expenses-heading']");
    const listBody = await textOf(page, "body");
    check("P11 Main Rent is on the list", listBody.includes("P11 Main Rent"));
    check("P11 Zoom is on the list as org-level", listBody.includes("P11 Zoom") && listBody.includes("Org-level"));
    checkEqual(
      "heading uses brand white",
      await computed(page, "[data-testid='expenses-heading']", "color"),
      BRAND_RGB.white,
    );
    await screenshot(page, "phase11-01-expenses-list");

    step("2. Create a branch expense through the form, read it back from MySQL");
    await page.click("[data-testid='add-expense']");
    await page.waitForSelector("[data-testid='expense-form']");
    await page.select("[data-testid='expense-category']", "EQUIPMENT");
    await setField(page, "Amount", "2500");
    await setField(page, "Date", today);
    await page.select("[data-testid='expense-branch']", branchId);
    await setField(page, "Paid to", CREATED_PAYEE);
    await setField(page, "Notes", "Ceiling fan");
    await page.click('button[type="submit"]');
    await page.waitForSelector("[data-testid='expenses-heading']", { timeout: 10_000 });
    const created = expenseByPayee(CREATED_PAYEE);
    checkEqual("created amount is 2500.00", created.amount, "2500.00");
    checkEqual("created category is EQUIPMENT", created.category, "EQUIPMENT");
    checkEqual("created branch is Main", created.branchId, branchId);
    check(
      "created row is on the list",
      (await textOf(page, "body")).includes(CREATED_PAYEE),
    );
    await screenshot(page, "phase11-02-created");

    step("3. Edit rewrites the same row (1.21.3)");
    await clickRowButton(page, CREATED_PAYEE, "Edit");
    await page.waitForSelector("[data-testid='expense-form']");
    await setField(page, "Amount", "2750.50");
    await setField(page, "Notes", "Corrected");
    await page.click('button[type="submit"]');
    await page.waitForSelector("[data-testid='expenses-heading']", { timeout: 10_000 });
    const edited = expenseByPayee(CREATED_PAYEE);
    checkEqual("edit kept the same id", edited.id, created.id);
    checkEqual("edited amount is 2750.50", edited.amount, "2750.50");
    checkEqual("edited notes", edited.notes, "Corrected");
    await screenshot(page, "phase11-03-edited");

    step("4. Org-wide P&L matches SUM(payments) − SUM(expenses) for the gym-local month");
    await page.goto(`${APP_URL}/reports`, { waitUntil: "networkidle0" });
    await page.waitForSelector("[data-testid='pnl-totals']");
    const orgRevenue = sqlRevenue(organizationId, null, timezone);
    const orgExpenses = sqlExpenses(organizationId, null, timezone);
    const orgNet = (Number(orgRevenue) - Number(orgExpenses)).toFixed(2);
    checkEqual(
      "P&L revenue matches SUM(payments.amount) for the gym's month",
      parseAmount(await textOf(page, "[data-testid='pnl-revenue']")),
      orgRevenue,
    );
    checkEqual(
      "P&L expenses match SUM(expenses.amount) for the gym's month",
      parseAmount(await textOf(page, "[data-testid='pnl-expenses']")),
      orgExpenses,
    );
    checkEqual(
      "P&L net is revenue minus expenses",
      parseAmount(await textOf(page, "[data-testid='pnl-net']")),
      orgNet,
    );
    const orgCategories = await textOf(page, "[data-testid='pnl-categories']");
    check("org-wide P&L includes Software", orgCategories.includes("Software"));
    const shownFrom = await page.$eval("[data-testid='pnl-from']", (el) =>
      (el as HTMLInputElement).placeholder,
    );
    checkEqual("P&L defaults to the current gym-local month", shownFrom, month);
    await screenshot(page, "phase11-04-pnl-org");

    step("5. Branch P&L excludes org-level SOFTWARE and the other branch's utilities (1.21.1)");
    await page.select("[data-testid='pnl-branch']", branchId);
    await page.waitForFunction(
      (expected) => {
        const text = (document.querySelector("[data-testid='pnl-expenses']")?.textContent ?? "")
          .replace(/,/g, "")
          .replace("−", "-");
        const match = text.match(/-?\d+\.\d{2}/);
        return (match?.[0] ?? "") === expected;
      },
      { timeout: 10_000 },
      sqlExpenses(organizationId, branchId, timezone),
    );
    const branchRevenue = sqlRevenue(organizationId, branchId, timezone);
    const branchExpenses = sqlExpenses(organizationId, branchId, timezone);
    checkEqual(
      "branch P&L revenue matches stamped payments at Main",
      parseAmount(await textOf(page, "[data-testid='pnl-revenue']")),
      branchRevenue,
    );
    checkEqual(
      "branch P&L expenses are only Main-stamped rows",
      parseAmount(await textOf(page, "[data-testid='pnl-expenses']")),
      branchExpenses,
    );
    const branchCategories = await textOf(page, "[data-testid='pnl-categories']");
    check("branch P&L still includes Rent", branchCategories.includes("Rent"));
    check("branch P&L hides Software", !branchCategories.includes("Software"));
    check("branch P&L hides Andheri utilities", !branchCategories.includes("Utilities"));
    await screenshot(page, "phase11-05-pnl-branch");

    step("6. Hard-delete removes the row");
    await page.goto(`${APP_URL}/expenses`, { waitUntil: "networkidle0" });
    await page.waitForSelector("[data-testid='expenses-heading']");
    await clickRowButton(page, CREATED_PAYEE, "Delete");
    await page.waitForSelector("[data-testid='confirm-delete-expense']");
    await page.click("[data-testid='confirm-delete-expense']");
    await page.waitForFunction(
      (payee) => !document.body.textContent?.includes(payee),
      { timeout: 10_000 },
      CREATED_PAYEE,
    );
    const gone = queryOne(`SELECT id FROM expenses WHERE paidTo = ${sqlString(CREATED_PAYEE)}`);
    check("deleted expense is absent from MySQL", gone === undefined);
    await screenshot(page, "phase11-06-deleted");

    step("7. RBAC: expenses.manage vs reports.view (4.2)");
    const accountantExpenses = await forceApiCall(
      page,
      "get",
      `/organizations/${organizationId}/expenses`,
    );
    checkEqual("ACCOUNTANT GET /expenses is 200", accountantExpenses.status, 200);
    await logout(page);

    await login(page, MANAGER);
    check("MANAGER sees Reports", await exists(page, 'a[href="/reports"]'));
    check("MANAGER does not see Expenses", !(await exists(page, 'a[href="/expenses"]')));
    const managerPnl = await forceApiCall(
      page,
      "get",
      `/organizations/${organizationId}/reports/profit-loss`,
    );
    checkEqual("MANAGER GET /reports/profit-loss is 200", managerPnl.status, 200);
    const managerExpenses = await forceApiCall(
      page,
      "get",
      `/organizations/${organizationId}/expenses`,
    );
    checkEqual("MANAGER GET /expenses is 403", managerExpenses.status, 403);
    checkEqual("MANAGER expenses code is PERMISSION_DENIED", managerExpenses.code, "PERMISSION_DENIED");
    await screenshot(page, "phase11-07-manager");
    await logout(page);

    await login(page, RECEPTIONIST);
    check("RECEPTIONIST does not see Expenses", !(await exists(page, 'a[href="/expenses"]')));
    check("RECEPTIONIST does not see Reports", !(await exists(page, 'a[href="/reports"]')));
    const deskExpenses = await forceApiCall(
      page,
      "get",
      `/organizations/${organizationId}/expenses`,
    );
    const deskPnl = await forceApiCall(
      page,
      "get",
      `/organizations/${organizationId}/reports/profit-loss`,
    );
    checkEqual("RECEPTIONIST GET /expenses is 403", deskExpenses.status, 403);
    checkEqual("RECEPTIONIST GET /profit-loss is 403", deskPnl.status, 403);
    await logout(page);

    await login(page, TRAINER);
    const trainerExpenses = await forceApiCall(
      page,
      "get",
      `/organizations/${organizationId}/expenses`,
    );
    const trainerPnl = await forceApiCall(
      page,
      "get",
      `/organizations/${organizationId}/reports/profit-loss`,
    );
    checkEqual("TRAINER GET /expenses is 403", trainerExpenses.status, 403);
    checkEqual("TRAINER GET /profit-loss is 403", trainerPnl.status, 403);
    await logout(page);

    await login(page, OWNER);
    check("OWNER sees Expenses", await exists(page, 'a[href="/expenses"]'));
    check("OWNER sees Reports", await exists(page, 'a[href="/reports"]'));
    const ownerExpenses = await forceApiCall(
      page,
      "get",
      `/organizations/${organizationId}/expenses`,
    );
    checkEqual("OWNER GET /expenses is 200", ownerExpenses.status, 200);
    await screenshot(page, "phase11-08-owner");
  } finally {
    await browser.close();
  }

  process.exit(summary());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
