// Slot date/time helpers.
//
// Per docs/api-contract.md the initial project assumes every restaurant is in
// Asia/Bangkok. Bangkok is UTC+7 year-round with no daylight saving, so a slot
// (date + time) maps to a single, deterministic UTC instant. If other regions
// are ever supported, this is the one place that must become timezone-aware.
const BANGKOK_OFFSET = '+07:00';

/** Calendar date and time in Bangkok, suitable for lexicographic slot queries. */
export function bangkokNow(now: Date = new Date()): { date: string; time: string } {
  const local = new Date(now.getTime() + 7 * 60 * 60 * 1000).toISOString();
  return { date: local.slice(0, 10), time: local.slice(11, 16) };
}

/** Reject impossible calendar dates such as February 31. */
export function isValidCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year!, month! - 1, day!));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() + 1 === month && parsed.getUTCDate() === day;
}

/** The absolute instant a `YYYY-MM-DD` + `HH:mm` slot occurs, in Asia/Bangkok. */
export function slotInstant(date: string, time: string): Date {
  return new Date(`${date}T${time}:00${BANGKOK_OFFSET}`);
}

/** True when the slot is strictly in the past relative to `now`. */
export function isPastSlot(date: string, time: string, now: Date = new Date()): boolean {
  return slotInstant(date, time).getTime() < now.getTime();
}
