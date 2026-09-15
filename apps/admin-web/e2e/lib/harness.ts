import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer, { type Browser, type HTTPResponse, type Page } from "puppeteer-core";

export const E2E_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
export const SHOT_DIR = join(E2E_DIR, "screenshots");

export const APP_URL = process.env.E2E_APP_URL ?? "http://localhost:5173";
export const API_URL = process.env.E2E_API_URL ?? "http://localhost:4000/api/v1";

/**
 * `puppeteer-core` ships no browser of its own — that's the point. It drives whatever Chrome the
 * machine already has, so verification runs don't add a ~150 MB download to `pnpm install` or to
 * CI (this harness is excluded from `pnpm test` and never runs in CI).
 * Override with E2E_CHROME if your Chrome lives somewhere unusual.
 */
const CHROME_CANDIDATES = [
  process.env.E2E_CHROME,
  "/opt/google/chrome/chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter((p): p is string => Boolean(p));

function findChrome(): string {
  const found = CHROME_CANDIDATES.find((path) => existsSync(path));
  if (!found) {
    throw new Error(
      `No Chrome found. Looked in:\n${CHROME_CANDIDATES.map((p) => `  - ${p}`).join("\n")}\n` +
        "Set E2E_CHROME to a Chrome/Chromium binary.",
    );
  }
  return found;
}

export async function launch(): Promise<Browser> {
  return puppeteer.launch({
    executablePath: findChrome(),
    headless: process.env.E2E_HEADFUL === "1" ? false : true,
    defaultViewport: { width: 1440, height: 900 },
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      // Flutter Web / CanvasKit needs a GL implementation in headless Chrome.
      "--enable-webgl",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      ...(process.env.E2E_CHROME_ARGS?.split(/\s+/).filter(Boolean) ?? []),
    ],
  });
}

/** One observed API call: what the browser actually put on the wire. */
export interface ApiCall {
  method: string;
  path: string;
  status: number;
  at: number;
}

/**
 * Records every request the page makes to the API. This is the evidence for the refresh flows —
 * asserting on the *sequence and count* of network calls is the only way to prove the interceptor
 * retried once and that concurrent 401s collapsed into a single refresh.
 */
export function recordApiCalls(page: Page): {
  calls: ApiCall[];
  reset: () => void;
  since: (mark: number) => ApiCall[];
} {
  const calls: ApiCall[] = [];

  page.on("response", (response: HTTPResponse) => {
    const url = response.url();
    if (!url.startsWith(API_URL)) return;
    // Preflights aren't application traffic and would just add noise to the sequences below.
    if (response.request().method() === "OPTIONS") return;

    calls.push({
      method: response.request().method(),
      path: url.slice(API_URL.length).split("?")[0] ?? "",
      status: response.status(),
      at: Date.now(),
    });
  });

  return {
    calls,
    reset: () => {
      calls.length = 0;
    },
    since: (mark: number) => calls.filter((c) => c.at >= mark),
  };
}

/** Surfaces in-page errors in the harness output — otherwise a crashed render just looks like a
 * missing selector. */
export function forwardPageErrors(page: Page): void {
  page.on("pageerror", (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`  \u001b[31m[page error]\u001b[0m ${message}`);
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      console.log(`  \u001b[31m[console]\u001b[0m ${message.text()}`);
    }
  });
}

export function formatCalls(calls: ApiCall[]): string {
  if (calls.length === 0) return "    (none)";
  return calls.map((c) => `    ${c.method} ${c.path} -> ${c.status}`).join("\n");
}

/** Resolved values of the brand palette (DEVELOPMENT_PLAN.md Section 1.14) as the browser reports them. */
export const BRAND_RGB = {
  black: "rgb(0, 0, 0)",
  black88: "rgb(31, 31, 31)",
  green: "rgb(201, 255, 31)",
  greenMuted: "rgb(233, 255, 165)",
  white: "rgb(254, 249, 245)",
  /** Slice 0 solid muted — not `white` at 40% alpha. Locked headed Chrome 2026-09-15. */
  whiteMuted: "rgb(201, 196, 191)",
} as const;

/** Reads a *computed* style off the live element — not the class attribute. */
export async function computed(
  page: Page,
  selector: string,
  property: string,
): Promise<string> {
  return page.$eval(
    selector,
    (el, prop) => window.getComputedStyle(el).getPropertyValue(prop as string),
    property,
  );
}

export async function screenshot(page: Page, name: string): Promise<string> {
  const path = join(SHOT_DIR, `${name}.png`);
  await mkdir(dirname(path), { recursive: true });
  await page.screenshot({ path: path as `${string}.png`, fullPage: false });
  return path;
}

// ---------------------------------------------------------------------------
// Tiny assertion helpers — a full test runner would be overkill for a script
// that must be read as a verification transcript.
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

export function check(label: string, condition: boolean, detail = ""): void {
  if (condition) {
    passed += 1;
    console.log(`  \u001b[32mPASS\u001b[0m ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    failed += 1;
    console.log(`  \u001b[31mFAIL\u001b[0m ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

export function checkEqual(label: string, actual: unknown, expected: unknown): void {
  check(
    label,
    Object.is(actual, expected),
    Object.is(actual, expected) ? String(actual) : `expected ${String(expected)}, got ${String(actual)}`,
  );
}

export function step(title: string): void {
  console.log(`\n\u001b[1m${title}\u001b[0m`);
}

export function summary(): number {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  ${passed} passed, ${failed} failed`);
  console.log("=".repeat(60));
  return failed === 0 ? 0 : 1;
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Direct database access
//
// Shelling out to the `mysql` client rather than importing Prisma keeps the check honestly
// independent of the code under test: these assertions read the same rows an operator would,
// through a different driver, rather than through the ORM that wrote them.
// ---------------------------------------------------------------------------

const DB = {
  host: process.env.E2E_DB_HOST ?? "127.0.0.1",
  port: process.env.E2E_DB_PORT ?? "3307",
  user: process.env.E2E_DB_USER ?? "gym_app",
  password: process.env.E2E_DB_PASSWORD ?? "gym_app_dev_pw",
  name: process.env.E2E_DB_NAME ?? "gym_dev",
};

/** Runs a query and returns rows as objects, using MySQL's tab-separated batch output. */
export function queryDb(sql: string): Record<string, string>[] {
  const stdout = execFileSync(
    "mysql",
    [
      "--protocol=tcp",
      `-h${DB.host}`,
      `-P${DB.port}`,
      `-u${DB.user}`,
      `-p${DB.password}`,
      "--batch",
      "--raw",
      DB.name,
      "-e",
      sql,
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );

  const lines = stdout.trim().split("\n").filter(Boolean);
  if (lines.length < 2) return [];

  const headers = lines[0]!.split("\t");
  return lines.slice(1).map((line) => {
    const cells = line.split("\t");
    return Object.fromEntries(headers.map((header, i) => [header, cells[i] ?? ""]));
  });
}

/** Single-row convenience for the very common "look up this one record" case. */
export function queryOne(sql: string): Record<string, string> | undefined {
  return queryDb(sql)[0];
}

/** Pulls a column the script can't continue without, failing loudly rather than passing around
 * an `undefined` that would silently become the string "undefined" in a later query. */
export function requireCell(row: Record<string, string> | undefined, column: string): string {
  const value = row?.[column];
  if (value === undefined) {
    throw new Error(`Query returned no "${column}" — got ${JSON.stringify(row)}`);
  }
  return value;
}

/** Escapes a value for inlining into a query. Fine for a dev script with known inputs. */
export function sqlString(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;
}
