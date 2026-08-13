type PerformanceApp = "client" | "kitchen" | "courier" | "admin";

interface BeaconMetrics {
  app: PerformanceApp;
  route: string;
  build: string;
  ttfb_ms?: number;
  lcp_ms?: number;
  cls?: number;
  inp_ms?: number;
}

export function installPerformanceBeacon(app: PerformanceApp, routeProvider: () => string): () => void {
  const env = runtimeEnv();
  const baseURL = stringEnv(env.VITE_API_BASE_URL).replace(/\/+$/, "");
  if (!baseURL) return () => undefined;

  const sampleRate = normalizePerformanceBeaconSampleRate(stringEnv(env.VITE_PERF_BEACON_SAMPLE));
  if (sampleRate <= 0 || Math.random() >= sampleRate) return () => undefined;

  const build = sanitizePerformanceBeaconText(stringEnv(env.VITE_BUILD_SHA) || stringEnv(env.VITE_APP_VERSION) || "dev", 80);
  const metrics: BeaconMetrics = {
    app,
    route: sanitizePerformanceBeaconText(routeProvider() || "unknown", 64),
    build,
  };
  let sent = false;
  const observers: PerformanceObserver[] = [];

  const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  if (navigation && navigation.responseStart >= navigation.requestStart) {
    metrics.ttfb_ms = rounded(navigation.responseStart - navigation.requestStart);
  }

  observe("largest-contentful-paint", (entry) => {
    metrics.lcp_ms = rounded(entry.startTime);
  });

  observe("layout-shift", (entry) => {
    const shift = entry as PerformanceEntry & { value?: number; hadRecentInput?: boolean };
    if (!shift.hadRecentInput && typeof shift.value === "number") {
      metrics.cls = rounded((metrics.cls || 0) + shift.value, 4);
    }
  });

  observe("event", (entry) => {
    const duration = entry.duration;
    if (Number.isFinite(duration)) {
      metrics.inp_ms = rounded(Math.max(metrics.inp_ms || 0, duration));
    }
  }, { durationThreshold: 40 });

  const send = () => {
    if (sent) return;
    sent = true;
    metrics.route = sanitizePerformanceBeaconText(routeProvider() || metrics.route, 64);
    const body = JSON.stringify(metrics);
    const url = `${baseURL}/api/v1/performance/beacon`;
    if (navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
    } else {
      void fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
      }).catch(() => undefined);
    }
  };

  const onVisibilityChange = () => {
    if (document.visibilityState === "hidden") send();
  };
  window.addEventListener("pagehide", send);
  document.addEventListener("visibilitychange", onVisibilityChange);

  function observe(type: string, callback: (entry: PerformanceEntry) => void, extra: Record<string, unknown> = {}) {
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) callback(entry);
      });
      observer.observe({ type, buffered: true, ...extra } as PerformanceObserverInit);
      observers.push(observer);
    } catch {
      // Browser/WebView does not support this metric.
    }
  }

  return () => {
    window.removeEventListener("pagehide", send);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    observers.forEach((observer) => observer.disconnect());
  };
}

function rounded(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function normalizePerformanceBeaconSampleRate(value: string | undefined): number {
  const configuredSample = Number.parseFloat(value || "0.05");
  return Math.min(0.05, Math.max(0, Number.isFinite(configuredSample) ? configuredSample : 0.05));
}

export function sanitizePerformanceBeaconText(value: string, maxLength: number): string {
  const withoutQuery = value.split(/[?#]/, 1)[0] || "";
  return withoutQuery.replace(/[^a-zA-Z0-9._/-]/g, "_").slice(0, maxLength) || "unknown";
}

function runtimeEnv(): Record<string, string | boolean | undefined> {
  return ((import.meta as ImportMeta & { env?: Record<string, string | boolean | undefined> }).env || {});
}

function stringEnv(value: string | boolean | undefined): string {
  return typeof value === "string" ? value : "";
}
