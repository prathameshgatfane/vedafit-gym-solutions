/**
 * Phase 7 verification — real Chrome, real API, real database.
 *
 * Run with:
 *   1. MySQL up      (apps/api: bash scripts/dev-mysql-sandbox.sh start)
 *   2. Fixtures      (apps/api: pnpm tsx scripts/phase7-fixtures.ts)
 *   3. API up        (apps/api: pnpm dev)
 *   4. Admin web up  (apps/admin-web: pnpm dev)
 *   5. pnpm e2e:attendance
 *
 * Every check-in is performed by clicking through the actual UI, then read back out of MySQL with
 * the `mysql` client — a different driver from the Prisma client that wrote it, so the assertions
 * can't be satisfied by the ORM agreeing with itself.
 *
 * Two things bypass the UI, both deliberately:
 *   - Step 6 fires three simultaneous check-ins through the app's own axios instance. There is no
 *     way to click one button three times at once, and racing them is the entire point.
 *   - Step 8 fires a check-in as a TRAINER the same way, because the UI correctly offers them no
 *     button — and "the button is hidden" is not the same claim as "the server refuses".
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
const TRAINER = { email: "trainer@demo-gym.test", password: "ChangeMe123!" };

/** Must match the namespaces in apps/api/scripts/phase7-fixtures.ts. */
const MEMBER_PHONE_PREFIX = "+9195555";
const SECOND_BRANCH_NAME = "P7 Bandra";

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

async function gotoAttendance(page: Page) {
  await page.goto(`${APP_URL}/attendance`, { waitUntil: "networkidle0" });
  await page.waitForSelector('[data-testid="attendance-table"]', { timeout: 10_000 });
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

async function textOf(page: Page, selector: string): Promise<string> {
  return page.$eval(selector, (el) => el.textContent?.replace(/\s+/g, " ").trim() ?? "");
}

/**
 * Waits for the outcome banner to be about `mustMention`, not merely present. The panel clears
 * the previous result before each attempt, but waiting on the selector alone would still be a
 * race — and a stale banner reads as a pass for whatever the last check-in said.
 */
async function waitForOutcome(page: Page, mustMention: string): Promise<string> {
  await page.waitForFunction(
    (needle: string) => {
      const el = document.querySelector('[data-testid="check-in-outcome"]');
      return Boolean(el?.textContent?.includes(needle));
    },
    { timeout: 10_000 },
    mustMention,
  );
  return textOf(page, '[data-testid="check-in-outcome"]');
}

async function exists(page: Page, selector: string): Promise<boolean> {
  return (await page.$(selector)) !== null;
}

/**
 * Searches for a member in the check-in panel and presses their button. Returns nothing — what
 * happened is read from the outcome banner or the override prompt by the caller.
 */
async function searchAndCheckIn(page: Page, memberId: string, term: string) {
  const input = await page.waitForSelector('[data-testid="check-in-search"]');
  if (!input) throw new Error("No check-in search box");
  await input.click({ count: 3 });
  await input.type(term);

  const button = `[data-testid="check-in-${memberId}"]`;
  await page.waitForSelector(button, { timeout: 10_000 });
  await page.click(button);
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

function memberIdByPhone(suffix: string): string {
  const row = queryOne(
    `SELECT id, firstName, lastName FROM members WHERE phone = ${sqlString(
      `${MEMBER_PHONE_PREFIX}${suffix}`,
    )}`,
  );
  return requireCell(row, "id");
}

function attendanceFor(memberId: string): Record<string, string> | undefined {
  return queryOne(
    `SELECT id, organizationId, branchId, memberId, membershipId, overrideReason,
            markedByUserId, DATE_FORMAT(attendanceDate, '%Y-%m-%d') AS attendanceDate,
            DATE_FORMAT(checkedInAt, '%Y-%m-%d %H:%i:%s') AS checkedInAt
     FROM attendances WHERE memberId = ${sqlString(memberId)}
     ORDER BY checkedInAt ASC`,
  );
}

function countAttendance(memberId: string): number {
  const row = queryOne(
    `SELECT COUNT(*) AS n FROM attendances WHERE memberId = ${sqlString(memberId)}`,
  );
  return Number(requireCell(row, "n"));
}

async function main() {
  const browser = await launch();
  const page = await browser.newPage();
  forwardPageErrors(page);

  const org = queryOne(`SELECT id, timezone FROM organizations WHERE slug = 'demo-gym'`);
  const organizationId = requireCell(org, "id");
  const timezone = requireCell(org, "timezone");

  const mainBranchId = requireCell(
    queryOne(
      `SELECT id FROM branches WHERE organizationId = ${sqlString(organizationId)}
         AND name <> ${sqlString(SECOND_BRANCH_NAME)} ORDER BY createdAt ASC LIMIT 1`,
    ),
    "id",
  );
  const secondBranchId = requireCell(
    queryOne(
      `SELECT id FROM branches WHERE organizationId = ${sqlString(organizationId)}
         AND name = ${sqlString(SECOND_BRANCH_NAME)}`,
    ),
    "id",
  );

  const members = {
    active: memberIdByPhone("00000"),
    expired: memberIdByPhone("00001"),
    frozen: memberIdByPhone("00002"),
    none: memberIdByPhone("00003"),
    cancelled: memberIdByPhone("00004"),
    upcoming: memberIdByPhone("00005"),
    duplicate: memberIdByPhone("00006"),
    visitor: memberIdByPhone("00007"),
  };

  // The gym's today, computed here from the organization's own stored zone rather than read back
  // from the API — otherwise the check would just be the API agreeing with itself.
  const gymToday = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const utcToday = new Date().toISOString().slice(0, 10);

  step("Setup — what the database says before anything is clicked");
  console.log(`  organization ${organizationId} (${timezone})`);
  console.log(`  gym today    ${gymToday}   (UTC today ${utcToday}, UTC now ${new Date().toISOString()})`);
  if (gymToday !== utcToday) {
    console.log(
      `  \u001b[33mnote\u001b[0m the gym's day and the UTC day differ right now — 1.17.4 is live, not hypothetical`,
    );
  }
  console.log(`  main branch  ${mainBranchId}`);
  console.log(`  P7 Bandra    ${secondBranchId}`);
  checkEqual(
    "no Phase 7 check-ins exist yet",
    Number(
      requireCell(
        queryOne(
          `SELECT COUNT(*) AS n FROM attendances a JOIN members m ON m.id = a.memberId
             WHERE m.phone LIKE ${sqlString(`${MEMBER_PHONE_PREFIX}%`)}`,
        ),
        "n",
      ),
    ),
    0,
  );

  // ---------------------------------------------------------------------------
  step("1. RECEPTIONIST signs in and the register loads on the gym's own day");
  // ---------------------------------------------------------------------------
  await login(page, RECEPTIONIST);
  await gotoAttendance(page);

  const banner = await textOf(page, '[data-testid="today-banner"]');
  console.log(`  banner: ${banner}`);
  const expectedDay = new Intl.DateTimeFormat("en-IN", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(`${gymToday}T00:00:00.000Z`));
  check(
    "the register's heading is the gym's calendar day, not the browser's",
    banner.includes(expectedDay),
    `expected "${expectedDay}"`,
  );
  check("today's headcount starts at zero", banner.includes("0 members have checked in"));

  // Brand palette, as the browser actually resolves it — not as classes in the JSX.
  checkEqual(
    "page background is brand black",
    await computed(page, "body", "background-color"),
    BRAND_RGB.black,
  );
  checkEqual(
    "check-in panel sits on the brand's secondary surface",
    await computed(page, '[data-testid="check-in-panel"]', "background-color"),
    BRAND_RGB.black88,
  );
  checkEqual(
    "the filter bar uses the same surface",
    await computed(page, '[data-testid="attendance-filter-bar"]', "background-color"),
    BRAND_RGB.black88,
  );
  checkEqual(
    "text in the filter bar is the brand's off-white",
    await computed(page, '[data-testid="attendance-search"]', "color"),
    BRAND_RGB.white,
  );
  await screenshot(page, "phase7-01-register-empty");

  // ---------------------------------------------------------------------------
  step("2. A member with an ACTIVE membership — checked in, linked to their term");
  // ---------------------------------------------------------------------------
  const search = await page.waitForSelector('[data-testid="check-in-search"]');
  await search!.type("Aarav");
  await page.waitForSelector(`[data-testid="check-in-${members.active}"]`, { timeout: 10_000 });
  checkEqual(
    "the check-in button is brand green",
    await computed(page, `[data-testid="check-in-${members.active}"]`, "background-color"),
    BRAND_RGB.green,
  );
  await screenshot(page, "phase7-01b-search-results");
  await page.click(`[data-testid="check-in-${members.active}"]`);

  const activeOutcome = await waitForOutcome(page, "Aarav Active");
  console.log(`  outcome: ${activeOutcome}`);
  check("the UI confirms the check-in with a time", /checked in at \d/i.test(activeOutcome));
  check("it is not flagged as an override", !/override/i.test(activeOutcome));

  const activeRow = attendanceFor(members.active);
  check("a row exists in MySQL", activeRow !== undefined);
  checkEqual("stamped with the branch it happened at", activeRow?.branchId, mainBranchId);
  checkEqual("attendanceDate is the gym's today", activeRow?.attendanceDate, gymToday);
  checkEqual("overrideReason is NULL — the visit was covered", activeRow?.overrideReason, "NULL");

  const activeTerm = queryOne(
    `SELECT id FROM memberships WHERE memberId = ${sqlString(members.active)} AND status = 'ACTIVE'`,
  );
  checkEqual(
    "linked to the term that covered it",
    activeRow?.membershipId,
    requireCell(activeTerm, "id"),
  );

  const receptionistId = requireCell(
    queryOne(`SELECT id FROM users WHERE email = ${sqlString(RECEPTIONIST.email)} AND deletedAt IS NULL`),
    "id",
  );
  checkEqual("recorded against the staff member who marked it", activeRow?.markedByUserId, receptionistId);

  // ---------------------------------------------------------------------------
  step("3. Expired, frozen, cancelled, not-yet-started and no membership at all");
  // ---------------------------------------------------------------------------
  const scenarios = [
    { key: "expired", id: members.expired, term: "Esha", reason: "EXPIRED", says: /expired/i },
    { key: "frozen", id: members.frozen, term: "Farhan", reason: "FROZEN", says: /frozen/i },
    { key: "cancelled", id: members.cancelled, term: "Kabir", reason: "CANCELLED", says: /cancelled/i },
    { key: "upcoming", id: members.upcoming, term: "Uma", reason: "NOT_STARTED", says: /hasn't started/i },
    { key: "none", id: members.none, term: "Nisha", reason: "NO_MEMBERSHIP", says: /no membership/i },
  ] as const;

  for (const scenario of scenarios) {
    await searchAndCheckIn(page, scenario.id, scenario.term);
    await page.waitForSelector('[data-testid="override-confirm"]', { timeout: 10_000 });

    const prompt = await textOf(page, '[data-testid="override-confirm"]');
    console.log(`  ${scenario.key}: ${prompt}`);
    check(
      `${scenario.key} — refused first, with a reason a human can act on`,
      scenario.says.test(prompt),
    );
    check(
      `${scenario.key} — the prompt says the override is recorded against them`,
      /recorded as an override against your name/i.test(prompt),
    );
    checkEqual(`${scenario.key} — nothing written before confirming`, countAttendance(scenario.id), 0);

    if (scenario.key === "cancelled") {
      // Back out once, to show the refusal really is a stopping point and not a formality.
      await clickButton(page, "Cancel");
      await sleep(200);
      check(
        "cancelling the prompt leaves no row behind",
        countAttendance(scenario.id) === 0 && !(await exists(page, '[data-testid="override-confirm"]')),
      );
      await searchAndCheckIn(page, scenario.id, scenario.term);
      await page.waitForSelector('[data-testid="override-confirm"]', { timeout: 10_000 });
    }

    if (scenario.key === "expired") {
      await screenshot(page, "phase7-02-override-prompt");
    }

    await page.click('[data-testid="override-confirm-button"]');
    const outcome = await waitForOutcome(page, scenario.term);
    check(
      `${scenario.key} — the UI says it was recorded as an override`,
      /recorded as an override/i.test(outcome),
      outcome,
    );

    const row = attendanceFor(scenario.id);
    checkEqual(`${scenario.key} — overrideReason in MySQL`, row?.overrideReason, scenario.reason);
    checkEqual(`${scenario.key} — membershipId is NULL, nothing covered it`, row?.membershipId, "NULL");
    checkEqual(`${scenario.key} — the override names who allowed it`, row?.markedByUserId, receptionistId);
  }

  // The stale ACTIVE row that the expired member's refusal was based on must be untouched:
  // attendance reads memberships, it does not retire them on its own clock (1.17.4).
  const expiredTerm = queryOne(
    `SELECT status FROM memberships WHERE memberId = ${sqlString(members.expired)}`,
  );
  check(
    "checking in never rewrote a membership's status",
    expiredTerm?.status === "EXPIRED",
    `membership is ${expiredTerm?.status}`,
  );

  // ---------------------------------------------------------------------------
  step("4. Duplicate check-in — the second is a no-op, not an error");
  // ---------------------------------------------------------------------------
  await searchAndCheckIn(page, members.duplicate, "Divya");
  await waitForOutcome(page, "Divya Duplicate");
  const firstRow = attendanceFor(members.duplicate);
  const firstTime = requireCell(firstRow, "checkedInAt");
  const firstId = requireCell(firstRow, "id");
  console.log(`  first check-in: ${firstId} at ${firstTime}`);

  await sleep(1100); // so a second row, if one were written, would carry a different timestamp
  await searchAndCheckIn(page, members.duplicate, "Divya");
  const repeatOutcome = await waitForOutcome(page, "already checked in today");
  console.log(`  outcome: ${repeatOutcome}`);
  check("the UI says they already checked in today", /already checked in today/i.test(repeatOutcome));
  check("and that nothing was recorded twice", /nothing was recorded twice/i.test(repeatOutcome));
  check("no error is shown", !(await exists(page, '[role="alert"]')));

  checkEqual("still exactly one row in MySQL", countAttendance(members.duplicate), 1);
  const secondLook = attendanceFor(members.duplicate);
  checkEqual("same row id", requireCell(secondLook, "id"), firstId);
  checkEqual("and the original arrival time is preserved", requireCell(secondLook, "checkedInAt"), firstTime);
  await screenshot(page, "phase7-03-duplicate");

  // ---------------------------------------------------------------------------
  step("5. The register lists the day, and filters to overrides only");
  // ---------------------------------------------------------------------------
  await gotoAttendance(page);
  await page.waitForSelector('[data-testid="attendance-row"]', { timeout: 10_000 });

  const rowCount = await page.$$eval('[data-testid="attendance-row"]', (rows) => rows.length);
  const dbCount = Number(
    requireCell(
      queryOne(
        `SELECT COUNT(*) AS n FROM attendances a JOIN members m ON m.id = a.memberId
           WHERE m.phone LIKE ${sqlString(`${MEMBER_PHONE_PREFIX}%`)}
             AND a.attendanceDate = ${sqlString(gymToday)}`,
      ),
      "n",
    ),
  );
  checkEqual("the register shows every check-in the database holds for today", rowCount, dbCount);

  const todayBanner = await textOf(page, '[data-testid="today-banner"]');
  check(
    "the headcount moved with them",
    todayBanner.includes(`${dbCount} members have checked in`),
    todayBanner,
  );

  const coveredBadges = await page.$$eval('[data-testid="coverage-covered"]', (n) => n.length);
  const overrideBadges = await page.$$eval('[data-testid="coverage-override"]', (n) => n.length);
  console.log(`  ${coveredBadges} covered, ${overrideBadges} overrides on screen`);
  checkEqual(
    "override badges match the database's override rows",
    overrideBadges,
    Number(
      requireCell(
        queryOne(
          `SELECT COUNT(*) AS n FROM attendances a JOIN members m ON m.id = a.memberId
             WHERE m.phone LIKE ${sqlString(`${MEMBER_PHONE_PREFIX}%`)}
               AND a.attendanceDate = ${sqlString(gymToday)} AND a.overrideReason IS NOT NULL`,
        ),
        "n",
      ),
    ),
  );

  checkEqual(
    "a covered visit's badge is brand green",
    await computed(page, '[data-testid="coverage-covered"]', "color"),
    BRAND_RGB.green,
  );
  const overrideColour = await computed(page, '[data-testid="coverage-override"]', "color");
  check(
    "an override's badge is amber, so the two read differently at a glance",
    overrideColour !== BRAND_RGB.green,
    overrideColour,
  );

  await page.select('[data-testid="attendance-coverage"]', "overrides");
  await sleep(700);
  const filteredCovered = await page.$$eval('[data-testid="coverage-covered"]', (n) => n.length);
  const filteredOverrides = await page.$$eval('[data-testid="coverage-override"]', (n) => n.length);
  checkEqual("overrides-only hides the covered visits", filteredCovered, 0);
  checkEqual("and keeps the overrides", filteredOverrides, overrideBadges);
  check(
    "the filter is in the URL, so the view can be shared",
    page.url().includes("overridesOnly=true"),
    page.url(),
  );
  await screenshot(page, "phase7-04-overrides-only");

  // Paging/searching must not wipe the day being looked at.
  await page.goto(`${APP_URL}/attendance?date=2026-01-01`, { waitUntil: "networkidle0" });
  await page.waitForSelector('[data-testid="attendance-table"]', { timeout: 10_000 });
  const emptyDay = await textOf(page, '[data-testid="attendance-table"]');
  check("a day with no visits says so", /nobody has checked in on this day yet/i.test(emptyDay));

  // ---------------------------------------------------------------------------
  step("6. Three simultaneous check-ins — the unique index, not a check-then-insert");
  // ---------------------------------------------------------------------------
  const racedMember = members.visitor; // registered at Bandra, but the desk is at Main
  // A branch-scoped receptionist can't see a Bandra member, so this race runs as the OWNER, who
  // must also name the branch explicitly (1.17.3).
  await logout(page);
  await login(page, OWNER);
  await gotoAttendance(page);

  // Written as one inline `Array.from` rather than a named `fire()` helper: esbuild's keepNames
  // transform wraps named functions in a `__name` call that doesn't exist inside the page.
  const raceResults = await page.evaluate(
    async (moduleUrl: string, orgId: string, memberId: string, branchId: string) => {
      const mod = await import(/* @vite-ignore */ moduleUrl);
      return Promise.all(
        Array.from({ length: 3 }, () =>
          mod.apiClient
            .post(`/organizations/${orgId}/attendance`, { memberId, branchId })
            .then((r: { status: number }) => ({ status: r.status }))
            .catch((e: { response?: { status?: number } }) => ({
              status: e.response?.status ?? 0,
            })),
        ),
      );
    },
    "/src/lib/api-client.ts",
    organizationId,
    racedMember,
    mainBranchId,
  );

  console.log(`  statuses: ${raceResults.map((r) => r.status).join(", ")}`);
  checkEqual("three simultaneous check-ins produced exactly one row", countAttendance(racedMember), 1);
  check(
    "one of them created it",
    raceResults.some((r) => r.status === 201),
  );
  check(
    "and none of them blew up with a 500",
    raceResults.every((r) => r.status < 500),
    raceResults.map((r) => r.status).join(", "),
  );

  const racedRow = attendanceFor(racedMember);
  checkEqual(
    "stamped with the branch the check-in happened at, not the member's home branch",
    racedRow?.branchId,
    mainBranchId,
  );
  const homeBranch = requireCell(
    queryOne(`SELECT branchId FROM members WHERE id = ${sqlString(racedMember)}`),
    "branchId",
  );
  checkEqual("(the member's home branch is the other one)", homeBranch, secondBranchId);
  check(
    "so the two genuinely differ",
    racedRow?.branchId !== homeBranch,
    `${racedRow?.branchId} vs ${homeBranch}`,
  );

  // ---------------------------------------------------------------------------
  step("7. An org-wide caller must name a branch — it is never guessed");
  // ---------------------------------------------------------------------------
  const noBranch = await forceApiCall(page, `/organizations/${organizationId}/attendance`, {
    memberId: members.upcoming,
    override: true,
  });
  checkEqual("refused with 400", noBranch.status, 400);
  checkEqual("with BRANCH_REQUIRED", noBranch.code, "BRANCH_REQUIRED");

  // ---------------------------------------------------------------------------
  step("8. RBAC — TRAINER reads the register, the desk marks it, neither does the other's job");
  // ---------------------------------------------------------------------------
  await logout(page);
  await login(page, TRAINER);
  await gotoAttendance(page);

  check("a TRAINER sees the register", await exists(page, '[data-testid="attendance-table"]'));
  const trainerRegister = await textOf(page, '[data-testid="attendance-table"]');
  // Own-roster (1.19.1): the key is the same as the desk's, so a 200 is not enough. An
  // unassigned P7 member must not appear, even if they checked in today.
  check(
    "does not list an unassigned member (1.19.1 own-roster)",
    !/Aarav Active/.test(trainerRegister),
  );
  check(
    "but no check-in panel",
    !(await exists(page, '[data-testid="check-in-panel"]')),
  );
  check("and no search box to check anyone in with", !(await exists(page, '[data-testid="check-in-search"]')));
  await screenshot(page, "phase7-05-trainer-read-only");

  // The hidden panel is a courtesy. The server is the control.
  const before = countAttendance(members.upcoming);
  const trainerAttempt = await forceApiCall(page, `/organizations/${organizationId}/attendance`, {
    memberId: members.upcoming,
    branchId: mainBranchId,
    override: true,
  });
  checkEqual("forcing a check-in through the app's own client is refused", trainerAttempt.status, 403);
  checkEqual("with PERMISSION_DENIED", trainerAttempt.code, "PERMISSION_DENIED");
  checkEqual("and nothing was written", countAttendance(members.upcoming), before);

  // ACCOUNTANT holds neither key — attendance is not their brief.
  await logout(page);
  await login(page, { email: "accounts@demo-gym.test", password: "ChangeMe123!" });
  await page.goto(`${APP_URL}/attendance`, { waitUntil: "networkidle0" });
  await sleep(400);
  const accountantBody = await textOf(page, "body");
  check(
    "an ACCOUNTANT gets the not-for-your-role screen instead of the register",
    /not available for your role/i.test(accountantBody),
  );
  check(
    "and Attendance isn't in their sidebar",
    !(await page.$$eval("nav a", (links) =>
      links.some((l) => l.textContent?.trim() === "Attendance"),
    )),
  );

  // ---------------------------------------------------------------------------
  step("9. Final state — what an operator would see in the database");
  // ---------------------------------------------------------------------------
  const finalRows = queryDb(
    `SELECT m.firstName, m.lastName, b.name AS branch,
            COALESCE(a.overrideReason, 'covered') AS coverage,
            IF(a.membershipId IS NULL, 'none', 'linked') AS term,
            u.name AS markedBy,
            DATE_FORMAT(a.attendanceDate, '%Y-%m-%d') AS day
       FROM attendances a
       JOIN members m ON m.id = a.memberId
       JOIN branches b ON b.id = a.branchId
       LEFT JOIN users u ON u.id = a.markedByUserId
      WHERE m.phone LIKE ${sqlString(`${MEMBER_PHONE_PREFIX}%`)}
      ORDER BY a.checkedInAt ASC`,
  );
  console.table(finalRows);

  checkEqual(
    "every check-in has exactly one of a term or an override reason",
    finalRows.filter((r) => (r.coverage === "covered") === (r.term === "linked")).length,
    finalRows.length,
  );
  checkEqual(
    "every check-in landed on the gym's today",
    finalRows.filter((r) => r.day === gymToday).length,
    finalRows.length,
  );
  checkEqual(
    "and every one names the staff member who recorded it",
    finalRows.filter((r) => r.markedBy && r.markedBy !== "NULL").length,
    finalRows.length,
  );

  await browser.close();
  process.exit(summary());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
