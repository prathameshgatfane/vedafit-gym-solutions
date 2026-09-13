/**
 * Phase 9 verification — real Chrome, real API, real database.
 *
 * Run with:
 *   1. MySQL up      (apps/api: bash scripts/dev-mysql-sandbox.sh start)
 *   2. Fixtures      (apps/api: pnpm tsx scripts/phase9-fixtures.ts)
 *   3. API up        (apps/api: pnpm dev)
 *   4. Admin web up  (apps/admin-web: pnpm dev)
 *   5. pnpm e2e:trainers
 *
 * The claim this phase has to prove is the row-level half of `attendance.view` for a trainer
 * (Locked Decision 1.19.1): the permission key is the same one a receptionist holds, so a 200
 * from the middleware is not enough. The trainer's register must list assigned members' check-ins
 * and must not list anyone else's — confirmed on the rendered page and against MySQL with the
 * `mysql` client, a different driver from the Prisma client that served the API.
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
const COACH = { email: "coach@demo-gym.test", password: "ChangeMe123!" };
const ACCOUNTANT = { email: "accounts@demo-gym.test", password: "ChangeMe123!" };

const MEMBER_PHONE_PREFIX = "+9193333";
const COACH_EMAIL = "coach@demo-gym.test";
const TRAINER_EMAIL = "trainer@demo-gym.test";

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

async function forceApiGet(
  page: Page,
  path: string,
): Promise<{ status: number; code: string; names: string[] }> {
  return page.evaluate(
    async (moduleUrl: string, requestPath: string) => {
      const mod = await import(/* @vite-ignore */ moduleUrl);
      try {
        const res = await mod.apiClient.get(requestPath);
        const rows = (res.data?.data ?? []) as { member?: { firstName?: string; lastName?: string } }[];
        return {
          status: res.status as number,
          code: "NONE",
          names: rows.map((row) => `${row.member?.firstName ?? ""} ${row.member?.lastName ?? ""}`.trim()),
        };
      } catch (error) {
        const err = error as {
          response?: { status?: number; data?: { error?: { code?: string } } };
        };
        return {
          status: err.response?.status ?? 0,
          code: err.response?.data?.error?.code ?? "NONE",
          names: [],
        };
      }
    },
    "/src/lib/api-client.ts",
    path,
  );
}

function orgId(): string {
  return requireCell(
    queryOne("SELECT id FROM organizations WHERE slug = 'demo-gym'"),
    "id",
  );
}

function userId(email: string): string {
  return requireCell(
    queryOne(`SELECT id FROM users WHERE email = ${sqlString(email)} AND deletedAt IS NULL`),
    "id",
  );
}

function memberByPhone(suffix: string): { id: string; firstName: string; lastName: string } {
  const row = queryOne(
    `SELECT id, firstName, lastName FROM members WHERE phone = ${sqlString(
      `${MEMBER_PHONE_PREFIX}${suffix}`,
    )}`,
  );
  return {
    id: requireCell(row, "id"),
    firstName: requireCell(row, "firstName"),
    lastName: requireCell(row, "lastName"),
  };
}

function trainerProfileId(email: string): string | undefined {
  return queryOne(
    `SELECT tp.id AS id
       FROM trainer_profiles tp
       JOIN users u ON u.id = tp.userId
      WHERE u.email = ${sqlString(email)}`,
  )?.id;
}

function assignmentCount(profileId: string, memberId: string): number {
  const row = queryOne(
    `SELECT COUNT(*) AS n FROM trainer_assignments
      WHERE trainerProfileId = ${sqlString(profileId)}
        AND memberId = ${sqlString(memberId)}`,
  );
  return Number(row?.n ?? 0);
}

function gymToday(): string {
  const timezone = requireCell(
    queryOne("SELECT timezone FROM organizations WHERE slug = 'demo-gym'"),
    "timezone",
  );
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone || "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function attendanceNamesToday(): string[] {
  const today = gymToday();
  return queryDb(
    `SELECT m.firstName, m.lastName
       FROM attendances a
       JOIN members m ON m.id = a.memberId
      WHERE a.attendanceDate = ${sqlString(today)}
        AND m.phone LIKE ${sqlString(`${MEMBER_PHONE_PREFIX}%`)}
      ORDER BY m.firstName`,
  ).map((row) => `${row.firstName} ${row.lastName}`);
}

function rosterAttendanceNames(profileId: string): string[] {
  const today = gymToday();
  return queryDb(
    `SELECT m.firstName, m.lastName
       FROM attendances a
       JOIN trainer_assignments ta ON ta.memberId = a.memberId
       JOIN members m ON m.id = a.memberId
      WHERE ta.trainerProfileId = ${sqlString(profileId)}
        AND a.attendanceDate = ${sqlString(today)}
      ORDER BY m.firstName`,
  ).map((row) => `${row.firstName} ${row.lastName}`);
}

async function main() {
  const browser = await launch();
  const page = await browser.newPage();
  forwardPageErrors(page);

  const organizationId = orgId();
  const kiran = memberByPhone("00001");
  const zoya = memberByPhone("00002");
  const demoProfileId = trainerProfileId(TRAINER_EMAIL);
  if (!demoProfileId) throw new Error("Demo trainer has no profile — run phase9-fixtures.ts");

  // ---------------------------------------------------------------------------
  step("1. OWNER creates a profile through the form — candidate, not a role-name check");
  // ---------------------------------------------------------------------------
  await login(page, OWNER);
  check("Trainers is in the sidebar", await exists(page, 'a[href="/trainers"]'));
  await page.goto(`${APP_URL}/trainers/new`, { waitUntil: "networkidle0" });
  await page.waitForSelector('[data-testid="trainer-form"]', { timeout: 10_000 });

  const headingColor = await computed(page, "h1", "color");
  checkEqual("brand white on the create heading", headingColor, BRAND_RGB.white);

  const coachId = userId(COACH_EMAIL);
  await page.waitForFunction(
    (id) =>
      [...document.querySelectorAll('[data-testid="trainer-candidate"] option')].some(
        (option) => (option as HTMLOptionElement).value === id,
      ),
    { timeout: 10_000 },
    coachId,
  );
  await page.select('[data-testid="trainer-candidate"]', coachId);
  await page.type('[data-testid="trainer-specialization"]', "Yoga");
  await page.type('[data-testid="trainer-commission"]', "8");
  await clickButton(page, "Create profile");
  await page.waitForSelector('[data-testid="trainer-detail-heading"]', { timeout: 10_000 });

  const coachProfile = queryOne(
    `SELECT id, specialization, commissionPct FROM trainer_profiles WHERE userId = ${sqlString(coachId)}`,
  );
  check("a TrainerProfile row exists for the coach", Boolean(coachProfile));
  checkEqual("specialization stored as typed", coachProfile?.specialization, "Yoga");
  checkEqual("commission stored as DECIMAL(5,2)", coachProfile?.commissionPct, "8.00");
  await screenshot(page, "phase9-01-created-coach");

  // ---------------------------------------------------------------------------
  step("2. OWNER edits the demo trainer and assigns the outsider");
  // ---------------------------------------------------------------------------
  await page.goto(`${APP_URL}/trainers/${demoProfileId}/edit`, { waitUntil: "networkidle0" });
  await page.waitForSelector('[data-testid="trainer-form"]', { timeout: 10_000 });
  await page.click('[data-testid="trainer-specialization"]');
  await page.keyboard.down("Control");
  await page.keyboard.press("a");
  await page.keyboard.up("Control");
  await page.type('[data-testid="trainer-specialization"]', "Hypertrophy");
  await clickButton(page, "Save changes");
  await page.waitForSelector('[data-testid="trainer-detail-heading"]', { timeout: 10_000 });

  const edited = queryOne(
    `SELECT specialization FROM trainer_profiles WHERE id = ${sqlString(demoProfileId)}`,
  );
  checkEqual("edit wrote specialization in MySQL", edited?.specialization, "Hypertrophy");
  checkEqual(
    "the user row was not rewritten",
    requireCell(queryOne(`SELECT name FROM users WHERE id = ${sqlString(userId(TRAINER_EMAIL))}`), "name"),
    "Demo Trainer",
  );

  await page.goto(`${APP_URL}/trainers/${demoProfileId}`, { waitUntil: "networkidle0" });
  await page.waitForSelector('[data-testid="trainer-roster"]', { timeout: 10_000 });
  const beforeAssign = await textOf(page, '[data-testid="trainer-roster"]');
  check("Kiran is already on the roster", /Kiran Assigned/.test(beforeAssign));
  check("Zoya is not", !/Zoya Outsider/.test(beforeAssign));

  // Phone, not "Zoya": Phase 10's leftover "Zoya Convert" also matches a name search and
  // page.click('[data-testid="assign-button"]') would assign the first hit.
  await page.type('[data-testid="assign-search"]', `${MEMBER_PHONE_PREFIX}00002`);
  await page.waitForFunction(
    (name) =>
      [...document.querySelectorAll('[data-testid="assign-result"]')].some((el) =>
        (el.textContent ?? "").includes(name),
      ),
    { timeout: 10_000 },
    "Zoya Outsider",
  );
  const assignedNamed = await page.evaluate((name) => {
    const row = [...document.querySelectorAll('[data-testid="assign-result"]')].find((el) =>
      (el.textContent ?? "").includes(name),
    );
    const button = row?.querySelector('[data-testid="assign-button"]') as HTMLButtonElement | null;
    if (!button) return false;
    button.click();
    return true;
  }, "Zoya Outsider");
  if (!assignedNamed) throw new Error("No assign button on the Zoya Outsider result");
  await page.waitForFunction(
    () => /Zoya Outsider/.test(document.querySelector('[data-testid="trainer-roster"]')?.textContent ?? ""),
    { timeout: 15_000 },
  );
  checkEqual("assignment row written in MySQL", assignmentCount(demoProfileId, zoya.id), 1);
  await screenshot(page, "phase9-02-assigned-zoya");

  // ---------------------------------------------------------------------------
  step("3. TRAINER attendance is own-roster, confirmed against MySQL (1.19.1)");
  // ---------------------------------------------------------------------------
  await logout(page);
  await login(page, TRAINER);
  check("Trainers is not in the sidebar — no trainers.view, no trainers.manage", !(await exists(page, 'a[href="/trainers"]')));

  await page.goto(`${APP_URL}/members`, { waitUntil: "networkidle0" });
  await page.waitForSelector('[data-testid="members-table"]', { timeout: 10_000 });
  check("own-roster banner on members", await exists(page, '[data-testid="own-roster-banner"]'));
  const memberTable = await textOf(page, '[data-testid="members-table"]');
  check("Kiran is on the trainer's member list", /Kiran Assigned/.test(memberTable));
  check("Zoya is too, after the assignment", /Zoya Outsider/.test(memberTable));

  await page.goto(`${APP_URL}/attendance`, { waitUntil: "networkidle0" });
  await page.waitForSelector('[data-testid="attendance-table"]', { timeout: 10_000 });
  check("own-roster banner on attendance", await exists(page, '[data-testid="own-roster-banner"]'));
  check("no check-in panel — trainers do not hold attendance.mark", !(await exists(page, '[data-testid="check-in-panel"]')));

  const trainerRegister = await textOf(page, '[data-testid="attendance-table"]');
  const sqlRoster = rosterAttendanceNames(demoProfileId);
  const sqlAllP9 = attendanceNamesToday();
  check("Kiran's check-in is on the trainer's register", /Kiran Assigned/.test(trainerRegister));
  check("Zoya's check-in is on it while she is assigned", /Zoya Outsider/.test(trainerRegister));
  checkEqual(
    "SQL roster check-ins match the two assigned members",
    sqlRoster.join(", "),
    "Kiran Assigned, Zoya Outsider",
  );
  check(
    "MySQL has both P9 check-ins on the books — the filter is hiding nothing that isn't there",
    sqlAllP9.includes("Kiran Assigned") && sqlAllP9.includes("Zoya Outsider"),
    sqlAllP9.join(", "),
  );

  const trainerApi = await forceApiGet(page, `/organizations/${organizationId}/attendance`);
  checkEqual("GET /attendance as the trainer is 200", trainerApi.status, 200);
  check("API names include Kiran", trainerApi.names.includes("Kiran Assigned"));
  check("API names include Zoya", trainerApi.names.includes("Zoya Outsider"));
  await screenshot(page, "phase9-03-trainer-roster");

  // ---------------------------------------------------------------------------
  step("4. Unassigning drops access including past check-ins (1.19.2)");
  // ---------------------------------------------------------------------------
  await logout(page);
  await login(page, OWNER);
  await page.goto(`${APP_URL}/trainers/${demoProfileId}`, { waitUntil: "networkidle0" });
  await page.waitForSelector('[data-testid="roster-row"]', { timeout: 10_000 });
  await page.click(`[data-testid="roster-row"][data-member-id="${zoya.id}"] [data-testid="unassign-button"]`);
  await page.waitForFunction(
    () => !/Zoya Outsider/.test(document.querySelector('[data-testid="trainer-roster"]')?.textContent ?? ""),
    { timeout: 10_000 },
  );
  checkEqual("assignment row gone from MySQL", assignmentCount(demoProfileId, zoya.id), 0);
  checkEqual("Kiran is still assigned", assignmentCount(demoProfileId, kiran.id), 1);

  await logout(page);
  await login(page, TRAINER);
  await page.goto(`${APP_URL}/attendance`, { waitUntil: "networkidle0" });
  await page.waitForSelector('[data-testid="attendance-table"]', { timeout: 10_000 });
  const afterUnassign = await textOf(page, '[data-testid="attendance-table"]');
  check("Kiran remains on the trainer's register", /Kiran Assigned/.test(afterUnassign));
  check("Zoya's past check-in dropped with the assignment", !/Zoya Outsider/.test(afterUnassign));

  const afterApi = await forceApiGet(page, `/organizations/${organizationId}/attendance`);
  check("API no longer names Zoya", !afterApi.names.includes("Zoya Outsider"));

  await page.goto(`${APP_URL}/members`, { waitUntil: "networkidle0" });
  await page.waitForSelector('[data-testid="members-table"]', { timeout: 10_000 });
  const membersAfter = await textOf(page, '[data-testid="members-table"]');
  check("Zoya is gone from the trainer's member list", !/Zoya Outsider/.test(membersAfter));
  await screenshot(page, "phase9-04-unassigned");

  // ---------------------------------------------------------------------------
  step("5. A TRAINER with no assignments sees the empty set, not the gym");
  // ---------------------------------------------------------------------------
  await logout(page);
  await login(page, COACH);
  await page.goto(`${APP_URL}/attendance`, { waitUntil: "networkidle0" });
  await page.waitForSelector('[data-testid="attendance-table"]', { timeout: 10_000 });
  const coachRegister = await textOf(page, '[data-testid="attendance-table"]');
  check("coach sees the own-roster banner", await exists(page, '[data-testid="own-roster-banner"]'));
  check("and not Kiran — no assignments means no rows (1.19.1)", !/Kiran Assigned/.test(coachRegister));
  check("and not Zoya", !/Zoya Outsider/.test(coachRegister));
  check(
    "empty copy names the restriction",
    /none of your assigned members have checked in/i.test(coachRegister),
  );

  // ---------------------------------------------------------------------------
  step("6. RECEPTIONIST still sees the full register — they hold attendance.mark");
  // ---------------------------------------------------------------------------
  await logout(page);
  await login(page, RECEPTIONIST);
  check("Trainers is not in the receptionist sidebar", !(await exists(page, 'a[href="/trainers"]')));
  await page.goto(`${APP_URL}/attendance`, { waitUntil: "networkidle0" });
  await page.waitForSelector('[data-testid="attendance-table"]', { timeout: 10_000 });
  const deskRegister = await textOf(page, '[data-testid="attendance-table"]');
  check("no own-roster banner for the desk", !(await exists(page, '[data-testid="own-roster-banner"]')));
  check("desk still sees Kiran", /Kiran Assigned/.test(deskRegister));
  check("desk still sees Zoya's check-in after unassign", /Zoya Outsider/.test(deskRegister));
  await screenshot(page, "phase9-05-receptionist");

  // ---------------------------------------------------------------------------
  step("7. RBAC — Section 4.2. The hidden nav is a courtesy; the server is the control");
  // ---------------------------------------------------------------------------
  const trainerTrainers = await forceApiGet(page, `/organizations/${organizationId}/trainers`);
  checkEqual("RECEPTIONIST GET /trainers is 403", trainerTrainers.status, 403);
  checkEqual("with PERMISSION_DENIED", trainerTrainers.code, "PERMISSION_DENIED");

  await logout(page);
  await login(page, TRAINER);
  const trainerForbidden = await forceApiGet(page, `/organizations/${organizationId}/trainers`);
  checkEqual("TRAINER GET /trainers is 403", trainerForbidden.status, 403);
  checkEqual("TRAINER PERMISSION_DENIED", trainerForbidden.code, "PERMISSION_DENIED");

  await logout(page);
  await login(page, ACCOUNTANT);
  check("Trainers is not in the accountant sidebar", !(await exists(page, 'a[href="/trainers"]')));
  await page.goto(`${APP_URL}/members`, { waitUntil: "networkidle0" });
  await page.waitForSelector('[data-testid="members-table"]', { timeout: 10_000 });
  const accountantMembers = await textOf(page, '[data-testid="members-table"]');
  check("ACCOUNTANT is not own-rostered — they do not hold attendance.view", !(await exists(page, '[data-testid="own-roster-banner"]')));
  check("and can still see Zoya on the member list", /Zoya Outsider/.test(accountantMembers));
  check("and Kiran", /Kiran Assigned/.test(accountantMembers));

  await page.goto(`${APP_URL}/attendance`, { waitUntil: "networkidle0" });
  await sleep(400);
  const accountantBody = await textOf(page, "body");
  check(
    "ACCOUNTANT gets the not-for-your-role screen on attendance",
    /not available for your role/i.test(accountantBody),
  );

  const accountantTrainers = await forceApiGet(page, `/organizations/${organizationId}/trainers`);
  checkEqual("ACCOUNTANT GET /trainers is 403", accountantTrainers.status, 403);

  await screenshot(page, "phase9-06-accountant");

  await browser.close();
  process.exit(summary());
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
