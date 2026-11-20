import type { ReservationLocation } from "./generated";

const demoKey = "tk-demo-reservation-locations-v1";

export function reservationLocationName(code: string, locale: string, name?: string): string {
  if (code === "telep" && (!name || name === "Telep")) return locale === "ru" ? "Телеп" : "Telep";
  if (code === "podbara" && (!name || name === "Podbara")) return locale === "ru" ? "Подбара" : "Podbara";
  return name || code;
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
    { code: "telep", name: "Telep", address: "Koste Abraševića 49", max_guests: 5, booking_mode: "tables", is_open: saved.telep !== false, seat_capacity: 0, slot_step_minutes: 15, duration_minutes: 120, advance_days: 7, version: 1 },
    { code: "podbara", name: "Podbara", address: "Temerinska 44", max_guests: 21, booking_mode: "seats", is_open: saved.podbara !== false, seat_capacity: 21, slot_step_minutes: 15, duration_minutes: 120, advance_days: 7, version: 1 },
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
