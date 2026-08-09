import type { Order } from "@tk-delivery/api-client/generated";

const demoOrdersKey = "tk-client-demo-orders-v1";

export type StaffRole = "KITCHEN" | "COURIER";

export interface StaffSession {
  token: string;
  active_role: StaffRole;
  expires_at: string;
}

export interface StaffApi {
  mode: "real" | "demo";
  authenticate(role: StaffRole): Promise<StaffSession>;
  listKitchenOrders(token: string): Promise<{ orders: Order[] }>;
  listCourierOrders(token: string): Promise<{ orders: Order[] }>;
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
  const from = new Date(order.ready_at || order.created_at).getTime();
  const minutes = Math.max(0, Math.floor((Date.now() - from) / 60000));
  if (minutes < 1) return "только что";
  if (minutes === 1) return "1 минута";
  if (minutes < 5) return `${minutes} минуты`;
  return `${minutes} минут`;
}

export function paymentText(order: Order): string {
  if (order.payment_method === "cash") return `Наличными ${money(order.total_minor)}`;
  return "Оплачен";
}

export function problemLink(order: Order): string {
  return `https://t.me/TakoLako_main_bot?text=${encodeURIComponent(`Проблема с заказом #${order.public_number}`)}`;
}

export function mapLink(address?: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address || "")}`;
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
