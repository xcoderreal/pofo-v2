import { describe, expect, test } from "bun:test";
import {
  autoGranularity,
  isGranularityValid,
  rangeLabel,
  resolveRange,
  toApiDate,
  validGranularities,
} from "@/lib/timeseries";

// A fixed "today" so none of these assertions depend on the wall clock.
// Deliberately mid-year, so a YTD span that was hardcoded to a day count
// would disagree with the computed one.
const TODAY = new Date(2026, 7, 1); // Aug 1 2026

describe("resolveRange — fixed offsets", () => {
  test("1W spans a week back from today", () => {
    const { start, end, spanDays } = resolveRange("1W", TODAY);

    expect(toApiDate(end)).toBe("2026-08-01");
    expect(toApiDate(start)).toBe("2026-07-25");
    expect(spanDays).toBe(8);
  });

  test("1Y spans a year back from today", () => {
    const { start } = resolveRange("1Y", TODAY);

    expect(toApiDate(start)).toBe("2025-08-01");
  });
});

describe("resolveRange — YTD", () => {
  test("starts at Jan 1 of the current year, not a fixed day count", () => {
    const { start, end } = resolveRange("YTD", TODAY);

    expect(toApiDate(start)).toBe("2026-01-01");
    expect(toApiDate(end)).toBe("2026-08-01");
  });

  test("is short in January and long in December — the bug a hardcoded day count would have", () => {
    const january = resolveRange("YTD", new Date(2026, 0, 3));
    const december = resolveRange("YTD", new Date(2026, 11, 31));

    expect(january.spanDays).toBe(3);
    expect(december.spanDays).toBe(365);
  });

  test("handles a leap year", () => {
    const { spanDays } = resolveRange("YTD", new Date(2028, 11, 31));

    expect(spanDays).toBe(366);
  });
});

describe("resolveRange — Max", () => {
  test("starts at the earliest transaction", () => {
    const { start, spanDays } = resolveRange("Max", TODAY, {
      earliest: new Date(2019, 2, 14),
    });

    expect(toApiDate(start)).toBe("2019-03-14");
    expect(spanDays).toBeGreaterThan(365 * 7);
  });

  test("collapses to a single day when there are no transactions", () => {
    const { start, end, spanDays } = resolveRange("Max", TODAY, {
      earliest: null,
    });

    expect(toApiDate(start)).toBe(toApiDate(end));
    expect(spanDays).toBe(1);
  });
});

describe("resolveRange — Custom", () => {
  test("uses the supplied bounds verbatim", () => {
    const { start, end, spanDays } = resolveRange("Custom", TODAY, {
      custom: { start: new Date(2025, 0, 1), end: new Date(2025, 0, 31) },
    });

    expect(toApiDate(start)).toBe("2025-01-01");
    expect(toApiDate(end)).toBe("2025-01-31");
    expect(spanDays).toBe(31);
  });

  test("throws when bounds are missing rather than silently guessing", () => {
    expect(() => resolveRange("Custom", TODAY)).toThrow();
  });
});

describe("autoGranularity", () => {
  test("picks daily for short spans", () => {
    expect(autoGranularity(resolveRange("1W", TODAY).spanDays)).toBe("daily");
    expect(autoGranularity(resolveRange("1M", TODAY).spanDays)).toBe("daily");
  });

  test("picks weekly for a quarter", () => {
    expect(autoGranularity(resolveRange("3M", TODAY).spanDays)).toBe("weekly");
  });

  test("picks monthly for a year", () => {
    expect(autoGranularity(resolveRange("1Y", TODAY).spanDays)).toBe("monthly");
  });

  test("keys on the resolved span, so Max and Custom need no special case", () => {
    const decade = resolveRange("Max", TODAY, { earliest: new Date(2014, 0, 1) });
    const week = resolveRange("Custom", TODAY, {
      custom: { start: new Date(2026, 6, 25), end: new Date(2026, 7, 1) },
    });

    expect(autoGranularity(decade.spanDays)).toBe("yearly");
    expect(autoGranularity(week.spanDays)).toBe("daily");
  });

  test("YTD's default changes with the calendar", () => {
    const january = resolveRange("YTD", new Date(2026, 0, 10));
    const december = resolveRange("YTD", new Date(2026, 11, 31));

    expect(autoGranularity(january.spanDays)).toBe("daily");
    expect(autoGranularity(december.spanDays)).toBe("monthly");
  });
});

describe("granularity validity", () => {
  test("a week is too short for anything but daily", () => {
    const { spanDays } = resolveRange("1W", TODAY);

    expect(validGranularities(spanDays)).toEqual(["daily"]);
  });

  test("yearly needs at least a year", () => {
    expect(isGranularityValid("yearly", 365)).toBe(false);
    expect(isGranularityValid("yearly", 366)).toBe(true);
  });

  test("a long span allows every granularity", () => {
    const { spanDays } = resolveRange("Max", TODAY, {
      earliest: new Date(2016, 0, 1),
    });

    expect(validGranularities(spanDays)).toEqual([
      "daily",
      "weekly",
      "monthly",
      "yearly",
    ]);
  });

  test("the auto-selected granularity is always itself valid", () => {
    for (const span of [1, 7, 30, 45, 90, 200, 365, 1000, 5000]) {
      expect(isGranularityValid(autoGranularity(span), span)).toBe(true);
    }
  });
});

describe("toApiDate", () => {
  test("formats in local terms, not as a UTC instant", () => {
    // A late-evening local date whose UTC form would land on the next
    // day in any timezone behind UTC.
    expect(toApiDate(new Date(2026, 0, 31, 23, 30))).toBe("2026-01-31");
  });

  test("zero-pads month and day", () => {
    expect(toApiDate(new Date(2026, 2, 5))).toBe("2026-03-05");
  });
});

describe("rangeLabel", () => {
  test("gives every range a label", () => {
    expect(rangeLabel("YTD")).toBe("year to date");
    expect(rangeLabel("Max")).toBe("all time");
    expect(rangeLabel("1Y")).toBe("past year");
  });
});
