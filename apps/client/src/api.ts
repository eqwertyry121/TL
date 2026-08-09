import type { AdminCategory, AdminMenuItem, Category, Order, Runtime, Settings } from "@tk-delivery/api-client/generated";
import { demoCategories, demoRuntime } from "./fixtures";
import { rawInitData } from "./telegram";
import type { Api, Calculation, CreateOrderInput, Locale, Session } from "./types";

const demoOrdersKey = "tk-client-demo-orders-v1";
const demoCalculationsKey = "tk-client-demo-calculations-v1";
const demoMenuKey = "tk-admin-demo-menu-v1";
const demoSettingsKey = "tk-admin-demo-settings-v1";

export function createApi(): Api {
  const appEnv = import.meta.env.VITE_APP_ENV || (import.meta.env.PROD ? "production" : "development");
  const demoMode = import.meta.env.VITE_DEMO_MODE === "true" && appEnv !== "production";
  const baseURL = import.meta.env.VITE_API_BASE_URL || "";
  if (demoMode || (appEnv !== "production" && !baseURL)) return demoApi();
  if (!baseURL) return unconfiguredApi();
  return realApi(baseURL);
}

function realApi(baseURL: string): Api {
  return {
    mode: "real",
    async authenticate(locale) {
      const response = await post(`${baseURL}/api/v1/auth/telegram`, {
        audience: "client",
        role: "CLIENT",
        init_data: rawInitData(),
        locale,
      });
      return response.session;
    },
    runtime: () => get(`${baseURL}/api/v1/runtime`),
    menu: (locale) => get(`${baseURL}/api/v1/menu?locale=${locale}`),
    calculate: (token, items) => post(`${baseURL}/api/v1/orders/calculate`, { items }, token),
    createOrder: (token, input, idempotencyKey) =>
      post(`${baseURL}/api/v1/orders`, input, token, { "Idempotency-Key": idempotencyKey }),
    getOrder: (token, id) => get(`${baseURL}/api/v1/orders/${id}`, token),
    listOrders: (token) => get(`${baseURL}/api/v1/orders`, token),
  };
}

function demoApi(): Api {
  return {
    mode: "demo",
    async authenticate() {
      return {
        token: "demo-client-token",
        active_role: "CLIENT",
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      };
    },
    async runtime() {
      return { ...loadDemoRuntime(), server_time: new Date().toISOString() };
    },
    async menu() {
      return { categories: loadDemoCategories() };
    },
    async calculate(_token, items) {
      const categories = loadDemoCategories();
      const runtime = loadDemoRuntime();
      const lookup = menuLookup(categories);
      const calculationItems = items.map(({ item_id, quantity }) => {
        const item = lookup.get(item_id);
        if (!item || quantity <= 0 || quantity > 10) {
          throw apiError("INVALID_QUANTITY");
        }
      return {
          item_id,
          title: item.title,
          unit_price_minor: item.price_minor,
          quantity,
          line_total_minor: item.price_minor * quantity,
          version: item.version,
        };
      });
      const subtotal = calculationItems.reduce((sum, item) => sum + item.line_total_minor, 0);
      const calculation = {
        calculation_token: crypto.randomUUID(),
        items: calculationItems,
        subtotal_minor: subtotal,
        delivery_fee_minor: runtime.flat_delivery_fee_minor,
        total_minor: subtotal + runtime.flat_delivery_fee_minor,
        currency: "RSD",
        expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      } satisfies Calculation;
      saveDemoCalculation(calculation);
      return calculation;
    },
    async createOrder(_token, input, idempotencyKey) {
      const orders = loadDemoOrders();
      const existing = orders.find((order) => (order as DemoOrder).__key === idempotencyKey);
      if (existing) return stripDemo(existing);
      const decoded = loadDemoCalculation(input.calculation_token);
      const order: DemoOrder = {
        id: crypto.randomUUID(),
        public_number: 100 + orders.length + 1,
        fulfillment_status: "NEW",
        payment_method: "cash",
        payment_status: "CASH_PENDING",
        subtotal_minor: decoded.subtotal_minor,
        delivery_fee_minor: decoded.delivery_fee_minor,
        total_minor: decoded.total_minor,
        currency: "RSD",
        phone: input.phone,
        address: input.address,
        customer_comment: input.comment,
        locale: input.locale,
        version: 1,
        created_at: new Date().toISOString(),
        items: decoded.items.map((item) => ({
          menu_item_id: item.item_id,
          snapshot_title: item.title,
          unit_price_minor: item.unit_price_minor,
          quantity: item.quantity,
          line_total_minor: item.line_total_minor,
        })),
        __key: idempotencyKey,
      };
      saveDemoOrders([order, ...orders]);
      return stripDemo(order);
    },
    async getOrder(_token, id) {
      const order = loadDemoOrders().find((entry) => entry.id === id);
      if (!order) throw apiError("FORBIDDEN");
      return stripDemo(order);
    },
    async listOrders() {
      return { orders: loadDemoOrders().map(stripDemo) };
    },
  };
}

function unconfiguredApi(): Api {
  const fail = async () => {
    throw apiError("SERVER_UNAVAILABLE");
  };
  return {
    mode: "real",
    authenticate: fail,
    runtime: fail,
    menu: fail,
    calculate: fail,
    createOrder: fail,
    getOrder: fail,
    listOrders: fail,
  };
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
    throw apiError(payload?.error?.code || "SERVER_UNAVAILABLE");
  }
  return payload;
}

function menuLookup(categories: Category[]) {
  return new Map(categories.flatMap((category) => category.items.map((item) => [item.id, item])));
}

function loadDemoRuntime(): Runtime {
  const settings = loadJSON<Settings | null>(demoSettingsKey, null);
  if (!settings) return demoRuntime;
  return {
    ...demoRuntime,
    accepting_orders: !settings.manual_day_off,
    reason: settings.manual_day_off ? "manual_day_off" : "open",
    day_off_banner: settings.day_off_banner,
    flat_delivery_fee_minor: settings.flat_delivery_fee_minor,
    support_text: settings.support_text,
    enabled_payments: settings.cash_enabled ? ["cash"] : [],
  };
}

function loadDemoCategories(): Category[] {
  const menu = loadJSON<{ categories: AdminCategory[]; items: AdminMenuItem[] } | null>(demoMenuKey, null);
  if (!menu) return demoCategories;
  return menu.categories
    .filter((category) => category.visible && !category.archived)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((category) => ({
      id: category.id,
      title: category.title_ru,
      sort_order: category.sort_order,
      items: menu.items
        .filter((item) => item.category_id === category.id && item.visible && !item.archived)
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((item) => ({
          id: item.id,
          category_id: item.category_id,
          title: item.title_ru,
          description: item.description_ru,
          price_minor: item.price_minor,
          currency: item.currency,
          photo_path: item.photo_path,
          weight_text: item.weight_text,
          allergen_text: item.allergen_text_ru,
          sort_order: item.sort_order,
          version: item.version,
        })),
    }));
}

function loadJSON<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) || "") as T;
  } catch {
    return fallback;
  }
}

interface DemoOrder extends Order {
  __key: string;
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

function stripDemo(order: DemoOrder): Order {
  const { __key, ...clean } = order;
  void __key;
  return clean;
}

function loadDemoCalculations(): Record<string, Calculation> {
  try {
    return JSON.parse(localStorage.getItem(demoCalculationsKey) || "{}");
  } catch {
    return {};
  }
}

function saveDemoCalculation(calculation: Calculation): void {
  const calculations = loadDemoCalculations();
  calculations[calculation.calculation_token] = calculation;
  localStorage.setItem(demoCalculationsKey, JSON.stringify(calculations));
}

function loadDemoCalculation(token: string): Calculation {
  const calculation = loadDemoCalculations()[token];
  if (!calculation || new Date(calculation.expires_at).getTime() < Date.now()) {
    throw apiError("CALCULATION_EXPIRED");
  }
  return calculation;
}

function apiError(code: string) {
  return Object.assign(new Error(code), { code });
}
