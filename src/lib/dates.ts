// Dates are plain "YYYY-MM-DD" strings end to end; months are "YYYY-MM".

export const APP_TIMEZONE = process.env.APP_TIMEZONE ?? "Asia/Colombo";

const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isIsoDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return d.toISOString().slice(0, 10) === s;
}

export function isYearMonth(s: string): boolean {
  return MONTH_RE.test(s);
}

export function today(timeZone = APP_TIMEZONE, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function currentYearMonth(timeZone = APP_TIMEZONE): string {
  return today(timeZone).slice(0, 7);
}

export function monthOf(date: string): string {
  return date.slice(0, 7);
}

const utc = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

export function addDays(date: string, n: number): string {
  const d = utc(date);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
}

export function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return iso(d).slice(0, 7);
}

export function firstDay(ym: string): string {
  return `${ym}-01`;
}

/** Exclusive upper bound: first day of the next month. */
export function nextMonthStart(ym: string): string {
  return firstDay(addMonths(ym, 1));
}

export function lastDay(ym: string): string {
  return addDays(nextMonthStart(ym), -1);
}

export function daysInMonth(ym: string): number {
  return Number(lastDay(ym).slice(8, 10));
}

export function diffDays(a: string, b: string): number {
  return Math.round((utc(a).getTime() - utc(b).getTime()) / 86_400_000);
}

/** Monday of the week containing `date`. */
export function weekStart(date: string): string {
  const dow = (utc(date).getUTCDay() + 6) % 7;
  return addDays(date, -dow);
}

export function formatDay(date: string, opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" }): string {
  return new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: "UTC" }).format(utc(date));
}

export function formatMonth(ym: string, opts: Intl.DateTimeFormatOptions = { month: "long", year: "numeric" }): string {
  return new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: "UTC" }).format(utc(firstDay(ym)));
}

/** "Today", "Yesterday", "Tomorrow", "3 days ago", "In 2 days". */
export function relativeDay(date: string, todayStr: string): string {
  const n = diffDays(date, todayStr);
  if (n === 0) return "Today";
  if (n === -1) return "Yesterday";
  if (n === 1) return "Tomorrow";
  return n < 0 ? `${-n} days ago` : `In ${n} days`;
}

// ---- Budget months (pay cycles) ----
// A budget month can start on any day 1–28 (e.g. 25 = salary day). It is named
// after the month it starts in: with startDay 25, "2026-09" is 25 Sep → 24 Oct.
// startDay 1 gives ordinary calendar months.

/** First day of budget month `ym`. */
export function periodStart(ym: string, startDay: number): string {
  return `${ym}-${String(startDay).padStart(2, "0")}`;
}

/** Exclusive end: the first day of the next budget month. */
export function periodEnd(ym: string, startDay: number): string {
  return periodStart(addMonths(ym, 1), startDay);
}

/** The budget month a date belongs to. */
export function periodOf(date: string, startDay: number): string {
  const ym = date.slice(0, 7);
  return Number(date.slice(8, 10)) >= startDay ? ym : addMonths(ym, -1);
}

/** "25 Sep – 24 Oct" for a range [from, toExclusive). */
export function formatRange(from: string, toExclusive: string): string {
  const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };
  return `${formatDay(from, opts)} – ${formatDay(addDays(toExclusive, -1), opts)}`;
}

export type Range = { from: string; to: string }; // to is exclusive

/** Clamp a date into a range: used to date transfers made while viewing another month. */
export function clampToRange(date: string, r: Range): string {
  if (date < r.from) return r.from;
  if (date >= r.to) return addDays(r.to, -1);
  return date;
}

/** Clamp a date into a month: used to date transfers made while viewing another month. */
export function clampToMonth(date: string, ym: string): string {
  if (date < firstDay(ym)) return firstDay(ym);
  if (date > lastDay(ym)) return lastDay(ym);
  return date;
}
