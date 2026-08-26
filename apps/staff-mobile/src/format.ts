/**
 * Pickup dates and times are bare store-local strings — "2026-08-26", "16:00" —
 * and they must stay that way. Parsing one into a Date applies the device's
 * timezone, and a tablet set to the wrong zone would then show a customer the
 * wrong pickup day. Everything here is string manipulation for that reason.
 */

export function formatTime(time: string): string {
  const [hourText = "0", minute = "00"] = time.split(":");
  const hour = Number(hourText);
  const suffix = hour < 12 ? "AM" : "PM";
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}:${minute} ${suffix}`;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

export function formatDate(date: string, today: string): string {
  if (date === today) return "Today";

  const [year = "0", month = "1", day = "1"] = date.split("-");
  /* Built and read in UTC so the weekday is derived from the calendar date
     itself, never from where the tablet happens to be. */
  const utc = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return `${WEEKDAYS[utc.getUTCDay()]}, ${MONTHS[utc.getUTCMonth()]} ${utc.getUTCDate()}`;
}

export const formatMoney = (cents: number, currency: string): string =>
  `${currency === "CAD" || currency === "USD" ? "$" : ""}${(cents / 100).toFixed(2)}`;
