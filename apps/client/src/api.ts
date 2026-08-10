import type { AdminCategory, AdminMenuItem, Category, Order, Runtime, ScheduleDay, Settings } from "@tk-delivery/api-client/generated";
import { demoCategories, demoRuntime } from "./fixtures";
import { rawInitData, telegramUser } from "./telegram";
import type { Api, Calculation, CreateOrderInput, Locale, Session } from "./types";

const demoOrdersKey = "tk-client-demo-orders-v1";
const demoCalculationsKey = "tk-client-demo-calculations-v1";
const demoMenuKey = "tk-admin-demo-menu-v1";
const demoSettingsKey = "tk-admin-demo-settings-v1";
const demoCryptoTestMigrationKey = "tk-demo-crypto-test-enabled-v1";

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
      const profile = demoTelegramProfile();
      return {
        token: "demo-client-token",
        telegram_user_id: profile.telegram_user_id,
        username: profile.username,
        first_name: profile.first_name,
        photo_url: profile.photo_url,
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
      const lookup = menuLookup(categories);
      const calculationItems = items.map(({ item_id, quantity }) => {
        const item = lookup.get(item_id);
        const minQuantity = item?.min_quantity || 1;
        if (!item || quantity < minQuantity || quantity > 99) {
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
        delivery_fee_minor: 0,
        total_minor: subtotal,
        currency: "RSD",
        expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      } satisfies Calculation;
      saveDemoCalculation(calculation);
      return calculation;
    },
    async createOrder(_token, input, idempotencyKey) {
      const runtime = loadDemoRuntime();
      if (!runtime.accepting_orders) {
        throw apiError(runtime.reason === "manual_day_off" ? "MANUAL_DAY_OFF" : "RESTAURANT_CLOSED");
      }
      if (!input.phone.trim() || !input.address.trim()) {
        throw apiError("INVALID_INPUT");
      }
      const orders = loadDemoOrders();
      const existing = orders.find((order) => (order as DemoOrder).__key === idempotencyKey);
      if (existing) return stripDemo(existing);
      const decoded = loadDemoCalculation(input.calculation_token);
      const profile = demoTelegramProfile();
      const order: DemoOrder = {
        id: crypto.randomUUID(),
        public_number: 100 + orders.length + 1,
        client_username: profile.username,
        client_first_name: profile.first_name,
        client_photo_url: profile.photo_url,
        fulfillment_status: "NEW",
        payment_method: input.payment_method,
        payment_status: input.payment_method === "crypto" ? "PAID" : "CASH_PENDING",
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

function demoTelegramProfile(): { telegram_user_id: number; username: string; first_name: string; photo_url: string } {
  const user = telegramUser();
  return {
    telegram_user_id: user?.id || 0,
    username: (user?.username || "").replace(/^@/, ""),
    first_name: user?.first_name || "Telegram user",
    photo_url: user?.photo_url || "",
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
  const settings = loadDemoSettings();
  const accepting = demoAcceptingState(settings);
  return {
    ...demoRuntime,
    accepting_orders: accepting.ok,
    reason: accepting.reason,
    next_opening: accepting.nextOpening,
    day_off_banner: settings.day_off_banner,
    flat_delivery_fee_minor: 0,
    support_text: "@Tako_Lako",
    enabled_payments: [
      ...(settings.cash_enabled ? ["cash" as const] : []),
      ...(settings.crypto_enabled ? ["crypto" as const] : []),
    ],
  };
}

function loadDemoSettings(): Settings {
  const settings = loadJSON<Settings>(demoSettingsKey, seedDemoSettings());
  if (!localStorage.getItem(demoCryptoTestMigrationKey)) {
    const next = { ...settings, crypto_enabled: true };
    localStorage.setItem(demoSettingsKey, JSON.stringify(next));
    localStorage.setItem(demoCryptoTestMigrationKey, "1");
    return next;
  }
  return settings;
}

function demoAcceptingState(settings: Settings): { ok: boolean; reason: string; nextOpening?: string } {
  const timezone = settings.timezone || "Europe/Belgrade";
  const schedule = settings.schedule?.length === 7 ? settings.schedule : defaultSchedule();
  if (settings.manual_day_off) {
    return { ok: false, reason: "manual_day_off", nextOpening: demoNextOpening(schedule, timezone) };
  }
  const now = zonedNowParts(timezone);
  const today = schedule.find((day) => day.day_of_week === now.dayOfWeek);
  if (!today || today.closed) {
    return { ok: false, reason: "weekly_day_off", nextOpening: demoNextOpening(schedule, timezone) };
  }
  const current = now.hour * 3600 + now.minute * 60 + now.second;
  const open = timeToSeconds(today.open_time);
  const cutoff = timeToSeconds(today.order_cutoff_time);
  if (current < open || current >= cutoff) {
    return { ok: false, reason: "schedule_closed", nextOpening: demoNextOpening(schedule, timezone) };
  }
  return { ok: true, reason: "open" };
}

function demoNextOpening(schedule: ScheduleDay[], timezone: string): string | undefined {
  const now = zonedNowParts(timezone);
  for (let offset = 0; offset < 8; offset += 1) {
    const candidateDate = new Date(Date.UTC(now.year, now.month - 1, now.day + offset));
    const dayOfWeek = candidateDate.getUTCDay();
    const day = schedule.find((entry) => entry.day_of_week === dayOfWeek);
    if (!day || day.closed) continue;
    const open = timeToSeconds(day.open_time);
    const candidateLocal = {
      year: candidateDate.getUTCFullYear(),
      month: candidateDate.getUTCMonth() + 1,
      day: candidateDate.getUTCDate(),
      hour: Math.floor(open / 3600),
      minute: Math.floor((open % 3600) / 60),
      second: 0,
    };
    const candidateInstant = zonedLocalToInstant(candidateLocal, timezone);
    if (candidateInstant.getTime() > Date.now()) return candidateInstant.toISOString();
  }
  return undefined;
}

function defaultSchedule(): ScheduleDay[] {
  return [0, 1, 2, 3, 4, 5, 6].map((day) => ({
    day_of_week: day,
    closed: day === 1,
    open_time: "13:00",
    order_cutoff_time: "21:00",
    close_time: "22:00",
    version: 1,
  }));
}

function seedDemoSettings(): Settings {
  return {
    timezone: "Europe/Belgrade",
    currency: "RSD",
    manual_day_off: false,
    day_off_banner: "ВЫХОДНОЙ",
    flat_delivery_fee_minor: 0,
    support_text: "@Tako_Lako",
    support_phone: "",
    terms_url: "",
    max_item_quantity: 99,
    max_comment_length: 300,
    cash_enabled: true,
    card_enabled: false,
    crypto_enabled: true,
    version: 1,
    schedule: defaultSchedule(),
  };
}

function zonedNowParts(timezone: string): { year: number; month: number; day: number; dayOfWeek: number; hour: number; minute: number; second: number } {
  const parts = zonedParts(new Date(), timezone);
  const dayOfWeek = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
  return { ...parts, dayOfWeek };
}

function zonedParts(value: Date, timezone: string): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const pick = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value || 0);
  return {
    year: pick("year"),
    month: pick("month"),
    day: pick("day"),
    hour: pick("hour"),
    minute: pick("minute"),
    second: pick("second"),
  };
}

function zonedLocalToInstant(value: { year: number; month: number; day: number; hour: number; minute: number; second: number }, timezone: string): Date {
  const utcGuess = new Date(Date.UTC(value.year, value.month - 1, value.day, value.hour, value.minute, value.second));
  const actual = zonedParts(utcGuess, timezone);
  const wantedAsUTC = Date.UTC(value.year, value.month - 1, value.day, value.hour, value.minute, value.second);
  const actualAsUTC = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
  return new Date(utcGuess.getTime() + wantedAsUTC - actualAsUTC);
}

function timeToSeconds(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return (Number.isFinite(hours) ? hours : 0) * 3600 + (Number.isFinite(minutes) ? minutes : 0) * 60;
}

function loadDemoCategories(): Category[] {
  const menu = loadJSON<{ categories: AdminCategory[]; items: AdminMenuItem[] } | null>(demoMenuKey, null);
  if (!menu) return demoCategories;
  const items = menu.items.map(normalizeDemoMenuItem);
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
          min_quantity: item.min_quantity,
          allergen_text: item.allergen_text_ru,
          sort_order: item.sort_order,
          version: item.version,
        })),
    }));
}

function normalizeDemoMenuItem(item: AdminMenuItem): AdminMenuItem {
  if (item.id === "22222222-2222-2222-2222-222222222001") {
    return {
      ...item,
      description_ru: "Замороженные хинкали с говядиной и зеленью. Минимум 5 шт",
      weight_text: "от 5 шт",
      min_quantity: 5,
    };
  }
  if (item.id === "22222222-2222-2222-2222-222222222002") {
    return {
      ...item,
      title_ru: "Хинкали без кинзы",
      title_sr: "Hinkali bez korijandera",
      title_en: "Khinkali without cilantro",
      description_ru: "Замороженные хинкали с говядиной без кинзы. Минимум 5 шт",
      description_sr: "Zamrznuti hinkali sa govedinom bez korijandera. Minimum 5 kom",
      description_en: "Frozen beef khinkali without cilantro. Minimum 5 pcs",
      weight_text: "от 5 шт",
      min_quantity: 5,
    };
  }
  return { ...item, min_quantity: Math.max(1, item.min_quantity || 1) };
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
