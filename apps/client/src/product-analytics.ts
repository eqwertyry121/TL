export interface ProductEvent {
  name: "screen_view" | "click";
  screen: string;
  target: string;
}

interface ProductAnalyticsOptions {
  screen(): string;
  send(events: ProductEvent[]): Promise<void>;
}

const flushDelayMS = 1500;
const maxBatchSize = 25;

export function installProductAnalytics(options: ProductAnalyticsOptions): () => void {
  let queue: ProductEvent[] = [];
  let timer = 0;
  let stopped = false;

  const flush = () => {
    window.clearTimeout(timer);
    timer = 0;
    if (!queue.length) return;
    const events = queue.splice(0, maxBatchSize);
    void options.send(events).catch(() => undefined);
    if (queue.length) timer = window.setTimeout(flush, flushDelayMS);
  };
  const enqueue = (event: ProductEvent) => {
    if (stopped) return;
    queue.push(event);
    if (queue.length >= maxBatchSize) flush();
    else if (!timer) timer = window.setTimeout(flush, flushDelayMS);
  };
  const trackScreen = () => enqueue({ name: "screen_view", screen: safeScreen(options.screen()), target: "" });
  const onClick = (event: MouseEvent) => {
    const origin = event.target instanceof Element ? event.target : null;
    const interactive = origin?.closest<HTMLElement>("button, a, [role='button']");
    if (!interactive) return;
    const screen = safeScreen(options.screen());
    enqueue({ name: "click", screen, target: analyticsTarget(interactive, screen) });
  };
  const onHashChange = () => window.setTimeout(trackScreen, 0);
  const onPageHide = () => flush();

  document.addEventListener("click", onClick, true);
  window.addEventListener("hashchange", onHashChange);
  window.addEventListener("pagehide", onPageHide);
  trackScreen();

  return () => {
    document.removeEventListener("click", onClick, true);
    window.removeEventListener("hashchange", onHashChange);
    window.removeEventListener("pagehide", onPageHide);
    flush();
    stopped = true;
  };
}

function analyticsTarget(element: HTMLElement, screen: string): string {
  const explicit = safeLabel(element.dataset.analytics || "");
  if (explicit) return `${screen}:${explicit}`;

  if (element instanceof HTMLAnchorElement) {
    const href = element.getAttribute("href") || "";
    if (href.startsWith("#/")) return `${screen}:navigate_${safeLabel(href.slice(2).split(/[/?]/)[0] || "menu")}`;
    if (href.startsWith("#")) return `${screen}:navigate_internal`;
    try {
      const url = new URL(href, window.location.href);
      if (url.hostname === "t.me" || url.hostname.endsWith(".telegram.me")) return `${screen}:open_telegram`;
      if (url.origin !== window.location.origin) return `${screen}:open_external`;
    } catch {
      return `${screen}:link`;
    }
    return `${screen}:link`;
  }

  const aria = safeLabel(element.getAttribute("aria-label") || "");
  if (aria) return `${screen}:button_${aria}`;
  const text = safeLabel(element.textContent || "");
  if (text) return `${screen}:button_${text}`;
  const stableClasses = [...element.classList]
    .filter((name) => !["active", "disabled", "selected", "open"].includes(name))
    .slice(0, 3)
    .join("_");
  return `${screen}:button_${safeLabel(stableClasses) || "unlabelled"}`;
}

function safeScreen(value: string): string {
  return ["menu", "dish", "cart", "checkout", "order", "orders", "booking", "support", "terms", "returns", "privacy"].includes(value)
    ? value
    : "unknown";
}

function safeLabel(value: string): string {
  return value
    .toLocaleLowerCase("ru-RU")
    .replace(/@[\p{L}\p{N}_]+/gu, "user")
    .replace(/#\d+/g, "number")
    .replace(/\b\d{1,2}:\d{2}\b/g, "time")
    .replace(/\d+/g, "n")
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}
