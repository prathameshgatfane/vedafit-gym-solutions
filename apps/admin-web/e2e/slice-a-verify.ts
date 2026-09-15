/**
 * Slice A — admin-web light/dark tokens + toggle. Super Admin is Slice B; do not run that here.
 *
 * Headed Chrome, computed styles. Dark must still match Section 1.14. Light must meet AA 4.5:1
 * and must not paint lime `#C9FF1F` as body/link/heading text.
 *
 *   API + admin-web up, then:
 *   E2E_HEADFUL=1 pnpm e2e:slice-a
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
  screenshot,
  step,
  summary,
} from "./lib/harness";

const OWNER = { email: "owner@demo-gym.test", password: "ChangeMe123!" };
const AA_NORMAL = 4.5;
const THEME_KEY = "vedafit.admin.theme";
const LIME = { r: 201, g: 255, b: 31 };
const LIGHT = {
  bg: "rgb(254, 249, 245)",
  surface: "rgb(255, 255, 255)",
  fg: "rgb(20, 20, 20)",
  fgMuted: "rgb(92, 88, 84)",
  accentText: "rgb(61, 77, 0)",
} as const;

function parseRgb(css: string): { r: number; g: number; b: number; a: number } | null {
  const comma = css.trim().match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i);
  if (comma) {
    return {
      r: Number(comma[1]),
      g: Number(comma[2]),
      b: Number(comma[3]),
      a: comma[4] === undefined ? 1 : Number(comma[4]),
    };
  }
  const space = css.trim().match(/^rgba?\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/i);
  if (!space) return null;
  const aRaw = space[4];
  let a = 1;
  if (aRaw !== undefined) a = aRaw.endsWith("%") ? Number(aRaw.slice(0, -1)) / 100 : Number(aRaw);
  return { r: Number(space[1]), g: Number(space[2]), b: Number(space[3]), a };
}

function srgbChannel(n: number): number {
  const s = n / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance(r: number, g: number, b: number): number {
  return 0.2126 * srgbChannel(r) + 0.7152 * srgbChannel(g) + 0.0722 * srgbChannel(b);
}

function contrastRatio(fg: { r: number; g: number; b: number }, bg: { r: number; g: number; b: number }): number {
  const l1 = luminance(fg.r, fg.g, fg.b);
  const l2 = luminance(bg.r, bg.g, bg.b);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

function composite(
  fg: { r: number; g: number; b: number; a: number },
  bg: { r: number; g: number; b: number },
): { r: number; g: number; b: number } {
  const a = Math.min(1, Math.max(0, fg.a));
  return {
    r: fg.r * a + bg.r * (1 - a),
    g: fg.g * a + bg.g * (1 - a),
    b: fg.b * a + bg.b * (1 - a),
  };
}

function isRgb(css: string, r: number, g: number, b: number, aMin = 0.99): boolean {
  const parsed = parseRgb(css);
  if (!parsed) return false;
  return (
    parsed.a >= aMin &&
    Math.round(parsed.r) === r &&
    Math.round(parsed.g) === g &&
    Math.round(parsed.b) === b
  );
}

function isLime(css: string): boolean {
  return isRgb(css, LIME.r, LIME.g, LIME.b);
}

async function paintedBackground(page: Page, selector: string): Promise<{ r: number; g: number; b: number; css: string }> {
  return page.$eval(selector, (el) => {
    let node: Element | null = el;
    while (node) {
      const bg = window.getComputedStyle(node).backgroundColor;
      const m = bg.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i);
      if (m) {
        const aRaw = m[4];
        let a = 1;
        if (aRaw !== undefined) a = aRaw.endsWith("%") ? Number(aRaw.slice(0, -1)) / 100 : Number(aRaw);
        if (a > 0.99) return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), css: bg };
      }
      node = node.parentElement;
    }
    return { r: 0, g: 0, b: 0, css: "rgb(0, 0, 0)" };
  });
}

async function assertContrast(
  page: Page,
  label: string,
  selector: string,
  options: { placeholder?: boolean; fill?: boolean } = {},
): Promise<string> {
  const bg = await paintedBackground(page, selector);
  const colorCss = options.placeholder
    ? await page.$eval(selector, (el) => window.getComputedStyle(el, "::placeholder").color)
    : options.fill
      ? await computed(page, selector, "fill")
      : await computed(page, selector, "color");
  const parsed = parseRgb(colorCss);
  if (!parsed) {
    check(`${label} has parseable color`, false, colorCss);
    return colorCss;
  }
  const fg = composite(parsed, bg);
  const ratio = contrastRatio(fg, bg);
  check(
    `${label} contrast ≥ ${AA_NORMAL}:1`,
    ratio + 1e-9 >= AA_NORMAL,
    `${ratio.toFixed(2)}:1  fg ${colorCss} on ${bg.css}`,
  );
  return colorCss;
}

async function themeAttr(page: Page): Promise<string | null> {
  return page.evaluate(() => document.documentElement.getAttribute("data-theme"));
}

async function storedTheme(page: Page): Promise<string | null> {
  return page.evaluate((key) => window.localStorage.getItem(key), THEME_KEY);
}

async function loginAdmin(page: Page) {
  await page.goto(`${APP_URL}/login`, { waitUntil: "networkidle0" });
  await page.waitForSelector('input[type="password"]');
  await page.type('input[type="email"]', OWNER.email);
  await page.type('input[type="password"]', OWNER.password);
  await page.click('button[type="submit"]');
  await page.waitForSelector('[data-testid="app-shell"]', { timeout: 10_000 });
}

async function shot(page: Page, name: string, width: number, height: number) {
  await page.setViewport({ width, height });
  await new Promise((r) => setTimeout(r, 400));
  await screenshot(page, name);
}

async function main() {
  const browser = await launch();
  const page = await browser.newPage();
  forwardPageErrors(page);

  try {
    step("1. First visit is dark — no prefers-color-scheme, no storage key");
    await page.goto(`${APP_URL}/login`, { waitUntil: "networkidle0" });
    await page.waitForSelector("h1");
    checkEqual("data-theme is dark", await themeAttr(page), "dark");
    checkEqual("theme key absent", await storedTheme(page), null);
    checkEqual("body is 1.14 black", await computed(page, "body", "background-color"), BRAND_RGB.black);
    checkEqual("heading is 1.14 white", await computed(page, "h1", "color"), BRAND_RGB.white);
    checkEqual("subtitle is 1.14 green-muted", await computed(page, "div.max-w-sm > p", "color"), BRAND_RGB.greenMuted);
    checkEqual("Sign in fill is 1.14 lime", await computed(page, 'button[type="submit"]', "background-color"), BRAND_RGB.green);
    checkEqual("Sign in label is black", await computed(page, 'button[type="submit"]', "color"), BRAND_RGB.black);

    step("2. Dark theme — screenshot targets still AA, lime is fill not muted text");
    await loginAdmin(page);
    await page.goto(`${APP_URL}/memberships?status=ACTIVE`, { waitUntil: "networkidle0" });
    await page.waitForSelector('[data-testid="member-phone"]', { timeout: 10_000 });
    const darkPhone = await assertContrast(page, "dark phone", '[data-testid="member-phone"]');
    check("dark phone is Slice 0 muted, not lime", isRgb(darkPhone, 201, 196, 191), darkPhone);
    await assertContrast(page, "dark placeholder", 'input[placeholder="Member name or phone"]', {
      placeholder: true,
    });

    step("3. Toggle to light, persist, do not use lime as text");
    await page.click('[data-testid="theme-toggle"]');
    await page.waitForFunction(() => document.documentElement.getAttribute("data-theme") === "light");
    checkEqual("data-theme is light", await themeAttr(page), "light");
    checkEqual(`localStorage ${THEME_KEY}`, await storedTheme(page), "light");
    checkEqual(
      "toggle aria-pressed is true in light",
      await page.$eval('[data-testid="theme-toggle"]', (el) => el.getAttribute("aria-pressed")),
      "true",
    );

    const lightPhone = await assertContrast(page, "light phone", '[data-testid="member-phone"]');
    check("light phone is fg-muted candidate", isRgb(lightPhone, 92, 88, 84), lightPhone);
    check("light phone is NOT lime", !isLime(lightPhone), lightPhone);

    const lightHeading = await assertContrast(page, "light Memberships heading", "h1");
    check("light heading is fg, not lime", isRgb(lightHeading, 20, 20, 20), lightHeading);

    const lightPlaceholder = await assertContrast(
      page,
      "light memberships placeholder",
      'input[placeholder="Member name or phone"]',
      { placeholder: true },
    );
    check("light placeholder is NOT lime", !isLime(lightPlaceholder), lightPlaceholder);

    const badgeColor = await computed(page, '[data-testid="status-badge"]', "color");
    check("ACTIVE badge text is NOT lime in light", !isLime(badgeColor), badgeColor);
    await assertContrast(page, "light ACTIVE badge text", '[data-testid="status-badge"]');

    await page.goto(`${APP_URL}/invoices?status=UNPAID`, { waitUntil: "networkidle0" });
    await page.waitForSelector('[data-testid="invoice-pending"]', { timeout: 10_000 });
    const warningColor = await computed(page, '[data-testid="invoice-pending"]', "color");
    check("light warning/amber is NOT lime", !isLime(warningColor), warningColor);
    check("light warning is the locked darker amber", isRgb(warningColor, 146, 64, 14), warningColor);
    await assertContrast(page, "light warning/amber pending amount", '[data-testid="invoice-pending"]');

    await page.goto(`${APP_URL}/payments`, { waitUntil: "networkidle0" });
    const failedSelector =
      '::-p-xpath(//span[@data-testid="status-badge"][normalize-space()="FAILED"])';
    await page.waitForSelector(failedSelector, { timeout: 10_000 });
    const dangerColor = await computed(page, failedSelector, "color");
    check("light danger/red is NOT lime", !isLime(dangerColor), dangerColor);
    check("light danger is the locked darker red", isRgb(dangerColor, 155, 28, 28), dangerColor);
    await assertContrast(page, "light FAILED badge", failedSelector);

    step("4. Dashboard chart re-themes — line stays lime fill, ticks follow fg");
    await page.goto(`${APP_URL}/`, { waitUntil: "networkidle0" });
    await page.waitForSelector("[data-testid=widget-revenue-trend]", { timeout: 10_000 });
    const subtitle = await computed(page, '[data-testid="dashboard-heading"] + p', "color");
    check("light dashboard subtitle is accent-text, not lime", isRgb(subtitle, 61, 77, 0), subtitle);
    await assertContrast(page, "light dashboard subtitle", '[data-testid="dashboard-heading"] + p');

    const metric = await computed(page, "[data-testid=widget-members-value]", "color");
    check("light metric value is NOT lime (lime is fill-only)", !isLime(metric), metric);
    await assertContrast(page, "light metric value", "[data-testid=widget-members-value]");

    const signInLike = await computed(page, 'nav a[aria-current="page"]', "background-color");
    check("light active nav is still lime fill", isLime(signInLike), signInLike);
    checkEqual(
      "light active nav label is black",
      await computed(page, 'nav a[aria-current="page"]', "color"),
      BRAND_RGB.black,
    );

    const chartStroke = await page.$eval("[data-testid=revenue-chart]", (el) => {
      const curve =
        el.querySelector(".recharts-area-curve") ??
        [...el.querySelectorAll("path")].find((path) => {
          const stroke = path.getAttribute("stroke");
          return Boolean(stroke && stroke !== "none");
        });
      return curve?.getAttribute("stroke") ?? "";
    });
    check("chart area stroke is still lime (data mark, not text)", isLime(chartStroke), chartStroke);

    const tickFill = await assertContrast(
      page,
      "light chart axis tick",
      ".recharts-cartesian-axis-tick-value",
      { fill: true },
    );
    check("light chart tick is fg-muted, not lime / not alpha cream", isRgb(tickFill, 92, 88, 84), tickFill);

    const bodyLight = await computed(page, "body", "background-color");
    checkEqual("light body is cream", bodyLight, LIGHT.bg);

    step("5. Reload keeps light");
    await page.reload({ waitUntil: "networkidle0" });
    await page.waitForSelector('[data-testid="dashboard-heading"]', { timeout: 10_000 });
    checkEqual("data-theme still light after reload", await themeAttr(page), "light");
    checkEqual("storage still light after reload", await storedTheme(page), "light");
    checkEqual("heading still light fg after reload", await computed(page, "h1", "color"), LIGHT.fg);

    step("6. Light screenshots — login, dashboard, memberships, members at 375 / 768 / 1440");
    const widths: [number, number][] = [
      [375, 812],
      [768, 1024],
      [1440, 900],
    ];
    for (const [width, height] of widths) {
      await page.goto(`${APP_URL}/`, { waitUntil: "networkidle0" });
      await page.waitForSelector('[data-testid="dashboard-heading"]');
      await shot(page, `slice-a-dashboard-${width}`, width, height);

      await page.goto(`${APP_URL}/memberships`, { waitUntil: "networkidle0" });
      await page.waitForSelector("h1");
      await shot(page, `slice-a-memberships-${width}`, width, height);

      await page.goto(`${APP_URL}/members`, { waitUntil: "networkidle0" });
      await page.waitForSelector("h1");
      await shot(page, `slice-a-members-${width}`, width, height);
    }

    await page.click('[data-testid="sign-out"]');
    await page.waitForSelector('input[type="password"]', { timeout: 10_000 });
    checkEqual("login page stays light after sign-out", await themeAttr(page), "light");
    const loginHeading = await computed(page, "h1", "color");
    check("light login heading is NOT lime", !isLime(loginHeading), loginHeading);
    await assertContrast(page, "light login heading", "h1");
    checkEqual(
      "light login Sign in fill is still lime",
      await computed(page, 'button[type="submit"]', "background-color"),
      BRAND_RGB.green,
    );
    for (const [width, height] of widths) {
      await shot(page, `slice-a-login-${width}`, width, height);
    }
  } finally {
    await browser.close();
  }

  process.exit(summary());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
