/**
 * Calendar-date helpers.
 *
 * A membership term is a range of *calendar days*, not a range of instants: "your membership runs
 * to 30 April" means the whole of 30 April regardless of what time it is. Every term boundary is
 * therefore stored at UTC midnight (the same convention `member.dateOfBirth` uses) so a term can't
 * gain or lose a day by crossing a timezone.
 *
 * Attendance is the other kind of date and gets the other treatment — see `localCalendarDate` at
 * the bottom and Locked Decision 1.17.4. A term boundary is typed by a human; an attendance day is
 * *derived from an instant*, and that mapping only means anything in the gym's own timezone.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Today as a UTC-midnight `Date`. The single clock reading every lifecycle rule compares against. */
export function todayUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** `YYYY-MM-DD` → UTC midnight. Assumes the string was already validated by Zod. */
export function parseCalendarDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

/** UTC-midnight `Date` → `YYYY-MM-DD`, the only shape a calendar date is ever serialized in. */
export function formatCalendarDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

/** Whole days from `from` to `to`; negative if `to` is earlier. Both are UTC midnights. */
export function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / MS_PER_DAY);
}

/**
 * `endDate` is the **last day of access, inclusive** — a 30-day plan starting on the 1st runs
 * through the 30th, not the 31st. Renewals therefore start at `endDate + 1 day` with no gap and
 * no double-counted day (Locked Decision 1.15.3).
 */
export function termEndDate(startDate: Date, durationDays: number): Date {
  return addDays(startDate, durationDays - 1);
}

/**
 * Which calendar day an instant falls on, in the given IANA timezone, as a UTC-midnight `Date`
 * (Locked Decision 1.17.4).
 *
 * IST is UTC+5:30, so a 5:00 AM check-in is 23:30 UTC the *previous* day — taking the UTC day
 * would file an ordinary opening-time visit under yesterday, and would let the same member check
 * in at 5:00 and again at 6:00 the same morning under a one-per-day rule.
 *
 * The result is still stored at UTC midnight so it compares directly against membership
 * `startDate`/`endDate`, which are UTC midnights for the unrelated reason above. Only the
 * *choice* of which day differs, never the representation.
 *
 * `en-CA` is used purely because it formats as `YYYY-MM-DD`; `Intl` ships with Node, so this adds
 * no date dependency.
 */
export function localCalendarDate(instant: Date, timeZone: string): Date {
  const formatted = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);

  return parseCalendarDate(formatted);
}

/**
 * Falls back to UTC on an unrecognised zone rather than throwing. A bad `organizations.timezone`
 * should misfile a check-in by a few hours, not take the front desk offline — and the caller has
 * no better answer to give at that point either.
 */
export function safeTimeZone(timeZone: string | null | undefined): string {
  if (!timeZone) return "UTC";
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());
    return timeZone;
  } catch {
    return "UTC";
  }
}

// ── Local month boundaries (Locked Decision 1.18.1) ──────────────────────────
//
// Revenue is summed over the organization's local month, for the same reason attendance uses its
// local day: `paidAt` is an instant, and under a UTC month every payment taken between midnight
// and 05:30 IST on the 1st files under the previous month. Unlike `localCalendarDate`, which maps
// an instant *to* a day, these go the other way — from a civil date the gym would recognise to the
// pair of UTC instants that bracket it, so the query can still use the index on `paidAt`.

/** A calendar month in the gym's own reckoning. `month` is 1-12, not the 0-11 `Date` uses. */
export interface LocalMonth {
  year: number;
  month: number;
}

/**
 * The offset, in milliseconds, that has to be added to `instant` to read it as wall-clock time in
 * `timeZone`. Positive east of Greenwich (+5.5h for IST).
 */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    // `hourCycle` rather than `hour12: false`, which yields "24" for midnight in some zones and
    // would push the computed offset out by a day.
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);

  const field = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);

  const asIfUtc = Date.UTC(
    field("year"),
    field("month") - 1,
    field("day"),
    field("hour"),
    field("minute"),
    field("second"),
  );

  return asIfUtc - instant.getTime();
}

/**
 * A wall-clock time in `timeZone` → the UTC instant it happens at.
 *
 * `civilMs` carries the desired local time encoded as though it were UTC, which is the same trick
 * `localCalendarDate` uses in the other direction. The offset is applied twice because the offset
 * *at the answer* is what matters, and a first guess made with the offset at the wrong instant is
 * off by an hour across a DST boundary. India has no DST, so this only ever matters for an
 * organization in a zone that does — which is precisely when a silent one-hour error would be
 * hardest to notice.
 */
function civilToInstant(civilMs: number, timeZone: string): Date {
  const guess = new Date(civilMs - zoneOffsetMs(new Date(civilMs), timeZone));
  return new Date(civilMs - zoneOffsetMs(guess, timeZone));
}

/** Which calendar month an instant falls in, in the gym's zone. */
export function localMonthOf(instant: Date, timeZone: string): LocalMonth {
  const day = localCalendarDate(instant, timeZone);
  return { year: day.getUTCFullYear(), month: day.getUTCMonth() + 1 };
}

/**
 * The half-open instant range `[start, end)` covering a local month. Half-open rather than
 * inclusive so a payment taken in the last second of the month can't be double-counted by the
 * next month's query, and so the SQL is a plain `>= start AND < end` with no fencepost.
 */
export function localMonthBounds(
  month: LocalMonth,
  timeZone: string,
): { start: Date; end: Date } {
  const start = civilToInstant(Date.UTC(month.year, month.month - 1, 1), timeZone);
  const end = civilToInstant(Date.UTC(month.year, month.month, 1), timeZone);
  return { start, end };
}

/** `{ year: 2026, month: 9 }` → `"2026-09"`, the shape the API serializes a month in. */
export function formatLocalMonth(month: LocalMonth): string {
  return `${month.year}-${String(month.month).padStart(2, "0")}`;
}

/** Inverse of `formatLocalMonth`. Caller has already validated `YYYY-MM`. */
export function parseLocalMonth(value: string): LocalMonth {
  const [year, month] = value.split("-");
  return { year: Number(year), month: Number(month) };
}

/** Inclusive count of calendar months from `from` to `to`. Negative if `to` is earlier. */
export function monthCountInclusive(from: LocalMonth, to: LocalMonth): number {
  return to.year * 12 + to.month - (from.year * 12 + from.month) + 1;
}

/**
 * Civil-date bounds of a local-month range, as UTC-midnight `Date`s, half-open `[start, end)`.
 * An `expenseDate` DATE column compares directly against these (1.21.4).
 */
export function localMonthRangeDates(
  from: LocalMonth,
  to: LocalMonth,
): { start: Date; end: Date } {
  const start = new Date(Date.UTC(from.year, from.month - 1, 1));
  const end = new Date(Date.UTC(to.year, to.month, 1));
  return { start, end };
}

/**
 * The `count` months ending at `month`, oldest first — the x-axis of the revenue trend. Returned
 * in chart order so no caller has to remember to reverse it.
 */
export function monthsEndingAt(month: LocalMonth, count: number): LocalMonth[] {
  const months: LocalMonth[] = [];

  for (let back = count - 1; back >= 0; back -= 1) {
    // Date.UTC normalises an out-of-range month index, so December of the previous year comes
    // out right without any manual year borrowing.
    const shifted = new Date(Date.UTC(month.year, month.month - 1 - back, 1));
    months.push({ year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1 });
  }

  return months;
}

/** Wall-clock hour (0-23) of an instant in `timeZone`. Used to decide "is it 21:00 at the gym?" (1.22.4). */
export function localHour(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: safeTimeZone(timeZone),
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  return Number(parts.find((part) => part.type === "hour")?.value ?? 0);
}

/** True during the gym-local hour that counts as nightly. The 15-minute tick asks this, not UTC. */
export function isNightlyWindow(
  instant: Date,
  timeZone: string,
  hour = 21,
): boolean {
  return localHour(instant, timeZone) === hour;
}
