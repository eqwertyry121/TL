import type { Order } from "@tk-delivery/api-client/generated";
export { startVisiblePolling } from "@tk-delivery/api-client/polling";

const demoOrdersKey = "tk-client-demo-orders-v1";
const getCache = new Map<string, { etag: string; payload: unknown }>();
const getCacheLimit = 64;

export type StaffRole = "KITCHEN" | "COURIER";

export interface StaffSession {
  token: string;
  telegram_user_id?: number;
  username?: string;
  first_name?: string;
  photo_url?: string;
  active_role: StaffRole;
  expires_at: string;
}

export interface StaffApi {
  mode: "real" | "demo";
  bootstrap(role: StaffRole): Promise<{ session: StaffSession; orders: Order[] }>;
  authenticate(role: StaffRole): Promise<StaffSession>;
  listKitchenOrders(token: string, signal?: AbortSignal): Promise<{ orders: Order[] }>;
  listCourierOrders(token: string, signal?: AbortSignal): Promise<{ orders: Order[] }>;
  sendCourierETA(token: string, id: string, minutes: number): Promise<{ ok: boolean }>;
  startCourierDelivery(token: string, id: string, idempotencyKey: string, expectedVersion: number): Promise<Order>;
  resetCourierDelivery(token: string, id: string, idempotencyKey: string, expectedVersion: number): Promise<Order>;
  startKitchenPreparation(token: string, id: string, idempotencyKey: string, expectedVersion: number): Promise<Order>;
  resetKitchenPreparation(token: string, id: string, idempotencyKey: string, expectedVersion: number): Promise<Order>;
  estimateKitchenReady(token: string, id: string, input: { ready_in_minutes?: number; estimated_ready_at?: string; expected_version: number }, idempotencyKey: string): Promise<Order>;
  markReady(token: string, id: string, idempotencyKey: string, expectedVersion: number): Promise<Order>;
  markPickupCollected(token: string, id: string, idempotencyKey: string, expectedVersion: number): Promise<Order>;
  markDelivered(token: string, id: string, idempotencyKey: string, expectedVersion: number): Promise<Order>;
}

export interface StaffApiError extends Error {
  code: string;
  status?: number;
}

interface DemoOrder extends Order {
  __key?: string;
}

export function createStaffApi(role: StaffRole): StaffApi {
  const env = runtimeEnv();
  const appEnv = stringEnv(env.VITE_APP_ENV) || (env.PROD ? "production" : "development");
  const demoMode = env.VITE_DEMO_MODE === "true" && appEnv !== "production";
  const baseURL = stringEnv(env.VITE_API_BASE_URL);
  if (demoMode || (appEnv !== "production" && !baseURL)) return demoApi(role);
  if (!baseURL) return unconfiguredApi();
  return realApi(baseURL, appEnv);
}

export function money(value: number): string {
  return new Intl.NumberFormat("ru-RU").format(value) + " RSD";
}

export function sameOrderSnapshot(current: Order[], incoming: Order[]): boolean {
  if (current === incoming) return true;
  if (current.length !== incoming.length) return false;
  return current.every((order, index) => {
    const next = incoming[index];
    return Boolean(next) && order.id === next.id && order.version === next.version;
  });
}

export function orderAge(order: Order): string {
  return elapsedSince(order.ready_at || order.created_at);
}

export function kitchenTimeText(order: Order): string {
  if (orderFulfillmentType(order) === "pickup" && order.fulfillment_status === "READY_FOR_PICKUP") {
    return `Готов ${elapsedSince(order.ready_at || order.created_at)}`;
  }
  return `Создан ${elapsedSince(order.created_at)}`;
}

export function courierTimeText(order: Order): string {
  return `Готов ${elapsedSince(order.ready_at || order.created_at)}`;
}

export function clientLabel(order: Order): string {
  const username = telegramUsername(order);
  if (username) return `@${username}`;
  const firstName = (order.client_first_name || "").trim();
  if (firstName) return firstName;
  return "Клиент Telegram";
}

function elapsedSince(value: string): string {
  const from = new Date(value).getTime();
  const minutes = Math.max(0, Math.floor((Date.now() - from) / 60000));
  if (minutes < 1) return "только что";
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) return rest ? `${hours} ч ${rest} мин назад` : `${hours} ч назад`;
  const days = Math.floor(hours / 24);
  return `${days} д назад`;
}

export function paymentText(order: Order): string {
  if (order.payment_method === "cash") return orderFulfillmentType(order) === "pickup" ? `Наличными при самовывозе ${money(order.total_minor)}` : `Наличными ${money(order.total_minor)}`;
  if (order.payment_method === "crypto") return "Crypto TEST · оплачено";
  if (order.payment_method === "card") return "Карта · оплачено";
  return "Оплачен";
}

export function problemLink(order: Order): string {
  return `https://t.me/Tako_Lako?text=${encodeURIComponent(`Проблема с заказом #${order.public_number}`)}`;
}

export function mapLink(address?: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address || "")}`;
}

export function telegramUsername(order: Order): string {
  const username = (order.client_username || "").trim().replace(/^@+/, "");
  return /^[A-Za-z0-9_]{5,32}$/.test(username) ? username : "";
}

export function telegramUserLink(order: Order, draftText = ""): string | undefined {
  const username = telegramUsername(order);
  if (!username) return undefined;
  const query = draftText ? `?text=${encodeURIComponent(draftText)}` : "";
  return `https://t.me/${username}${query}`;
}

export function courierEtaText(minutes: number): string {
  return `курьер TakoLako: приеду к вам через ${minutes} минут`;
}

export function courierEtaLink(order: Order, minutes: number): string | undefined {
  return telegramUserLink(order, courierEtaText(minutes));
}

export function openTelegramLink(url: string): boolean {
  const webApp = window.Telegram?.WebApp;
  if (webApp?.openTelegramLink) {
    webApp.openTelegramLink(url);
    return true;
  }
  return window.open(url, "_blank", "noopener,noreferrer") !== null;
}

export function isAuthError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; status?: unknown };
  const code = typeof candidate.code === "string" ? candidate.code : "";
  const status = typeof candidate.status === "number" ? candidate.status : 0;
  return status === 401 || status === 403 || code === "AUTH_INVALID" || code === "FORBIDDEN";
}

function realApi(baseURL: string, appEnv: string): StaffApi {
  const authenticate = async (role: StaffRole) => {
    const initData = rawInitData();
    if (appEnv === "production" && !initData) {
      throw staffApiError("TELEGRAM_INIT_DATA_MISSING");
    }
    const response =
      appEnv === "production"
        ? await post(`${baseURL}/api/v1/auth/telegram`, {
            audience: "staff",
            role,
            init_data: initData,
          })
        : await post(`${baseURL}/api/v1/dev/session`, { telegram_user_id: 1048084234, role });
    return response.session;
  };
  return {
    mode: "real",
    async bootstrap(role) {
      const initData = rawInitData();
      try {
        const response = await post(`${baseURL}/api/v1/bootstrap/staff`, { role, init_data: initData });
        return { session: response.session, orders: response.orders };
      } catch (err) {
        if (!isMissingEndpoint(err)) throw err;
      }
      const session = await authenticate(role);
      const orders = role === "KITCHEN"
        ? await get(`${baseURL}/api/v1/kitchen/orders`, session.token)
        : await get(`${baseURL}/api/v1/courier/orders`, session.token);
      return { session, orders: orders.orders };
    },
    authenticate,
    listKitchenOrders: (token, signal) => get(`${baseURL}/api/v1/kitchen/orders`, token, signal),
    listCourierOrders: (token, signal) => get(`${baseURL}/api/v1/courier/orders`, token, signal),
    sendCourierETA: (token, id, minutes) => post(`${baseURL}/api/v1/courier/orders/${id}/eta`, { minutes }, token),
    startCourierDelivery: (token, id, idempotencyKey, expectedVersion) => post(`${baseURL}/api/v1/courier/orders/${id}/start`, { expected_version: expectedVersion }, token, { "Idempotency-Key": idempotencyKey }),
    resetCourierDelivery: (token, id, idempotencyKey, expectedVersion) => post(`${baseURL}/api/v1/courier/orders/${id}/delivery/reset`, { expected_version: expectedVersion }, token, { "Idempotency-Key": idempotencyKey }),
    startKitchenPreparation: (token, id, idempotencyKey, expectedVersion) => post(`${baseURL}/api/v1/kitchen/orders/${id}/start`, { expected_version: expectedVersion }, token, { "Idempotency-Key": idempotencyKey }),
    resetKitchenPreparation: (token, id, idempotencyKey, expectedVersion) => post(`${baseURL}/api/v1/kitchen/orders/${id}/preparation/reset`, { expected_version: expectedVersion }, token, { "Idempotency-Key": idempotencyKey }),
    estimateKitchenReady: (token, id, input, idempotencyKey) => post(`${baseURL}/api/v1/kitchen/orders/${id}/estimate-ready`, input, token, { "Idempotency-Key": idempotencyKey }),
    markReady: (token, id, idempotencyKey, expectedVersion) => post(`${baseURL}/api/v1/kitchen/orders/${id}/ready`, { expected_version: expectedVersion }, token, { "Idempotency-Key": idempotencyKey }),
    markPickupCollected: (token, id, idempotencyKey, expectedVersion) => post(`${baseURL}/api/v1/kitchen/orders/${id}/picked-up`, { expected_version: expectedVersion }, token, { "Idempotency-Key": idempotencyKey }),
    markDelivered: (token, id, idempotencyKey, expectedVersion) => post(`${baseURL}/api/v1/courier/orders/${id}/delivered`, { expected_version: expectedVersion }, token, { "Idempotency-Key": idempotencyKey }),
  };
}

function demoApi(role: StaffRole): StaffApi {
  const authenticate = async () => ({
    token: `demo-${role.toLowerCase()}-token`,
    telegram_user_id: 1048084234,
    active_role: role,
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  } satisfies StaffSession);
  const listOrders = () => role === "KITCHEN"
    ? loadDemoOrders().filter(isKitchenOrder).map(stripDemo)
    : loadDemoOrders().filter(isCourierOrder).map(stripDemo);
  return {
    mode: "demo",
    async bootstrap() {
      return { session: await authenticate(), orders: listOrders() };
    },
    authenticate,
    async listKitchenOrders() {
      return { orders: loadDemoOrders().filter(isKitchenOrder).map(stripDemo) };
    },
    async listCourierOrders() {
      return { orders: loadDemoOrders().filter(isCourierOrder).map(stripDemo) };
    },
    async sendCourierETA() {
      return { ok: true };
    },
    async startCourierDelivery(_token, id) {
      return updateDemoCourierDelivery(id, true);
    },
    async resetCourierDelivery(_token, id) {
      return updateDemoCourierDelivery(id, false);
    },
    async startKitchenPreparation(_token, id) {
      return updateDemoPreparation(id, true);
    },
    async resetKitchenPreparation(_token, id) {
      return updateDemoPreparation(id, false);
    },
    async estimateKitchenReady(_token, id, input) {
      const orders = loadDemoOrders();
      const order = orders.find((entry) => entry.id === id);
      if (!order) throw new Error("ORDER_NOT_FOUND");
      order.estimated_ready_at = input.estimated_ready_at || new Date(Date.now() + (input.ready_in_minutes || 30) * 60000).toISOString();
      order.estimated_ready_updated_at = new Date().toISOString();
      order.version += 1;
      saveDemoOrders(orders);
      return stripDemo(order);
    },
    async markReady(_token, id) {
      const order = loadDemoOrders().find((entry) => entry.id === id);
      return transitionDemoOrder(id, "NEW", orderFulfillmentType(order!) === "pickup" ? "READY_FOR_PICKUP" : "OUT_FOR_DELIVERY");
    },
    async markPickupCollected(_token, id) {
      return transitionDemoOrder(id, "READY_FOR_PICKUP", "DELIVERED", "pickup");
    },
    async markDelivered(_token, id) {
      return transitionDemoOrder(id, "OUT_FOR_DELIVERY", "DELIVERED", "delivery");
    },
  };
}

function unconfiguredApi(): StaffApi {
  const fail = async () => {
    throw Object.assign(new Error("SERVER_UNAVAILABLE"), { code: "SERVER_UNAVAILABLE" });
  };
  return {
    mode: "real",
    bootstrap: () => fail() as Promise<{ session: StaffSession; orders: Order[] }>,
    authenticate: () => fail() as Promise<StaffSession>,
    listKitchenOrders: fail,
    listCourierOrders: fail,
    sendCourierETA: fail,
    startCourierDelivery: fail,
    resetCourierDelivery: fail,
    startKitchenPreparation: fail,
    resetKitchenPreparation: fail,
    estimateKitchenReady: fail,
    markReady: fail,
    markPickupCollected: fail,
    markDelivered: fail,
  };
}

function runtimeEnv(): Record<string, string | boolean | undefined> {
  return ((import.meta as ImportMeta & { env?: Record<string, string | boolean | undefined> }).env || {});
}

function stringEnv(value: string | boolean | undefined): string {
  return typeof value === "string" ? value : "";
}

function rawInitData(): string {
  return window.Telegram?.WebApp?.initData || "";
}

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData?: string;
        openTelegramLink?: (url: string) => void;
      };
    };
  }
}

async function get(url: string, token?: string, signal?: AbortSignal) {
  const cacheKey = `${token || "public"}\n${url}`;
  const cached = getCache.get(cacheKey);
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  if (cached?.etag) headers["If-None-Match"] = cached.etag;
  const response = await fetch(url, { headers, signal });
  return read(response, cacheKey);
}

async function post(url: string, body: unknown, token?: string, headers: Record<string, string> = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: JSON.stringify(body),
  });
  return read(response);
}

async function read(response: Response, cacheKey?: string) {
  if (response.status === 304 && cacheKey) {
    const cached = getCache.get(cacheKey);
    if (cached) return cached.payload;
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = payload?.error?.code || "SERVER_UNAVAILABLE";
    throw staffApiError(code, response.status);
  }
  const etag = response.headers.get("ETag");
  if (cacheKey && etag) {
    rememberGetCache(cacheKey, etag, payload);
  }
  return payload;
}

function rememberGetCache(cacheKey: string, etag: string, payload: unknown): void {
  if (getCache.has(cacheKey)) getCache.delete(cacheKey);
  getCache.set(cacheKey, { etag, payload });
  while (getCache.size > getCacheLimit) {
    const oldestKey = getCache.keys().next().value;
    if (!oldestKey) return;
    getCache.delete(oldestKey);
  }
}

function staffApiError(code: string, status?: number): StaffApiError {
  return Object.assign(new Error(code), { code, status } satisfies Pick<StaffApiError, "code" | "status">);
}

function isMissingEndpoint(error: unknown): boolean {
  return typeof error === "object" && error !== null && "status" in error && (error as { status?: number }).status === 404;
}

function loadDemoOrders(): DemoOrder[] {
  try {
    return JSON.parse(localStorage.getItem(demoOrdersKey) || "[]");
  } catch {
    return [];
  }
}

function saveDemoOrders(orders: DemoOrder[]): void {
  localStorage.setItem(demoOrdersKey, JSON.stringify(orders));
}

function isKitchenOrder(order: Order): boolean {
  return order.fulfillment_status === "NEW" || (orderFulfillmentType(order) === "pickup" && order.fulfillment_status === "READY_FOR_PICKUP");
}

function isCourierOrder(order: Order): boolean {
  return orderFulfillmentType(order) === "delivery" && order.fulfillment_status === "OUT_FOR_DELIVERY";
}

function transitionDemoOrder(id: string, from: Order["fulfillment_status"], to: Order["fulfillment_status"], requiredFulfillmentType?: Order["fulfillment_type"]): Order {
  const orders = loadDemoOrders();
  const index = orders.findIndex((order) => order.id === id);
  const order = orders[index];
  if (!order || order.fulfillment_status !== from || (requiredFulfillmentType && orderFulfillmentType(order) !== requiredFulfillmentType)) {
    throw Object.assign(new Error("ORDER_STATUS_CONFLICT"), { code: "ORDER_STATUS_CONFLICT" });
  }
  const now = new Date().toISOString();
  const next: DemoOrder = {
    ...order,
    fulfillment_status: to,
    payment_status: to === "DELIVERED" && order.payment_method === "cash" ? "PAID" : order.payment_status,
    version: order.version + 1,
    ready_at: to === "OUT_FOR_DELIVERY" || to === "READY_FOR_PICKUP" ? now : order.ready_at,
    delivered_at: to === "DELIVERED" ? now : order.delivered_at,
  };
  orders[index] = next;
  saveDemoOrders(orders);
  window.dispatchEvent(new StorageEvent("storage", { key: demoOrdersKey }));
  return stripDemo(next);
}

function updateDemoPreparation(id: string, started: boolean): Order {
  const orders = loadDemoOrders();
  const index = orders.findIndex((order) => order.id === id);
  const order = orders[index];
  if (!order || order.fulfillment_status !== "NEW" || Boolean(order.kitchen_started_at) === started) {
    throw Object.assign(new Error("ORDER_STATUS_CONFLICT"), { code: "ORDER_STATUS_CONFLICT" });
  }
  const next: DemoOrder = {
    ...order,
    kitchen_started_at: started ? new Date().toISOString() : undefined,
    version: order.version + 1,
  };
  orders[index] = next;
  saveDemoOrders(orders);
  window.dispatchEvent(new StorageEvent("storage", { key: demoOrdersKey }));
  return stripDemo(next);
}

function updateDemoCourierDelivery(id: string, started: boolean): Order {
  const orders = loadDemoOrders();
  const index = orders.findIndex((order) => order.id === id);
  const order = orders[index];
  if (!order || order.fulfillment_status !== "OUT_FOR_DELIVERY" || Boolean(order.courier_started_at) === started) {
    throw Object.assign(new Error("ORDER_STATUS_CONFLICT"), { code: "ORDER_STATUS_CONFLICT" });
  }
  const next: DemoOrder = {
    ...order,
    courier_started_at: started ? new Date().toISOString() : undefined,
    version: order.version + 1,
  };
  orders[index] = next;
  saveDemoOrders(orders);
  window.dispatchEvent(new StorageEvent("storage", { key: demoOrdersKey }));
  return stripDemo(next);
}

function orderFulfillmentType(order: Order): Order["fulfillment_type"] {
  return order.fulfillment_type === "pickup" ? "pickup" : "delivery";
}

function stripDemo(order: DemoOrder): Order {
  const { __key, ...clean } = order;
  void __key;
  return clean;
}
