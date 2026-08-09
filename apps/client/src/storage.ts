import type { CartLine, CartState, CheckoutDraft, Locale } from "./types";

const CART_KEY = "tk-client-cart-v1";
const CHECKOUT_KEY = "tk-client-checkout-v1";
const LOCALE_KEY = "tk-client-locale";
const IDEMPOTENCY_KEY = "tk-client-pending-intent";

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
