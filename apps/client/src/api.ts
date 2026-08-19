import type { AdminCategory, AdminMenuItem, Category, Order, Runtime, ScheduleDay, Settings } from "@tk-delivery/api-client/generated";
import { demoCategories, demoRuntime } from "./fixtures";
import { rawInitData, telegramUser } from "./telegram";
import type { Api, Calculation, CashLocationChallenge, ClientBootstrapData, CreateOrderInput, Locale, Session } from "./types";

const demoOrdersKey = "tk-client-demo-orders-v1";
const demoCalculationsKey = "tk-client-demo-calculations-v1";
const demoMenuKey = "tk-admin-demo-menu-v6";
const demoSettingsKey = "tk-admin-demo-settings-v1";
const demoCryptoTestMigrationKey = "tk-demo-crypto-test-enabled-v1";
const getCache = new Map<string, { etag: string; payload: unknown }>();
const getCacheLimit = 64;

export function createApi(): Api {
  const appEnv = import.meta.env.VITE_APP_ENV || (import.meta.env.PROD ? "production" : "development");
  const demoMode = import.meta.env.VITE_DEMO_MODE === "true" && appEnv !== "production";
  const baseURL = import.meta.env.VITE_API_BASE_URL || "";
  if (demoMode || (appEnv !== "production" && !baseURL)) return demoApi();
  if (!baseURL) return unconfiguredApi();
  return realApi(baseURL);
}

function realApi(baseURL: string): Api {
  const authenticate = async (_locale: Locale) => {
    const response = await post(`${baseURL}/api/v1/auth/telegram`, {
      audience: "client",
      role: "CLIENT",
      init_data: rawInitData(),
    });
    return response.session;
  };
  return {
    mode: "real",
    async bootstrap(locale) {
      try {
        return await post(`${baseURL}/api/v1/bootstrap/client`, {
          locale,
          init_data: rawInitData(),
        });
      } catch (err) {
        if (!isMissingEndpoint(err)) throw err;
      }

      const [runtime, menu] = await Promise.all([
        get(`${baseURL}/api/v1/runtime`),
        get(`${baseURL}/api/v1/menu?locale=${locale}`),
      ]);
      const fallback = {
        runtime,
        categories: menu.categories,
        menu_revision: menu.menu_revision ?? 0,
        orders: [],
        contact: { verified: false },
      } satisfies ClientBootstrapData;
      if (!rawInitData()) return fallback;
      const session = await authenticate(locale);
      return { ...fallback, session };
    },
    authenticate,
    runtime: (signal) => get(`${baseURL}/api/v1/runtime`, undefined, signal),
    menu: (locale) => get(`${baseURL}/api/v1/menu?locale=${locale}`),
    calculate: (token, items, fulfillmentType) => post(`${baseURL}/api/v1/orders/calculate`, { items, fulfillment_type: fulfillmentType }, token),
    calculateAddition: (token, orderId, items) => post(`${baseURL}/api/v1/orders/${orderId}/addition/calculate`, { items }, token),
    contact: (token) => get(`${baseURL}/api/v1/contact`, token),
    createCashLocationChallenge: (token, input) => post(`${baseURL}/api/v1/cash-location/challenges`, input, token),
    getCashLocationChallenge: (token, id, signal) => get(`${baseURL}/api/v1/cash-location/challenges/${id}`, token, signal),
    verifyCashLocationChallenge: (token, id, input) => post(`${baseURL}/api/v1/cash-location/challenges/${id}/telegram-webapp-location`, input, token),
    createOrder: (token, input, idempotencyKey) =>
      post(`${baseURL}/api/v1/orders`, input, token, { "Idempotency-Key": idempotencyKey }),
    addOrderItems: (token, orderId, input, idempotencyKey) =>
      post(`${baseURL}/api/v1/orders/${orderId}/addition`, input, token, { "Idempotency-Key": idempotencyKey }),
    getOrder: (token, id, signal) => get(`${baseURL}/api/v1/orders/${id}`, token, signal),
    listOrders: (token, filter = {}, signal) => get(`${baseURL}/api/v1/orders?${new URLSearchParams(clean(filter))}`, token, signal),
  };
}

function demoApi(): Api {
  const authenticate = async () => {
    const profile = demoTelegramProfile();
    return {
      token: "demo-client-token",
      telegram_user_id: profile.telegram_user_id,
      username: profile.username,
      first_name: profile.first_name,
      photo_url: profile.photo_url,
      active_role: "CLIENT",
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    } satisfies Session;
  };
  return {
    mode: "demo",
    async bootstrap() {
      const session = await authenticate();
      return {
        session,
        roles: ["CLIENT"],
        runtime: await this.runtime(),
        categories: loadDemoCategories(),
        menu_revision: 1,
        orders: [],
        contact: { verified: false },
      };
    },
    authenticate,
    async runtime() {
      return { ...loadDemoRuntime(), server_time: new Date().toISOString() };
    },
    async menu() {
      return { categories: loadDemoCategories() };
    },
    async calculate(_token, items, fulfillmentType) {
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
        fulfillment_type: fulfillmentType,
        subtotal_minor: subtotal,
        delivery_fee_minor: 0,
        total_minor: subtotal,
        currency: "RSD",
        expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      } satisfies Calculation;
      saveDemoCalculation(calculation);
      return calculation;
    },
    async calculateAddition(_token, orderId, items) {
      const order = loadDemoOrders().find((entry) => entry.id === orderId);
      if (!order || order.fulfillment_status !== "NEW" || order.payment_method !== "cash" || order.latest_addition) {
        throw apiError("ORDER_STATUS_CONFLICT");
      }
      const categories = loadDemoCategories();
      const lookup = menuLookup(categories);
      const calculationItems = items.map(({ item_id, quantity }) => {
        const item = lookup.get(item_id);
        const currentQty = order.items
          .filter((entry) => entry.menu_item_id === item_id)
          .reduce((sum, entry) => sum + entry.quantity, 0);
        const minQuantity = item?.min_quantity || 1;
        if (!item || quantity <= 0 || currentQty + quantity > 99 || (currentQty === 0 && quantity < minQuantity)) {
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
        fulfillment_type: "delivery",
        subtotal_minor: subtotal,
        delivery_fee_minor: 0,
        total_minor: subtotal,
        currency: "RSD",
        expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        order_subtotal_minor: order.subtotal_minor + subtotal,
        order_total_minor: order.total_minor + subtotal,
      } satisfies Calculation;
      saveDemoCalculation(calculation);
      return calculation;
    },
    async contact() {
      return {
        verified: true,
        phone: "+381600000000",
        masked: "*******0000",
        verified_at: new Date().toISOString(),
      };
    },
    async createCashLocationChallenge(_token, input) {
      loadDemoCalculation(input.calculation_token);
      return demoVerifiedLocationChallenge();
    },
    async getCashLocationChallenge() {
      return demoVerifiedLocationChallenge();
    },
    async verifyCashLocationChallenge() {
      return demoVerifiedLocationChallenge();
    },
    async createOrder(_token, input, idempotencyKey) {
      const runtime = loadDemoRuntime();
      if (!runtime.accepting_orders) {
        throw apiError(runtime.reason === "manual_day_off" ? "MANUAL_DAY_OFF" : "RESTAURANT_CLOSED");
      }
      if (!input.terms_accepted || !input.terms_version.trim()) {
        throw apiError("TERMS_REQUIRED");
      }
      if (!input.phone.trim() || (input.fulfillment_type !== "pickup" && !input.address.trim())) {
        throw apiError("INVALID_INPUT");
      }
      if (input.payment_method === "cash" && input.fulfillment_type !== "pickup" && !input.cash_location_challenge_id) {
        throw apiError("CASH_LOCATION_REQUIRED");
      }
      const orders = loadDemoOrders();
      const existing = orders.find((order) => (order as DemoOrder).__key === idempotencyKey);
      if (existing) return stripDemo(existing);
      const decoded = loadDemoCalculation(input.calculation_token);
      const decodedFulfillmentType = decoded.fulfillment_type || "delivery";
      if (decodedFulfillmentType !== input.fulfillment_type) {
        throw apiError("CALCULATION_EXPIRED");
      }
      const profile = demoTelegramProfile();
      const order: DemoOrder = {
        id: crypto.randomUUID(),
        public_number: 100 + orders.length + 1,
        client_username: profile.username,
        client_first_name: profile.first_name,
        client_photo_url: profile.photo_url,
        fulfillment_type: input.fulfillment_type,
        fulfillment_status: "NEW",
        payment_method: input.payment_method,
        payment_status: input.payment_method === "crypto" ? "PAID" : "CASH_PENDING",
        subtotal_minor: decoded.subtotal_minor,
        delivery_fee_minor: decoded.delivery_fee_minor,
        total_minor: decoded.total_minor,
        currency: "RSD",
        phone: input.phone,
        address: input.fulfillment_type === "pickup" ? "Самовывоз" : input.address,
        customer_comment: input.comment,
        locale: input.locale,
        version: 1,
        created_at: new Date().toISOString(),
        can_add_items: true,
        add_items_until: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
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
    async addOrderItems(_token, orderId, input, idempotencyKey) {
      const orders = loadDemoOrders();
      const order = orders.find((entry) => entry.id === orderId);
      if (!order || order.fulfillment_status !== "NEW" || order.payment_method !== "cash" || order.latest_addition || order.version !== input.expected_version) {
        throw apiError("ORDER_STATUS_CONFLICT");
      }
      const existing = (order as DemoOrder & { __additionKey?: string }).__additionKey === idempotencyKey;
      if (existing) return stripDemo(order);
      const calculation = loadDemoCalculation(input.calculation_token);
      const additionId = crypto.randomUUID();
      const createdAt = new Date().toISOString();
      order.items = [
        ...order.items,
        ...calculation.items.map((item) => ({
          menu_item_id: item.item_id,
          snapshot_title: item.title,
          unit_price_minor: item.unit_price_minor,
          quantity: item.quantity,
          line_total_minor: item.line_total_minor,
          addition_id: additionId,
          addition_revision: 1,
          addition_created_at: createdAt,
        })),
      ];
      order.subtotal_minor += calculation.subtotal_minor;
      order.total_minor += calculation.subtotal_minor;
      order.version += 1;
      order.latest_addition = {
        id: additionId,
        revision: 1,
        subtotal_minor: calculation.subtotal_minor,
        currency: "RSD",
        created_at: createdAt,
      };
      order.can_add_items = false;
      order.add_items_reason = "already_added";
      (order as DemoOrder & { __additionKey?: string }).__additionKey = idempotencyKey;
      saveDemoOrders(orders);
      return stripDemo(order);
    },
    async getOrder(_token, id) {
      const order = loadDemoOrders().find((entry) => entry.id === id);
      if (!order) throw apiError("FORBIDDEN");
      return stripDemo(order);
    },
    async listOrders(_token, filter = {}) {
      const limit = Math.min(Math.max(filter.limit || 20, 1), 50);
      const offset = Math.max(filter.offset || 0, 0);
      const orders = loadDemoOrders().map(stripDemo);
      return { orders: orders.slice(offset, offset + limit), limit, offset, has_more: orders.length > offset + limit };
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

function demoVerifiedLocationChallenge(): CashLocationChallenge {
  return {
    id: crypto.randomUUID(),
    status: "VERIFIED",
    distance_meters: 1200,
    accuracy_meters: 25,
    expires_at: new Date(Date.now() + 3 * 60 * 1000).toISOString(),
    verified_at: new Date().toISOString(),
    dev_bypass: true,
  };
}

function unconfiguredApi(): Api {
  const fail = async () => {
    throw apiError("SERVER_UNAVAILABLE");
  };
  return {
    mode: "real",
    bootstrap: fail,
    authenticate: fail,
    runtime: fail,
    menu: fail,
    calculate: fail,
    calculateAddition: fail,
    contact: fail,
    createCashLocationChallenge: fail,
    getCashLocationChallenge: fail,
    verifyCashLocationChallenge: fail,
    createOrder: fail,
    addOrderItems: fail,
    getOrder: fail,
    listOrders: fail,
  };
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
    throw apiError(payload?.error?.code || "SERVER_UNAVAILABLE", response.status);
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

function isMissingEndpoint(err: unknown): boolean {
  return typeof err === "object" && err !== null && "status" in err && (err as { status?: number }).status === 404;
}

function clean(filter: Record<string, string | number | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(filter)
      .filter(([, value]) => value !== undefined && value !== "")
      .map(([key, value]) => [key, String(value)]),
  );
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
    cash_location_required: settings.cash_location_required,
    cash_location_radius_meters: settings.cash_location_radius_meters,
  };
}

function loadDemoSettings(): Settings {
  const settings = loadJSON<Settings>(demoSettingsKey, seedDemoSettings());
  const normalized: Settings = {
    ...settings,
    cash_location_required: settings.cash_location_required ?? true,
    restaurant_latitude: settings.restaurant_latitude ?? 45.24197,
    restaurant_longitude: settings.restaurant_longitude ?? 19.808807,
    cash_location_radius_meters: settings.cash_location_radius_meters || 12000,
    cash_location_ttl_seconds: settings.cash_location_ttl_seconds || 180,
    cash_location_max_accuracy_meters: settings.cash_location_max_accuracy_meters || 200,
  };
  if (!localStorage.getItem(demoCryptoTestMigrationKey)) {
    const next = { ...normalized, crypto_enabled: true };
    localStorage.setItem(demoSettingsKey, JSON.stringify(next));
    localStorage.setItem(demoCryptoTestMigrationKey, "1");
    return next;
  }
  if (
    normalized.cash_location_required !== settings.cash_location_required ||
    normalized.restaurant_latitude !== settings.restaurant_latitude ||
    normalized.restaurant_longitude !== settings.restaurant_longitude ||
    normalized.cash_location_radius_meters !== settings.cash_location_radius_meters ||
    normalized.cash_location_ttl_seconds !== settings.cash_location_ttl_seconds ||
    normalized.cash_location_max_accuracy_meters !== settings.cash_location_max_accuracy_meters
  ) {
    localStorage.setItem(demoSettingsKey, JSON.stringify(normalized));
  }
  return normalized;
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
    cash_location_required: true,
    restaurant_latitude: 45.24197,
    restaurant_longitude: 19.808807,
    cash_location_radius_meters: 12000,
    cash_location_ttl_seconds: 180,
    cash_location_max_accuracy_meters: 200,
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
      items: items
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
  __additionKey?: string;
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
  const { __key, __additionKey, ...clean } = order;
  void __key;
  void __additionKey;
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

function apiError(code: string, status?: number) {
  return Object.assign(new Error(code), { code, status });
}
