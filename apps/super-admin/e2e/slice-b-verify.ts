/**
 * Slice B — Super Admin light/dark tokens + toggle. Combined e2e:theme is Slice C; not this script.
 *
 * Locked colours are the Slice A set. Dark default, key `vedafit.platform.theme`.
 *
 *   API + super-admin up, then:
 *   E2E_HEADFUL=1 pnpm e2e:slice-b
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

const PLATFORM = { email: "platform@vedafit.test", password: "ChangeMe123!" };
const AA_NORMAL = 4.5;
const THEME_KEY = "vedafit.platform.theme";
const LIME = { r: 201, g: 255, b: 31 };
const LIGHT = {
  bg: "rgb(254, 249, 245)",
  fg: "rgb(20, 20, 20)",
  fgMuted: "rgb(92, 88, 84)",
  accentText: "rgb(61, 77, 0)",
} as const;
const WIDTHS: [number, number][] = [
  [375, 812],
  [768, 1024],
  [1440, 900],
];

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

async function storedTheme(page: Page): Promise<string | null> {
  return page.evaluate((key) => window.localStorage.getItem(key), THEME_KEY);
}

async function loginPlatform(page: Page) {
  await page.goto(`${APP_URL}/login`, { waitUntil: "networkidle0" });
  await page.waitForSelector('input[type="password"]');
  await page.type('input[type="email"]', PLATFORM.email);
  await page.type('input[type="password"]', PLATFORM.password);
  await page.click('button[type="submit"]');
  await page.waitForSelector('[data-testid="app-shell"]', { timeout: 10_000 });
}

async function shot(page: Page, name: string, width: number, height: number) {
  await page.setViewport({ width, height });
  await new Promise((r) => setTimeout(r, 400));
  await screenshot(page, name);
}

async function shootMainScreens(page: Page, mode: "dark" | "light") {
  for (const [width, height] of WIDTHS) {
    await page.goto(`${APP_URL}/organizations`, { waitUntil: "networkidle0" });
    await page.waitForSelector("h1");
    await shot(page, `slice-b-${mode}-orgs-${width}`, width, height);

    await page.click('::-p-xpath(//a[normalize-space()="Demo Gym"])');
    await page.waitForSelector('[data-testid="org-name"]', { timeout: 10_000 });
    await shot(page, `slice-b-${mode}-org-detail-${width}`, width, height);

    await page.goto(`${APP_URL}/plans`, { waitUntil: "networkidle0" });
    await page.waitForSelector("h1");
    await shot(page, `slice-b-${mode}-plans-${width}`, width, height);
  }
}

async function main() {
  const browser = await launch();
  const page = await browser.newPage();
  forwardPageErrors(page);

  try {
    step("1. First visit is dark — platform key, not admin-web's");
    await page.goto(`${APP_URL}/login`, { waitUntil: "networkidle0" });
    await page.waitForSelector("h1");
    checkEqual("data-theme is dark", await themeAttr(page), "dark");
    checkEqual("vedafit.platform.theme absent", await storedTheme(page), null);
    checkEqual(
      "admin-web key is not used on this origin",
      await page.evaluate(() => window.localStorage.getItem("vedafit.admin.theme")),
      null,
    );
    checkEqual("body is 1.14 black", await computed(page, "body", "background-color"), BRAND_RGB.black);
    checkEqual("heading is 1.14 white", await computed(page, "h1", "color"), BRAND_RGB.white);
    checkEqual("subtitle is 1.14 green-muted", await computed(page, "div.max-w-sm > p", "color"), BRAND_RGB.greenMuted);
    checkEqual("Sign in fill is 1.14 lime", await computed(page, 'button[type="submit"]', "background-color"), BRAND_RGB.green);
    checkEqual("Sign in label is black", await computed(page, 'button[type="submit"]', "color"), BRAND_RGB.black);

    step("2. Dark Organizations — muted + lime-as-link still AA on black");
    await loginPlatform(page);
    await page.goto(`${APP_URL}/organizations`, { waitUntil: "networkidle0" });
    await page.waitForSelector("h1");
    await assertContrast(page, "dark orgs heading", "h1");
    const darkLink = await assertContrast(page, "dark Demo Gym link", '::-p-xpath(//a[normalize-space()="Demo Gym"])');
    check("dark org link is lime (accent-text on black)", isLime(darkLink), darkLink);
    await assertContrast(page, "dark search placeholder", 'input[placeholder="Name, slug, or email"]', {
      placeholder: true,
    });
    await assertContrast(page, "dark ACTIVE badge", '[data-testid="status-badge"]');

    step("3. Dark screenshots — orgs, org detail, plans at 375 / 768 / 1440");
    await shootMainScreens(page, "dark");

    step("4. Toggle to light — persist, reuse Slice A locked colours");
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(`${APP_URL}/organizations`, { waitUntil: "networkidle0" });
    await page.click('[data-testid="theme-toggle"]');
    await page.waitForFunction(() => document.documentElement.getAttribute("data-theme") === "light");
    checkEqual("data-theme is light", await themeAttr(page), "light");
    checkEqual(`localStorage ${THEME_KEY}`, await storedTheme(page), "light");
    checkEqual("body is cream", await computed(page, "body", "background-color"), LIGHT.bg);

    const heading = await assertContrast(page, "light orgs heading", "h1");
    check("light heading is fg, not lime", isRgb(heading, 20, 20, 20), heading);

    const link = await assertContrast(page, "light Demo Gym link", '::-p-xpath(//a[normalize-space()="Demo Gym"])');
    check("light org link is locked accent-text, not lime", isRgb(link, 61, 77, 0), link);

    const placeholder = await assertContrast(page, "light search placeholder", 'input[placeholder="Name, slug, or email"]', {
      placeholder: true,
    });
    check("light placeholder is fg-muted", isRgb(placeholder, 92, 88, 84), placeholder);

    const badge = await computed(page, '[data-testid="status-badge"]', "color");
    check("light ACTIVE badge is not lime", !isLime(badge), badge);
    await assertContrast(page, "light ACTIVE badge", '[data-testid="status-badge"]');

    const trial = await page.$('::-p-xpath(//span[@data-testid="status-badge"][contains(normalize-space(), "TRIAL")])');
    if (trial) {
      const warning = await computed(
        page,
        '::-p-xpath(//span[@data-testid="status-badge"][contains(normalize-space(), "TRIAL")])',
        "color",
      );
      check("light TRIAL is locked warning amber", isRgb(warning, 146, 64, 14), warning);
      await assertContrast(
        page,
        "light TRIAL badge",
        '::-p-xpath(//span[@data-testid="status-badge"][contains(normalize-space(), "TRIAL")])',
      );
    }

    const signInFill = await computed(page, '[data-testid="new-organization"]', "background-color");
    check("New organization button is still lime fill", isLime(signInFill), signInFill);

    await page.goto(`${APP_URL}/plans`, { waitUntil: "networkidle0" });
    await page.waitForSelector("h1");
    const plansHeading = await assertContrast(page, "light plans heading", "h1");
    check("light plans heading is not lime", !isLime(plansHeading), plansHeading);
    await assertContrast(page, "light plan code", '[data-testid="saas-plan-card"] p.text-xs.uppercase');

    step("5. Reload keeps light");
    await page.reload({ waitUntil: "networkidle0" });
    await page.waitForSelector("h1");
    checkEqual("data-theme still light after reload", await themeAttr(page), "light");
    checkEqual("storage still light after reload", await storedTheme(page), "light");
    checkEqual("heading still light fg after reload", await computed(page, "h1", "color"), LIGHT.fg);

    step("6. Light screenshots — orgs, org detail, plans at 375 / 768 / 1440");
    await shootMainScreens(page, "light");
  } finally {
    await browser.close();
  }

  process.exit(summary());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
