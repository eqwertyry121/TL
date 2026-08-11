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
  platform?: string;
  initDataUnsafe?: {
    user?: TelegramUserProfile;
  };
  BackButton?: TelegramBackButton;
  LocationManager?: TelegramLocationManager;
  ready(): void;
  expand(): void;
  isVersionAtLeast?(version: string): boolean;
  requestContact?(callback: (ok: boolean, contact?: { phone_number?: string; user_id?: number }) => void): void;
  openTelegramLink?(url: string): void;
  HapticFeedback?: {
    impactOccurred(style: "light" | "medium" | "heavy"): void;
  };
}

interface TelegramLocationManager {
  isInited?: boolean;
  isLocationAvailable?: boolean;
  isAccessRequested?: boolean;
  isAccessGranted?: boolean;
  init(callback?: () => void): void;
  getLocation(callback: (location: TelegramLocationData | null) => void): void;
  openSettings?(): void;
}

export interface TelegramLocationData {
  latitude: number;
  longitude: number;
  horizontal_accuracy?: number | null;
  altitude?: number | null;
  course?: number | null;
  speed?: number | null;
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

export function canRequestTelegramLocation(): boolean {
  const app = telegram();
  if (!app?.LocationManager) return false;
  return !app.isVersionAtLeast || app.isVersionAtLeast("8.0");
}

export function shouldRequestLocationInMiniApp(): boolean {
  if (!hasAnyLocationSource()) return false;
  const platform = (telegram()?.platform || "").toLowerCase();
  if (platform === "ios" || platform === "android" || platform === "android_x") return false;
  return true;
}

export async function requestTelegramLocation(): Promise<TelegramLocationData | null> {
  dismissSoftKeyboard();
  const telegramLocation = await requestTelegramLocationManager();
  if (telegramLocation) return telegramLocation;
  return requestBrowserLocation();
}

function requestTelegramLocationManager(): Promise<TelegramLocationData | null> {
  const app = telegram();
  const manager = app?.LocationManager;
  if (!manager || (app.isVersionAtLeast && !app.isVersionAtLeast("8.0"))) return Promise.resolve(null);

  return new Promise((resolve) => {
    let done = false;
    const finish = (location: TelegramLocationData | null) => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      resolve(normalizeLocation(location));
    };
    const request = () => {
      try {
        manager.getLocation((location) => finish(location));
      } catch {
        finish(null);
      }
    };
    const timer = window.setTimeout(() => finish(null), 15000);
    try {
      if (manager.isInited) {
        request();
      } else {
        manager.init(request);
      }
    } catch {
      finish(null);
    }
  });
}

function requestBrowserLocation(): Promise<TelegramLocationData | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve(normalizeLocation({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          horizontal_accuracy: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null,
        }));
      },
      () => resolve(null),
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 30000,
      },
    );
  });
}

function hasAnyLocationSource(): boolean {
  return canRequestTelegramLocation() || (typeof navigator !== "undefined" && Boolean(navigator.geolocation));
}

function normalizeLocation(location: TelegramLocationData | null | undefined): TelegramLocationData | null {
  if (!location || !Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)) return null;
  const normalized: TelegramLocationData = {
    latitude: location.latitude,
    longitude: location.longitude,
  };
  if (typeof location.horizontal_accuracy === "number" && Number.isFinite(location.horizontal_accuracy)) {
    normalized.horizontal_accuracy = location.horizontal_accuracy;
  }
  return normalized;
}

export function openTelegramLink(url: string): void {
  dismissSoftKeyboard();
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

function dismissSoftKeyboard(): void {
  const active = document.activeElement;
  if (active instanceof HTMLElement) active.blur();
}
