import type { Calculation, CartLine, CartState, CashLocationChallenge, CheckoutDraft, Locale } from "./types";

const CART_KEY = "tk-client-cart-v1";
const CHECKOUT_KEY = "tk-client-checkout-v1";
const CHECKOUT_PROGRESS_KEY = "tk-client-checkout-progress-v1";
const LOCALE_KEY = "tk-client-locale";
const IDEMPOTENCY_KEY = "tk-client-pending-intent";

export interface CheckoutProgress {
  version: 1;
  cartSignature: string;
  calculation: Calculation;
  cashLocation: CashLocationChallenge | null;
  savedAt: string;
}

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
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
}

export function clearCart(): void {
  localStorage.removeItem(CART_KEY);
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
  try {
    return {
      phone: "",
      street: "",
      details: "",
      comment: "",
      ...JSON.parse(localStorage.getItem(CHECKOUT_KEY) || "{}"),
    };
  } catch {
    return { phone: "", street: "", details: "", comment: "" };
  }
}

export function saveCheckoutDraft(draft: CheckoutDraft): void {
  localStorage.setItem(CHECKOUT_KEY, JSON.stringify(draft));
}

export function checkoutCartSignature(lines: CartLine[]): string {
  return lines
    .map((line) => `${line.itemId}:${line.quantity}:${line.unitPriceMinor}:${line.menuVersion}`)
    .sort()
    .join("|");
}

export function loadCheckoutProgress(cartSignature: string): CheckoutProgress | null {
  if (!cartSignature) return null;
  try {
    const parsed = JSON.parse(localStorage.getItem(CHECKOUT_PROGRESS_KEY) || "") as CheckoutProgress;
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
  localStorage.setItem(CHECKOUT_PROGRESS_KEY, JSON.stringify(progress));
}

export function clearCheckoutProgress(): void {
  localStorage.removeItem(CHECKOUT_PROGRESS_KEY);
}

export function loadLocale(fallback: Locale): Locale {
  const stored = localStorage.getItem(LOCALE_KEY);
  return stored === "sr" || stored === "en" || stored === "ru" ? stored : fallback;
}

export function saveLocale(locale: Locale): void {
  localStorage.setItem(LOCALE_KEY, locale);
}

export function pendingIdempotencyKey(): string {
  let key = localStorage.getItem(IDEMPOTENCY_KEY);
  if (!key) {
    key = crypto.randomUUID();
    localStorage.setItem(IDEMPOTENCY_KEY, key);
  }
  return key;
}

export function resetPendingIdempotencyKey(): void {
  localStorage.removeItem(IDEMPOTENCY_KEY);
}

function isFuture(value: string | undefined): boolean {
  if (!value) return false;
  const expiresAt = new Date(value).getTime();
  return Number.isFinite(expiresAt) && expiresAt > Date.now() + 3000;
}
