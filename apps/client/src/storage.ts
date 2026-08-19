import type { Category } from "@tk-delivery/api-client/generated";
import type { Calculation, CartLine, CartState, CashLocationChallenge, CheckoutDraft, Locale } from "./types";

const CART_KEY = "tk-client-cart-v1";
const CHECKOUT_KEY = "tk-client-checkout-v1";
const CHECKOUT_PROGRESS_KEY = "tk-client-checkout-progress-v1";
const LOCALE_KEY = "tk-client-locale";
const IDEMPOTENCY_KEY = "tk-client-pending-intent";
const ADDITION_IDEMPOTENCY_KEY_PREFIX = "tk-client-pending-addition.";
const PUBLIC_DATA_KEY_PREFIX = "tk.menu.v2.";
const LEGACY_PUBLIC_DATA_KEY = "tk-client-public-menu-v2";
const CHECKOUT_DRAFT_TTL_MS = 12 * 60 * 60 * 1000;
const PUBLIC_DATA_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface CheckoutProgress {
  version: 1;
  cartSignature: string;
  calculation: Calculation;
  cashLocation: CashLocationChallenge | null;
  savedAt: string;
}

export interface CachedPublicData {
  version: 2;
  locale: Locale;
  menu_revision: number;
  categories: Category[];
  savedAt: string;
}

interface StoredCheckoutDraft {
  version: 1;
  draft: Partial<CheckoutDraft> & { details?: string };
  savedAt: string;
}

let legacySensitiveLocalStorageCleared = false;

function clearLegacySensitiveLocalStorage(): void {
  if (legacySensitiveLocalStorageCleared) return;
  legacySensitiveLocalStorageCleared = true;
  removeLocalStorageItem(CHECKOUT_KEY);
  removeLocalStorageItem(CHECKOUT_PROGRESS_KEY);
  removeLocalStorageItem(IDEMPOTENCY_KEY);
}

function removeLocalStorageItem(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore storage access errors
  }
}

function removeSessionStorageItem(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // ignore storage access errors
  }
}

const emptyCheckoutDraft = (): CheckoutDraft => ({
  phone: "",
  street: "",
  houseNumber: "",
  entrance: "",
  floor: "",
  apartment: "",
  comment: "",
});

export function loadCart(): CartState {
  try {
    const parsed = JSON.parse(localStorage.getItem(CART_KEY) || "");
    if (parsed?.version === 1 && parsed.lines && typeof parsed.lines === "object") {
      return parsed;
    }
  } catch {
    // ignore corrupted local state
  }
  return { version: 1, lines: {} };
}

export function saveCart(cart: CartState): void {
  try {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
  } catch {
    // Cart persistence is best-effort; current in-memory state stays usable.
  }
}

export function clearCart(): void {
  removeLocalStorageItem(CART_KEY);
}

export function upsertCartLine(cart: CartState, line: CartLine): CartState {
  const next = { ...cart.lines };
  if (line.quantity <= 0) {
    delete next[line.itemId];
  } else {
    next[line.itemId] = line;
  }
  return { version: 1, lines: next };
}

export function loadCheckoutDraft(): CheckoutDraft {
  clearLegacySensitiveLocalStorage();
  try {
    const parsed = JSON.parse(sessionStorage.getItem(CHECKOUT_KEY) || "") as StoredCheckoutDraft;
    if (parsed?.version === 1 && parsed.draft && isRecent(parsed.savedAt, CHECKOUT_DRAFT_TTL_MS)) {
      return normalizeCheckoutDraft(parsed.draft);
    }
    removeSessionStorageItem(CHECKOUT_KEY);
  } catch {
    removeSessionStorageItem(CHECKOUT_KEY);
  }
  return emptyCheckoutDraft();
}

export function saveCheckoutDraft(draft: CheckoutDraft): void {
  try {
    sessionStorage.setItem(CHECKOUT_KEY, JSON.stringify({
      version: 1,
      draft,
      savedAt: new Date().toISOString(),
    } satisfies StoredCheckoutDraft));
  } catch {
    // Checkout draft persistence is best-effort and must not break ordering.
  }
}

function normalizeCheckoutDraft(draft: Partial<CheckoutDraft> & { details?: string }): CheckoutDraft {
  const next = { ...emptyCheckoutDraft(), ...draft };
  if (!next.houseNumber && next.street) {
    const match = next.street.trim().match(/^(.+?)\s+([0-9][0-9A-Za-zА-Яа-я./-]*)$/u);
    if (match) {
      next.street = match[1].trim();
      next.houseNumber = match[2].trim();
    }
  }

  if (draft.details && !next.entrance && !next.floor && !next.apartment) {
    const parts = draft.details
      .split(/[,;]+/)
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length >= 3) {
      next.entrance = parts[0];
      next.floor = parts[1];
      next.apartment = parts.slice(2).join(", ");
    } else if (parts.length === 2) {
      next.entrance = parts[0];
      next.apartment = parts[1];
    } else if (parts.length === 1) {
      next.apartment = parts[0];
    }
  }

  return next;
}

export function checkoutCartSignature(lines: CartLine[]): string {
  return lines
    .map((line) => `${line.itemId}:${line.quantity}:${line.unitPriceMinor}:${line.menuVersion}`)
    .sort()
    .join("|");
}

export function loadCheckoutProgress(cartSignature: string): CheckoutProgress | null {
  clearLegacySensitiveLocalStorage();
  if (!cartSignature) return null;
  try {
    const parsed = JSON.parse(sessionStorage.getItem(CHECKOUT_PROGRESS_KEY) || "") as CheckoutProgress;
    if (parsed?.version !== 1 || parsed.cartSignature !== cartSignature || !isFuture(parsed.calculation?.expires_at)) {
      clearCheckoutProgress();
      return null;
    }
    if (parsed.cashLocation && !isFuture(parsed.cashLocation.expires_at)) {
      return { ...parsed, cashLocation: null };
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveCheckoutProgress(cartSignature: string, calculation: Calculation | null, cashLocation: CashLocationChallenge | null): void {
  if (!cartSignature || !calculation || !isFuture(calculation.expires_at)) {
    clearCheckoutProgress();
    return;
  }
  const progress: CheckoutProgress = {
    version: 1,
    cartSignature,
    calculation,
    cashLocation: cashLocation && isFuture(cashLocation.expires_at) ? cashLocation : null,
    savedAt: new Date().toISOString(),
  };
  try {
    sessionStorage.setItem(CHECKOUT_PROGRESS_KEY, JSON.stringify(progress));
  } catch {
    // Progress cache is an accelerator only.
  }
}

export function clearCheckoutProgress(): void {
  removeSessionStorageItem(CHECKOUT_PROGRESS_KEY);
}

export function loadLocale(fallback: Locale): Locale {
  try {
    const stored = localStorage.getItem(LOCALE_KEY);
    return stored === "sr" || stored === "en" || stored === "ru" ? stored : fallback;
  } catch {
    return fallback;
  }
}

export function saveLocale(locale: Locale): void {
  try {
    localStorage.setItem(LOCALE_KEY, locale);
  } catch {
    // Locale can fall back to Telegram/browser language on next load.
  }
}

export function loadCachedPublicData(locale: Locale): CachedPublicData | null {
  const key = publicDataKey(locale);
  try {
    removeLocalStorageItem(LEGACY_PUBLIC_DATA_KEY);
    const parsed = JSON.parse(localStorage.getItem(key) || "") as CachedPublicData;
    if (
      parsed?.version === 2 &&
      parsed.locale === locale &&
      typeof parsed.menu_revision === "number" &&
      Array.isArray(parsed.categories) &&
      isRecent(parsed.savedAt, PUBLIC_DATA_TTL_MS)
    ) {
      return parsed;
    }
    removeLocalStorageItem(key);
  } catch {
    // Public cache is only a startup accelerator.
    removeLocalStorageItem(key);
  }
  return null;
}

export function saveCachedPublicData(locale: Locale, menuRevision: number, categories: Category[]): void {
  try {
    removeLocalStorageItem(LEGACY_PUBLIC_DATA_KEY);
    localStorage.setItem(publicDataKey(locale), JSON.stringify({
      version: 2,
      locale,
      menu_revision: menuRevision,
      categories,
      savedAt: new Date().toISOString(),
    } satisfies CachedPublicData));
  } catch {
    // Public cache is best-effort and never required for checkout correctness.
  }
}

function publicDataKey(locale: Locale): string {
  return `${PUBLIC_DATA_KEY_PREFIX}${locale}`;
}

export function pendingIdempotencyKey(): string {
  clearLegacySensitiveLocalStorage();
  try {
    let key = sessionStorage.getItem(IDEMPOTENCY_KEY);
    if (!key) {
      key = crypto.randomUUID();
      sessionStorage.setItem(IDEMPOTENCY_KEY, key);
    }
    return key;
  } catch {
    return crypto.randomUUID();
  }
}

export function resetPendingIdempotencyKey(): void {
  removeSessionStorageItem(IDEMPOTENCY_KEY);
}

export function pendingAdditionIdempotencyKey(orderId: string, signature: string): string {
  clearLegacySensitiveLocalStorage();
  const key = `${ADDITION_IDEMPOTENCY_KEY_PREFIX}${orderId}.${signature}`;
  try {
    let value = sessionStorage.getItem(key);
    if (!value) {
      value = crypto.randomUUID();
      sessionStorage.setItem(key, value);
    }
    return value;
  } catch {
    return crypto.randomUUID();
  }
}

export function resetPendingAdditionIdempotencyKey(orderId: string): void {
  try {
    for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = sessionStorage.key(index);
      if (key?.startsWith(`${ADDITION_IDEMPOTENCY_KEY_PREFIX}${orderId}.`)) {
        removeSessionStorageItem(key);
      }
    }
  } catch {
    // ignore storage access errors
  }
}

function isFuture(value: string | undefined): boolean {
  if (!value) return false;
  const expiresAt = new Date(value).getTime();
  return Number.isFinite(expiresAt) && expiresAt > Date.now() + 3000;
}

function isRecent(value: string | undefined, ttlMs: number): boolean {
  if (!value) return false;
  const savedAt = new Date(value).getTime();
  return Number.isFinite(savedAt) && Date.now() - savedAt <= ttlMs;
}
