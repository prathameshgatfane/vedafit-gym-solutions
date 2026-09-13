/**
 * Phase 6 verification — real Chrome, real API, real database.
 *
 * Run with:
 *   1. MySQL up      (apps/api: bash scripts/dev-mysql-sandbox.sh start)
 *   2. Fixtures      (apps/api: pnpm tsx scripts/phase6-fixtures.ts)
 *   3. API up        (apps/api: pnpm dev)
 *   4. Admin web up  (apps/admin-web: pnpm dev)
 *   5. pnpm e2e:billing
 *
 * Every mutation is performed by clicking through the actual UI, then read back out of MySQL with
 * the `mysql` client — a different driver from the Prisma client that wrote it, so the assertions
 * can't be satisfied by the ORM agreeing with itself.
 *
 * Nothing is simulated. The one thing that bypasses the UI is the concurrency check in step 7,
 * which fires ten invoice creations at once through the app's own axios instance — there is no
 * way to click ten buttons simultaneously, and racing them is the entire point of that check.
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
const ACCOUNTANT = { email: "accounts@demo-gym.test", password: "ChangeMe123!" };
const RECEPTIONIST = { email: "reception@demo-gym.test", password: "ChangeMe123!" };

/** Must match the namespaces in apps/api/scripts/phase6-fixtures.ts. */
const MEMBER_PHONE_PREFIX = "+9196666";
const PLAN_NAME = "P6 Gold";

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

/** Types into the input belonging to a label, replacing anything already there. */
async function setField(page: Page, label: string, value: string) {
  const handle = await page.$(
    `::-p-xpath(//label[text()=${sqlString(label)}]/following-sibling::input)`,
  );
  if (!handle) throw new Error(`No input for label "${label}"`);
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

/**
 * Clicks a button *inside* a specific container. Needed where the same label appears twice —
 * "Cancel invoice" is both the action that opens the confirmation and the one that confirms it.
 */
async function clickButtonIn(page: Page, testId: string, label: string) {
  const clicked = await page.$$eval(
    `[data-testid="${testId}"] button`,
    (buttons, text) => {
      const button = buttons.find((b) => b.textContent?.trim() === text);
      if (!button) return false;
      (button as HTMLButtonElement).click();
      return true;
    },
    label,
  );
  if (!clicked) throw new Error(`No button labelled "${label}" inside [${testId}]`);
}

async function buttonExists(page: Page, label: string): Promise<boolean> {
  return page.$$eval(
    "button",
    (buttons, text) => buttons.some((b) => b.textContent?.trim() === text),
    label,
  );
}

async function textOf(page: Page, selector: string): Promise<string> {
  return page.$eval(selector, (el) => el.textContent?.replace(/\s+/g, " ").trim() ?? "");
}

/** Reads a computed style off the button with the given visible text. */
async function computedOfButton(page: Page, label: string, property: string): Promise<string> {
  return page.$$eval(
    "button",
    (buttons, text, prop) => {
      const button = buttons.find((b) => b.textContent?.trim() === text);
      if (!button) return "";
      return window.getComputedStyle(button).getPropertyValue(prop as string);
    },
    label,
    property,
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

/** Raises an ad-hoc invoice by driving the real form; returns its id. */
async function raiseInvoice(
  page: Page,
  memberLastName: string,
  amount: string,
  notes: string,
): Promise<string> {
  await page.goto(`${APP_URL}/invoices/new`, { waitUntil: "networkidle0" });
  await page.waitForSelector("form select");
  await selectByText(page, "Member", memberLastName);
  await setField(page, "Amount (₹)", amount);
  await setField(page, "What is this for?", notes);
  await clickButton(page, "Raise invoice");
  await page.waitForSelector("[data-testid='invoice-heading']", { timeout: 10_000 });
  return page.url().split("/invoices/")[1]!;
}

/** Records a payment on the currently-open invoice detail page. */
async function recordPayment(page: Page, amount: string, method?: string) {
  await clickButton(page, "Record payment");
  await page.waitForSelector("[data-testid='record-payment-panel']");
  await setField(page, "Amount (₹)", amount);
  if (method) await selectByText(page, "Method", method);
  await clickButton(page, "Save payment");
  await page.waitForSelector("[data-testid='action-notice']", { timeout: 10_000 });
}

async function main(): Promise<number> {
  const browser = await launch();
  const page = await browser.newPage();
  forwardPageErrors(page);

  try {
    const organizationId = requireCell(
      queryOne(`SELECT id FROM organizations WHERE slug = 'demo-gym'`),
      "id",
    );

    await login(page, OWNER);

    // ---------------------------------------------------------------------
    step("1. Selling a membership raises its own invoice, for the snapshot price");
    // ---------------------------------------------------------------------
    const saleMemberId = memberIdByLastName("Sale");
    await page.goto(`${APP_URL}/members/${saleMemberId}/memberships/new`, {
      waitUntil: "networkidle0",
    });
    await page.waitForSelector("[data-testid='plan-select']");
    await selectByText(page, "Plan", PLAN_NAME);
    await clickButton(page, "Create membership");
    await page.waitForSelector("[data-testid='membership-heading']", { timeout: 10_000 });
    const membershipId = page.url().split("/memberships/")[1]!;

    const saleInvoice = queryOne(
      `SELECT id, invoiceNumber, amountTotal, amountPaid, amountPending, status, notes, membershipId
       FROM invoices WHERE membershipId = ${sqlString(membershipId)}`,
    );
    check("selling a term wrote an invoice", saleInvoice !== undefined);
    checkEqual("billed the snapshot price", saleInvoice?.amountTotal, "1000.00");
    checkEqual("nothing collected yet", saleInvoice?.amountPaid, "0.00");
    checkEqual("the whole amount is pending", saleInvoice?.amountPending, "1000.00");
    checkEqual("born UNPAID, never DRAFT", saleInvoice?.status, "UNPAID");
    checkEqual("linked to the term it bills", saleInvoice?.membershipId, membershipId);
    check("says what it is for", (saleInvoice?.notes ?? "").includes(PLAN_NAME), saleInvoice?.notes);
    check(
      "invoice number matches INV-YYYY-NNNNNN",
      /^INV-\d{4}-\d{6}$/.test(saleInvoice?.invoiceNumber ?? ""),
      saleInvoice?.invoiceNumber,
    );

    // ---------------------------------------------------------------------
    step("2. Partial payments walk the invoice through its statuses");
    // ---------------------------------------------------------------------
    const partialMemberId = memberIdByLastName("Partial");
    const partialInvoiceId = await raiseInvoice(page, "Partial", "1000", "Personal training block");

    checkEqual(
      "starts at the full amount outstanding",
      await textOf(page, "[data-testid='amount-pending']"),
      "₹1,000.00",
    );

    await recordPayment(page, "300", "Cash");
    let row = queryOne(
      `SELECT amountPaid, amountPending, status FROM invoices WHERE id = ${sqlString(partialInvoiceId)}`,
    );
    checkEqual("after ₹300: amountPaid", row?.amountPaid, "300.00");
    checkEqual("after ₹300: amountPending", row?.amountPending, "700.00");
    checkEqual("after ₹300: status", row?.status, "PARTIALLY_PAID");
    check(
      "the UI says the same",
      (await textOf(page, "[data-testid='action-notice']")).includes("₹700.00 still outstanding"),
      await textOf(page, "[data-testid='action-notice']"),
    );
    console.log(`  screenshot: ${await screenshot(page, "p6-01-partially-paid")}`);

    await recordPayment(page, "250.50", "UPI");
    row = queryOne(
      `SELECT amountPaid, amountPending, status FROM invoices WHERE id = ${sqlString(partialInvoiceId)}`,
    );
    checkEqual("after a second instalment: amountPaid", row?.amountPaid, "550.50");
    checkEqual("after a second instalment: amountPending", row?.amountPending, "449.50");
    checkEqual("still PARTIALLY_PAID", row?.status, "PARTIALLY_PAID");

    // The exact remainder — equality is allowed, only more is refused.
    await recordPayment(page, "449.50", "Card");
    row = queryOne(
      `SELECT amountPaid, amountPending, status FROM invoices WHERE id = ${sqlString(partialInvoiceId)}`,
    );
    checkEqual("settled: amountPaid equals the total", row?.amountPaid, "1000.00");
    checkEqual("settled: nothing pending", row?.amountPending, "0.00");
    checkEqual("settled: status PAID", row?.status, "PAID");
    check(
      "the UI announces it is settled in full",
      (await textOf(page, "[data-testid='action-notice']")).includes("settled in full"),
    );

    const instalments = queryDb(
      `SELECT amount, method, status FROM payments WHERE invoiceId = ${sqlString(partialInvoiceId)}
       ORDER BY createdAt ASC`,
    );
    checkEqual("three payment rows, not one edited row", instalments.length, 3);
    checkEqual(
      "amounts stored exactly",
      instalments.map((p) => p.amount).join(","),
      "300.00,250.50,449.50",
    );
    checkEqual(
      "methods recorded per instalment",
      instalments.map((p) => p.method).join(","),
      "CASH,UPI,CARD",
    );
    console.log(`  screenshot: ${await screenshot(page, "p6-02-paid-in-full")}`);

    // ---------------------------------------------------------------------
    step("3. Overpayment is refused, and refused loudly");
    // ---------------------------------------------------------------------
    const overpayInvoiceId = await raiseInvoice(page, "Overpay", "500", "Merchandise");
    await clickButton(page, "Record payment");
    await page.waitForSelector("[data-testid='record-payment-panel']");
    await setField(page, "Amount (₹)", "5000");
    await clickButton(page, "Save payment");
    await page.waitForSelector("[role='alert']", { timeout: 10_000 });

    const overpayError = await textOf(page, "[role='alert']");
    check("refused, naming the real balance", overpayError.includes("500.00 outstanding"), overpayError);

    const afterOverpay = queryOne(
      `SELECT amountPaid, status FROM invoices WHERE id = ${sqlString(overpayInvoiceId)}`,
    );
    checkEqual("nothing was collected", afterOverpay?.amountPaid, "0.00");
    checkEqual("the invoice is untouched", afterOverpay?.status, "UNPAID");
    checkEqual(
      "and no payment row was written",
      queryDb(`SELECT id FROM payments WHERE invoiceId = ${sqlString(overpayInvoiceId)}`).length,
      0,
    );
    console.log(`  screenshot: ${await screenshot(page, "p6-03-overpayment-refused")}`);

    // A wrong bill is corrected by cancelling and reissuing, since the amount is immutable.
    await clickButton(page, "Cancel invoice");
    await page.waitForSelector("[data-testid='confirm-cancel-invoice']");
    await clickButtonIn(page, "confirm-cancel-invoice", "Cancel invoice");
    await page.waitForSelector("[data-testid='action-notice']", { timeout: 10_000 });

    checkEqual(
      "an untouched invoice can be cancelled",
      queryOne(`SELECT status FROM invoices WHERE id = ${sqlString(overpayInvoiceId)}`)?.status,
      "CANCELLED",
    );
    await page.reload({ waitUntil: "networkidle0" });
    await page.waitForSelector("[data-testid='invoice-heading']");
    check(
      "and then takes no payments at all",
      !(await buttonExists(page, "Record payment")),
    );
    const forcedOnCancelled = await forceApiCall(page, `/organizations/${organizationId}/payments`, {
      invoiceId: overpayInvoiceId,
      amount: 10,
      method: "CASH",
    });
    checkEqual("the server refuses too, not just the UI", forcedOnCancelled.code, "INVOICE_NOT_PAYABLE");

    // The settled invoice from step 2 is the other half of the rule: money collected, no cancel.
    await page.goto(`${APP_URL}/invoices/${partialInvoiceId}`, { waitUntil: "networkidle0" });
    await page.waitForSelector("[data-testid='invoice-heading']");
    check(
      "an invoice with payments against it offers no cancel",
      !(await buttonExists(page, "Cancel invoice")),
    );

    // ---------------------------------------------------------------------
    step("4. Brand palette on the billing screens (computed CSS, not class names)");
    // ---------------------------------------------------------------------
    await page.goto(`${APP_URL}/invoices`, { waitUntil: "networkidle0" });
    await page.waitForSelector("[data-testid='invoices-table']");
    checkEqual(
      "page background is brand.black",
      await computed(page, "body", "background-color"),
      BRAND_RGB.black,
    );
    checkEqual(
      "filter bar is brand.black-88",
      await computed(page, "[data-testid='invoices-filter-bar']", "background-color"),
      BRAND_RGB.black88,
    );
    checkEqual(
      "primary action is brand.green",
      await computedOfButton(page, "Raise invoice", "background-color"),
      BRAND_RGB.green,
    );
    checkEqual(
      "invoice numbers are brand.white",
      await computed(page, "[data-testid='invoice-number']", "color"),
      BRAND_RGB.white,
    );
    console.log(`  screenshot: ${await screenshot(page, "p6-04-invoices-list")}`);

    // ---------------------------------------------------------------------
    step("5. Pending-fees view lists only what is still owed");
    // ---------------------------------------------------------------------
    const pendingResponse = page.waitForResponse(
      (r) => r.url().includes("/invoices?") && r.url().includes("outstanding=true"),
      { timeout: 10_000 },
    );
    await page.click("[data-testid='outstanding-toggle']");
    await pendingResponse;
    await sleep(300); // let React commit the new rows

    const shownNumbers = await page.$$eval("[data-testid='invoice-number']", (cells) =>
      cells.map((c) => c.textContent?.trim() ?? ""),
    );
    const settledNumber = requireCell(
      queryOne(`SELECT invoiceNumber FROM invoices WHERE id = ${sqlString(partialInvoiceId)}`),
      "invoiceNumber",
    );
    check(
      "the settled invoice drops out of the pending list",
      !shownNumbers.includes(settledNumber),
      `pending list: ${shownNumbers.join(", ") || "(empty)"}`,
    );

    const dbOutstanding = queryDb(
      `SELECT invoiceNumber FROM invoices WHERE organizationId = ${sqlString(organizationId)} AND amountPending > 0`,
    ).map((r) => r.invoiceNumber);
    check(
      "and every one that is shown really does owe money",
      shownNumbers.every((n) => dbOutstanding.includes(n)),
      `${shownNumbers.length} shown, ${dbOutstanding.length} outstanding in MySQL`,
    );
    console.log(`  screenshot: ${await screenshot(page, "p6-05-pending-fees")}`);

    // ---------------------------------------------------------------------
    step("6. Refund — a new row, the original untouched, an audit entry (1.16.3)");
    // ---------------------------------------------------------------------
    await logout(page);
    await login(page, ACCOUNTANT);

    const refundInvoiceId = await raiseInvoice(page, "Refund", "1000", "Term paid up front");
    await recordPayment(page, "1000", "Cash");

    const original = queryOne(
      `SELECT id, amount, status, refundOfPaymentId, paidAt FROM payments
       WHERE invoiceId = ${sqlString(refundInvoiceId)}`,
    );
    const originalId = requireCell(original, "id");

    await page.reload({ waitUntil: "networkidle0" });
    await page.waitForSelector("[data-testid='refund-button']");
    await clickButton(page, "Refund");
    await page.waitForSelector("[data-testid='confirm-refund']");
    await setField(page, "Refund amount (₹)", "400");
    await setField(page, "Reason (optional)", "Member moved cities");
    console.log(`  screenshot: ${await screenshot(page, "p6-06-refund-confirm")}`);
    await clickButton(page, "Issue refund");
    await page.waitForSelector("[data-testid='action-notice']", { timeout: 10_000 });

    const originalAfter = queryOne(
      `SELECT id, amount, status, refundOfPaymentId, paidAt FROM payments WHERE id = ${sqlString(originalId)}`,
    );
    check("the original payment row still exists", originalAfter !== undefined);
    checkEqual("its amount was not touched", originalAfter?.amount, original?.amount);
    checkEqual("its status is still SUCCESS", originalAfter?.status, "SUCCESS");
    checkEqual("it is not marked as a refund", originalAfter?.refundOfPaymentId, "NULL");
    checkEqual("even its paidAt is unchanged", originalAfter?.paidAt, original?.paidAt);

    const refunds = queryDb(
      `SELECT id, amount, status, method, refundOfPaymentId, invoiceId FROM payments
       WHERE refundOfPaymentId = ${sqlString(originalId)}`,
    );
    checkEqual("exactly one refund row was added", refunds.length, 1);
    checkEqual("stored as a negative amount", refunds[0]?.amount, "-400.00");
    checkEqual("marked REFUNDED", refunds[0]?.status, "REFUNDED");
    checkEqual("pointing at the payment it reverses", refunds[0]?.refundOfPaymentId, originalId);
    checkEqual("on the same invoice", refunds[0]?.invoiceId, refundInvoiceId);
    checkEqual("going back the way it came in", refunds[0]?.method, "CASH");

    const rolledBack = queryOne(
      `SELECT amountTotal, amountPaid, amountPending, status FROM invoices WHERE id = ${sqlString(refundInvoiceId)}`,
    );
    checkEqual("the bill still says what was billed", rolledBack?.amountTotal, "1000.00");
    checkEqual("collected falls by the refund", rolledBack?.amountPaid, "600.00");
    checkEqual("outstanding rises by the refund", rolledBack?.amountPending, "400.00");
    checkEqual("PAID rolls back to PARTIALLY_PAID", rolledBack?.status, "PARTIALLY_PAID");

    const accountantId = requireCell(
      queryOne(`SELECT id FROM users WHERE email = ${sqlString(ACCOUNTANT.email)}`),
      "id",
    );
    const audit = queryOne(
      `SELECT actorUserId, action, entityType, entityId, organizationId, beforeJson, afterJson
       FROM audit_logs WHERE entityType = 'Payment' AND entityId = ${sqlString(originalId)}`,
    );
    check("an AuditLog row was written", audit !== undefined);
    checkEqual("action REFUND", audit?.action, "REFUND");
    checkEqual("filed against the original payment", audit?.entityId, originalId);
    checkEqual("attributed to the signed-in accountant", audit?.actorUserId, accountantId);
    checkEqual("scoped to the organization", audit?.organizationId, organizationId);
    // Parsed rather than string-matched: MySQL normalises JSON key order and spacing on write,
    // so asserting on the raw text would be asserting on MySQL's formatter.
    const before6 = JSON.parse(audit?.beforeJson ?? "{}") as {
      payment?: { amount?: string; status?: string };
      alreadyRefunded?: string;
    };
    const after6 = JSON.parse(audit?.afterJson ?? "{}") as {
      refundedAmount?: string;
      reason?: string;
      invoice?: { status?: string; amountPending?: string };
    };
    checkEqual("beforeJson holds the payment's pre-refund amount", before6.payment?.amount, "1000.00");
    checkEqual("beforeJson holds its pre-refund status", before6.payment?.status, "SUCCESS");
    checkEqual("beforeJson notes nothing had been refunded yet", before6.alreadyRefunded, "0.00");
    checkEqual("afterJson holds the refunded amount", after6.refundedAmount, "400.00");
    checkEqual("afterJson holds the typed reason", after6.reason, "Member moved cities");
    checkEqual("afterJson holds the invoice's new status", after6.invoice?.status, "PARTIALLY_PAID");
    checkEqual("and its new balance", after6.invoice?.amountPending, "400.00");

    const ledgerRows = await page.$$eval("[data-testid='payment-history'] tbody tr", (rows) =>
      rows.map((r) => r.textContent?.replace(/\s+/g, " ").trim() ?? ""),
    );
    checkEqual("the UI shows two entries, not one", ledgerRows.length, 2);
    check(
      "the receipt is still shown at its full value",
      ledgerRows.some((r) => r.includes("₹1,000.00") && r.includes("SUCCESS")),
      ledgerRows[0],
    );
    check(
      "and the reversal is shown as a negative entry",
      ledgerRows.some((r) => r.includes("−₹400.00") && r.includes("REFUNDED")),
      ledgerRows[1],
    );
    console.log(`  screenshot: ${await screenshot(page, "p6-07-refund-ledger")}`);

    // A second refund is capped at what is left of the original.
    await clickButton(page, "Refund");
    await page.waitForSelector("[data-testid='confirm-refund']");
    await setField(page, "Refund amount (₹)", "700");
    await clickButton(page, "Issue refund");
    await page.waitForSelector("[role='alert']", { timeout: 10_000 });
    const capMessage = await textOf(page, "[role='alert']");
    check("a refund beyond the remainder is refused", capMessage.includes("already been refunded"), capMessage);
    checkEqual(
      "and no second refund row was written",
      queryDb(`SELECT id FROM payments WHERE refundOfPaymentId = ${sqlString(originalId)}`).length,
      1,
    );

    // ---------------------------------------------------------------------
    step("7. Concurrent invoice creation produces no duplicate or colliding numbers (1.16.4)");
    // ---------------------------------------------------------------------
    const raceMemberId = memberIdByLastName("Race");
    const before = queryDb(
      `SELECT invoiceNumber FROM invoices WHERE organizationId = ${sqlString(organizationId)}`,
    ).length;

    const raceResults = await page.evaluate(
      async (moduleUrl: string, orgId: string, memberId: string) => {
        const mod = await import(/* @vite-ignore */ moduleUrl);
        const attempts = Array.from({ length: 10 }, (_, i) =>
          mod.apiClient
            .post(`/organizations/${orgId}/invoices`, {
              memberId,
              amountTotal: 100 + i,
              notes: `concurrent ${i}`,
            })
            .then((r: { data: { data: { invoiceNumber: string } } }) => r.data.data.invoiceNumber)
            .catch((e: { response?: { status?: number } }) => `ERROR ${e.response?.status ?? 0}`),
        );
        return Promise.all(attempts);
      },
      "/src/lib/api-client.ts",
      organizationId,
      raceMemberId,
    );

    const errored = raceResults.filter((r) => r.startsWith("ERROR"));
    checkEqual("all ten requests succeeded", errored.length, 0);
    checkEqual("all ten numbers are distinct", new Set(raceResults).size, 10);

    const raceSequences = raceResults
      .map((n) => Number(n.split("-")[2]))
      .sort((a, b) => a - b);
    const contiguous = raceSequences.every(
      (value, i) => i === 0 || value === raceSequences[i - 1]! + 1,
    );
    check(
      "and contiguous — the counter left no gaps",
      contiguous,
      `${raceSequences[0]}…${raceSequences[raceSequences.length - 1]}`,
    );

    const after = queryDb(
      `SELECT invoiceNumber FROM invoices WHERE organizationId = ${sqlString(organizationId)}`,
    );
    checkEqual("ten new rows in MySQL", after.length - before, 10);
    checkEqual(
      "every invoice number in the org is still unique",
      new Set(after.map((r) => r.invoiceNumber)).size,
      after.length,
    );

    // The counter is never rewound — not even when fixture rows are deleted between runs — so
    // the invariant that matters is that it can only ever hand out a number nobody holds.
    const year = new Date().getUTCFullYear();
    const nextValue = Number(
      requireCell(
        queryOne(
          `SELECT nextValue FROM invoice_sequences WHERE organizationId = ${sqlString(organizationId)}
           AND year = ${year}`,
        ),
        "nextValue",
      ),
    );
    const highestIssued = Math.max(
      ...queryDb(
        `SELECT invoiceNumber FROM invoices WHERE organizationId = ${sqlString(organizationId)}
         AND invoiceNumber LIKE 'INV-${year}-%'`,
      ).map((r) => Number(r.invoiceNumber!.split("-")[2])),
    );
    check(
      "the counter sits above every number already issued",
      nextValue > highestIssued,
      `next=${nextValue}, highest issued=${highestIssued}`,
    );

    // ---------------------------------------------------------------------
    step("8. RBAC — ACCOUNTANT can refund, RECEPTIONIST cannot (Section 4.2)");
    // ---------------------------------------------------------------------
    const rbacInvoiceId = await raiseInvoice(page, "Rbac", "800", "Front desk test");
    await recordPayment(page, "800", "Cash");
    const rbacPaymentId = requireCell(
      queryOne(`SELECT id FROM payments WHERE invoiceId = ${sqlString(rbacInvoiceId)}`),
      "id",
    );

    await logout(page);
    await login(page, RECEPTIONIST);

    await page.goto(`${APP_URL}/invoices/${rbacInvoiceId}`, { waitUntil: "networkidle0" });
    await page.waitForSelector("[data-testid='payment-history']");

    check(
      "receptionist can read the payment history",
      (await page.$("[data-testid='payment-row']")) !== null,
    );
    check("but is offered no Refund button", !(await buttonExists(page, "Refund")));
    check("and no Raise invoice button", !(await buttonExists(page, "Raise invoice")));
    console.log(`  screenshot: ${await screenshot(page, "p6-08-receptionist-no-refund")}`);

    // The hidden button is a courtesy; the server is the control.
    const forcedRefund = await forceApiCall(
      page,
      `/organizations/${organizationId}/payments/${rbacPaymentId}/refund`,
      { amount: 100 },
    );
    checkEqual("forcing the refund API returns 403", forcedRefund.status, 403);
    checkEqual("with PERMISSION_DENIED", forcedRefund.code, "PERMISSION_DENIED");

    const forcedInvoice = await forceApiCall(page, `/organizations/${organizationId}/invoices`, {
      memberId: memberIdByLastName("Rbac"),
      amountTotal: 50,
      notes: "should not exist",
    });
    checkEqual("and raising an invoice is refused too", forcedInvoice.status, 403);

    checkEqual(
      "the refusal left no refund row behind",
      queryDb(`SELECT id FROM payments WHERE refundOfPaymentId = ${sqlString(rbacPaymentId)}`).length,
      0,
    );
    checkEqual(
      "and no audit entry",
      queryDb(`SELECT id FROM audit_logs WHERE entityId = ${sqlString(rbacPaymentId)}`).length,
      0,
    );
    const untouched = queryOne(
      `SELECT status, amountPaid FROM invoices WHERE id = ${sqlString(rbacInvoiceId)}`,
    );
    checkEqual("the invoice is exactly as the accountant left it", untouched?.status, "PAID");
    checkEqual("with the money still collected", untouched?.amountPaid, "800.00");

    // But a receptionist *can* take money — that half of the matrix has to work too.
    const receptionInvoiceId = await (async () => {
      await logout(page);
      await login(page, ACCOUNTANT);
      const id = await raiseInvoice(page, "Rbac", "300", "Receptionist collects this");
      await logout(page);
      await login(page, RECEPTIONIST);
      return id;
    })();

    await page.goto(`${APP_URL}/invoices/${receptionInvoiceId}`, { waitUntil: "networkidle0" });
    await page.waitForSelector("[data-testid='invoice-heading']");
    await recordPayment(page, "300", "Cash");

    const collected = queryOne(
      `SELECT amountPaid, status FROM invoices WHERE id = ${sqlString(receptionInvoiceId)}`,
    );
    checkEqual("a receptionist can record a payment", collected?.amountPaid, "300.00");
    checkEqual("settling the bill", collected?.status, "PAID");

    // ---------------------------------------------------------------------
    step("9. A member's outstanding balance, on their own page");
    // ---------------------------------------------------------------------
    await page.goto(`${APP_URL}/members/${partialMemberId}`, { waitUntil: "networkidle0" });
    await page.waitForSelector("[data-testid='member-invoices']");
    checkEqual(
      "a fully-settled member shows nothing outstanding",
      await textOf(page, "[data-testid='member-outstanding']"),
      "Nothing outstanding",
    );

    await page.goto(`${APP_URL}/members/${saleMemberId}`, { waitUntil: "networkidle0" });
    await page.waitForSelector("[data-testid='member-invoices']");
    const owed = await textOf(page, "[data-testid='member-outstanding']");
    check("a member with an unpaid term shows the balance", owed.includes("₹1,000.00"), owed);
    console.log(`  screenshot: ${await screenshot(page, "p6-09-member-billing")}`);

    // ---------------------------------------------------------------------
    step("10. A mid-term plan change reports its forfeited value but moves no money (1.16.1)");
    // ---------------------------------------------------------------------
    await logout(page);
    await login(page, OWNER);

    await page.goto(`${APP_URL}/memberships/${membershipId}`, { waitUntil: "networkidle0" });
    await page.waitForSelector("[data-testid='membership-heading']");
    await clickButton(page, "Change plan");
    await page.waitForSelector("[data-testid='forfeit-warning']");

    const warning = await textOf(page, "[data-testid='forfeit-warning']");
    // The figure is checked against the same arithmetic the API uses — snapshot rate × unused
    // days — rather than a hardcoded number, so it can't pass by coincidence on a re-run.
    const term = queryOne(
      `SELECT priceAtPurchase, durationDaysAtPurchase, DATEDIFF(endDate, UTC_DATE()) + 1 AS daysLeft
       FROM memberships WHERE id = ${sqlString(membershipId)}`,
    );
    const expectedForfeit = (
      (Number(term?.priceAtPurchase) / Number(term?.durationDaysAtPurchase)) *
      Number(term?.daysLeft)
    ).toFixed(2);
    const expectedText = `worth ₹${Number(expectedForfeit).toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
    check(
      "the warning quotes the unused value in money, not just days",
      warning.includes(expectedText),
      `expected "${expectedText}" in: ${warning}`,
    );
    check(
      "and says plainly that nothing is refunded automatically",
      warning.includes("no refund or credit is issued automatically"),
      warning,
    );

    const refundsForSaleMember = queryDb(
      `SELECT p.id FROM payments p WHERE p.memberId = ${sqlString(saleMemberId)}
       AND p.refundOfPaymentId IS NOT NULL`,
    );
    checkEqual("no credit was issued behind the scenes", refundsForSaleMember.length, 0);
    console.log(`  screenshot: ${await screenshot(page, "p6-10-forfeit-warning")}`);

    // ---------------------------------------------------------------------
    step("11. The payments ledger — every entry, receipts and refunds alike");
    // ---------------------------------------------------------------------
    await page.goto(`${APP_URL}/payments?limit=50`, { waitUntil: "networkidle0" });
    await page.waitForSelector("[data-testid='payments-table']");

    const receiptRows = (await page.$$("[data-testid='payment-row']")).length;
    const refundRows = (await page.$$("[data-testid='refund-row']")).length;

    const dbCounts = queryOne(
      `SELECT
         SUM(refundOfPaymentId IS NULL) AS receipts,
         SUM(refundOfPaymentId IS NOT NULL) AS refunds,
         SUM(amount) AS net
       FROM payments WHERE organizationId = ${sqlString(organizationId)}`,
    );
    checkEqual("every receipt in MySQL is on screen", receiptRows, Number(dbCounts?.receipts));
    checkEqual("and every refund", refundRows, Number(dbCounts?.refunds));

    const netShown = await textOf(page, "[data-testid='net-total']");
    const netExpected = `₹${Number(dbCounts?.net).toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
    check(
      "the net total matches SUM(amount) — refunds netted against receipts",
      netShown.includes(netExpected),
      `screen: ${netShown} / MySQL: ${netExpected}`,
    );
    console.log(`  screenshot: ${await screenshot(page, "p6-11-payments-ledger")}`);

    return summary();
  } finally {
    await browser.close();
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
