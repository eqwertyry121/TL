interface LocationData {
  latitude: number;
  longitude: number;
  horizontal_accuracy?: number | null;
}

interface LocationManager {
  isInited?: boolean;
  isLocationAvailable?: boolean;
  isAccessGranted?: boolean;
  init(callback?: () => void): void;
  getLocation(callback: (location: LocationData | null) => void): void;
}

type LocationResult =
  | { status: "success"; location: LocationData }
  | { status: "unavailable" | "denied" | "timeout" };

// One native request per tap. No automatic browser prompt or bot navigation.
export function requestCityLocation(manager?: LocationManager, timeoutMs = 15000): Promise<LocationResult> {
  if (!manager) return Promise.resolve({ status: "unavailable" });
  return new Promise((resolve) => {
    let done = false;
    const finish = (result: LocationResult) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => finish({ status: "timeout" }), timeoutMs);
    const request = () => {
      if (done) return;
      if (manager.isLocationAvailable === false) return finish({ status: "unavailable" });
      try {
        manager.getLocation((location) => {
          if (!location) return finish({ status: manager.isAccessGranted === true ? "unavailable" : "denied" });
          if (!Number.isFinite(location.latitude) || !Number.isFinite(location.longitude) ||
              Math.abs(location.latitude) > 90 || Math.abs(location.longitude) > 180) {
            return finish({ status: "unavailable" });
          }
          // Telegram also returns altitude/course/speed. The API deliberately
          // accepts only the fields needed for the city check.
          const coordinates: LocationData = { latitude: location.latitude, longitude: location.longitude };
          if (typeof location.horizontal_accuracy === "number" && Number.isFinite(location.horizontal_accuracy)) {
            coordinates.horizontal_accuracy = location.horizontal_accuracy;
          }
          finish({ status: "success", location: coordinates });
        });
      } catch {
        finish({ status: "unavailable" });
      }
    };
    try {
      if (manager.isInited) request();
      else manager.init(request);
    } catch {
      finish({ status: "unavailable" });
    }
  });
}

export type CityLocationFailure = "denied" | "unavailable" | "timeout" | "inaccurate" | "outside" | "retry";

interface LocationSettingsManager {
  isInited?: boolean;
  isLocationAvailable?: boolean;
  isAccessRequested?: boolean;
  isAccessGranted?: boolean;
  openSettings?(): void;
}

export function canOpenCityLocationSettings(manager?: LocationSettingsManager): boolean {
  return Boolean(manager?.isInited && manager.isLocationAvailable !== false &&
    manager.isAccessRequested && !manager.isAccessGranted && typeof manager.openSettings === "function");
}

// Call synchronously from a tap, never on mount or from an animation timer.
export function openCityLocationSettings(manager?: LocationSettingsManager): boolean {
  if (!manager?.openSettings || !canOpenCityLocationSettings(manager)) return false;
  try {
    manager.openSettings();
    return true;
  } catch {
    return false;
  }
}

export function cityLocationFailure(challenge: { status: string; rejection_reason?: string }): CityLocationFailure | null {
  if (challenge.status === "VERIFIED") return null;
  if (challenge.rejection_reason === "OUTSIDE_CASH_AREA") return "outside";
  if (["LOCATION_INACCURATE", "LOCATION_ACCURACY_MISSING"].includes(challenge.rejection_reason || "")) return "inaccurate";
  return "retry";
}

export function cityLocationHelpCopy(locale: string) {
  if (locale === "sr") return {
    permissionButton: "Dozvoli pristup lokaciji",
    permissionTitle: "Proverimo grad dostave",
    permissionDescription: "Uključite Geolocation u Telegramu.",
    permissionWaiting: "Dozvolite pristup u Telegramu. Provera će se nastaviti automatski.",
    permissionFailed: "Telegram nije potvrdio pristup. Pokušajte ponovo.",
    checking: "Proveravamo grad…",
    off: "Isključeno",
    on: "Uključite",
    offAlt: "Telegram: prekidač Geolocation je isključen",
    onAlt: "Telegram: prekidač Geolocation je uključen",
    support: "Problem? Pišite",
    messages: {
      denied: "Dozvolite Telegramu pristup lokaciji.",
      unavailable: "Uključite lokaciju na telefonu i dozvolite Telegramu da je koristi u podešavanjima telefona. Zatim pokušajte ponovo ili potvrdite preko bota.",
      timeout: "Telefon nije poslao lokaciju na vreme. Proverite da je lokacija uključena i pokušajte ponovo.",
      inaccurate: "Signal nije dovoljno precizan. U podešavanjima telefona dozvolite Telegramu preciznu lokaciju, priđite prozoru i pokušajte ponovo.",
      outside: "Nismo potvrdili da ste u zoni dostave. Ako ste u Novom Sadu, pokušajte ponovo sa preciznom lokacijom. Dostupan je i izbor preuzimanja.",
      retry: "Provera nije završena. Proverite internet vezu i pokušajte ponovo.",
    },
  };
  if (locale === "en") return {
    permissionButton: "Allow location access",
    permissionTitle: "Check your delivery city",
    permissionDescription: "Switch on Geolocation in Telegram.",
    permissionWaiting: "Allow access in Telegram. The check will continue automatically.",
    permissionFailed: "Telegram did not confirm access. Please try again.",
    checking: "Checking your city…",
    off: "Off",
    on: "Switch on",
    offAlt: "Telegram: Geolocation switch off",
    onAlt: "Telegram: Geolocation switch on",
    support: "Having trouble? Message",
    messages: {
      denied: "Allow Telegram to access your location.",
      unavailable: "Turn on location on your phone and allow Telegram to use it in your phone settings. Then retry or confirm through the bot.",
      timeout: "Your phone did not send its location in time. Check that location is on and try again.",
      inaccurate: "The signal is not accurate enough. Allow precise location for Telegram in your phone settings, move near a window and retry.",
      outside: "We could not confirm you are in the delivery area. If you are in Novi Sad, retry with precise location. You can also choose pickup.",
      retry: "The check did not finish. Check your internet connection and try again.",
    },
  };
  return {
    permissionButton: "Дать разрешение на геолокацию",
    permissionTitle: "Проверим город доставки",
    permissionDescription: "Включите Geolocation в Telegram.",
    permissionWaiting: "Разрешите доступ в Telegram. Проверка продолжится автоматически.",
    permissionFailed: "Telegram не подтвердил доступ. Попробуйте ещё раз.",
    checking: "Проверяем город…",
    off: "Выключено",
    on: "Включите",
    offAlt: "Telegram: переключатель Geolocation выключен",
    onAlt: "Telegram: переключатель Geolocation включён",
    support: "Возникла проблема? Написать",
    messages: {
      denied: "Разрешите Telegram доступ к геолокации.",
      unavailable: "Включите геолокацию на телефоне и разрешите Telegram использовать её в настройках телефона. Затем повторите проверку или подтвердите через бота.",
      timeout: "Телефон не передал местоположение вовремя. Проверьте, что геолокация включена, и повторите попытку.",
      inaccurate: "Сигнал недостаточно точный. В настройках телефона разрешите Telegram точную геолокацию, подойдите к окну и повторите проверку.",
      outside: "Не удалось подтвердить, что вы в зоне доставки. Если вы в Нови-Саде, повторите проверку с точной геолокацией. Также можно выбрать самовывоз.",
      retry: "Проверка не завершилась. Проверьте интернет и попробуйте ещё раз.",
    },
  };
}

export function cityLocationCopy(locale: string) {
  if (locale === "sr") return {
    description: "Jednom proveravamo da ste u Novom Sadu. Tačne koordinate se ne čuvaju.",
    fallback: "Lokacija nije dostupna u aplikaciji. Pokušajte ponovo ili potvrdite preko bota.",
    bot: "Potvrdi preko bota",
  };
  if (locale === "en") return {
    description: "We check once that you are in Novi Sad. Exact coordinates are not stored.",
    fallback: "Location is unavailable in the app. Try again or confirm through the bot.",
    bot: "Confirm through the bot",
  };
  return {
    description: "Один раз проверим, что вы в Нови-Саде. Точные координаты не сохраняем.",
    fallback: "Не удалось получить местоположение в приложении. Повторите или подтвердите через бота.",
    bot: "Подтвердить через бота",
  };
}
