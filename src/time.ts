// Slot date/time helpers.
//
// Per docs/api-contract.md the initial project assumes every restaurant is in
// Asia/Bangkok. Bangkok is UTC+7 year-round with no daylight saving, so a slot
// (date + time) maps to a single, deterministic UTC instant. If other regions
// are ever supported, this is the one place that must become timezone-aware.
const BANGKOK_OFFSET = '+07:00';

/** The absolute instant a `YYYY-MM-DD` + `HH:mm` slot occurs, in Asia/Bangkok. */
export function slotInstant(date: string, time: string): Date {
  return new Date(`${date}T${time}:00${BANGKOK_OFFSET}`);
}

/** True when the slot is strictly in the past relative to `now`. */
export function isPastSlot(date: string, time: string, now: Date = new Date()): boolean {
  return slotInstant(date, time).getTime() < now.getTime();
}
