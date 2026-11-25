// Shared formatting for the emails the site sends, so names, places, dates and the
// event details box look the same in every email.

const EVENT_TZ = "America/New_York"; // events are in New York, whatever timezone the admin is in

export const SUPPORT_PHONE = "(718) 407-0134";

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// "sarah" -> "Sarah", "2222 ocean parkway, brooklyn" -> "2222 Ocean Parkway, Brooklyn".
// Only raises first letters, so names like "McDonald" or "NYC" keep their own capitals.
export function titleCase(value) {
  return String(value ?? "")
    .trim()
    .replace(/(^|[\s\-(/])(\p{Ll})/gu, (_, before, letter) => before + letter.toUpperCase());
}

const toDate = (ts) => (ts?.toDate ? ts.toDate() : ts instanceof Date ? ts : null);

// "Monday, November 23"
export function formatEventDate(ts) {
  const d = toDate(ts);
  if (!d) return "TBA";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: EVENT_TZ, weekday: "long", month: "long", day: "numeric",
  }).format(d);
}

// "8 PM", or "8:30 PM" when it isn't on the hour
export function formatEventTime(ts) {
  const d = toDate(ts);
  if (!d) return "TBA";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: EVENT_TZ, hour: "numeric", minute: "2-digit",
  }).format(d).replace(":00", "");
}

export function mapsUrl(address) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

// The green "Event details" box.
//   fullAddress: true  -> the full address, linked to Google Maps
//   fullAddress: false -> only the general area, plus "Full address sent once you confirm"
export function eventDetailsBoxHtml(event, { fullAddress = true, title = "Event details:" } = {}) {
  const general = titleCase(event?.generalLocation || "");
  const full = titleCase(event?.fullAddress || "");

  let location;
  if (fullAddress && full) {
    location = `<a href="${mapsUrl(full)}" style="color: #2563EB; text-decoration: none;">${escapeHtml(full)}</a>`;
  } else if (fullAddress && general) {
    location = escapeHtml(general);
  } else {
    location = escapeHtml(general || "TBA");
  }

  const note = fullAddress
    ? ""
    : `<br><span style="font-size: 12px; font-style: italic; color: #4B635A;">Full address sent once you confirm</span>`;

  return `
        <div style="background: #DEE8DF; padding: 16px 20px; border-radius: 12px; border: 1px solid #95B699; margin: 20px 0; color: #1E3D34; text-align: left; line-height: 1.6;">
          <strong>${escapeHtml(title)}</strong><br>
          <strong>Date:</strong> ${escapeHtml(formatEventDate(event?.scheduledAt))}<br>
          <strong>Time:</strong> ${escapeHtml(formatEventTime(event?.scheduledAt))}<br>
          <strong>Location:</strong> ${location}${note}
        </div>`;
}

export function cancelLineHtml(cancelUrl) {
  return `<p style="margin-top: 24px; font-size: 13px; color: #1E3D34;">Can't make it? <a href="${cancelUrl}" style="color: #95B699; font-weight: bold;">Cancel Registration</a></p>`;
}
