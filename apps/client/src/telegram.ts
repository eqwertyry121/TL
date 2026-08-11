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
    user?: TelegramUserProfile;
  };
  BackButton?: TelegramBackButton;
  ready(): void;
  expand(): void;
  requestContact?(callback: (ok: boolean, contact?: { phone_number?: string; user_id?: number }) => void): void;
  openTelegramLink?(url: string): void;
  HapticFeedback?: {
    impactOccurred(style: "light" | "medium" | "heavy"): void;
  };
}

export interface TelegramUserProfile {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  language_code?: string;
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

export function telegramUser(): TelegramUserProfile | null {
  return telegram()?.initDataUnsafe?.user || null;
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

export function requestTelegramContact(): Promise<boolean> {
  const app = telegram();
  if (!app?.requestContact) return Promise.resolve(false);
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(false), 12000);
    app.requestContact?.((ok) => {
      window.clearTimeout(timer);
      resolve(Boolean(ok));
    });
  });
}

export function openTelegramLink(url: string): void {
  const app = telegram();
  if (app?.openTelegramLink) {
    app.openTelegramLink(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

export function haptic(): void {
  telegram()?.HapticFeedback?.impactOccurred("light");
}

export function rawInitData(): string {
  return telegram()?.initData || "";
}
