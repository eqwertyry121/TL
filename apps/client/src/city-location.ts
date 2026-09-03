interface LocationData {
  latitude: number;
  longitude: number;
  horizontal_accuracy?: number | null;
}

interface LocationManager {
  isInited?: boolean;
  isLocationAvailable?: boolean;
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
          if (!location) return finish({ status: "denied" });
          if (!Number.isFinite(location.latitude) || !Number.isFinite(location.longitude) ||
              Math.abs(location.latitude) > 90 || Math.abs(location.longitude) > 180) {
            return finish({ status: "unavailable" });
          }
          finish({ status: "success", location });
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
