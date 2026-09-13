/**
 * Phase 5 verification — real Chrome, real API, real database.
 *
 * Run with:
 *   1. MySQL up      (apps/api: bash scripts/dev-mysql-sandbox.sh start)
 *   2. Fixtures      (apps/api: pnpm tsx scripts/phase5-fixtures.ts)
 *   3. API up        (apps/api: pnpm dev)
 *   4. Admin web up  (apps/admin-web: pnpm dev)
 *   5. pnpm e2e:memberships
 *
 * Every mutation is performed by clicking through the actual UI, then read back out of MySQL with
 * the `mysql` client — not through the API that wrote it.
 *
 * Two things are simulated rather than waited for, both by writing a *past timestamp* and then
 * letting the real code do the arithmetic: a term that has already ended (via a backdated start
 * date entered in the UI) and a freeze that began a week ago (via one UPDATE, clearly marked).
 * Nothing else touches the database except to read it.
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
const RECEPTIONIST = { email: "reception@demo-gym.test", password: "ChangeMe123!" };

/** Must match the namespaces in apps/api/scripts/phase5-fixtures.ts. */
const MEMBER_PHONE_PREFIX = "+9197777";
const PLAN_NAME_PREFIX = "E2E ";

const GOLD_PLAN = { name: `${PLAN_NAME_PREFIX}Gold`, price: "1000", durationDays: "30" };
const GOLD_NEW_PRICE = "2500";
const GOLD_NEW_DURATION = "60";
const PLATINUM_PLAN = `${PLAN_NAME_PREFIX}Platinum`;

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const today = new Date(
  Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()),
);
const day = (offset: number) => new Date(today.getTime() + offset * MS_PER_DAY).toISOString().slice(0, 10);

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

/**
 * Types into the input belonging to a label, replacing anything already there.
 *
 * `<input type="date">` is the exception: Chrome reads keystrokes into it through locale-ordered
 * segments, so typing an ISO string lands garbage. Those get the value assigned through React's
 * own setter instead, with an input event so the controlled component still sees the change.
 */
async function setField(page: Page, label: string, value: string) {
  const handle = await page.$(
    `::-p-xpath(//label[text()=${sqlString(label)}]/following-sibling::input)`,
  );
  if (!handle) throw new Error(`No input for label "${label}"`);

  const isDate = await handle.evaluate((el) => (el as HTMLInputElement).type === "date");
  if (isDate) {
    await handle.evaluate((el, next) => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(el, next);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }, value);
    return;
  }

  await handle.click({ count: 3 });
  await handle.type(value);
}

/** Picks an option by its visible text from the select belonging to a label. */
async function selectByText(page: Page, label: string, optionText: string) {
  const handle = await page.$(
    `::-p-xpath(//label[text()=${sqlString(label)}]/following-sibling::*[1]//select)`,
  );
  if (!handle) throw new Error(`No select for label "${label}"`);
  const value = await handle.evaluate((el, text) => {
    const option = Array.from((el as HTMLSelectElement).options).find((o) =>
      o.textContent?.includes(text as string),
    );
    return option?.value ?? "";
  }, optionText);
  if (!value) throw new Error(`No option matching "${optionText}" in "${label}"`);
  await handle.select(value);
}

/** Clicks the button whose visible text is exactly `label`. */
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

async function buttonExists(page: Page, label: string): Promise<boolean> {
  return page.$$eval(
    "button",
    (buttons, text) => buttons.some((b) => b.textContent?.trim() === text),
    label,
  );
}

/**
 * Fires a request through the app's own axios instance, imported by its Vite dev URL so it
 * carries the live session's access token. This is how "the button is hidden" is separated from
 * "the server refuses" — the UI is bypassed entirely.
 */
async function forceApiCall(
  page: Page,
  path: string,
  body: Record<string, unknown> = {},
): Promise<{ status: number; code: string }> {
  return page.evaluate(
    async (moduleUrl: string, requestPath: string, requestBody: Record<string, unknown>) => {
      const mod = await import(/* @vite-ignore */ moduleUrl);
      try {
        const res = await mod.apiClient.post(requestPath, requestBody);
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
    path,
    body,
  );
}

function memberIdByLastName(lastName: string): string {
  return requireCell(
    queryOne(
      `SELECT id FROM members WHERE lastName = ${sqlString(lastName)} AND phone LIKE '${MEMBER_PHONE_PREFIX}%'`,
    ),
    "id",
  );
}

/** Sells a plan to a member by driving the real form, and returns the new membership's id. */
async function sellMembership(
  page: Page,
  memberId: string,
  planName: string,
  startDate?: string,
): Promise<string> {
  await page.goto(`${APP_URL}/members/${memberId}/memberships/new`, { waitUntil: "networkidle0" });
  await page.waitForSelector("[data-testid='plan-select']");
  await selectByText(page, "Plan", planName);
  if (startDate) await setField(page, "Start date (optional)", startDate);
  await clickButton(page, "Create membership");
  await page.waitForSelector("[data-testid='membership-heading']", { timeout: 10_000 });
  return page.url().split("/memberships/")[1]!;
}

async function main(): Promise<number> {
  const browser = await launch();
  const page = await browser.newPage();
  forwardPageErrors(page);

  try {
    await login(page, OWNER);
    const organizationId = requireCell(
      queryOne(`SELECT id FROM organizations WHERE slug = 'demo-gym'`),
      "id",
    );

    // ---------------------------------------------------------------------
    step("1. Create a membership plan through the UI");
    // ---------------------------------------------------------------------
    await page.goto(`${APP_URL}/membership-plans/new`, { waitUntil: "networkidle0" });
    await page.waitForSelector("form");
    await setField(page, "Plan name", GOLD_PLAN.name);
    await setField(page, "Price (₹)", GOLD_PLAN.price);
    await setField(page, "Duration (days)", GOLD_PLAN.durationDays);
    await clickButton(page, "Create plan");
    await page.waitForSelector("[data-testid='plans-table'] tbody tr", { timeout: 10_000 });

    const goldRow = queryOne(
      `SELECT id, price, durationDays, status FROM membership_plans WHERE name = ${sqlString(GOLD_PLAN.name)}`,
    );
    check("plan row exists in MySQL", goldRow !== undefined);
    checkEqual("price stored as DECIMAL(10,2)", goldRow?.price, "1000.00");
    checkEqual("duration stored", goldRow?.durationDays, "30");
    checkEqual("status defaults to ACTIVE", goldRow?.status, "ACTIVE");
    const goldPlanId = requireCell(goldRow, "id");
    console.log(`  screenshot: ${await screenshot(page, "p5-01-plans-list")}`);

    // ---------------------------------------------------------------------
    step("2. Sell it, and confirm the price/duration snapshot on the row");
    // ---------------------------------------------------------------------
    const snapshotMemberId = memberIdByLastName("Snapshot");
    const membershipId = await sellMembership(page, snapshotMemberId, GOLD_PLAN.name);

    const sold = queryOne(
      `SELECT priceAtPurchase, durationDaysAtPurchase, DATE(startDate) AS startDate,
              DATE(endDate) AS endDate, status, branchId, totalFrozenDays, previousMembershipId
       FROM memberships WHERE id = ${sqlString(membershipId)}`,
    );
    checkEqual("priceAtPurchase snapshot", sold?.priceAtPurchase, "1000.00");
    checkEqual("durationDaysAtPurchase snapshot", sold?.durationDaysAtPurchase, "30");
    checkEqual("startDate is today", sold?.startDate, day(0));
    // endDate is the last day of access, inclusive — 30 days starting today ends on day 29.
    checkEqual("endDate is start + 29 days (inclusive term)", sold?.endDate, day(29));
    checkEqual("status ACTIVE", sold?.status, "ACTIVE");
    checkEqual("no freeze history yet", sold?.totalFrozenDays, "0");
    checkEqual("not a renewal", sold?.previousMembershipId, "NULL");

    const memberBranch = queryOne(
      `SELECT branchId FROM members WHERE id = ${sqlString(snapshotMemberId)}`,
    );
    checkEqual("branch inherited from the member", sold?.branchId, memberBranch?.branchId);
    console.log(`  screenshot: ${await screenshot(page, "p5-02-membership-detail")}`);

    // ---------------------------------------------------------------------
    step("3. Change the plan's price — the issued membership must not follow");
    // ---------------------------------------------------------------------
    await page.goto(`${APP_URL}/membership-plans/${goldPlanId}/edit`, { waitUntil: "networkidle0" });
    await page.waitForSelector("form");
    await setField(page, "Price (₹)", GOLD_NEW_PRICE);
    await setField(page, "Duration (days)", GOLD_NEW_DURATION);
    await clickButton(page, "Save changes");
    await page.waitForSelector("[data-testid='plans-table'] tbody tr", { timeout: 10_000 });

    const repriced = queryOne(
      `SELECT price, durationDays FROM membership_plans WHERE id = ${sqlString(goldPlanId)}`,
    );
    checkEqual("plan now costs more", repriced?.price, "2500.00");
    checkEqual("and runs longer", repriced?.durationDays, "60");

    const afterReprice = queryOne(
      `SELECT priceAtPurchase, durationDaysAtPurchase, DATE(endDate) AS endDate
       FROM memberships WHERE id = ${sqlString(membershipId)}`,
    );
    checkEqual("issued membership keeps its price", afterReprice?.priceAtPurchase, "1000.00");
    checkEqual("and its duration", afterReprice?.durationDaysAtPurchase, "30");
    checkEqual("and its end date", afterReprice?.endDate, day(29));

    // The database is one half of it; what an operator actually sees is the other.
    await page.goto(`${APP_URL}/memberships/${membershipId}`, { waitUntil: "networkidle0" });
    await page.waitForSelector("[data-testid='price-at-purchase']");
    const shownPrice = await page.$eval("[data-testid='price-at-purchase']", (el) =>
      el.textContent?.trim(),
    );
    checkEqual("UI still shows the price it was sold at", shownPrice, "₹1,000.00");
    console.log(`  screenshot: ${await screenshot(page, "p5-03-snapshot-holds")}`);

    // ---------------------------------------------------------------------
    step("4. Renew — a new row at the new price, the old row untouched");
    // ---------------------------------------------------------------------
    await clickButton(page, "Renew");
    await page.waitForSelector("[data-testid='confirm-renew']");
    await clickButton(page, "Confirm renewal");
    await page.waitForFunction(
      (oldId: string) => !window.location.pathname.endsWith(oldId),
      { timeout: 10_000 },
      membershipId,
    );

    const renewedId = page.url().split("/memberships/")[1]!;
    check("renewal landed on a different row", renewedId !== membershipId, renewedId);

    const renewed = queryOne(
      `SELECT priceAtPurchase, durationDaysAtPurchase, DATE(startDate) AS startDate,
              DATE(endDate) AS endDate, status, previousMembershipId
       FROM memberships WHERE id = ${sqlString(renewedId)}`,
    );
    checkEqual("new term priced at the plan's current rate", renewed?.priceAtPurchase, "2500.00");
    checkEqual("with the plan's current duration", renewed?.durationDaysAtPurchase, "60");
    checkEqual("starting the day after the old term ends", renewed?.startDate, day(30));
    checkEqual("and running 60 inclusive days", renewed?.endDate, day(89));
    checkEqual("chained to the term it followed", renewed?.previousMembershipId, membershipId);

    const original = queryOne(
      `SELECT priceAtPurchase, status, DATE(endDate) AS endDate
       FROM memberships WHERE id = ${sqlString(membershipId)}`,
    );
    checkEqual("original term still ACTIVE", original?.status, "ACTIVE");
    checkEqual("still at its own price", original?.priceAtPurchase, "1000.00");
    checkEqual("with its own end date", original?.endDate, day(29));

    const memberTerms = queryDb(
      `SELECT id FROM memberships WHERE memberId = ${sqlString(snapshotMemberId)}`,
    );
    checkEqual("the member now has two term rows, not one edited row", memberTerms.length, 2);

    // ---------------------------------------------------------------------
    step("5. Freeze pauses the clock; unfreeze hands the days back (1.15.2)");
    // ---------------------------------------------------------------------
    const freezeMemberId = memberIdByLastName("Freeze");
    // Backdated ten days so that a freeze starting a week ago is a scenario that could really
    // have happened, rather than a freeze predating the term it belongs to.
    const freezeId = await sellMembership(page, freezeMemberId, PLATINUM_PLAN, day(-10));

    const beforeFreeze = queryOne(
      `SELECT DATE(endDate) AS endDate FROM memberships WHERE id = ${sqlString(freezeId)}`,
    );
    checkEqual("90-day term that began ten days ago ends on day 79", beforeFreeze?.endDate, day(79));

    await clickButton(page, "Freeze");
    await page.waitForSelector("[data-testid='action-notice']", { timeout: 10_000 });

    const frozen = queryOne(
      `SELECT status, frozenAt FROM memberships WHERE id = ${sqlString(freezeId)}`,
    );
    checkEqual("status FROZEN in the database", frozen?.status, "FROZEN");
    check("frozenAt recorded", frozen?.frozenAt !== "NULL" && Boolean(frozen?.frozenAt));

    // Simulated time: the only write this harness makes. Backdating the start of the freeze is
    // equivalent to having waited a week, and lets the real unfreeze code do the arithmetic.
    queryDb(
      `UPDATE memberships SET frozenAt = DATE_SUB(NOW(), INTERVAL 7 DAY) WHERE id = ${sqlString(freezeId)}`,
    );

    await page.reload({ waitUntil: "networkidle0" });
    await page.waitForSelector("[data-testid='days-remaining']");
    const pausedDays = await page.$eval("[data-testid='days-remaining']", (el) =>
      el.textContent?.trim(),
    );
    // Three of the 90 days were used before the freeze began; a naive countdown to endDate would
    // have burned the seven frozen days too and shown 80.
    checkEqual("countdown is frozen at 87 days, not 80", pausedDays, "87");
    console.log(`  screenshot: ${await screenshot(page, "p5-04-frozen")}`);

    await clickButton(page, "Unfreeze");
    await page.waitForSelector("[data-testid='action-notice']", { timeout: 10_000 });

    const unfrozen = queryOne(
      `SELECT status, frozenAt, totalFrozenDays, DATE(endDate) AS endDate
       FROM memberships WHERE id = ${sqlString(freezeId)}`,
    );
    checkEqual("back to ACTIVE", unfrozen?.status, "ACTIVE");
    checkEqual("frozenAt cleared", unfrozen?.frozenAt, "NULL");
    checkEqual("seven frozen days recorded", unfrozen?.totalFrozenDays, "7");
    checkEqual("endDate pushed out by exactly seven days", unfrozen?.endDate, day(86));
    // endDate - totalFrozenDays still reconstructs the term the member originally bought.
    checkEqual("original term still reconstructible", day(86 - 7), day(79));

    const notice = await page.$eval("[data-testid='action-notice']", (el) => el.textContent ?? "");
    check("the UI states the new end date", notice.includes(day(86)), notice.trim());

    // ---------------------------------------------------------------------
    step("6. Invalid transitions are refused by the server, not just hidden (1.15.1)");
    // ---------------------------------------------------------------------
    const cancelMemberId = memberIdByLastName("Cancel");
    const cancelId = await sellMembership(page, cancelMemberId, PLATINUM_PLAN);

    await clickButton(page, "Cancel membership");
    await page.waitForSelector("[data-testid='confirm-cancel']");
    await clickButton(page, "Yes, cancel it");
    await page.waitForSelector("[data-testid='action-notice']", { timeout: 10_000 });

    const cancelled = queryOne(
      `SELECT status FROM memberships WHERE id = ${sqlString(cancelId)}`,
    );
    checkEqual("status CANCELLED in the database", cancelled?.status, "CANCELLED");

    await page.reload({ waitUntil: "networkidle0" });
    await page.waitForSelector("[data-testid='lifecycle-actions']");
    check("Renew is not offered on a cancelled term", !(await buttonExists(page, "Renew")));
    check("Freeze is not offered either", !(await buttonExists(page, "Freeze")));
    check("nor Cancel again", !(await buttonExists(page, "Cancel membership")));
    console.log(`  screenshot: ${await screenshot(page, "p5-05-cancelled")}`);

    // Hiding a button is a convenience. These bypass the UI to prove the API is the authority.
    const base = `/organizations/${organizationId}/memberships/${cancelId}`;
    const forcedRenew = await forceApiCall(page, `${base}/renew`);
    checkEqual("forced renew of a CANCELLED term -> 409", forcedRenew.status, 409);
    checkEqual("with INVALID_MEMBERSHIP_TRANSITION", forcedRenew.code, "INVALID_MEMBERSHIP_TRANSITION");

    const forcedFreeze = await forceApiCall(page, `${base}/freeze`);
    checkEqual("forced freeze of a CANCELLED term -> 409", forcedFreeze.status, 409);
    checkEqual("with INVALID_MEMBERSHIP_TRANSITION", forcedFreeze.code, "INVALID_MEMBERSHIP_TRANSITION");

    const forcedRecancel = await forceApiCall(page, `${base}/cancel`);
    checkEqual("re-cancelling is refused rather than being a silent no-op", forcedRecancel.status, 409);

    const forcedUnfreeze = await forceApiCall(page, `${base}/unfreeze`);
    checkEqual("unfreezing something never frozen -> 409", forcedUnfreeze.status, 409);

    const stillCancelled = queryOne(
      `SELECT status FROM memberships WHERE id = ${sqlString(cancelId)}`,
    );
    checkEqual("and the row is untouched by all four attempts", stillCancelled?.status, "CANCELLED");

    // ---------------------------------------------------------------------
    step("7. Mid-term plan change forfeits the remaining days (1.15.4)");
    // ---------------------------------------------------------------------
    const switchMemberId = memberIdByLastName("Switch");
    const switchFromId = await sellMembership(page, switchMemberId, PLATINUM_PLAN);

    await clickButton(page, "Change plan");
    await page.waitForSelector("[data-testid='forfeit-warning']");
    const warning = await page.$eval("[data-testid='forfeit-warning']", (el) => el.textContent ?? "");
    check("the warning names the exact number of days lost", warning.includes("90 unused days"), warning.trim());

    await selectByText(page, "Switch to", GOLD_PLAN.name);
    await clickButton(page, "Switch plan");
    await page.waitForFunction(
      (oldId: string) => !window.location.pathname.endsWith(oldId),
      { timeout: 10_000 },
      switchFromId,
    );

    const switchedTo = page.url().split("/memberships/")[1]!;
    const oldTerm = queryOne(`SELECT status FROM memberships WHERE id = ${sqlString(switchFromId)}`);
    checkEqual("the old term is cancelled", oldTerm?.status, "CANCELLED");

    const newTerm = queryOne(
      `SELECT priceAtPurchase, durationDaysAtPurchase, DATE(startDate) AS startDate,
              DATE(endDate) AS endDate, previousMembershipId
       FROM memberships WHERE id = ${sqlString(switchedTo)}`,
    );
    checkEqual("the new plan starts today, not at the old term's end", newTerm?.startDate, day(0));
    checkEqual("snapshotted at the new plan's current price", newTerm?.priceAtPurchase, "2500.00");
    checkEqual("for its current duration", newTerm?.durationDaysAtPurchase, "60");
    checkEqual("running a fresh 60 inclusive days", newTerm?.endDate, day(59));
    checkEqual("chained to the term it replaced", newTerm?.previousMembershipId, switchFromId);

    // ---------------------------------------------------------------------
    step("8. A lapsed term reads as EXPIRED with no scheduler (1.8)");
    // ---------------------------------------------------------------------
    const expiryMemberId = memberIdByLastName("Expiry");
    // A 60-day term that started 90 days ago ended a month back.
    const expiredId = await sellMembership(page, expiryMemberId, GOLD_PLAN.name, day(-90));

    const lapsed = queryOne(
      `SELECT DATE(endDate) AS endDate FROM memberships WHERE id = ${sqlString(expiredId)}`,
    );
    checkEqual("term ended a month ago", lapsed?.endDate, day(-31));

    /*
     * Creating the term redirected to its detail page, and that read already flipped it. To watch
     * the flip actually happen — and to show that nothing *else* performs it — put the row back
     * to ACTIVE, leave it alone, and check twice: once after idling, once after a read.
     */
    queryDb(`UPDATE memberships SET status = 'ACTIVE' WHERE id = ${sqlString(expiredId)}`);
    await page.goto(`${APP_URL}/`, { waitUntil: "networkidle0" });
    await sleep(5_000);

    const afterIdling = queryOne(
      `SELECT status FROM memberships WHERE id = ${sqlString(expiredId)}`,
    );
    checkEqual(
      "after five idle seconds nothing has expired it — there is no scheduler",
      afterIdling?.status,
      "ACTIVE",
    );

    await page.goto(`${APP_URL}/memberships/${expiredId}`, { waitUntil: "networkidle0" });
    await page.waitForSelector("[data-testid='status-badge']");
    const shownStatus = await page.$eval("[data-testid='status-badge']", (el) =>
      el.textContent?.trim(),
    );
    checkEqual("the UI reads it as EXPIRED", shownStatus, "EXPIRED");

    const afterRead = queryOne(`SELECT status FROM memberships WHERE id = ${sqlString(expiredId)}`);
    checkEqual("one read was enough to flip it, and it stuck", afterRead?.status, "EXPIRED");
    console.log(`  screenshot: ${await screenshot(page, "p5-06-expired")}`);

    // The status filter has to agree with the badge, or the list lies to whoever filters it.
    await page.goto(`${APP_URL}/memberships?status=ACTIVE&limit=100`, { waitUntil: "networkidle0" });
    await page.waitForSelector("[data-testid='memberships-table'] tbody tr");
    const activeRows = await page.$$eval(
      "[data-testid='memberships-table'] tbody tr",
      (rows) => rows.map((r) => r.textContent ?? ""),
    );
    check("the expired term is absent from ?status=ACTIVE", !activeRows.some((r) => r.includes("Deepak")));

    await page.goto(`${APP_URL}/memberships?status=EXPIRED&limit=100`, { waitUntil: "networkidle0" });
    await page.waitForSelector("[data-testid='memberships-table'] tbody tr");
    const expiredRows = await page.$$eval(
      "[data-testid='memberships-table'] tbody tr",
      (rows) => rows.map((r) => r.textContent ?? ""),
    );
    check("and present in ?status=EXPIRED", expiredRows.some((r) => r.includes("Deepak")));

    // Renewing an expired term starts today rather than backdating into the gap.
    await page.goto(`${APP_URL}/memberships/${expiredId}`, { waitUntil: "networkidle0" });
    await page.waitForSelector("[data-testid='lifecycle-actions']");
    check("Renew is offered on an expired term", await buttonExists(page, "Renew"));

    // ---------------------------------------------------------------------
    step("9. Brand palette renders as computed CSS on the new screens (1.14)");
    // ---------------------------------------------------------------------
    await page.goto(`${APP_URL}/membership-plans`, { waitUntil: "networkidle0" });
    await page.waitForSelector("[data-testid='plans-table'] tbody tr");

    checkEqual(
      "page background is brand.black",
      await computed(page, "body", "background-color"),
      BRAND_RGB.black,
    );
    checkEqual(
      "plans table header is brand.black-88",
      await computed(page, "[data-testid='plans-table'] thead", "background-color"),
      BRAND_RGB.black88,
    );

    const addPlanColor = await page.$$eval("button", (buttons) => {
      const button = buttons.find((b) => b.textContent?.trim() === "Add plan");
      return button ? window.getComputedStyle(button).backgroundColor : "";
    });
    checkEqual("primary action is brand.green", addPlanColor, BRAND_RGB.green);

    await page.goto(`${APP_URL}/memberships?status=ACTIVE&limit=100`, { waitUntil: "networkidle0" });
    await page.waitForSelector("[data-testid='status-badge']");
    const activeBadgeColor = await page.$$eval("[data-testid='status-badge']", (badges) => {
      const badge = badges.find((b) => b.textContent?.trim() === "ACTIVE");
      return badge ? window.getComputedStyle(badge).color : "";
    });
    checkEqual("ACTIVE badge text is brand.green", activeBadgeColor, BRAND_RGB.green);
    console.log(`  screenshot: ${await screenshot(page, "p5-07-memberships-list")}`);

    // ---------------------------------------------------------------------
    step("10. RBAC with a real RECEPTIONIST login (Section 4.2)");
    // ---------------------------------------------------------------------
    await logout(page);
    await login(page, RECEPTIONIST);

    const roleShown = await page.$eval('[data-testid="stat-role"]', (el) => el.textContent);
    checkEqual("signed in as RECEPTIONIST", roleShown, "RECEPTIONIST");

    // Reads the catalog — it has to, to sell from it.
    await page.goto(`${APP_URL}/membership-plans`, { waitUntil: "networkidle0" });
    await page.waitForSelector("[data-testid='plans-table'] tbody tr");
    check("can read the plan catalog", (await page.$("[data-testid='plans-table'] tbody tr")) !== null);
    check("but is offered no way to add a plan", !(await buttonExists(page, "Add plan")));
    check("nor to edit one", !(await buttonExists(page, "Edit")));
    check("nor to retire one", !(await buttonExists(page, "Retire")));

    const forcedPlanCreate = await page.evaluate(
      async (moduleUrl: string, path: string) => {
        const mod = await import(/* @vite-ignore */ moduleUrl);
        try {
          await mod.apiClient.post(path, { name: "Sneaky", price: 1, durationDays: 1 });
          return { status: 200, code: "NONE" };
        } catch (error) {
          const err = error as { response?: { status?: number; data?: { error?: { code?: string } } } };
          return { status: err.response?.status ?? 0, code: err.response?.data?.error?.code ?? "NONE" };
        }
      },
      "/src/lib/api-client.ts",
      `/organizations/${organizationId}/membership-plans`,
    );
    checkEqual("forced plan create -> 403", forcedPlanCreate.status, 403);
    checkEqual("with PERMISSION_DENIED", forcedPlanCreate.code, "PERMISSION_DENIED");

    // Selling is allowed.
    const receptionMemberId = memberIdByLastName("Walkin");
    const receptionSaleId = await sellMembership(page, receptionMemberId, PLATINUM_PLAN);
    const receptionSale = queryOne(
      `SELECT status, priceAtPurchase FROM memberships WHERE id = ${sqlString(receptionSaleId)}`,
    );
    check("receptionist's sale reached the database", receptionSale !== undefined);
    checkEqual("with the plan's snapshot", receptionSale?.priceAtPurchase, "4000.00");

    // Freeze and cancel are not.
    await page.waitForSelector("[data-testid='lifecycle-actions']");
    check("Renew is offered", await buttonExists(page, "Renew"));
    check("Freeze is not", !(await buttonExists(page, "Freeze")));
    check("Cancel is not", !(await buttonExists(page, "Cancel membership")));
    check("Change plan is not", !(await buttonExists(page, "Change plan")));
    console.log(`  screenshot: ${await screenshot(page, "p5-08-receptionist")}`);

    const saleBase = `/organizations/${organizationId}/memberships/${receptionSaleId}`;
    const forcedRecepFreeze = await forceApiCall(page, `${saleBase}/freeze`);
    checkEqual("forced freeze -> 403", forcedRecepFreeze.status, 403);
    checkEqual("with PERMISSION_DENIED", forcedRecepFreeze.code, "PERMISSION_DENIED");

    const forcedRecepCancel = await forceApiCall(page, `${saleBase}/cancel`);
    checkEqual("forced cancel -> 403", forcedRecepCancel.status, 403);

    // change-plan needs cancel *and* create; holding only create is not enough.
    const forcedRecepSwitch = await forceApiCall(page, `${saleBase}/change-plan`, {
      planId: goldPlanId,
    });
    checkEqual("forced mid-term plan change -> 403", forcedRecepSwitch.status, 403);

    const untouched = queryOne(
      `SELECT status FROM memberships WHERE id = ${sqlString(receptionSaleId)}`,
    );
    checkEqual("the membership survived all three attempts unchanged", untouched?.status, "ACTIVE");

    // Renewing is allowed — a renewal is a sale (1.15.3), so the front desk can do it.
    const forcedRecepRenew = await forceApiCall(page, `${saleBase}/renew`);
    checkEqual("renew is accepted -> 201", forcedRecepRenew.status, 201);

    const renewalChain = queryDb(
      `SELECT id FROM memberships WHERE previousMembershipId = ${sqlString(receptionSaleId)}`,
    );
    checkEqual("and produced a new term row", renewalChain.length, 1);

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
