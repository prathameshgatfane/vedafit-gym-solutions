import { describe, expect, it } from "vitest";
import {
  formatLocalMonth,
  localCalendarDate,
  localMonthBounds,
  localMonthOf,
  localMonthRangeDates,
  monthCountInclusive,
  monthsEndingAt,
  parseLocalMonth,
  safeTimeZone,
  localHour,
  isNightlyWindow,
} from "./dates";

const IST = "Asia/Kolkata";
/** Chosen because it has DST and a half-hour-off neighbour has already been covered by IST. */
const NEW_YORK = "America/New_York";

describe("localCalendarDate (1.17.4)", () => {
  it("files a 5 AM IST check-in under today, not yesterday", () => {
    // 23:30 UTC on the 6th is 05:00 IST on the 7th — the case the UTC day gets wrong.
    const instant = new Date("2026-09-06T23:30:00.000Z");

    expect(localCalendarDate(instant, IST).toISOString()).toBe("2026-09-07T00:00:00.000Z");
    expect(localCalendarDate(instant, "UTC").toISOString()).toBe("2026-09-06T00:00:00.000Z");
  });
});

describe("localMonthBounds (1.18.1)", () => {
  it("brackets an IST month at 18:30 UTC the day before, not at UTC midnight", () => {
    const { start, end } = localMonthBounds({ year: 2026, month: 9 }, IST);

    // 1 September 00:00 IST is 31 August 18:30 UTC.
    expect(start.toISOString()).toBe("2026-08-31T18:30:00.000Z");
    expect(end.toISOString()).toBe("2026-09-30T18:30:00.000Z");
  });

  it("puts a payment taken at 2 AM IST on the 1st into the new month, where UTC would not", () => {
    const paidAt = new Date("2026-08-31T20:30:00.000Z"); // 02:00 IST on 1 September
    const september = localMonthBounds({ year: 2026, month: 9 }, IST);
    const august = localMonthBounds({ year: 2026, month: 8 }, IST);

    expect(paidAt >= september.start && paidAt < september.end).toBe(true);
    expect(paidAt >= august.start && paidAt < august.end).toBe(false);

    // The whole point: the naive UTC reading disagrees.
    expect(paidAt.getUTCMonth() + 1).toBe(8);
  });

  it("is half-open, so the last instant of a month belongs to exactly one of the two", () => {
    const august = localMonthBounds({ year: 2026, month: 8 }, IST);
    const september = localMonthBounds({ year: 2026, month: 9 }, IST);

    expect(august.end.getTime()).toBe(september.start.getTime());

    const boundary = september.start;
    expect(boundary >= august.start && boundary < august.end).toBe(false);
    expect(boundary >= september.start && boundary < september.end).toBe(true);
  });

  it("rolls the year over in December", () => {
    const { start, end } = localMonthBounds({ year: 2026, month: 12 }, IST);

    expect(start.toISOString()).toBe("2026-11-30T18:30:00.000Z");
    expect(end.toISOString()).toBe("2026-12-31T18:30:00.000Z");
  });

  it("uses the offset in force at each end, so a DST month is 23 or 25 hours longer", () => {
    // US DST begins 8 March 2026 and ends 1 November 2026.
    const march = localMonthBounds({ year: 2026, month: 3 }, NEW_YORK);
    const november = localMonthBounds({ year: 2026, month: 11 }, NEW_YORK);

    const hours = (range: { start: Date; end: Date }) =>
      (range.end.getTime() - range.start.getTime()) / 3_600_000;

    expect(hours(march)).toBe(31 * 24 - 1); // an hour is skipped
    expect(hours(november)).toBe(30 * 24 + 1); // an hour repeats

    // Both ends are still local midnight, which is the property a naive fixed-offset
    // implementation loses.
    expect(march.start.toISOString()).toBe("2026-03-01T05:00:00.000Z"); // EST, UTC-5
    expect(march.end.toISOString()).toBe("2026-04-01T04:00:00.000Z"); // EDT, UTC-4
  });

  it("agrees with UTC for an organization actually in UTC", () => {
    const { start, end } = localMonthBounds({ year: 2026, month: 9 }, "UTC");

    expect(start.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });
});

describe("localMonthOf", () => {
  it("reads the month from the gym's clock, not the server's", () => {
    // 20:00 UTC on 31 August is already 01:30 IST on 1 September.
    const instant = new Date("2026-08-31T20:00:00.000Z");

    expect(localMonthOf(instant, IST)).toEqual({ year: 2026, month: 9 });
    expect(localMonthOf(instant, "UTC")).toEqual({ year: 2026, month: 8 });
  });
});

describe("monthsEndingAt", () => {
  it("returns oldest-first so it can be charted without reversing", () => {
    expect(monthsEndingAt({ year: 2026, month: 9 }, 3)).toEqual([
      { year: 2026, month: 7 },
      { year: 2026, month: 8 },
      { year: 2026, month: 9 },
    ]);
  });

  it("borrows across the year boundary", () => {
    expect(monthsEndingAt({ year: 2026, month: 2 }, 4)).toEqual([
      { year: 2025, month: 11 },
      { year: 2025, month: 12 },
      { year: 2026, month: 1 },
      { year: 2026, month: 2 },
    ]);
  });
});

describe("formatLocalMonth", () => {
  it("zero-pads so months sort lexically", () => {
    expect(formatLocalMonth({ year: 2026, month: 9 })).toBe("2026-09");
    expect(formatLocalMonth({ year: 2026, month: 12 })).toBe("2026-12");
  });
});

describe("parseLocalMonth / monthCountInclusive / localMonthRangeDates (1.21.4)", () => {
  it("round-trips a padded month string", () => {
    expect(parseLocalMonth("2026-09")).toEqual({ year: 2026, month: 9 });
    expect(formatLocalMonth(parseLocalMonth("2026-12"))).toBe("2026-12");
  });

  it("counts inclusive months, including a year wrap", () => {
    expect(monthCountInclusive({ year: 2026, month: 9 }, { year: 2026, month: 9 })).toBe(1);
    expect(monthCountInclusive({ year: 2026, month: 11 }, { year: 2027, month: 2 })).toBe(4);
    expect(monthCountInclusive({ year: 2026, month: 3 }, { year: 2026, month: 2 })).toBe(0);
  });

  it("gives a half-open DATE range covering the local months", () => {
    const { start, end } = localMonthRangeDates(
      { year: 2026, month: 9 },
      { year: 2026, month: 9 },
    );
    expect(start.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });
});

describe("safeTimeZone", () => {
  it("keeps a real zone and falls back to UTC on a broken one", () => {
    expect(safeTimeZone(IST)).toBe(IST);
    expect(safeTimeZone("Mars/Olympus_Mons")).toBe("UTC");
    expect(safeTimeZone(null)).toBe("UTC");
  });
});

describe("localHour / isNightlyWindow (1.22.4)", () => {
  it("is 21:00 in IST when it is 15:30 UTC, and morning in Honolulu", () => {
    const instant = new Date("2026-09-08T15:30:00.000Z");
    expect(localHour(instant, IST)).toBe(21);
    expect(isNightlyWindow(instant, IST)).toBe(true);
    expect(isNightlyWindow(instant, "Pacific/Honolulu")).toBe(false);
    expect(localHour(instant, "Pacific/Honolulu")).toBe(5);
  });
});
