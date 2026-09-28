/**
 * SA-R shell + org table — real Chrome at mobile / tablet / desktop widths.
 *
 *   1. MySQL + API + super-admin up
 *   2. pnpm e2e:responsive
 *
 * Does not replace Phase 15 / slice-b / slice-c.
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

const PLATFORM_EMAIL = process.env.E2E_PLATFORM_EMAIL ?? "platform@vedafit.test";
const PLATFORM_PASSWORD = process.env.E2E_PLATFORM_PASSWORD ?? "ChangeMe123!";

const VIEWPORTS = {
  mobile: { width: 375, height: 812 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1440, height: 900 },
} as const;

async function login(page: import("puppeteer-core").Page) {
  await page.goto(`${APP_URL}/login`, { waitUntil: "networkidle0" });
  await page.waitForSelector('input[type="password"]');
  await page.type('input[type="email"]', PLATFORM_EMAIL);
  await page.type('input[type="password"]', PLATFORM_PASSWORD);
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

async function shot(page: import("puppeteer-core").Page, name: string) {
  console.log(`  screenshot: ${await screenshot(page, name)}`);
}

async function main() {
  const browser = await launch();
  const page = await browser.newPage();
  forwardPageErrors(page);

  try {
    step("1. Mobile 375 — login, then drawer overlays; main is not squeezed");
    await page.setViewport(VIEWPORTS.mobile);
    await page.goto(`${APP_URL}/login`, { waitUntil: "networkidle0" });
    await page.waitForSelector("h1");
    await shot(page, "sa-r/login-375");
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
    await shot(page, "sa-r/shell-mobile-open");

    await page.$eval("[data-testid='sidebar-backdrop']", (el) => (el as HTMLButtonElement).click());
    await page.waitForFunction(() => !document.querySelector("[data-testid='sidebar-backdrop']"));
    check(
      "backdrop click closes the drawer",
      (await page.$("[data-testid='sidebar-backdrop']")) === null,
    );

    await page.click("[data-testid='sidebar-open']");
    await page.waitForSelector("[data-testid='sidebar-backdrop']");
    await page.$eval("[data-testid='app-sidebar'] a[href='/organizations']", (el) =>
      (el as HTMLAnchorElement).click(),
    );
    await page.waitForFunction(() => !document.querySelector("[data-testid='sidebar-backdrop']"));
    checkEqual("nav click closes the drawer", new URL(page.url()).pathname, "/organizations");
    await shot(page, "sa-r/shell-mobile-closed");

    step("2. Mobile 375 — topbar clusters do not overlap; select chrome has room for the arrow");
    const hamburgerBox = await boundingBox(page, "[data-testid='sidebar-open']");
    const nameBox = await boundingBox(page, "[data-testid='topbar-user-name']");
    const toggleBox = await boundingBox(page, "[data-testid='theme-toggle']");
    const signOutBox = await boundingBox(page, "[data-testid='sign-out']");
    check("hamburger does not overlap the user name", !boxesOverlap(hamburgerBox, nameBox));
    check("user name does not overlap theme toggle", !boxesOverlap(nameBox, toggleBox));
    check("theme toggle does not overlap Sign out", !boxesOverlap(toggleBox, signOutBox));
    check("user name does not overlap Sign out", !boxesOverlap(nameBox, signOutBox));
    check("hamburger does not overlap Sign out", !boxesOverlap(hamburgerBox, signOutBox));

    const selectPad = await page.$eval("select", (el) =>
      parseFloat(window.getComputedStyle(el).paddingRight),
    );
    check("filter select padding-right leaves room for the chevron", selectPad >= 32, `${selectPad}px`);

    step("3. Mobile 375 — Organizations table scrolls; first column sticks; fade marks overflow");
    await page.waitForSelector("[data-testid='organizations-table']");
    const orgs = await tableScroll(page, "organizations-table");
    check(
      "Organizations table is wider than its scrollport",
      !!orgs && orgs.scrollWidth > orgs.clientWidth + 1,
    );
    checkEqual("Organizations first column is sticky", orgs?.firstPosition, "sticky");
    check("Organizations fade is visible while more columns exist", orgs?.fade === true);
    await revealTable(page, "organizations-table");
    await shot(page, "sa-r/table-orgs-mobile");

    await scrollTableEnd(page, "organizations-table");
    const periodVisible = await page.$eval(
      "[data-testid='organizations-table'] th:last-child",
      (el) => {
        const r = el.getBoundingClientRect();
        return r.left < window.innerWidth && r.right > 0 && el.textContent?.trim() === "Period end";
      },
    );
    check("scrolling right reveals the Period end column", periodVisible);
    const orgsEnd = await tableScroll(page, "organizations-table");
    check("Organizations fade hides once scrolled to the end", orgsEnd?.fade === false);
    const orgColStillVisible = await page.evaluate(() => {
      const table = document.querySelector("[data-testid='organizations-table']");
      const scroller = table?.closest("[data-testid='data-table-scroll']");
      const th = table?.querySelector("th:first-child");
      if (!table || !scroller || !th) return false;
      const sr = scroller.getBoundingClientRect();
      const r = th.getBoundingClientRect();
      return (
        th.textContent?.trim() === "Organization" &&
        Math.abs(r.left - sr.left) < 3 &&
        r.right > sr.left + 24
      );
    });
    check(
      "Organization column stays visible while scrolled",
      orgColStillVisible,
      orgColStillVisible ? "" : "sticky left did not pin to the table scroller",
    );
    await shot(page, "sa-r/table-orgs-mobile-scrolled");

    step("4. Mobile 375 — remaining screens (login already visited; dashboard, detail, plans, new-org)");
    await page.goto(`${APP_URL}/`, { waitUntil: "networkidle0" });
    await page.waitForSelector("[data-testid='dashboard-heading']");
    check("dashboard does not horizontally overflow", !(await documentOverflows(page)));
    await shot(page, "sa-r/dashboard-375");

    await page.goto(`${APP_URL}/organizations`, { waitUntil: "networkidle0" });
    await page.waitForSelector("[data-testid='organizations-table'] a");
    await page.click("[data-testid='organizations-table'] a");
    await page.waitForSelector("[data-testid='org-name']", { timeout: 10_000 });
    check("org detail does not horizontally overflow", !(await documentOverflows(page)));
    const assignPad = await page.$eval(
      '::-p-xpath(//label[normalize-space()="SaaS plan"]/following::select[1])',
      (el) => parseFloat(window.getComputedStyle(el).paddingRight),
    );
    check("assign-plan select padding-right leaves room for the chevron", assignPad >= 32, `${assignPad}px`);
    await shot(page, "sa-r/org-detail-375");

    await page.goto(`${APP_URL}/plans`, { waitUntil: "networkidle0" });
    await page.waitForSelector("h1");
    check("plans does not horizontally overflow", !(await documentOverflows(page)));
    await shot(page, "sa-r/plans-375");

    await page.goto(`${APP_URL}/organizations/new`, { waitUntil: "networkidle0" });
    await page.waitForSelector("[data-testid='create-organization']");
    check("new-org does not horizontally overflow", !(await documentOverflows(page)));
    const createBox = await boundingBox(page, "[data-testid='create-organization']");
    check(
      "Create organization is in the viewport",
      createBox.right <= VIEWPORTS.mobile.width + 2 && createBox.x >= 0,
    );
    await shot(page, "sa-r/new-org-375");

    step("5. Tablet 768 — inline collapse persists across reload");
    await page.setViewport(VIEWPORTS.tablet);
    await page.goto(`${APP_URL}/organizations`, { waitUntil: "networkidle0" });
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
      "Organizations link has a tooltip title when collapsed",
      await page.$eval("a[href='/organizations']", (el) => el.getAttribute("title")),
      "Organizations",
    );
    checkEqual(
      "localStorage records collapsed",
      await page.evaluate(() => window.localStorage.getItem("vedafit.platform.sidebarCollapsed")),
      "1",
    );
    await shot(page, "sa-r/shell-tablet-collapsed");
    await shot(page, "sa-r/orgs-768");

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

    await page.goto(`${APP_URL}/`, { waitUntil: "networkidle0" });
    await shot(page, "sa-r/dashboard-768");
    await page.goto(`${APP_URL}/plans`, { waitUntil: "networkidle0" });
    await shot(page, "sa-r/plans-768");
    await page.goto(`${APP_URL}/organizations/new`, { waitUntil: "networkidle0" });
    await shot(page, "sa-r/new-org-768");
    await page.goto(`${APP_URL}/organizations`, { waitUntil: "networkidle0" });
    await page.click("[data-testid='organizations-table'] a");
    await page.waitForSelector("[data-testid='org-name']", { timeout: 10_000 });
    await shot(page, "sa-r/org-detail-768");
    await page.click("[data-testid='sign-out']");
    await page.waitForSelector('input[type="password"]', { timeout: 10_000 });
    await shot(page, "sa-r/login-768");
    await login(page);

    step("6. Desktop 1440 — collapse, brand palette, remaining screens");
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
      await page.evaluate(() => window.localStorage.getItem("vedafit.platform.sidebarCollapsed")),
      "1",
    );
    await shot(page, "sa-r/shell-desktop-collapsed");
    await shot(page, "sa-r/dashboard-1440");

    await page.goto(`${APP_URL}/organizations`, { waitUntil: "networkidle0" });
    await shot(page, "sa-r/orgs-1440");
    await page.click("[data-testid='organizations-table'] a");
    await page.waitForSelector("[data-testid='org-name']", { timeout: 10_000 });
    await shot(page, "sa-r/org-detail-1440");
    await page.goto(`${APP_URL}/plans`, { waitUntil: "networkidle0" });
    await shot(page, "sa-r/plans-1440");
    await page.goto(`${APP_URL}/organizations/new`, { waitUntil: "networkidle0" });
    await shot(page, "sa-r/new-org-1440");
    await page.click("[data-testid='sign-out']");
    await page.waitForSelector('input[type="password"]', { timeout: 10_000 });
    await shot(page, "sa-r/login-1440");
    await login(page);

    step("7. Mobile 375 light — theme toggle does not collide");
    await page.setViewport(VIEWPORTS.mobile);
    await page.goto(`${APP_URL}/organizations`, { waitUntil: "networkidle0" });
    await page.click("[data-testid='theme-toggle']");
    await page.waitForFunction(() => document.documentElement.getAttribute("data-theme") === "light");
    const lightHamburger = await boundingBox(page, "[data-testid='sidebar-open']");
    const lightName = await boundingBox(page, "[data-testid='topbar-user-name']");
    const lightToggle = await boundingBox(page, "[data-testid='theme-toggle']");
    const lightSignOut = await boundingBox(page, "[data-testid='sign-out']");
    check("light hamburger does not overlap name", !boxesOverlap(lightHamburger, lightName));
    check("light name does not overlap toggle", !boxesOverlap(lightName, lightToggle));
    check("light toggle does not overlap Sign out", !boxesOverlap(lightToggle, lightSignOut));
    await shot(page, "sa-r/orgs-375-light");

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
