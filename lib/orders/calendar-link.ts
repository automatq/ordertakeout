/**
 * Google Calendar "add event" link for a pickup — shared by the order tracking
 * page and the customer emails.
 *
 * The times are the store's wall clock. Google reads a floating (zoneless)
 * timestamp in the viewer's own zone, which is right for a local bakery and
 * wrong only for someone booking from another timezone — a trade for not
 * dragging a tz conversion into a convenience link.
 */
export function googleCalendarUrl(input: {
  date: string;
  time: string;
  orderNumber: string;
  locationName: string;
  address: string;
  city: string;
  phone: string;
}): string {
  const { date, time, orderNumber, locationName, address, city, phone } = input;
  const start = `${date.replace(/-/g, "")}T${time.replace(":", "")}00`;
  const [hours, minutes] = time.split(":").map(Number) as [number, number];
  const end = `${date.replace(/-/g, "")}T${String((hours + 1) % 24).padStart(2, "0")}${String(
    minutes,
  ).padStart(2, "0")}00`;

  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: `Pick up order ${orderNumber} — ${locationName}`,
    dates: `${start}/${end}`,
    location: `${address}, ${city}`,
    details: `Collect your party tray order ${orderNumber}. Call ${phone} if you need to change anything.`,
  });

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
