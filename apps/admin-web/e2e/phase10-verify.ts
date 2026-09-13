/**
 * Phase 10 verification — real Chrome, real API, real database.
 *
 * Run with:
 *   1. MySQL up      (apps/api: bash scripts/dev-mysql-sandbox.sh start)
 *   2. Migration     (apps/api: pnpm prisma migrate deploy)
 *   3. Fixtures      (apps/api: pnpm tsx scripts/phase10-fixtures.ts)
 *   4. API up        (apps/api: pnpm dev)
 *   5. Admin web up  (apps/admin-web: pnpm dev)
 *   6. pnpm e2e:leads
 *
 * The claims this phase has to prove: the pipeline graph is enforced by the server (not only
 * hidden in the UI), converting a lead actually inserts a Member and stamps convertedMemberId
 * in the same step, and `leads.manage` matches the 4.2 matrix (receptionist yes, trainer and
 * accountant no). Confirmed on the rendered page and against MySQL with the `mysql` client.
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

const LEAD_PHONE_PREFIX = "+9192222";

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
  await handle.click({ count: 3 });
  await handle.type(value);
}

async function clickButton(page: Page, label: string) {
  const clicked = await page.$$eval(
    "button",
    (buttons, text) => {
      const button = buttons.find((b) => b.textContent?.trim() === text);
      if (!button) return false;
      (button as HTMLButtonElement).click();
      return true;
    },
    label,
  );
  if (!clicked) throw new Error(`No button labelled "${label}"`);
}

async function forceApiCall(
  page: Page,
  method: "get" | "post" | "patch",
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

function orgId(): string {
  return requireCell(queryOne("SELECT id FROM organizations WHERE slug = 'demo-gym'"), "id");
}

function mainBranchId(): string {
  return requireCell(
    queryOne(
      `SELECT id FROM branches
        WHERE organizationId = ${sqlString(orgId())}
        ORDER BY createdAt ASC LIMIT 1`,
    ),
    "id",
  );
}

function leadByName(name: string): { id: string; status: string; phone: string } {
  const row = queryOne(
    `SELECT id, status, phone FROM leads
      WHERE name = ${sqlString(name)} AND phone LIKE ${sqlString(`${LEAD_PHONE_PREFIX}%`)}`,
  );
  return {
    id: requireCell(row, "id"),
    status: requireCell(row, "status"),
    phone: requireCell(row, "phone"),
  };
}

function leadByPhone(phone: string): {
  id: string;
  status: string;
  convertedMemberId: string | null;
} {
  const row = queryOne(
    `SELECT id, status, convertedMemberId FROM leads WHERE phone = ${sqlString(phone)}`,
  );
  return {
    id: requireCell(row, "id"),
    status: requireCell(row, "status"),
    convertedMemberId: row?.convertedMemberId ?? null,
  };
}

async function main() {
  const browser = await launch();
  const page = await browser.newPage();
  forwardPageErrors(page);
  const organizationId = orgId();
  const branchId = mainBranchId();

  step("1. OWNER: pipeline list, brand palette, create through the form");
  await login(page, OWNER);
  await page.goto(`${APP_URL}/leads`, { waitUntil: "networkidle0" });
  await page.waitForSelector("[data-testid='leads-heading']");
  const listBody = await textOf(page, "body");
  check("Priya New is on the list", listBody.includes("Priya New"));
  check("Aarav Contacted is on the list", listBody.includes("Aarav Contacted"));
  check("Meera Trial is on the list", listBody.includes("Meera Trial"));
  check("Vikram Lost is on the list", listBody.includes("Vikram Lost"));
  const headingColor = await computed(page, "[data-testid='leads-heading']", "color");
  checkEqual("heading uses brand white", headingColor, BRAND_RGB.white);
  await screenshot(page, "phase10-01-leads-list");

  await page.click("[data-testid='add-lead']");
  await page.waitForSelector("[data-testid='lead-form']");
  await setField(page, "Name", "Neha Created");
  await setField(page, "Phone", `${LEAD_PHONE_PREFIX}88001`);
  await setField(page, "Source", "walk-in");
  await clickButton(page, "Create lead");
  await page.waitForSelector("[data-testid='lead-detail-heading']", { timeout: 10_000 });
  const created = leadByPhone(`${LEAD_PHONE_PREFIX}88001`);
  checkEqual("created lead status is NEW", created.status, "NEW");
  check(
    "created lead heading names Neha",
    (await textOf(page, "[data-testid='lead-detail-heading']")).includes("Neha Created"),
  );

  step("2. Forward skip CONTACTED and refuse a backward move (1.20.1)");
  const priya = leadByName("Priya New");
  await page.goto(`${APP_URL}/leads/${priya.id}`, { waitUntil: "networkidle0" });
  await page.waitForSelector("[data-testid='pipeline-actions']");
  check("NEW offers skip to trial", await exists(page, "[data-testid='transition-TRIAL_SCHEDULED']"));
  await page.click("[data-testid='transition-TRIAL_SCHEDULED']");
  await page.waitForFunction(
    () =>
      document.querySelector("[data-testid='status-badge']")?.textContent?.includes("TRIAL") === true,
    { timeout: 10_000 },
  );
  checkEqual(
    "Priya skipped to TRIAL_SCHEDULED in MySQL",
    leadByName("Priya New").status,
    "TRIAL_SCHEDULED",
  );

  const back = await forceApiCall(page, "patch", `/organizations/${organizationId}/leads/${priya.id}`, {
    status: "CONTACTED",
  });
  checkEqual("backward PATCH is 409", back.status, 409);
  checkEqual("backward code is INVALID_LEAD_TRANSITION", back.code, "INVALID_LEAD_TRANSITION");
  checkEqual(
    "Priya is still TRIAL_SCHEDULED after the refused PATCH",
    leadByName("Priya New").status,
    "TRIAL_SCHEDULED",
  );

  const convertedViaPatch = await forceApiCall(
    page,
    "patch",
    `/organizations/${organizationId}/leads/${priya.id}`,
    { status: "CONVERTED" },
  );
  checkEqual("PATCH CONVERTED is 400 (not a legal target)", convertedViaPatch.status, 400);

  step("3. LOST recovers only to CONTACTED");
  const vikram = leadByName("Vikram Lost");
  const lostToNew = await forceApiCall(
    page,
    "patch",
    `/organizations/${organizationId}/leads/${vikram.id}`,
    { status: "NEW" },
  );
  checkEqual("LOST → NEW is 409", lostToNew.status, 409);
  checkEqual("LOST → NEW code", lostToNew.code, "INVALID_LEAD_TRANSITION");

  await page.goto(`${APP_URL}/leads/${vikram.id}`, { waitUntil: "networkidle0" });
  await page.waitForSelector("[data-testid='transition-CONTACTED']");
  check("LOST does not offer convert", !(await exists(page, "[data-testid='convert-form']")));
  await page.click("[data-testid='transition-CONTACTED']");
  await page.waitForFunction(
    () =>
      document
        .querySelector("[data-testid='status-badge']")
        ?.textContent?.includes("CONTACTED") === true,
    { timeout: 10_000 },
  );
  checkEqual("Vikram reopened to CONTACTED in MySQL", leadByName("Vikram Lost").status, "CONTACTED");

  await forceApiCall(page, "patch", `/organizations/${organizationId}/leads/${vikram.id}`, {
    status: "LOST",
  });
  const convertLost = await forceApiCall(
    page,
    "post",
    `/organizations/${organizationId}/leads/${vikram.id}/convert`,
    { firstName: "Vikram", lastName: "Lost", branchId },
  );
  checkEqual("convert from LOST is 409", convertLost.status, 409);
  checkEqual("convert from LOST code", convertLost.code, "LEAD_NOT_CONVERTIBLE");

  step("4. Convert creates a Member and freezes the lead (1.20.2)");
  const zoya = leadByName("Zoya Convert");
  await page.goto(`${APP_URL}/leads/${zoya.id}`, { waitUntil: "networkidle0" });
  await page.waitForSelector("[data-testid='convert-form']");
  await screenshot(page, "phase10-02-convert-form");
  await clickButton(page, "Convert to member");
  await page.waitForSelector("[data-testid='converted-banner']", { timeout: 10_000 });

  const converted = leadByPhone(zoya.phone);
  checkEqual("lead status is CONVERTED", converted.status, "CONVERTED");
  check("convertedMemberId is stamped", Boolean(converted.convertedMemberId));

  const member = queryOne(
    `SELECT id, firstName, lastName, phone, status FROM members WHERE id = ${sqlString(
      converted.convertedMemberId!,
    )}`,
  );
  checkEqual("member first name", member?.firstName, "Zoya");
  checkEqual("member last name", member?.lastName, "Convert");
  checkEqual("member phone is the lead's", member?.phone, zoya.phone);
  checkEqual("member is ACTIVE", member?.status, "ACTIVE");
  check(
    "banner names the member",
    (await textOf(page, "[data-testid='converted-banner']")).includes("Zoya Convert"),
  );
  check("convert form is gone", !(await exists(page, "[data-testid='convert-form']")));
  check("pipeline actions are gone", !(await exists(page, "[data-testid='pipeline-actions']")));
  const editClicked = await page.$$eval("button", (buttons) =>
    buttons.some((b) => b.textContent?.trim() === "Edit"),
  );
  check("Edit is gone on a converted lead", !editClicked);

  const patchConverted = await forceApiCall(
    page,
    "patch",
    `/organizations/${organizationId}/leads/${zoya.id}`,
    { name: "Nope" },
  );
  checkEqual("PATCH converted lead is 409", patchConverted.status, 409);
  checkEqual("PATCH converted code", patchConverted.code, "LEAD_CONVERTED");

  const reconvert = await forceApiCall(
    page,
    "post",
    `/organizations/${organizationId}/leads/${zoya.id}/convert`,
    { firstName: "Zoya", lastName: "Convert", branchId },
  );
  checkEqual("second convert is 409", reconvert.status, 409);
  checkEqual("second convert code", reconvert.code, "LEAD_CONVERTED");

  const memberCount = queryOne(
    `SELECT COUNT(*) AS n FROM members WHERE phone = ${sqlString(zoya.phone)}`,
  );
  checkEqual("exactly one member row for Zoya's phone", Number(memberCount?.n ?? 0), 1);

  step("5. RBAC: receptionist can run the pipeline; trainer and accountant cannot");
  await logout(page);
  await login(page, RECEPTIONIST);
  await page.goto(`${APP_URL}/leads`, { waitUntil: "networkidle0" });
  await page.waitForSelector("[data-testid='leads-heading']");
  check(
    "receptionist sees Leads in the sidebar",
    (await textOf(page, "[data-testid='app-sidebar']")).includes("Leads"),
  );
  const recepList = await forceApiCall(page, "get", `/organizations/${organizationId}/leads`);
  checkEqual("receptionist GET /leads is 200", recepList.status, 200);
  await screenshot(page, "phase10-03-receptionist");

  await logout(page);
  await login(page, TRAINER);
  const trainerList = await forceApiCall(page, "get", `/organizations/${organizationId}/leads`);
  checkEqual("trainer GET /leads is 403", trainerList.status, 403);
  checkEqual("trainer code", trainerList.code, "PERMISSION_DENIED");
  await page.goto(`${APP_URL}/leads`, { waitUntil: "networkidle0" });
  check(
    "trainer sidebar has no Leads",
    !(await textOf(page, "[data-testid='app-sidebar']")).includes("Leads"),
  );
  check(
    "trainer hitting /leads gets the not-for-your-role screen",
    /not available for your role/i.test(await textOf(page, "body")),
  );

  await logout(page);
  await login(page, ACCOUNTANT);
  const accountantList = await forceApiCall(page, "get", `/organizations/${organizationId}/leads`);
  checkEqual("accountant GET /leads is 403", accountantList.status, 403);
  checkEqual("accountant code", accountantList.code, "PERMISSION_DENIED");
  await screenshot(page, "phase10-04-accountant");

  await browser.close();
  process.exit(summary());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
