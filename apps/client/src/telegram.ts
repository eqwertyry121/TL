import type { Locale, Route } from "./types";
import { telegramLocale } from "./i18n";

interface TelegramBackButton {
  show(): void;
  hide(): void;
  onClick(fn: () => void): void;
  offClick(fn: () => void): void;
}

interface TelegramWebApp {
  initData: string;
  initDataUnsafe?: {
    user?: {
      id: number;
      language_code?: string;
    };
  };
  BackButton?: TelegramBackButton;
  ready(): void;
  expand(): void;
  requestContact?(callback: (ok: boolean, contact?: { phone_number?: string; user_id?: number }) => void): void;
  HapticFeedback?: {
    impactOccurred(style: "light" | "medium" | "heavy"): void;
  };
}

declare global {
  interface Window {
    Telegram?: {
      WebApp?: TelegramWebApp;
    };
  }
}

export function telegram() {
  const app = window.Telegram?.WebApp;
  app?.ready();
  app?.expand();
  return app;
}

export function initialLocale(): Locale {
  return telegramLocale(telegram()?.initDataUnsafe?.user?.language_code);
}

export function syncBackButton(route: Route, onBack: () => void): () => void {
  const back = telegram()?.BackButton;
  if (!back) return () => undefined;
  if (route.name === "menu") {
    back.hide();
    return () => undefined;
  }
  back.show();
  back.onClick(onBack);
  return () => back.offClick(onBack);
}

export function requestTelegramContact(): Promise<string | null> {
  const app = telegram();
  if (!app?.requestContact) return Promise.resolve(null);
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(null), 12000);
    app.requestContact?.((ok, contact) => {
      window.clearTimeout(timer);
      resolve(ok && contact?.phone_number ? contact.phone_number : null);
    });
  });
}

export function haptic(): void {
  telegram()?.HapticFeedback?.impactOccurred("light");
}

export function rawInitData(): string {
  return telegram()?.initData || "";
}
