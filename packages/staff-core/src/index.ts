import type { Order } from "@tk-delivery/api-client/generated";

const demoOrdersKey = "tk-client-demo-orders-v1";

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
  authenticate(role: StaffRole): Promise<StaffSession>;
  listKitchenOrders(token: string): Promise<{ orders: Order[] }>;
  listCourierOrders(token: string): Promise<{ orders: Order[] }>;
  sendCourierETA(token: string, id: string, minutes: number): Promise<{ ok: boolean }>;
  markReady(token: string, id: string, idempotencyKey: string): Promise<Order>;
  markDelivered(token: string, id: string, idempotencyKey: string): Promise<Order>;
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

export function orderAge(order: Order): string {
  return elapsedSince(order.ready_at || order.created_at);
}

export function kitchenTimeText(order: Order): string {
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
  if (order.payment_method === "cash") return `Наличными ${money(order.total_minor)}`;
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

export function openTelegramLink(url: string): void {
  const webApp = window.Telegram?.WebApp;
  if (webApp?.openTelegramLink) {
    webApp.openTelegramLink(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

function realApi(baseURL: string, appEnv: string): StaffApi {
  return {
    mode: "real",
    async authenticate(role) {
      const response =
        appEnv === "production"
          ? await post(`${baseURL}/api/v1/auth/telegram`, {
              audience: "staff",
              role,
              init_data: rawInitData(),
            })
          : await post(`${baseURL}/api/v1/dev/session`, { telegram_user_id: 1048084234, role });
      return response.session;
    },
    listKitchenOrders: (token) => get(`${baseURL}/api/v1/kitchen/orders`, token),
    listCourierOrders: (token) => get(`${baseURL}/api/v1/courier/orders`, token),
    sendCourierETA: (token, id, minutes) => post(`${baseURL}/api/v1/courier/orders/${id}/eta`, { minutes }, token),
    markReady: (token, id, idempotencyKey) => post(`${baseURL}/api/v1/kitchen/orders/${id}/ready`, {}, token, { "Idempotency-Key": idempotencyKey }),
    markDelivered: (token, id, idempotencyKey) => post(`${baseURL}/api/v1/courier/orders/${id}/delivered`, {}, token, { "Idempotency-Key": idempotencyKey }),
  };
}

function demoApi(role: StaffRole): StaffApi {
  return {
    mode: "demo",
    async authenticate() {
      return {
        token: `demo-${role.toLowerCase()}-token`,
        telegram_user_id: 1048084234,
        active_role: role,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      };
    },
    async listKitchenOrders() {
      return { orders: loadDemoOrders().filter((order) => order.fulfillment_status === "NEW").map(stripDemo) };
    },
    async listCourierOrders() {
      return { orders: loadDemoOrders().filter((order) => order.fulfillment_status === "OUT_FOR_DELIVERY").map(stripDemo) };
    },
    async sendCourierETA() {
      return { ok: true };
    },
    async markReady(_token, id) {
      return transitionDemoOrder(id, "NEW", "OUT_FOR_DELIVERY");
    },
    async markDelivered(_token, id) {
      return transitionDemoOrder(id, "OUT_FOR_DELIVERY", "DELIVERED");
    },
  };
}

function unconfiguredApi(): StaffApi {
  const fail = async () => {
    throw Object.assign(new Error("SERVER_UNAVAILABLE"), { code: "SERVER_UNAVAILABLE" });
  };
  return {
    mode: "real",
    authenticate: () => fail() as Promise<StaffSession>,
    listKitchenOrders: fail,
    listCourierOrders: fail,
    sendCourierETA: fail,
    markReady: fail,
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

async function get(url: string, token?: string) {
  const response = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : undefined });
  return read(response);
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

async function read(response: Response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(new Error(payload?.error?.code || "SERVER_UNAVAILABLE"), { code: payload?.error?.code || "SERVER_UNAVAILABLE" });
  }
  return payload;
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

function transitionDemoOrder(id: string, from: Order["fulfillment_status"], to: Order["fulfillment_status"]): Order {
  const orders = loadDemoOrders();
  const index = orders.findIndex((order) => order.id === id);
  const order = orders[index];
  if (!order || order.fulfillment_status !== from) {
    throw Object.assign(new Error("ORDER_STATUS_CONFLICT"), { code: "ORDER_STATUS_CONFLICT" });
  }
  const now = new Date().toISOString();
  const next: DemoOrder = {
    ...order,
    fulfillment_status: to,
    payment_status: to === "DELIVERED" && order.payment_method === "cash" ? "PAID" : order.payment_status,
    version: order.version + 1,
    ready_at: to === "OUT_FOR_DELIVERY" ? now : order.ready_at,
    delivered_at: to === "DELIVERED" ? now : order.delivered_at,
  };
  orders[index] = next;
  saveDemoOrders(orders);
  window.dispatchEvent(new StorageEvent("storage", { key: demoOrdersKey }));
  return stripDemo(next);
}

function stripDemo(order: DemoOrder): Order {
  const { __key, ...clean } = order;
  void __key;
  return clean;
}
