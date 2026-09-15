/**
 * Slice C — combined theme smoke across both apps. Not a third copy of slice-a / slice-b.
 *
 * Those two own the per-app matrix (chart ticks, status-color variants, 375/768/1440 shots).
 * This script adds what only a dual-origin pass can prove, in one Chrome session:
 *
 *   1. Keys stay isolated: toggling admin-web writes `vedafit.admin.theme` and does not
 *      create `vedafit.platform.theme` on :5174 (and the reverse).
 *   2. Token parity: both `index.css` copies still resolve to the locked Slice A RGBs.
 *   3. Dark default + light AA + persist, sampled once per app (not the full A/B surface).
 *
 *   API + admin-web :5173 + super-admin :5174, then:
 *   E2E_HEADFUL=1 pnpm e2e:theme
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
const PLATFORM = { email: "platform@vedafit.test", password: "ChangeMe123!" };
const SUPER_URL = process.env.E2E_SUPER_URL ?? "http://localhost:5174";
const AA_NORMAL = 4.5;
const ADMIN_KEY = "vedafit.admin.theme";
const PLATFORM_KEY = "vedafit.platform.theme";
const LIME = { r: 201, g: 255, b: 31 };
const LIGHT = {
  bg: "rgb(254, 249, 245)",
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
  options: { placeholder?: boolean } = {},
): Promise<string> {
  const bg = await paintedBackground(page, selector);
  const colorCss = options.placeholder
    ? await page.$eval(selector, (el) => window.getComputedStyle(el, "::placeholder").color)
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

async function stored(page: Page, key: string): Promise<string | null> {
  return page.evaluate((k) => window.localStorage.getItem(k), key);
}

async function loginAdmin(page: Page) {
  await page.goto(`${APP_URL}/login`, { waitUntil: "networkidle0" });
  await page.waitForSelector('input[type="password"]');
  await page.type('input[type="email"]', OWNER.email);
  await page.type('input[type="password"]', OWNER.password);
  await page.click('button[type="submit"]');
  await page.waitForSelector('[data-testid="app-shell"]', { timeout: 10_000 });
}

async function loginPlatform(page: Page) {
  await page.goto(`${SUPER_URL}/login`, { waitUntil: "networkidle0" });
  await page.waitForSelector('input[type="password"]');
  await page.type('input[type="email"]', PLATFORM.email);
  await page.type('input[type="password"]', PLATFORM.password);
  await page.click('button[type="submit"]');
  await page.waitForSelector('[data-testid="app-shell"]', { timeout: 10_000 });
}

async function main() {
  const browser = await launch();
  const page = await browser.newPage();
  forwardPageErrors(page);

  try {
    step("1. Admin-web first visit is dark — own key, not the platform key");
    await page.goto(`${APP_URL}/login`, { waitUntil: "networkidle0" });
    await page.waitForSelector("h1");
    checkEqual("admin data-theme is dark", await themeAttr(page), "dark");
    checkEqual("vedafit.admin.theme absent", await stored(page, ADMIN_KEY), null);
    checkEqual("vedafit.platform.theme absent on admin origin", await stored(page, PLATFORM_KEY), null);
    checkEqual("admin body is 1.14 black", await computed(page, "body", "background-color"), BRAND_RGB.black);

    step("2. Admin-web dark sample + toggle to light, persist");
    await loginAdmin(page);
    await page.goto(`${APP_URL}/memberships?status=ACTIVE`, { waitUntil: "networkidle0" });
    await page.waitForSelector('[data-testid="member-phone"]', { timeout: 10_000 });
    const darkPhone = await assertContrast(page, "admin dark phone", '[data-testid="member-phone"]');
    check("admin dark phone is Slice 0 muted", isRgb(darkPhone, 201, 196, 191), darkPhone);

    await page.click('[data-testid="theme-toggle"]');
    await page.waitForFunction(() => document.documentElement.getAttribute("data-theme") === "light");
    checkEqual("admin data-theme is light", await themeAttr(page), "light");
    checkEqual(`localStorage ${ADMIN_KEY}`, await stored(page, ADMIN_KEY), "light");
    checkEqual("platform key still absent on admin origin", await stored(page, PLATFORM_KEY), null);
    checkEqual("admin body is cream", await computed(page, "body", "background-color"), LIGHT.bg);

    const adminHeading = await assertContrast(page, "admin light heading", "h1");
    check("admin light heading is fg, not lime", isRgb(adminHeading, 20, 20, 20), adminHeading);
    const adminPhone = await assertContrast(page, "admin light phone", '[data-testid="member-phone"]');
    check("admin light phone is locked fg-muted", isRgb(adminPhone, 92, 88, 84), adminPhone);
    check("admin light phone is not lime", !isLime(adminPhone), adminPhone);
    const adminPlaceholder = await assertContrast(
      page,
      "admin light placeholder",
      'input[placeholder="Member name or phone"]',
      { placeholder: true },
    );
    check("admin light placeholder is fg-muted", isRgb(adminPlaceholder, 92, 88, 84), adminPlaceholder);
    checkEqual(
      "admin Sign in-like primary is still lime fill",
      await computed(page, 'nav a[aria-current="page"]', "background-color"),
      BRAND_RGB.green,
    );

    await page.reload({ waitUntil: "networkidle0" });
    await page.waitForSelector("h1");
    checkEqual("admin still light after reload", await themeAttr(page), "light");
    checkEqual("admin storage still light after reload", await stored(page, ADMIN_KEY), "light");
    await screenshot(page, "slice-c-admin-memberships-light");

    step("3. Super Admin in the same browser is still dark — keys do not leak across origins");
    await page.goto(`${SUPER_URL}/login`, { waitUntil: "networkidle0" });
    await page.waitForSelector("h1");
    checkEqual("platform data-theme is dark (admin light must not leak)", await themeAttr(page), "dark");
    checkEqual("vedafit.platform.theme absent", await stored(page, PLATFORM_KEY), null);
    checkEqual("vedafit.admin.theme absent on platform origin", await stored(page, ADMIN_KEY), null);
    checkEqual("platform body is 1.14 black", await computed(page, "body", "background-color"), BRAND_RGB.black);

    step("4. Super Admin dark sample + toggle to light, persist");
    await loginPlatform(page);
    await page.goto(`${SUPER_URL}/organizations`, { waitUntil: "networkidle0" });
    await page.waitForSelector("h1");
    await assertContrast(page, "platform dark heading", "h1");
    const darkLink = await assertContrast(page, "platform dark Demo Gym link", '::-p-xpath(//a[normalize-space()="Demo Gym"])');
    check("platform dark link is lime", isLime(darkLink), darkLink);

    await page.click('[data-testid="theme-toggle"]');
    await page.waitForFunction(() => document.documentElement.getAttribute("data-theme") === "light");
    checkEqual("platform data-theme is light", await themeAttr(page), "light");
    checkEqual(`localStorage ${PLATFORM_KEY}`, await stored(page, PLATFORM_KEY), "light");
    checkEqual("admin key still absent on platform origin", await stored(page, ADMIN_KEY), null);
    checkEqual("platform body is cream", await computed(page, "body", "background-color"), LIGHT.bg);

    const platformHeading = await assertContrast(page, "platform light heading", "h1");
    check("platform light heading is fg, not lime", isRgb(platformHeading, 20, 20, 20), platformHeading);
    const platformLink = await assertContrast(
      page,
      "platform light Demo Gym link",
      '::-p-xpath(//a[normalize-space()="Demo Gym"])',
    );
    check("platform light link is locked accent-text", isRgb(platformLink, 61, 77, 0), platformLink);
    const platformPlaceholder = await assertContrast(
      page,
      "platform light placeholder",
      'input[placeholder="Name, slug, or email"]',
      { placeholder: true },
    );
    check("platform light placeholder is fg-muted", isRgb(platformPlaceholder, 92, 88, 84), platformPlaceholder);
    const newOrgFill = await computed(page, '[data-testid="new-organization"]', "background-color");
    check("New organization is still lime fill", isLime(newOrgFill), newOrgFill);

    await page.reload({ waitUntil: "networkidle0" });
    await page.waitForSelector("h1");
    checkEqual("platform still light after reload", await themeAttr(page), "light");
    checkEqual("platform storage still light after reload", await stored(page, PLATFORM_KEY), "light");
    await screenshot(page, "slice-c-platform-orgs-light");

    step("5. Token parity — both CSS copies still resolve to the locked Slice A light RGBs");
    checkEqual("heading parity (admin vs platform)", adminHeading, platformHeading);
    checkEqual("muted parity (admin phone vs platform placeholder)", adminPhone, platformPlaceholder);
    check("accent-text is locked #3D4D00 on platform", isRgb(platformLink, 61, 77, 0), platformLink);

    step("6. Back on admin-web — still light; platform key still absent on that origin");
    await page.goto(`${APP_URL}/memberships`, { waitUntil: "networkidle0" });
    await page.waitForSelector("h1");
    checkEqual("admin still light after visiting platform", await themeAttr(page), "light");
    checkEqual("admin storage still light", await stored(page, ADMIN_KEY), "light");
    checkEqual("platform key still absent on admin origin", await stored(page, PLATFORM_KEY), null);
    checkEqual("admin heading still light fg", await computed(page, "h1", "color"), LIGHT.fg);
  } finally {
    await browser.close();
  }

  process.exit(summary());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
