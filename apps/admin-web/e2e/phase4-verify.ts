/**
 * Phase 4 verification — real Chrome, real API, real database.
 *
 * Run with:
 *   1. MySQL up      (apps/api: bash scripts/dev-mysql-sandbox.sh start)
 *   2. Fixtures      (apps/api: pnpm tsx scripts/phase4-fixtures.ts)
 *   3. API up        (apps/api: pnpm dev)
 *   4. Admin web up  (apps/admin-web: pnpm dev)
 *   5. pnpm e2e:members
 *
 * Every mutation is performed by clicking through the actual UI, then read back out of MySQL with
 * the `mysql` client — not through the API that wrote it.
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
  sqlString,
  step,
  summary,
} from "./lib/harness";

const OWNER = { email: "owner@demo-gym.test", password: "ChangeMe123!" };
const RECEPTIONIST = { email: "reception@demo-gym.test", password: "ChangeMe123!" };

/** Must match BROWSER_PHONE_PREFIX in apps/api/scripts/phase4-fixtures.ts. */
const PHONE_PREFIX = "+9198888";
const phone = (suffix: string) => `${PHONE_PREFIX}${suffix}`;

const CREATED_PHONE = phone("10001");
const RECEPTIONIST_PHONE = phone("20001");

async function login(page: Page, who: { email: string; password: string }) {
  await page.goto(`${APP_URL}/login`, { waitUntil: "networkidle0" });
  await page.waitForSelector('input[type="password"]');
  await page.type('input[type="email"]', who.email);
  await page.type('input[type="password"]', who.password);
  await page.click('button[type="submit"]');
  await page.waitForSelector('[data-testid="app-shell"]', { timeout: 10_000 });
}

async function logout(page: Page) {
  await page.click('[data-testid="app-topbar"] button');
  await page.waitForSelector('input[type="password"]', { timeout: 10_000 });
}

/** Text of every row in the members table, first column only. */
async function tableNames(page: Page): Promise<string[]> {
  return page.$$eval("[data-testid='members-table'] tbody tr td:first-child", (cells) =>
    cells.map((cell) => cell.textContent?.trim() ?? ""),
  );
}

async function fillMemberForm(
  page: Page,
  values: { firstName: string; lastName: string; phone: string; email?: string },
) {
  await page.waitForSelector("form");
  const setField = async (label: string, value: string) => {
    const handle = await page.$(`::-p-xpath(//label[text()=${sqlString(label)}]/following-sibling::input)`);
    if (!handle) throw new Error(`No input for label "${label}"`);
    await handle.click({ count: 3 });
    await handle.type(value);
  };

  await setField("First name", values.firstName);
  await setField("Last name", values.lastName);
  await setField("Phone", values.phone);
  if (values.email) await setField("Email (optional)", values.email);
}

/** Everything the UI created during this run, so a re-run starts clean. */
function cleanUpBrowserMembers(): number {
  const before = queryOne(
    `SELECT COUNT(*) AS n FROM members WHERE phone LIKE '${PHONE_PREFIX}%'`,
  );
  queryDb(`DELETE FROM members WHERE phone LIKE '${PHONE_PREFIX}%'`);
  return Number(before?.n ?? 0);
}

async function main(): Promise<number> {
  cleanUpBrowserMembers();

  const browser = await launch();
  const page = await browser.newPage();
  forwardPageErrors(page);

  try {
    await login(page, OWNER);

    // ---------------------------------------------------------------------
    step("1. Members list renders the seeded fixture set");
    // ---------------------------------------------------------------------
    await page.goto(`${APP_URL}/members`, { waitUntil: "networkidle0" });
    await page.waitForSelector("[data-testid='members-table'] tbody tr");

    const initialNames = await tableNames(page);
    check(
      "archived members are hidden by default",
      !initialNames.some((n) => n.includes("Farhan")),
      initialNames.join(", "),
    );
    checkEqual("5 non-archived fixture members listed", initialNames.length, 5);

    const dbActive = queryOne(
      `SELECT COUNT(*) AS n FROM members WHERE phone LIKE '+9199000000%' AND status <> 'ARCHIVED'`,
    );
    checkEqual("matches the database count", initialNames.length, Number(dbActive?.n));
    console.log(`  screenshot: ${await screenshot(page, "p4-01-members-list")}`);

    // ---------------------------------------------------------------------
    step("2. Brand palette on the members screens (computed CSS)");
    // ---------------------------------------------------------------------
    checkEqual(
      "filter bar surface is brand.black-88",
      await computed(page, "[data-testid='members-filter-bar']", "background-color"),
      BRAND_RGB.black88,
    );
    checkEqual(
      "table header surface is brand.black-88",
      await computed(page, "[data-testid='members-table'] thead", "background-color"),
      BRAND_RGB.black88,
    );
    // Picked by content rather than by position: the first `[data-testid=status-badge]` in the
    // DOM is whichever member sorts first, and the first `button` is the topbar's Sign out.
    const activeBadgeColor = await page.$$eval("[data-testid='status-badge']", (badges) => {
      const active = badges.find((b) => b.textContent?.trim() === "ACTIVE");
      return active ? window.getComputedStyle(active).color : "no ACTIVE badge found";
    });
    checkEqual("ACTIVE status badge text is brand.green", activeBadgeColor, BRAND_RGB.green);

    const addButtonBg = await page.$$eval("button", (buttons) => {
      const add = buttons.find((b) => b.textContent?.trim() === "Add member");
      return add ? window.getComputedStyle(add).backgroundColor : "no Add member button found";
    });
    checkEqual("Add member button fill is brand.green", addButtonBg, BRAND_RGB.green);
    checkEqual(
      "subtitle is brand.green-muted",
      await computed(page, "h1 + p", "color"),
      BRAND_RGB.greenMuted,
    );

    // ---------------------------------------------------------------------
    step("3. Create a member through the UI, then read it back out of MySQL");
    // ---------------------------------------------------------------------
    await page.click("::-p-text(Add member)");
    await page.waitForSelector("form");

    await fillMemberForm(page, {
      firstName: "Meera",
      lastName: "Iyer",
      phone: CREATED_PHONE,
      email: "meera.iyer@example.test",
    });
    await page.click('button[type="submit"]');
    await page.waitForSelector("[data-testid='member-name']", { timeout: 10_000 });

    const shownName = await page.$eval("[data-testid='member-name']", (el) => el.textContent);
    checkEqual("landed on the new member's detail page", shownName, "Meera Iyer");

    const createdRow = queryOne(
      `SELECT id, organizationId, branchId, firstName, lastName, phone, email, status, deletedAt
       FROM members WHERE phone = ${sqlString(CREATED_PHONE)}`,
    );
    check("row exists in the database", createdRow !== undefined);
    checkEqual("firstName persisted", createdRow?.firstName, "Meera");
    checkEqual("lastName persisted", createdRow?.lastName, "Iyer");
    checkEqual("email persisted", createdRow?.email, "meera.iyer@example.test");
    checkEqual("status defaults to ACTIVE", createdRow?.status, "ACTIVE");
    checkEqual("deletedAt is NULL", createdRow?.deletedAt, "NULL");
    check("id is a lowercase ULID", /^[0-9a-z]{26}$/.test(createdRow?.id ?? ""), createdRow?.id);

    const memberId = requireCell(createdRow, "id");
    console.log(`  created member id: ${memberId}`);
    console.log(`  screenshot: ${await screenshot(page, "p4-02-member-detail")}`);

    // ---------------------------------------------------------------------
    step("4. Edit that member through the UI, then confirm in MySQL");
    // ---------------------------------------------------------------------
    await page.click("::-p-text(Edit)");
    await page.waitForSelector("form");

    const lastNameInput = await page.$(
      "::-p-xpath(//label[text()='Last name']/following-sibling::input)",
    );
    await lastNameInput!.click({ count: 3 });
    await lastNameInput!.type("Iyer-Nair");
    await page.click('button[type="submit"]');

    await page.waitForFunction(
      () =>
        document.querySelector("[data-testid='member-name']")?.textContent?.includes("Iyer-Nair") ??
        false,
      { timeout: 10_000 },
    );

    const editedRow = queryOne(
      `SELECT lastName, updatedAt, createdAt FROM members WHERE id = ${sqlString(memberId)}`,
    );
    checkEqual("lastName updated in the database", editedRow?.lastName, "Iyer-Nair");
    check(
      "updatedAt moved past createdAt",
      (editedRow?.updatedAt ?? "") > (editedRow?.createdAt ?? ""),
      `${editedRow?.createdAt} → ${editedRow?.updatedAt}`,
    );

    // ---------------------------------------------------------------------
    step("5. Duplicate phone surfaces a friendly error (Locked Decision 1.3)");
    // ---------------------------------------------------------------------
    await page.goto(`${APP_URL}/members/new`, { waitUntil: "networkidle0" });
    await fillMemberForm(page, {
      firstName: "Copycat",
      lastName: "Duplicate",
      phone: CREATED_PHONE,
    });
    await page.click('button[type="submit"]');

    await page.waitForSelector("p[role='alert']", { timeout: 10_000 });
    const duplicateMessage = await page.$eval("p[role='alert']", (el) => el.textContent ?? "");

    check(
      "the error names who already holds the number",
      duplicateMessage.includes("Meera Iyer-Nair"),
      duplicateMessage,
    );
    check(
      "the error quotes the phone number",
      duplicateMessage.includes(CREATED_PHONE),
      duplicateMessage,
    );
    check(
      "it is attached to the phone field, not just a banner",
      (await page.$eval(
        "::-p-xpath(//label[text()='Phone']/following-sibling::input)",
        (el) => el.getAttribute("aria-invalid"),
      )) === "true",
    );
    check("still on the form — nothing was created", page.url().includes("/members/new"));

    const duplicateCount = queryOne(
      `SELECT COUNT(*) AS n FROM members WHERE phone = ${sqlString(CREATED_PHONE)}`,
    );
    checkEqual("database still holds exactly one row for that phone", Number(duplicateCount?.n), 1);
    console.log(`  screenshot: ${await screenshot(page, "p4-03-duplicate-phone")}`);

    // ---------------------------------------------------------------------
    step("6. Search + status filter + pagination + sort, all at once");
    // ---------------------------------------------------------------------
    // Fixture set: 4 non-archived "Singh" (Aarav, Bhavna ACTIVE; Divya, Esha INACTIVE),
    // Chetan Verma ACTIVE, plus Farhan Khan and Gita Singh ARCHIVED.
    await page.goto(
      `${APP_URL}/members?search=Singh&status=INACTIVE&limit=1&sortBy=firstName&sortOrder=asc`,
      { waitUntil: "networkidle0" },
    );
    await page.waitForSelector("[data-testid='members-table'] tbody tr");

    const page1 = await tableNames(page);
    checkEqual("page 1 of the filtered set holds one row", page1.length, 1);
    checkEqual("sorted ascending, so Divya comes first", page1[0], "Divya Singh");

    const summaryText = await page.$eval("h1 + p", (el) => el.textContent ?? "");
    check(
      "count reflects search AND status, not the whole list",
      summaryText.includes("2 members matching your filters"),
      summaryText,
    );

    const paginationText = await page.$eval(
      "[data-testid='pagination-summary']",
      (el) => el.textContent ?? "",
    );
    checkEqual("pagination says page 1 of 2", paginationText.trim(), "Page 1 of 2");

    // Cross-check the filtered total against the database.
    const dbFiltered = queryOne(
      `SELECT COUNT(*) AS n FROM members
       WHERE phone LIKE '+9199000000%' AND status = 'INACTIVE'
         AND (firstName LIKE '%Singh%' OR lastName LIKE '%Singh%')`,
    );
    checkEqual("matches the equivalent SQL count", Number(dbFiltered?.n), 2);

    await page.click("::-p-text(Next)");
    await page.waitForFunction(
      () =>
        document
          .querySelector("[data-testid='members-table'] tbody tr td:first-child")
          ?.textContent?.includes("Esha") ?? false,
      { timeout: 10_000 },
    );

    const page2 = await tableNames(page);
    checkEqual("page 2 holds the second match", page2[0], "Esha Singh");
    check(
      "paging preserved search and status in the URL",
      page.url().includes("search=Singh") && page.url().includes("status=INACTIVE"),
      page.url(),
    );
    console.log(`  screenshot: ${await screenshot(page, "p4-04-combined-filters")}`);

    // Reversing the sort must change which member is on page 1 — proving the sort is applied
    // across the whole filtered set before it's cut into pages, not just within a page.
    await page.goto(
      `${APP_URL}/members?search=Singh&status=INACTIVE&limit=1&sortBy=firstName&sortOrder=desc`,
      { waitUntil: "networkidle0" },
    );
    await page.waitForSelector("[data-testid='members-table'] tbody tr");
    checkEqual("descending sort puts Esha on page 1", (await tableNames(page))[0], "Esha Singh");

    // And the archived members are reachable only by asking.
    await page.goto(`${APP_URL}/members?status=ARCHIVED`, { waitUntil: "networkidle0" });
    await page.waitForSelector("[data-testid='members-table'] tbody tr");
    const archivedNames = await tableNames(page);
    checkEqual("2 archived fixture members", archivedNames.length, 2);
    check(
      "and they are the expected two",
      archivedNames.some((n) => n.includes("Farhan")) &&
        archivedNames.some((n) => n.includes("Gita")),
      archivedNames.join(", "),
    );

    // ---------------------------------------------------------------------
    step("7. Archive through the UI, then confirm the row in MySQL");
    // ---------------------------------------------------------------------
    await page.goto(`${APP_URL}/members/${memberId}`, { waitUntil: "networkidle0" });
    await page.waitForSelector("[data-testid='archive-button']");
    await page.click("[data-testid='archive-button']");
    await page.waitForSelector("[data-testid='confirm-archive']");

    const beforeArchive = queryOne(
      `SELECT status FROM members WHERE id = ${sqlString(memberId)}`,
    );
    checkEqual("nothing changed just from opening the dialog", beforeArchive?.status, "ACTIVE");

    await page.click("[data-testid='confirm-archive']");
    await page.waitForFunction(
      () =>
        document.querySelector("[data-testid='status-badge']")?.textContent?.trim() === "ARCHIVED",
      { timeout: 10_000 },
    );

    const archivedRow = queryOne(
      `SELECT status, deletedAt FROM members WHERE id = ${sqlString(memberId)}`,
    );
    checkEqual("status is ARCHIVED in the database", archivedRow?.status, "ARCHIVED");
    // Archive is a status transition, not a soft delete — Section 9 (2026-09-06).
    checkEqual("deletedAt is still NULL", archivedRow?.deletedAt, "NULL");
    console.log(`  screenshot: ${await screenshot(page, "p4-05-archived")}`);

    // The archived member drops out of the default list but is still reachable.
    await page.goto(`${APP_URL}/members`, { waitUntil: "networkidle0" });
    await page.waitForSelector("[data-testid='members-table'] tbody tr");
    check(
      "archived member no longer in the default list",
      !(await tableNames(page)).some((n) => n.includes("Iyer-Nair")),
    );

    // ---------------------------------------------------------------------
    step("8. RBAC with a real RECEPTIONIST login");
    // ---------------------------------------------------------------------
    await logout(page);
    await login(page, RECEPTIONIST);

    const roleShown = await page.$eval('[data-testid="stat-role"]', (el) => el.textContent);
    checkEqual("signed in as RECEPTIONIST", roleShown, "RECEPTIONIST");

    await page.goto(`${APP_URL}/members`, { waitUntil: "networkidle0" });
    await page.waitForSelector("[data-testid='members-table'] tbody tr");
    check("can view the members list", (await tableNames(page)).length > 0);

    // Create is allowed.
    await page.goto(`${APP_URL}/members/new`, { waitUntil: "networkidle0" });
    await fillMemberForm(page, {
      firstName: "Walkin",
      lastName: "Signup",
      phone: RECEPTIONIST_PHONE,
    });
    await page.click('button[type="submit"]');
    await page.waitForSelector("[data-testid='member-name']", { timeout: 10_000 });

    const receptionistRow = queryOne(
      `SELECT id, firstName, status FROM members WHERE phone = ${sqlString(RECEPTIONIST_PHONE)}`,
    );
    check("receptionist's member was written to the database", receptionistRow !== undefined);
    checkEqual("with the entered name", receptionistRow?.firstName, "Walkin");

    const receptionistMemberId = requireCell(receptionistRow, "id");

    // Archive is not.
    check(
      "archive button is not rendered for a RECEPTIONIST",
      (await page.$("[data-testid='archive-button']")) === null,
    );
    check(
      "but Edit still is (members.update is granted)",
      (await page.$("::-p-text(Edit)")) !== null,
    );
    console.log(`  screenshot: ${await screenshot(page, "p4-06-receptionist-detail")}`);

    /*
     * Hiding the button is only a convenience — the API is the authority. This bypasses the UI
     * entirely and fires the archive request through the app's own axios instance (imported by
     * its Vite dev URL, so it carries the receptionist's real access token) to prove the server
     * refuses it rather than merely being un-clickable.
     */
    const organizationId = requireCell(createdRow, "organizationId");
    const forced = await page.evaluate(
      async (moduleUrl: string, path: string) => {
        const mod = await import(/* @vite-ignore */ moduleUrl);
        try {
          await mod.apiClient.post(path, {});
          return { status: 200, code: "NONE" };
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
      `/organizations/${organizationId}/members/${receptionistMemberId}/archive`,
    );

    checkEqual("forced archive request is rejected 403", forced.status, 403);
    checkEqual("with PERMISSION_DENIED", forced.code, "PERMISSION_DENIED");

    const untouched = queryOne(
      `SELECT status FROM members WHERE id = ${sqlString(receptionistMemberId)}`,
    );
    checkEqual("the member is untouched in the database", untouched?.status, "ACTIVE");

    // ---------------------------------------------------------------------
    step("9. Archived member's phone number is available again");
    // ---------------------------------------------------------------------
    await logout(page);
    await login(page, OWNER);
    await page.goto(`${APP_URL}/members/new`, { waitUntil: "networkidle0" });

    await fillMemberForm(page, {
      firstName: "Returning",
      lastName: "Member",
      // The number belonging to the member archived in step 7.
      phone: CREATED_PHONE,
    });
    await page.click('button[type="submit"]');
    await page.waitForSelector("[data-testid='member-name']", { timeout: 10_000 });

    check("re-using an archived member's phone is allowed", page.url().includes("/members/"));
    const reuseRows = queryDb(
      `SELECT firstName, status FROM members WHERE phone = ${sqlString(CREATED_PHONE)} ORDER BY createdAt`,
    );
    checkEqual("two members now share that number", reuseRows.length, 2);
    checkEqual("the older one is archived", reuseRows[0]?.status, "ARCHIVED");
    checkEqual("the new one is active", reuseRows[1]?.status, "ACTIVE");
    checkEqual("and is the member just created", reuseRows[1]?.firstName, "Returning");

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
