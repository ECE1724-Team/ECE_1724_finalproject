/**
 * The Dashboard's "Next 7 days" window (PRD §5.4, FR-03; Database Design §8.3): from local
 * midnight today (inclusive) to local midnight seven calendar dates later (exclusive), in the
 * user's display time zone. It is built from calendar dates, never by adding 168 hours, so a
 * window that crosses a daylight-saving change is 167 or 169 hours long.
 */
export interface UpcomingWindow {
  /** The time zone as the client sent it (for example "America/Toronto"). */
  timeZone: string;
  /** Local start of today, as an instant. */
  start: Date;
  /** Local start of the day seven calendar dates later, as an instant (exclusive). */
  end: Date;
}

export const WINDOW_DAYS = 7;
const DAY_MS = 86_400_000;
const MAX_TIME_ZONE_LENGTH = 100;

interface CalendarDate { year: number; month: number; day: number }
interface WallClock extends CalendarDate { hour: number; minute: number; second: number }

const formatters = new Map<string, Intl.DateTimeFormat>();

/** A formatter for one time zone, or null when the name is not a time zone `Intl` knows. */
function formatterFor(timeZone: string): Intl.DateTimeFormat | null {
  const cached = formatters.get(timeZone);
  if (cached) return cached;
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone, hourCycle: "h23",
      year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric",
    });
  } catch {
    return null;
  }
  // Keyed by the canonical name, so the cache stays bounded (a few hundred zones) even though
  // names are accepted in any letter case.
  const canonical = formatter.resolvedOptions().timeZone;
  if (!formatters.has(canonical)) formatters.set(canonical, formatter);
  return formatter;
}

/**
 * Whether `value` is a time zone `Intl` accepts: an IANA name such as "America/Toronto" (any
 * letter case) or a fixed offset such as "+05:00".
 */
export function isTimeZone(value: string): boolean {
  return value.length > 0 && value.length <= MAX_TIME_ZONE_LENGTH && formatterFor(value) !== null;
}

function wallClock(formatter: Intl.DateTimeFormat, instant: number): WallClock {
  const parts: Record<string, number> = {};
  for (const { type, value } of formatter.formatToParts(instant)) {
    if (type !== "literal") parts[type] = Number(value);
  }
  return { year: parts.year!, month: parts.month!, day: parts.day!, hour: parts.hour!, minute: parts.minute!, second: parts.second! };
}

/** Local wall-clock time minus UTC at `instant`, in milliseconds. */
function offsetAt(formatter: Intl.DateTimeFormat, instant: number): number {
  const whole = instant - (((instant % 1000) + 1000) % 1000);
  const local = wallClock(formatter, whole);
  return Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second) - whole;
}

const sameDate = (a: CalendarDate, b: CalendarDate) => a.year === b.year && a.month === b.month && a.day === b.day;

/**
 * The first instant of `date` in the formatter's time zone. That is local midnight, or the
 * moment clocks jump forward when midnight itself is skipped (for example America/Santiago).
 */
function startOfDay(formatter: Intl.DateTimeFormat, date: CalendarDate): number {
  const utcMidnight = Date.UTC(date.year, date.month - 1, date.day);
  // The offsets in force a day before, at, and a day after UTC midnight include the one at local
  // midnight. Every candidate inside the date is at or after its first instant, and that first
  // instant is one of them, so the earliest one wins.
  const starts = [utcMidnight - DAY_MS, utcMidnight, utcMidnight + DAY_MS]
    .map((probe) => utcMidnight - offsetAt(formatter, probe))
    .filter((candidate) => sameDate(wallClock(formatter, candidate), date));
  if (!starts.length) throw new Error("Could not find the start of the local day");
  return Math.min(...starts);
}

function addDays(date: CalendarDate, days: number): CalendarDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

/** The upcoming-interview window for `now` in `timeZone`; null when the zone is not valid. */
export function upcomingWindow(timeZone: string, now: Date): UpcomingWindow | null {
  if (!isTimeZone(timeZone)) return null;
  const formatter = formatterFor(timeZone)!;
  const today = wallClock(formatter, now.getTime());
  return {
    timeZone,
    start: new Date(startOfDay(formatter, today)),
    end: new Date(startOfDay(formatter, addDays(today, WINDOW_DAYS))),
  };
}
