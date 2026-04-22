import { formatInTimeZone } from "date-fns-tz";

import type { PatSeries } from "./domain";
import { computeDailySummaries, type DailySummary } from "./summaries";

// ---------------------------------------------------------------------------
// Day-type classification + rollups (Carroll et al. 2025 slice strategy)
//
// Enables PM2.5 exposure summaries by "all days", "school days", "weekend",
// "summer", "testing days". A school calendar lets users define school-year
// ranges, holidays, testing windows, and summer windows; defaults fall back
// to June/July/August for summer and all weekdays for school days.
// ---------------------------------------------------------------------------

export type DayType =
  | "all"
  | "weekday"
  | "weekend"
  | "school-day"
  | "summer"
  | "testing-day"
  | "holiday";

export type DateRange = {
  // Inclusive calendar-date range. Strings are YYYY-MM-DD in local school time.
  start: string;
  end: string;
};

export type SchoolCalendar = {
  schoolYear?: DateRange[];
  holidays?: string[];
  testingWindows?: DateRange[];
  summerWindows?: DateRange[];
};

export const DEFAULT_DAY_TYPES: DayType[] = [
  "all",
  "weekday",
  "weekend",
  "school-day",
  "summer",
  "testing-day",
];

function isValidYmd(date: string): boolean {
  if (date.length !== 10) return false;
  if (date[4] !== "-" || date[7] !== "-") return false;
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const d = Number(date.slice(8, 10));
  return (
    Number.isInteger(y)
    && Number.isInteger(m)
    && Number.isInteger(d)
    && m >= 1
    && m <= 12
    && d >= 1
    && d <= 31
  );
}

function requireYmd(date: string): string {
  if (!isValidYmd(date)) {
    throw new Error(`Expected YYYY-MM-DD, received '${date}'`);
  }
  return date;
}

export function inRange(dateStr: string, range: DateRange): boolean {
  return dateStr >= range.start && dateStr <= range.end;
}

export function inAnyRange(dateStr: string, ranges: DateRange[] | undefined): boolean {
  if (!ranges || ranges.length === 0) return false;
  for (const r of ranges) {
    if (inRange(dateStr, r)) return true;
  }
  return false;
}

export function isWeekendDate(dateStr: string): boolean {
  requireYmd(dateStr);
  // Anchor at noon UTC so no DST transition can shift the computed weekday.
  const d = new Date(`${dateStr}T12:00:00Z`);
  const dow = d.getUTCDay();
  return dow === 0 || dow === 6;
}

export function isSummerDate(dateStr: string, calendar?: SchoolCalendar): boolean {
  requireYmd(dateStr);
  if (calendar?.summerWindows && calendar.summerWindows.length > 0) {
    return inAnyRange(dateStr, calendar.summerWindows);
  }
  const month = Number(dateStr.slice(5, 7));
  return month === 6 || month === 7 || month === 8;
}

export function isHolidayDate(dateStr: string, calendar?: SchoolCalendar): boolean {
  requireYmd(dateStr);
  return Boolean(calendar?.holidays?.includes(dateStr));
}

export function isTestingDate(dateStr: string, calendar?: SchoolCalendar): boolean {
  requireYmd(dateStr);
  return inAnyRange(dateStr, calendar?.testingWindows);
}

export function isSchoolDayDate(dateStr: string, calendar?: SchoolCalendar): boolean {
  requireYmd(dateStr);
  if (isWeekendDate(dateStr)) return false;
  if (isHolidayDate(dateStr, calendar)) return false;
  if (isSummerDate(dateStr, calendar)) return false;
  if (calendar?.schoolYear && calendar.schoolYear.length > 0) {
    return inAnyRange(dateStr, calendar.schoolYear);
  }
  return true;
}

export function classifyDayType(dateStr: string, calendar?: SchoolCalendar): DayType[] {
  requireYmd(dateStr);
  const tags: DayType[] = ["all"];
  tags.push(isWeekendDate(dateStr) ? "weekend" : "weekday");
  if (isSummerDate(dateStr, calendar)) tags.push("summer");
  if (isHolidayDate(dateStr, calendar)) tags.push("holiday");
  if (isTestingDate(dateStr, calendar)) tags.push("testing-day");
  if (isSchoolDayDate(dateStr, calendar)) tags.push("school-day");
  return tags;
}

export function matchesDayType(
  dateStr: string,
  dayType: DayType,
  calendar?: SchoolCalendar,
): boolean {
  switch (dayType) {
    case "all":
      return true;
    case "weekday":
      return !isWeekendDate(dateStr);
    case "weekend":
      return isWeekendDate(dateStr);
    case "summer":
      return isSummerDate(dateStr, calendar);
    case "holiday":
      return isHolidayDate(dateStr, calendar);
    case "testing-day":
      return isTestingDate(dateStr, calendar);
    case "school-day":
      return isSchoolDayDate(dateStr, calendar);
  }
}

export type DayTypeRollup = {
  dayType: DayType;
  dayCount: number;
  observationCount: number;
  meanPm25: number | null;
  medianPm25: number | null;
  p95Pm25: number | null;
  maxPm25: number | null;
  minPm25: number | null;
  stdPm25: number | null;
  minutesAboveEpaThreshold: number;
};

export type DayTypeRollupOptions = {
  calendar?: SchoolCalendar;
  dayTypes?: DayType[];
  epaDailyThreshold?: number;
  assumedMinutesPerObservation?: number;
};

function quantile(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];
  const idx = q * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const w = idx - lo;
  return sorted[lo] * (1 - w) + sorted[hi] * w;
}

export function rollupDailySummariesByDayType(
  summaries: DailySummary[],
  options: DayTypeRollupOptions = {},
): DayTypeRollup[] {
  const requested: DayType[] = options.dayTypes ?? DEFAULT_DAY_TYPES;
  const calendar = options.calendar;
  const results: DayTypeRollup[] = [];

  for (const dayType of requested) {
    const matched = summaries.filter((s) => matchesDayType(s.date, dayType, calendar));
    const dailyMeans: number[] = [];
    let observationCount = 0;
    let minutesAbove = 0;
    for (const s of matched) {
      if (s.fullDay.mean !== null) dailyMeans.push(s.fullDay.mean);
      observationCount += s.fullDay.count;
      minutesAbove += s.minutesAboveEpaThreshold;
    }
    const sorted = dailyMeans.slice().sort((a, b) => a - b);

    let meanVal: number | null = null;
    let stdVal: number | null = null;
    if (dailyMeans.length > 0) {
      let sum = 0;
      for (const v of dailyMeans) sum += v;
      meanVal = sum / dailyMeans.length;
      if (dailyMeans.length > 1) {
        let sq = 0;
        for (const v of dailyMeans) sq += (v - meanVal) * (v - meanVal);
        stdVal = Math.sqrt(sq / (dailyMeans.length - 1));
      }
    }

    results.push({
      dayType,
      dayCount: matched.length,
      observationCount,
      meanPm25: meanVal,
      medianPm25: quantile(sorted, 0.5),
      p95Pm25: quantile(sorted, 0.95),
      maxPm25: sorted.length > 0 ? sorted[sorted.length - 1] : null,
      minPm25: sorted.length > 0 ? sorted[0] : null,
      stdPm25: stdVal,
      minutesAboveEpaThreshold: minutesAbove,
    });
  }

  return results;
}

export function rollupPatSeriesByDayType(
  series: PatSeries,
  options: DayTypeRollupOptions = {},
): DayTypeRollup[] {
  const summaries = computeDailySummaries(series, {
    epaDailyThreshold: options.epaDailyThreshold,
    assumedMinutesPerObservation: options.assumedMinutesPerObservation,
  });
  return rollupDailySummariesByDayType(summaries, options);
}

export function filterSpatioTemporalByDayType<T extends { t: number }>(
  points: T[],
  dayType: DayType,
  timezone: string,
  calendar?: SchoolCalendar,
): T[] {
  if (dayType === "all") return points.slice();
  const filtered: T[] = [];
  for (const p of points) {
    const dateStr = formatInTimeZone(new Date(p.t), timezone, "yyyy-MM-dd");
    if (matchesDayType(dateStr, dayType, calendar)) filtered.push(p);
  }
  return filtered;
}
