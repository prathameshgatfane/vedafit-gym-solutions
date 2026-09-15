/**
 * Slice 0 — muted text contrast (dark theme only).
 *
 * Headed Chrome, computed styles (not class names). WCAG AA normal text is 4.5:1.
 * Locked token: brand.white-muted #C9C4BF → rgb(201, 196, 191) = 12.13:1 on rgb(0, 0, 0).
 *
 *   API + admin-web + super-admin up, then:
 *   E2E_HEADFUL=1 pnpm e2e:contrast
 */
import type { Page } from "puppeteer-core";
import {
  APP_URL,
  BRAND_RGB,
  check,
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
const MUTED_RGB = BRAND_RGB.whiteMuted;

function parseRgb(css: string): { r: number; g: number; b: number; a: number } | null {
  const m = css.trim().match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i);
  if (!m) return null;
  return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a: m[4] === undefined ? 1 : Number(m[4]) };
}

function isSolidMuted(css: string): boolean {
  const parsed = parseRgb(css);
  if (!parsed) return false;
  return (
    parsed.a >= 0.99 &&
    Math.round(parsed.r) === 201 &&
    Math.round(parsed.g) === 196 &&
    Math.round(parsed.b) === 191
  );
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

async function paintedBackground(page: Page, selector: string): Promise<{ r: number; g: number; b: number; css: string }> {
  return page.$eval(selector, (el) => {
    let node: Element | null = el;
    while (node) {
      const bg = window.getComputedStyle(node).backgroundColor;
      const m = bg.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i);
      if (m) {
        const a = m[4] === undefined ? 1 : Number(m[4]);
        if (a > 0.99) {
          return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), css: bg };
        }
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
    step("1. Admin Memberships — phone, days left, search placeholder");
    await loginAdmin(page);

    await page.goto(`${APP_URL}/memberships?status=ACTIVE`, { waitUntil: "networkidle0" });
    await page.waitForSelector('[data-testid="member-phone"]', { timeout: 10_000 });

    const phoneColor = await assertContrast(page, "member phone", '[data-testid="member-phone"]');
    check(`phone computed color is locked ${MUTED_RGB} (solid, not alpha)`, isSolidMuted(phoneColor), phoneColor);

    const daysSelector = '[data-testid="days-remaining"]';
    if (await page.$(daysSelector)) {
      const daysColor = await assertContrast(page, "days left", daysSelector);
      check(`days-left computed color is locked ${MUTED_RGB}`, isSolidMuted(daysColor), daysColor);
    } else {
      check("days-left row present (ACTIVE term with remaining days)", false);
    }

    const adminPlaceholder = 'input[placeholder="Member name or phone"]';
    const placeholderColor = await assertContrast(page, "admin search placeholder", adminPlaceholder, {
      placeholder: true,
    });
    check(`admin placeholder is locked ${MUTED_RGB}`, isSolidMuted(placeholderColor), placeholderColor);
    await screenshot(page, "contrast-admin-memberships");

    step("2. Super Admin Organizations — search placeholder");
    await loginPlatform(page);
    await page.goto(`${SUPER_URL}/organizations`, { waitUntil: "networkidle0" });
    const platformPlaceholder = 'input[placeholder="Name, slug, or email"]';
    await page.waitForSelector(platformPlaceholder, { timeout: 10_000 });
    const platformColor = await assertContrast(page, "super-admin search placeholder", platformPlaceholder, {
      placeholder: true,
    });
    check(`super-admin placeholder is locked ${MUTED_RGB}`, isSolidMuted(platformColor), platformColor);
    await screenshot(page, "contrast-super-admin-orgs");
  } finally {
    await browser.close();
  }

  process.exit(summary());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
