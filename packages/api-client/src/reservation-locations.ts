import type { ReservationLocation } from "./generated";

const demoKey = "tk-demo-reservation-locations-v1";

export function reservationLocationName(code: string, locale: string): string {
  if (code === "telep") return locale === "ru" ? "Телеп" : "Telep";
  if (code === "podbara") return locale === "ru" ? "Подбара" : "Podbara";
  return code;
}

export function demoReservationLocations(): ReservationLocation[] {
  let saved: Record<string, boolean> = {};
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(demoKey) || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) saved = parsed as Record<string, boolean>;
  } catch {
    // A malformed demo value must not prevent the booking screen from opening.
  }
  return [
    { code: "telep", name: "Telep", address: "Koste Abraševića 49", max_guests: 5, booking_mode: "tables", is_open: saved.telep !== false },
    { code: "podbara", name: "Podbara", address: "Temerinska 44", max_guests: 21, booking_mode: "seats", is_open: saved.podbara !== false },
  ];
}

export function setDemoReservationLocation(code: string, isOpen: boolean): ReservationLocation {
  const locations = demoReservationLocations();
  const location = locations.find((item) => item.code === code);
  if (!location) throw new Error("INVALID_INPUT");
  location.is_open = isOpen;
  localStorage.setItem(demoKey, JSON.stringify(Object.fromEntries(locations.map((item) => [item.code, item.is_open]))));
  return location;
}
