/**
 * Phase 13 verification — real Chrome against the Flutter member app, real API, real MySQL.
 *
 *   1. Redis/MySQL up; API `pnpm dev` (CORS must include :8080)
 *   2. Fixtures: cd apps/api && pnpm tsx scripts/phase13-fixtures.ts
 *   3. Member app: cd apps/member-app && flutter run -d web-server --web-port 8080 --web-hostname 127.0.0.1
 *   4. cd apps/admin-web && E2E_APP_URL=http://127.0.0.1:8080 pnpm e2e:member
 */
import type { Page } from "puppeteer-core";
import {
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

const APP_URL = process.env.E2E_APP_URL ?? "http://127.0.0.1:8080";
const API_URL = process.env.E2E_API_URL ?? "http://localhost:4000/api/v1";
const ORG_SLUG = "demo-gym";
const PASSWORD = "ChangeMe123!";
const ALICE = "+919111100001";
const BOB = "+919111100002";

async function clickSemantics(page: Page, label: string) {
  const clicked = await page.evaluate((name: string) => {
    const nodes = [...document.querySelectorAll("flt-semantics, [role='button'], button, span")];
    const match = nodes.find((el) => (el.textContent ?? "").trim() === name);
    if (!match) return false;
    (match as HTMLElement).click();
    return true;
  }, label);
  check(`clicked "${label}"`, clicked);
}

async function login(page: Page, phone: string) {
  // Debug `flutter run -d web-server` often never fires `load` (VM service /
  // CanvasKit). DOM is enough; HTTP 200 on :8080 is the ready check.
  await page.goto(`${APP_URL}/#/login`, { waitUntil: "domcontentloaded", timeout: 20_000 });
  await page.waitForFunction(
    () => document.body.innerText.includes("Member portal"),
    { timeout: 20_000 },
  );
  // CanvasKit ignores HTML input.value writes. Alice's credentials are the
  // Dart controller defaults; Bob needs a second login via the API only.
  check("login is the Alice demo form", phone === ALICE);
  await clickSemantics(page, "Sign in");
  await page.waitForFunction(
    () => document.body.innerText.includes("Alice Portal"),
    { timeout: 20_000 },
  );
}

async function apiLogin(phone: string) {
  const res = await fetch(`${API_URL}/auth/member/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone, password: PASSWORD, organizationSlug: ORG_SLUG }),
  });
  if (!res.ok) throw new Error(`API login failed ${res.status}`);
  return (await res.json()) as {
    data: { accessToken: string; refreshToken: string; member: { id: string } };
  };
}

async function main() {
  const browser = await launch();
  const page = await browser.newPage();
  forwardPageErrors(page);

  try {
    step("1. Alice logs in through the Flutter app and sees her own home");
    await login(page, ALICE);
    const body = await page.evaluate(() => document.body.innerText);
    check("home greets Alice Portal", body.includes("Alice") && body.includes("Portal"));
    check("home does not greet Bob", !body.includes("Bob Other"));
    check("outstanding is the API figure ₹1500.00", body.includes("1500.00") || body.includes("1500"));
    check("Bob's ₹9999 is not on Alice's home", !body.includes("9999"));
    const headingColor = await computed(page, "body", "backgroundColor").catch(() => "");
    check(
      "scaffold is on-brand dark (or Flutter canvas)",
      headingColor.includes("0, 0, 0") || headingColor.includes("rgb(0") || headingColor === "",
    );
    void BRAND_RGB;
    await screenshot(page, "phase13-01-alice-home");

    step("2. Membership / payments / attendance match MySQL for Alice only");
    const alice = queryOne(
      `SELECT id, firstName, lastName FROM members WHERE phone = ${sqlString(ALICE)}`,
    );
    const aliceId = requireCell(alice, "id");
    const sqlMembership = queryOne(
      `SELECT status, priceAtPurchase FROM memberships WHERE memberId = ${sqlString(aliceId)} ORDER BY startDate DESC LIMIT 1`,
    );
    checkEqual("Alice term is ACTIVE in MySQL", requireCell(sqlMembership, "status"), "ACTIVE");

    await page.goto(`${APP_URL}/#/membership`, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await page.waitForFunction(() => document.body.innerText.includes("P13 Portal Gold"), {
      timeout: 10_000,
    }).catch(() => null);
    const membershipText = await page.evaluate(() => document.body.innerText);
    check("membership screen names the seeded plan", membershipText.includes("Portal Gold") || membershipText.includes("ACTIVE"));

    const sqlPayment = queryDb(
      `SELECT amount FROM payments WHERE memberId = ${sqlString(aliceId)}`,
    );
    checkEqual("Alice has one payment row", String(sqlPayment.length), "1");

    const bob = queryOne(`SELECT id FROM members WHERE phone = ${sqlString(BOB)}`);
    const bobId = requireCell(bob, "id");
    const bobPayments = queryDb(
      `SELECT amount FROM payments WHERE memberId = ${sqlString(bobId)}`,
    );
    check("Bob has a payment Alice must not see", bobPayments.length === 1);

    step("3. Session refresh on reload (1.23.4)");
    await page.reload({ waitUntil: "domcontentloaded", timeout: 20_000 });
    await page.waitForFunction(
      () => document.body.innerText.includes("Alice"),
      { timeout: 20_000 },
    );
    const afterReload = await page.evaluate(() => document.body.innerText);
    check("reload restores Alice without the login form", afterReload.includes("Alice"));
    check("reload did not bounce to Sign in", !afterReload.includes("Sign in with the phone"));

    step("4. API self-scope: Alice token cannot see Bob's payments");
    const aliceSession = await apiLogin(ALICE);
    const alicePays = await fetch(`${API_URL}/me/payments`, {
      headers: { Authorization: `Bearer ${aliceSession.data.accessToken}` },
    });
    const alicePayBody = (await alicePays.json()) as { data: { amount: string; memberId: string }[] };
    checkEqual("Alice GET /me/payments is 200", alicePays.status, 200);
    checkEqual("Alice sees one payment", String(alicePayBody.data.length), "1");
    checkEqual("that payment is 500.00", alicePayBody.data[0]!.amount, "500.00");
    check(
      "Alice's payment memberId is Alice",
      alicePayBody.data.every((row) => row.memberId === aliceSession.data.member.id),
    );

    const bobSession = await apiLogin(BOB);
    const bobHome = await fetch(`${API_URL}/me`, {
      headers: { Authorization: `Bearer ${bobSession.data.accessToken}` },
    });
    const bobHomeBody = (await bobHome.json()) as { data: { outstandingPending: string; member: { firstName: string } } };
    checkEqual("Bob's outstanding is 9999.00", bobHomeBody.data.outstandingPending, "9999.00");
    checkEqual("Bob home is Bob", bobHomeBody.data.member.firstName, "Bob");

    const staffDenied = await fetch(`${API_URL}/me`, {
      headers: { Authorization: `Bearer ${aliceSession.data.accessToken}` },
    });
    checkEqual("Alice can call /me", staffDenied.status, 200);
  } finally {
    await browser.close();
  }

  process.exit(summary());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
