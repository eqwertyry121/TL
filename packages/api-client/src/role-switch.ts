import type { Role } from "./generated";

export const OWNER_TELEGRAM_ID = 1048084234;
export const OWNER_TELEGRAM_IDS = [OWNER_TELEGRAM_ID, 8241921060, 8609105840, 7604602332] as const;

const localPorts: Record<Role, string> = {
  CLIENT: "5173",
  KITCHEN: "5174",
  COURIER: "5175",
  ADMIN: "5176",
};

const labels: Record<Role, string> = {
  CLIENT: "Клиент",
  ADMIN: "Админ",
  KITCHEN: "Кухня",
  COURIER: "Курьер",
};

const paths: Record<Role, string> = {
  CLIENT: "",
  ADMIN: "admin/",
  KITCHEN: "kitchen/",
  COURIER: "courier/",
};

export interface RoleLink {
  role: Role;
  label: string;
  href: string;
  active: boolean;
}

export function isOwnerTelegramId(value: unknown): boolean {
  const telegramUserId = Number(value);
  return Number.isFinite(telegramUserId) && OWNER_TELEGRAM_IDS.some((id) => id === telegramUserId);
}

export function roleLinks(activeRole: Role): RoleLink[] {
  return (["CLIENT", "ADMIN", "KITCHEN", "COURIER"] as Role[]).map((role) => ({
    role,
    label: labels[role],
    href: roleUrl(role),
    active: role === activeRole,
  }));
}

export function roleUrl(role: Role): string {
  if (typeof window === "undefined") return "#";
  const { protocol, hostname, origin } = window.location;
  if (hostname === "127.0.0.1" || hostname === "localhost") {
    return `${protocol}//${hostname}:${localPorts[role]}/`;
  }
  return `${origin}/${paths[role]}`;
}
