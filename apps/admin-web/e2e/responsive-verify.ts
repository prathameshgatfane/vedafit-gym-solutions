/**
 * Shell + Wave 1 table verification — real Chrome at mobile / tablet / desktop widths.
 *
 *   1. MySQL + API + admin-web up
 *   2. pnpm e2e:responsive
 *
 * Does not replace phase3–13. Slice 1: drawer overlays at 375px; md+ collapse persists.
 * Wave 1: topbar clusters do not collide; Members/Plans/Expenses/Leads scroll with a
 * sticky first column and a right-edge fade.
 */
import {
  APP_URL,
  BRAND_RGB,
  check,
  checkEqual,
  computed,
  forwardPageErrors,
  launch,
  screenshot,
  step,
  summary,
} from "./lib/harness";

const OWNER_EMAIL = process.env.E2E_EMAIL ?? "owner@demo-gym.test";
const OWNER_PASSWORD = process.env.E2E_PASSWORD ?? "ChangeMe123!";

const VIEWPORTS = {
  mobile: { width: 375, height: 812 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1440, height: 900 },
} as const;

async function login(page: import("puppeteer-core").Page) {
  await page.goto(`${APP_URL}/login`, { waitUntil: "networkidle0" });
  await page.waitForSelector('input[type="password"]');
  await page.type('input[type="email"]', OWNER_EMAIL);
  await page.type('input[type="password"]', OWNER_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForSelector('[data-testid="app-shell"]', { timeout: 10_000 });
}

async function mainWidth(page: import("puppeteer-core").Page): Promise<number> {
  return page.$eval("main", (el) => el.getBoundingClientRect().width);
}

async function sidebarPosition(page: import("puppeteer-core").Page): Promise<string> {
  return page.$eval("[data-testid='app-sidebar']", (el) => window.getComputedStyle(el).position);
}

async function documentOverflows(page: import("puppeteer-core").Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
}

type Box = { x: number; y: number; right: number; bottom: number };

async function boundingBox(page: import("puppeteer-core").Page, selector: string): Promise<Box> {
  return page.$eval(selector, (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, right: r.right, bottom: r.bottom };
  });
}

function boxesOverlap(a: Box, b: Box): boolean {
  return !(a.right <= b.x + 1 || b.right <= a.x + 1 || a.bottom <= b.y + 1 || b.bottom <= a.y + 1);
}

async function tableScroll(page: import("puppeteer-core").Page, tableTestId: string) {
  return page.evaluate((id) => {
    const table = document.querySelector(`[data-testid="${id}"]`);
    const root = table?.closest("[data-testid='data-table']");
    const scroller = root?.querySelector("[data-testid='data-table-scroll']");
    const firstTh = table?.querySelector("th:first-child");
    if (!table || !scroller || !firstTh) return null;
    return {
      scrollWidth: (scroller as HTMLElement).scrollWidth,
      clientWidth: (scroller as HTMLElement).clientWidth,
      firstPosition: window.getComputedStyle(firstTh).position,
      fade: !!root?.querySelector("[data-testid='data-table-fade']"),
    };
  }, tableTestId);
}

async function revealTable(page: import("puppeteer-core").Page, tableTestId: string) {
  await page.$eval(`[data-testid='${tableTestId}']`, (el) => {
    el.scrollIntoView({ block: "center" });
  });
}

async function scrollTableEnd(page: import("puppeteer-core").Page, tableTestId: string) {
  await page.evaluate((id) => {
    const table = document.querySelector(`[data-testid="${id}"]`);
    const scroller = table
      ?.closest("[data-testid='data-table']")
      ?.querySelector("[data-testid='data-table-scroll']");
    if (scroller) (scroller as HTMLElement).scrollLeft = (scroller as HTMLElement).scrollWidth;
  }, tableTestId);
}

async function main() {
  const browser = await launch();
  const page = await browser.newPage();
  forwardPageErrors(page);

  try {
    // ------------------------------------------------------------------
    step("1. Mobile 375 — drawer overlays; main is not squeezed");
    // ------------------------------------------------------------------
    await page.setViewport(VIEWPORTS.mobile);
    await login(page);

    checkEqual("sidebar is position:fixed (out of flow)", await sidebarPosition(page), "fixed");
    const mobileMain = await mainWidth(page);
    check(
      "main uses nearly the full viewport (sidebar is not eating 240px)",
      mobileMain >= VIEWPORTS.mobile.width - 32,
      `${mobileMain}px wide in a ${VIEWPORTS.mobile.width}px viewport`,
    );
    check("page does not horizontally overflow", !(await documentOverflows(page)));
    checkEqual(
      "hamburger aria-expanded starts false",
      await page.$eval("[data-testid='sidebar-open']", (el) => el.getAttribute("aria-expanded")),
      "false",
    );
    check(
      "backdrop is absent until opened",
      (await page.$("[data-testid='sidebar-backdrop']")) === null,
    );

    await page.click("[data-testid='sidebar-open']");
    await page.waitForSelector("[data-testid='sidebar-backdrop']");
    checkEqual(
      "hamburger aria-expanded is true when open",
      await page.$eval("[data-testid='sidebar-open']", (el) => el.getAttribute("aria-expanded")),
      "true",
    );
    const mainWhileOpen = await mainWidth(page);
    check(
      "opening the drawer does not shrink main",
      Math.abs(mainWhileOpen - mobileMain) < 2,
      `${mobileMain} → ${mainWhileOpen}`,
    );
    checkEqual(
      "sidebar surface is brand.black-88",
      await computed(page, "[data-testid='app-sidebar']", "background-color"),
      BRAND_RGB.black88,
    );
    console.log(`  screenshot: ${await screenshot(page, "responsive/shell-mobile-open")}`);

    await page.click("[data-testid='sidebar-backdrop']");
    await page.waitForFunction(() => !document.querySelector("[data-testid='sidebar-backdrop']"));
    check(
      "backdrop click closes the drawer",
      (await page.$("[data-testid='sidebar-backdrop']")) === null,
    );

    await page.click("[data-testid='sidebar-open']");
    await page.waitForSelector("[data-testid='sidebar-backdrop']");
    await page.$eval("[data-testid='app-sidebar'] a[href='/members']", (el) =>
      (el as HTMLAnchorElement).click(),
    );
    await page.waitForFunction(() => !document.querySelector("[data-testid='sidebar-backdrop']"));
    checkEqual("nav click closes the drawer", new URL(page.url()).pathname, "/members");
    console.log(`  screenshot: ${await screenshot(page, "responsive/shell-mobile-closed")}`);

    // ------------------------------------------------------------------
    step("2. Mobile 375 — topbar clusters do not overlap; select chrome has room for the arrow");
    // ------------------------------------------------------------------
    const branchBox = await boundingBox(page, "[aria-label='Active branch']");
    const nameBox = await boundingBox(page, "[data-testid='topbar-user-name']");
    const signOutBox = await boundingBox(page, "[data-testid='sign-out']");
    const hamburgerBox = await boundingBox(page, "[data-testid='sidebar-open']");
    check("hamburger does not overlap the branch control", !boxesOverlap(hamburgerBox, branchBox));
    check("branch control does not overlap the user name", !boxesOverlap(branchBox, nameBox));
    check("user name does not overlap Sign out", !boxesOverlap(nameBox, signOutBox));
    check("branch control does not overlap Sign out", !boxesOverlap(branchBox, signOutBox));
    const selectPad = await page.$eval(
      "[data-testid='members-filter-bar'] select",
      (el) => parseFloat(window.getComputedStyle(el).paddingRight),
    );
    check("filter select padding-right leaves room for the chevron", selectPad >= 32, `${selectPad}px`);

    // ------------------------------------------------------------------
    step("3. Mobile 375 — Members table scrolls; first column sticks; fade marks the overflow");
    // ------------------------------------------------------------------
    await page.waitForSelector("[data-testid='members-table']");
    const members = await tableScroll(page, "members-table");
    check("Members table is wider than its scrollport", !!members && members.scrollWidth > members.clientWidth + 1);
    checkEqual("Members first column is sticky", members?.firstPosition, "sticky");
    check("Members fade is visible while more columns exist", members?.fade === true);
    await revealTable(page, "members-table");
    console.log(`  screenshot: ${await screenshot(page, "responsive/table-members-mobile")}`);

    await scrollTableEnd(page, "members-table");
    const addedVisible = await page.$eval(
      "[data-testid='members-table'] th:last-child",
      (el) => {
        const r = el.getBoundingClientRect();
        return r.left < window.innerWidth && r.right > 0 && el.textContent?.trim() === "Added";
      },
    );
    check("scrolling right reveals the Added column", addedVisible);
    const membersEnd = await tableScroll(page, "members-table");
    check("Members fade hides once scrolled to the end", membersEnd?.fade === false);

    // ------------------------------------------------------------------
    step("4. Mobile 375 — Wave 1 tables (Plans, Expenses, Leads); action buttons reachable");
    // ------------------------------------------------------------------
    await page.goto(`${APP_URL}/membership-plans`, { waitUntil: "networkidle0" });
    await page.waitForSelector("[data-testid='plans-table']");
    const plans = await tableScroll(page, "plans-table");
    check("Plans table overflows its scrollport", !!plans && plans.scrollWidth > plans.clientWidth + 1);
    checkEqual("Plans first column is sticky", plans?.firstPosition, "sticky");
    check("Plans fade is visible at rest", plans?.fade === true);
    await revealTable(page, "plans-table");
    console.log(`  screenshot: ${await screenshot(page, "responsive/table-plans-mobile")}`);
    await scrollTableEnd(page, "plans-table");
    const editReached = await page.evaluate(() => {
      const btn = [...document.querySelectorAll("[data-testid='plans-table'] button")].find(
        (el) => el.textContent?.trim() === "Edit",
      );
      if (!btn) return false;
      const r = btn.getBoundingClientRect();
      return r.left >= 0 && r.right <= window.innerWidth + 2;
    });
    check("Plans Edit button is in view after scrolling", editReached);

    await page.goto(`${APP_URL}/expenses`, { waitUntil: "networkidle0" });
    await page.waitForSelector("[data-testid='expenses-table']");
    const expenses = await tableScroll(page, "expenses-table");
    check("Expenses table overflows its scrollport", !!expenses && expenses.scrollWidth > expenses.clientWidth + 1);
    checkEqual("Expenses first column is sticky", expenses?.firstPosition, "sticky");
    check("Expenses fade is visible at rest", expenses?.fade === true);
    await revealTable(page, "expenses-table");
    console.log(`  screenshot: ${await screenshot(page, "responsive/table-expenses-mobile")}`);
    await scrollTableEnd(page, "expenses-table");
    const deleteReached = await page.evaluate(() => {
      const btn = document.querySelector("[data-testid='delete-expense']");
      if (!btn) return false;
      const r = btn.getBoundingClientRect();
      return r.left >= 0 && r.right <= window.innerWidth + 2;
    });
    check("Expenses Delete button is in view after scrolling", deleteReached);

    await page.goto(`${APP_URL}/leads`, { waitUntil: "networkidle0" });
    await page.waitForSelector("[data-testid='leads-table']");
    const leads = await tableScroll(page, "leads-table");
    check("Leads table overflows its scrollport", !!leads && leads.scrollWidth > leads.clientWidth + 1);
    checkEqual("Leads first column is sticky", leads?.firstPosition, "sticky");
    check("Leads fade is visible at rest", leads?.fade === true);
    await revealTable(page, "leads-table");
    console.log(`  screenshot: ${await screenshot(page, "responsive/table-leads-mobile")}`);

    // ------------------------------------------------------------------
    step("5. Mobile 375 — Wave 2 tables (same wrapper, louder fade)");
    // ------------------------------------------------------------------
    const wave2 = [
      { path: "/memberships", testId: "memberships-table", shot: "table-memberships-mobile" },
      { path: "/attendance", testId: "attendance-table", shot: "table-attendance-mobile" },
      { path: "/trainers", testId: "trainers-table", shot: "table-trainers-mobile" },
      { path: "/invoices", testId: "invoices-table", shot: "table-invoices-mobile" },
      { path: "/payments", testId: "payments-table", shot: "table-payments-mobile" },
      { path: "/notifications", testId: "notifications-table", shot: "table-notifications-mobile" },
    ] as const;

    for (const row of wave2) {
      await page.goto(`${APP_URL}${row.path}`, { waitUntil: "networkidle0" });
      await page.waitForSelector(`[data-testid='${row.testId}']`);
      const metrics = await tableScroll(page, row.testId);
      check(
        `${row.testId} overflows its scrollport`,
        !!metrics && metrics.scrollWidth > metrics.clientWidth + 1,
      );
      checkEqual(`${row.testId} first column is sticky`, metrics?.firstPosition, "sticky");
      check(`${row.testId} fade is visible at rest`, metrics?.fade === true);
      await revealTable(page, row.testId);
      console.log(`  screenshot: ${await screenshot(page, `responsive/${row.shot}`)}`);
      if (row.testId === "trainers-table") {
        await scrollTableEnd(page, "trainers-table");
        const editReached = await page.evaluate(() => {
          const btn = [...document.querySelectorAll("[data-testid='trainers-table'] button")].find(
            (el) => el.textContent?.trim() === "Edit",
          );
          if (!btn) return false;
          const r = btn.getBoundingClientRect();
          return r.left >= 0 && r.right <= window.innerWidth + 2;
        });
        check("Trainers Edit button is in view after scrolling", editReached);
      }
    }

    await page.goto(`${APP_URL}/reports`, { waitUntil: "networkidle0" });
    await page.waitForSelector("[data-testid='pnl-categories']");
    const pnl = await tableScroll(page, "pnl-categories");
    checkEqual("P&L first column is sticky", pnl?.firstPosition, "sticky");
    await revealTable(page, "pnl-categories");
    console.log(`  screenshot: ${await screenshot(page, "responsive/table-pnl-mobile")}`);

    await page.goto(`${APP_URL}/members`, { waitUntil: "networkidle0" });
    await page.waitForSelector("[data-testid='members-table'] a");
    await page.click("[data-testid='members-table'] a");
    await page.waitForSelector("[data-testid='member-invoices']");
    const billing = await tableScroll(page, "member-invoices");
    check(
      "member-invoices overflows its scrollport",
      !!billing && billing.scrollWidth > billing.clientWidth + 1,
    );
    checkEqual("member-invoices first column is sticky", billing?.firstPosition, "sticky");
    check("member-invoices fade is visible at rest", billing?.fade === true);
    await revealTable(page, "member-invoices");
    console.log(`  screenshot: ${await screenshot(page, "responsive/table-member-billing-mobile")}`);

    await page.goto(`${APP_URL}/invoices`, { waitUntil: "networkidle0" });
    await page.waitForSelector("[data-testid='invoices-table']");
    await page.click("[data-testid='invoices-table'] tbody tr");
    await page.waitForSelector("[data-testid='payment-history']");
    const history = await tableScroll(page, "payment-history");
    checkEqual("payment-history first column is sticky", history?.firstPosition, "sticky");
    if (history && history.scrollWidth > history.clientWidth + 1) {
      check("payment-history fade is visible when it overflows", history.fade === true);
    }
    await revealTable(page, "payment-history");
    console.log(`  screenshot: ${await screenshot(page, "responsive/table-payment-history-mobile")}`);

    // ------------------------------------------------------------------
    step("6. Tablet 768 — inline collapse persists across reload");
    // ------------------------------------------------------------------
    await page.setViewport(VIEWPORTS.tablet);
    await page.goto(`${APP_URL}/`, { waitUntil: "networkidle0" });
    await page.waitForSelector("[data-testid='app-sidebar']");

    checkEqual("sidebar is in flow on tablet", await sidebarPosition(page), "static");
    check(
      "hamburger is not shown at md+",
      await page.$eval("[data-testid='sidebar-open']", (el) => window.getComputedStyle(el).display === "none"),
    );

    await page.click("[data-testid='sidebar-toggle']");
    checkEqual(
      "toggle aria-expanded is false after collapse",
      await page.$eval("[data-testid='sidebar-toggle']", (el) => el.getAttribute("aria-expanded")),
      "false",
    );
    checkEqual(
      "Members link has a tooltip title when collapsed",
      await page.$eval("a[href='/members']", (el) => el.getAttribute("title")),
      "Members",
    );
    const stored = await page.evaluate(() => window.localStorage.getItem("vedafit.admin.sidebarCollapsed"));
    checkEqual("localStorage records collapsed", stored, "1");
    console.log(`  screenshot: ${await screenshot(page, "responsive/shell-tablet-collapsed")}`);

    await page.reload({ waitUntil: "networkidle0" });
    await page.waitForSelector("[data-testid='sidebar-toggle']");
    checkEqual(
      "collapse survives reload",
      await page.$eval("[data-testid='sidebar-toggle']", (el) => el.getAttribute("aria-expanded")),
      "false",
    );

    await page.click("[data-testid='sidebar-toggle']");
    checkEqual(
      "expand restores aria-expanded",
      await page.$eval("[data-testid='sidebar-toggle']", (el) => el.getAttribute("aria-expanded")),
      "true",
    );

    // ------------------------------------------------------------------
    step("7. Desktop 1440 — collapse, brand palette, sign-out still targetable");
    // ------------------------------------------------------------------
    await page.setViewport(VIEWPORTS.desktop);
    await page.goto(`${APP_URL}/`, { waitUntil: "networkidle0" });
    await page.waitForSelector("[data-testid='app-shell']");

    checkEqual("sidebar is in flow on desktop", await sidebarPosition(page), "static");
    checkEqual(
      "page background is brand.black",
      await computed(page, "[data-testid='app-shell']", "background-color"),
      BRAND_RGB.black,
    );
    check(
      "sign-out is its own test id (not the first topbar button)",
      (await page.$("[data-testid='sign-out']")) !== null,
    );
    await page.click("[data-testid='sidebar-toggle']");
    checkEqual(
      "desktop collapse writes localStorage",
      await page.evaluate(() => window.localStorage.getItem("vedafit.admin.sidebarCollapsed")),
      "1",
    );
    console.log(`  screenshot: ${await screenshot(page, "responsive/shell-desktop-collapsed")}`);

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
