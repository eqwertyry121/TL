import type { AdminAnalytics, AdminCategory, AdminDashboard, AdminMenuItem, AuditEntry, Order, ScheduleDay, Settings, StaffMember } from "@tk-delivery/api-client/generated";
import type { Role } from "@tk-delivery/api-client/generated";
import { isOwnerTelegramId, roleLinks } from "@tk-delivery/api-client/role-switch";
import {
  createAdminApi,
  isAuthError,
  money,
  statusText,
  type AdminMenuResponse,
  type AdminOrdersResponse,
  type AdminSession,
  type AdminTab,
  type AnalyticsRange,
  type CategoryInput,
  type MenuItemInput,
  type SettingsInput,
  type StaffInput,
} from "./api";
import { AlertTriangle, Archive, BarChart3, CalendarDays, ClipboardList, Eye, EyeOff, Home, Menu as MenuIcon, RefreshCw, Save, Settings as SettingsIcon, Shield, Trash2, Upload, Users } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

const api = createAdminApi();
const tabs: Array<{ id: AdminTab; label: string; icon: typeof Home }> = [
  { id: "home", label: "Главная", icon: Home },
  { id: "menu", label: "Меню", icon: MenuIcon },
  { id: "orders", label: "Заказы", icon: ClipboardList },
  { id: "staff", label: "Сотрудники", icon: Users },
  { id: "schedule", label: "График", icon: CalendarDays },
  { id: "analytics", label: "Аналитика", icon: BarChart3 },
  { id: "settings", label: "Настройки", icon: SettingsIcon },
  { id: "audit", label: "Журнал", icon: Shield },
];

const statusOptions: Array<{ value: "" | Order["fulfillment_status"]; label: string }> = [
  { value: "", label: "Все заказы" },
  { value: "NEW", label: "Новые" },
  { value: "OUT_FOR_DELIVERY", label: "В доставке" },
  { value: "DELIVERED", label: "Доставлены" },
  { value: "CANCELLED", label: "Отменены" },
];

const quickSchedule = { open_time: "13:00", order_cutoff_time: "21:00", close_time: "22:00" };
type AdminActionRunner = <T>(action: (authToken: string) => Promise<T>) => Promise<T | undefined>;
type AdminLoadKey = "dashboard" | "menu" | "settings" | "schedule" | "orders" | "staff" | "analytics" | "audit";

export function App() {
  const [token, setToken] = useState("");
  const [session, setSession] = useState<AdminSession | null>(null);
  const [tab, setTab] = useState<AdminTab>("home");
  const [dashboard, setDashboard] = useState<AdminDashboard | null>(null);
  const [menu, setMenu] = useState<AdminMenuResponse>({ categories: [], items: [] });
  const [settings, setSettings] = useState<Settings | null>(null);
  const [schedule, setSchedule] = useState<ScheduleDay[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [ordersPage, setOrdersPage] = useState<Pick<AdminOrdersResponse, "limit" | "offset" | "has_more">>({ limit: 100, offset: 0, has_more: false });
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [analytics, setAnalytics] = useState<AdminAnalytics | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [range, setRange] = useState<AnalyticsRange>("today");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const authRefreshRef = useRef<Promise<string> | null>(null);

  function applySession(nextSession: AdminSession) {
    setSession(nextSession);
    setToken(nextSession.token);
    return nextSession.token;
  }

  async function authenticate() {
    return applySession(await api.authenticate());
  }

  async function refreshAuth() {
    if (!authRefreshRef.current) {
      authRefreshRef.current = authenticate().finally(() => {
        authRefreshRef.current = null;
      });
    }
    return authRefreshRef.current;
  }

  async function withAuth<T>(action: (authToken: string) => Promise<T>, authToken = token): Promise<T> {
    const currentToken = authToken || (await refreshAuth());
    try {
      return await action(currentToken);
    } catch (err) {
      if (!isAuthError(err)) throw err;
      const freshToken = await refreshAuth();
      return action(freshToken);
    }
  }

  async function load(authToken = token, analyticsRange = range) {
    setLoading(true);
    setError("");
    try {
      let results = await loadAdminSections(authToken || (await refreshAuth()), analyticsRange);
      if (results.some((entry) => !entry.ok && isAuthError(entry.reason))) {
        results = await loadAdminSections(await refreshAuth(), analyticsRange);
      }

      const failed: AdminLoadKey[] = [];
      for (const entry of results) {
        if (!entry.ok) {
          failed.push(entry.key);
          continue;
        }
        switch (entry.key) {
          case "dashboard":
            setDashboard(entry.value as AdminDashboard);
            break;
          case "menu":
            setMenu(entry.value as AdminMenuResponse);
            break;
          case "settings":
            setSettings(entry.value as Settings);
            break;
          case "schedule":
            setSchedule((entry.value as { schedule: ScheduleDay[] }).schedule);
            break;
          case "orders":
            setOrders((entry.value as AdminOrdersResponse).orders);
            setOrdersPage(orderPageMeta(entry.value as AdminOrdersResponse));
            break;
          case "staff":
            setStaff((entry.value as { staff: StaffMember[] }).staff);
            break;
          case "analytics":
            setAnalytics(entry.value as AdminAnalytics);
            break;
          case "audit":
            setAudit((entry.value as { entries: AuditEntry[] }).entries);
            break;
        }
      }
      if (failed.length) {
        setError(`Не загрузились: ${failed.map(adminLoadLabel).join(", ")}. Остальные данные обновлены.`);
      }
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  }

  async function loadAdminSections(authToken: string, analyticsRange: AnalyticsRange) {
    const sections: Array<readonly [AdminLoadKey, Promise<unknown>]> = [
      ["dashboard", api.dashboard(authToken)],
      ["menu", api.menu(authToken)],
      ["settings", api.settings(authToken)],
      ["schedule", api.schedule(authToken)],
      ["orders", api.orders(authToken)],
      ["staff", api.staff(authToken)],
      ["analytics", api.analytics(authToken, analyticsRange)],
      ["audit", api.audit(authToken)],
    ];
    return Promise.all(sections.map(async ([key, promise]) => {
      try {
        return { key, ok: true as const, value: await promise };
      } catch (reason) {
        return { key, ok: false as const, reason };
      }
    }));
  }

  useEffect(() => {
    let stopped = false;
    api.authenticate().then((session) => {
      if (stopped) return;
      const nextToken = applySession(session);
      void load(nextToken);
    }).catch((err) => {
      if (!stopped) setError(errorText(err));
      setLoading(false);
    });
    return () => {
      stopped = true;
    };
  }, []);

  async function run<T>(action: (authToken: string) => Promise<T>): Promise<T | undefined> {
    setError("");
    try {
      const result = await withAuth(action);
      await load();
      return result;
    } catch (err) {
      setError(errorText(err));
      return undefined;
    }
  }

  async function loadOrders(filter: { status?: string; q?: string; date?: string; limit?: number; offset?: number }) {
    setError("");
    try {
      const page = await withAuth((authToken) => api.orders(authToken, filter));
      setOrders(page.orders);
      setOrdersPage(orderPageMeta(page));
      return page;
    } catch (err) {
      setError(errorText(err));
      return undefined;
    }
  }

  async function loadOrderDetail(id: string) {
    setError("");
    try {
      return await withAuth((authToken) => api.order(authToken, id));
    } catch (err) {
      setError(errorText(err));
      return undefined;
    }
  }

  async function exportAnalyticsCSV(currentRange: AnalyticsRange) {
    setError("");
    try {
      const blob = await withAuth((authToken) => api.analyticsCSV(authToken, currentRange));
      downloadBlob(blob, `tk-analytics-${currentRange}.csv`);
    } catch (err) {
      setError(errorText(err));
    }
  }

  async function setDayOff(enabled: boolean) {
    if (enabled && !window.confirm("Новые заказы будут остановлены. Уже созданные заказы останутся активны.")) return;
    await run((authToken) => api.setManualDayOff(authToken, enabled));
  }

  return (
    <div className="admin">
      <aside className="sidebar">
        <div className="brand">
          <strong>Tako Lako</strong>
          <span>админ панель</span>
        </div>
        <nav>
          {tabs.map((entry) => {
            const Icon = entry.icon;
            return (
              <button key={entry.id} className={tab === entry.id ? "active" : ""} onClick={() => setTab(entry.id)}>
                <Icon size={18} /> {entry.label}
              </button>
            );
          })}
        </nav>
      </aside>
      <main>
        <header className="topbar">
          <div>
            <h1>{tabs.find((entry) => entry.id === tab)?.label}</h1>
            <p>ID создателя: 1048084234</p>
            {isOwnerTelegramId(session?.telegram_user_id) && <OwnerRoleSwitch activeRole="ADMIN" />}
          </div>
          <button className="secondary" onClick={() => void load()} disabled={!token || loading}><RefreshCw size={18} /> Обновить</button>
        </header>
        {error && <div className="error"><AlertTriangle size={18} /> {error}</div>}
        {loading && <div className="muted">Загрузка…</div>}
        {tab === "home" && dashboard && settings && <HomeTab dashboard={dashboard} settings={settings} onDayOff={setDayOff} />}
        {tab === "menu" && <MenuTab menu={menu} onAction={run} />}
        {tab === "orders" && <OrdersTab orders={orders} page={ordersPage} onLoad={loadOrders} onLoadOrder={loadOrderDetail} onAction={run} />}
        {tab === "staff" && <StaffTab staff={staff} onAction={run} />}
        {tab === "schedule" && <ScheduleTab schedule={schedule} onSave={(next) => run((authToken) => api.updateSchedule(authToken, next)).then(() => undefined)} />}
        {tab === "analytics" && analytics && <AnalyticsTab analytics={analytics} range={range} onRange={(next) => { setRange(next); void load(token, next); }} onExport={() => void exportAnalyticsCSV(range)} />}
        {tab === "settings" && settings && <SettingsTab settings={settings} demoMode={api.mode === "demo"} onSave={(input) => run((authToken) => api.updateSettings(authToken, input)).then(() => undefined)} />}
        {tab === "audit" && <AuditTab entries={audit} />}
      </main>
    </div>
  );
}

function OwnerRoleSwitch({ activeRole }: { activeRole: Role }) {
  return (
    <div className="role-switch" aria-label="Переключение роли owner">
      {roleLinks(activeRole).map((link) => (
        <a key={link.role} className={link.active ? "active" : ""} href={link.href}>
          {link.label}
        </a>
      ))}
    </div>
  );
}

function HomeTab({ dashboard, settings, onDayOff }: { dashboard: AdminDashboard; settings: Settings; onDayOff(enabled: boolean): Promise<void> }) {
  const accepting = dashboard.runtime.accepting_orders;
  return (
    <section className="grid">
      <div className={accepting ? "panel ok" : "panel danger"}>
        <h2>{accepting ? "Заказы принимаются" : "Приём заказов остановлен"}</h2>
        <p>{runtimeReason(dashboard.runtime.reason)}</p>
        <button className={settings.manual_day_off ? "primary" : "danger-button"} onClick={() => void onDayOff(!settings.manual_day_off)}>
          {settings.manual_day_off ? "Включить приём" : "Остановить приём заказов"}
        </button>
      </div>
      <Metric title="Новые" value={dashboard.new_orders} />
      <Metric title="В доставке" value={dashboard.out_for_delivery} />
      <Metric title="Заказов сегодня" value={dashboard.orders_today} />
      <Metric title="Выручка сегодня" value={money(dashboard.revenue_today_minor)} />
      <div className="panel wide">
        <h2>Ошибки уведомлений и оплат</h2>
        {dashboard.notification_errors.length ? dashboard.notification_errors.map((item) => <p key={item}>{item}</p>) : <p className="muted">Ошибок нет</p>}
      </div>
    </section>
  );
}

function MenuTab({ menu, onAction }: { menu: AdminMenuResponse; onAction: AdminActionRunner }) {
  const [cat, setCat] = useState<AdminCategory | null>(null);
  const [item, setItem] = useState<AdminMenuItem | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const activeCategories = menu.categories.filter((entry) => !entry.archived);
  const visibleCategories = showArchived ? menu.categories : menu.categories.filter((entry) => !entry.archived);
  const visibleItems = showArchived ? menu.items : menu.items.filter((entry) => !entry.archived);

  function openCategory(category: AdminCategory) {
    setCat(category);
    setItem(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openItem(dish: AdminMenuItem) {
    setItem(dish);
    setCat(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <section className="stack">
      <div className="panel menu-toolbar">
        <div>
          <h2>Меню ресторана</h2>
          <p className="muted">Редактирование открывается сразу здесь. Архив можно показать и восстановить.</p>
        </div>
        <div className="actions">
          <button className="primary" onClick={() => openCategory(emptyCategory())}>+ Категория</button>
          <button className="primary" disabled={!activeCategories.length} onClick={() => openItem(emptyItem(activeCategories[0]?.id || ""))}>+ Блюдо</button>
          <label className="check archive-toggle"><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} /> Показать архив</label>
        </div>
      </div>

      {cat && <CategoryForm category={cat} onCancel={() => setCat(null)} onSave={(input) => onAction((authToken) => cat.id ? api.updateCategory(authToken, cat.id, input) : api.createCategory(authToken, input)).then(() => setCat(null))} />}
      {item && (
        <DishForm
          item={item}
          categories={activeCategories}
          onCancel={() => setItem(null)}
          onUpload={(file) => onAction((authToken) => api.uploadMenuPhoto(authToken, file))}
          onSave={(input) => onAction((authToken) => item.id ? api.updateItem(authToken, item.id, input) : api.createItem(authToken, input)).then(() => setItem(null))}
        />
      )}

      <div className="two">
        <div className="panel">
          <h2>Категории</h2>
          {visibleCategories.length === 0 ? <p className="muted">Категорий нет</p> : visibleCategories.map((category) => (
            <div className="row menu-row" key={category.id}>
              <div>
                <strong>{category.title_ru || "Без названия"}</strong>
                <span>{category.item_count} блюд · порядок {category.sort_order} · v{category.version}</span>
              </div>
              <StatusPills visible={category.visible} archived={category.archived} />
              <div className="row-actions">
                {!category.archived && <button onClick={() => openCategory(category)}>Редактировать</button>}
                {category.archived ? (
                  <button className="primary" onClick={() => void onAction((authToken) => api.restoreCategory(authToken, category.id, "restore from admin"))}>Восстановить</button>
                ) : (
                  <>
                    <button onClick={() => void onAction((authToken) => api.archiveCategory(authToken, category.id, "archive from admin"))}><Archive size={16} /> В архив</button>
                    <button className="danger-button" onClick={() => void onAction((authToken) => api.deleteCategory(authToken, category.id, "delete/archive from admin"))}><Trash2 size={16} /> Удалить</button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="panel">
          <h2>Блюда</h2>
          {visibleItems.length === 0 ? <p className="muted">Блюд нет</p> : visibleItems.map((dish) => (
            <div className="row menu-row" key={dish.id}>
              <div>
                <strong>{dish.title_ru || "Без названия"}</strong>
                <span>{money(dish.price_minor)} · {categoryTitle(menu.categories, dish.category_id)} · мин. {dish.min_quantity || 1} шт · v{dish.version}</span>
              </div>
              <StatusPills visible={dish.visible} archived={dish.archived} />
              <div className="row-actions">
                {!dish.archived && <button onClick={() => openItem(dish)}>Редактировать</button>}
                {dish.archived ? (
                  <button className="primary" onClick={() => void onAction((authToken) => api.restoreItem(authToken, dish.id, "restore from admin"))}>Восстановить</button>
                ) : (
                  <>
                    <button onClick={() => void onAction((authToken) => api.archiveItem(authToken, dish.id, "archive from admin"))}><Archive size={16} /> В архив</button>
                    <button className="danger-button" onClick={() => void onAction((authToken) => api.deleteItem(authToken, dish.id, "delete/archive from admin"))}><Trash2 size={16} /> Удалить</button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function CategoryForm({ category, onSave, onCancel }: { category: AdminCategory; onSave(input: CategoryInput): Promise<void>; onCancel(): void }) {
  const [form, setForm] = useState(category);
  return (
    <div className="panel editor">
      <div className="editor-head">
        <div>
          <h2>{category.id ? "Редактирование категории" : "Новая категория"}</h2>
          <p className="muted">RU обязателен. SR/EN можно заполнить позже.</p>
        </div>
        <button onClick={onCancel}>Закрыть</button>
      </div>
      <div className="form-grid">
        <Text label="Название RU" value={form.title_ru} onChange={(title_ru) => setForm({ ...form, title_ru })} />
        <Text label="Название SR-Latn" value={form.title_sr} onChange={(title_sr) => setForm({ ...form, title_sr })} />
        <Text label="Название EN" value={form.title_en} onChange={(title_en) => setForm({ ...form, title_en })} />
        <NumberInput label="Порядок" value={form.sort_order} onChange={(sort_order) => setForm({ ...form, sort_order })} />
      </div>
      <label className="check"><input type="checkbox" checked={form.visible} onChange={(event) => setForm({ ...form, visible: event.target.checked })} /> Показывать клиентам</label>
      <div className="actions">
        <button className="primary" onClick={() => void onSave(form)}><Save size={16} /> Сохранить</button>
        <button onClick={onCancel}>Отмена</button>
      </div>
    </div>
  );
}

function DishForm({
  item,
  categories,
  onSave,
  onCancel,
  onUpload,
}: {
  item: AdminMenuItem;
  categories: AdminCategory[];
  onSave(input: MenuItemInput): Promise<void>;
  onCancel(): void;
  onUpload(file: File): Promise<unknown>;
}) {
  const [form, setForm] = useState(item);
  const previewURL = adminPhotoURL(form.photo_path);
  async function upload(file?: File) {
    if (!file) return;
    const response = await onUpload(file);
    const photoPath = typeof response === "object" && response && "photo_path" in response ? String((response as { photo_path?: unknown }).photo_path || "") : "";
    if (photoPath) setForm((current) => ({ ...current, photo_path: photoPath }));
  }
  return (
    <div className="panel editor">
      <div className="editor-head">
        <div>
          <h2>{item.id ? "Редактирование блюда" : "Новое блюдо"}</h2>
          <p className="muted">Цена хранится целым числом в RSD. Старые заказы не меняются.</p>
        </div>
        <button onClick={onCancel}>Закрыть</button>
      </div>
      <div className="form-grid">
        <label><span>Категория</span><select value={form.category_id} onChange={(event) => setForm({ ...form, category_id: event.target.value })}>
          {categories.map((category) => <option key={category.id} value={category.id}>{category.title_ru}</option>)}
        </select></label>
        <Text label="Название RU" value={form.title_ru} onChange={(title_ru) => setForm({ ...form, title_ru })} />
        <Text label="Название SR-Latn" value={form.title_sr} onChange={(title_sr) => setForm({ ...form, title_sr })} />
        <Text label="Название EN" value={form.title_en} onChange={(title_en) => setForm({ ...form, title_en })} />
        <NumberInput label="Цена, RSD" value={form.price_minor} onChange={(price_minor) => setForm({ ...form, price_minor })} />
        <NumberInput label="Минимум, шт" value={form.min_quantity || 1} onChange={(min_quantity) => setForm({ ...form, min_quantity: Math.max(1, min_quantity) })} />
        <Text label="Вес/порция" value={form.weight_text} onChange={(weight_text) => setForm({ ...form, weight_text })} />
        <NumberInput label="Порядок" value={form.sort_order} onChange={(sort_order) => setForm({ ...form, sort_order })} />
      </div>
      <Textarea label="Описание RU" value={form.description_ru} onChange={(description_ru) => setForm({ ...form, description_ru })} />
      <div className="form-grid">
        <Textarea label="Описание SR-Latn" value={form.description_sr} onChange={(description_sr) => setForm({ ...form, description_sr })} />
        <Textarea label="Описание EN" value={form.description_en} onChange={(description_en) => setForm({ ...form, description_en })} />
      </div>
      <div className="form-grid">
        <Text label="Аллергены RU" value={form.allergen_text_ru} onChange={(allergen_text_ru) => setForm({ ...form, allergen_text_ru })} />
        <Text label="Аллергены SR-Latn" value={form.allergen_text_sr} onChange={(allergen_text_sr) => setForm({ ...form, allergen_text_sr })} />
        <Text label="Аллергены EN" value={form.allergen_text_en} onChange={(allergen_text_en) => setForm({ ...form, allergen_text_en })} />
      </div>
      <Text label="Фото / URL / путь" value={form.photo_path} onChange={(photo_path) => setForm({ ...form, photo_path })} />
      <label className="upload"><Upload size={16} /> Загрузить фото <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void upload(event.target.files?.[0])} /></label>
      {previewURL && (
        <div className="photo-preview">
          <img src={previewURL} alt="" loading="lazy" />
          <span>Preview фото блюда</span>
        </div>
      )}
      <label className="check"><input type="checkbox" checked={form.visible} onChange={(event) => setForm({ ...form, visible: event.target.checked })} /> Показывать клиентам</label>
      {item.id && item.price_minor !== form.price_minor && <div className="warn">Цена меняется: {money(item.price_minor)} → {money(form.price_minor)}. Старые заказы останутся с прежней ценой.</div>}
      <div className="actions">
        <button className="primary" onClick={() => void onSave(form)}><Save size={16} /> Сохранить</button>
        <button onClick={onCancel}>Отмена</button>
      </div>
    </div>
  );
}

function OrdersTabLegacy({ orders, onAction }: { orders: Order[]; onAction: AdminActionRunner }) {
  const [status, setStatus] = useState<"" | Order["fulfillment_status"]>("");
  const [query, setQuery] = useState("");
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return orders.filter((order) => {
      if (status && order.fulfillment_status !== status) return false;
      if (!q) return true;
      return [
        String(order.public_number),
        order.phone || "",
        order.address || "",
        order.client_username || "",
        order.client_first_name || "",
      ].some((value) => value.toLowerCase().includes(q));
    });
  }, [orders, query, status]);
  return (
    <section className="stack">
      <div className="panel toolbar">
        <input placeholder="Поиск: номер, телефон, адрес, username" value={query} onChange={(event) => setQuery(event.target.value)} />
        <select value={status} onChange={(event) => setStatus(event.target.value as "" | Order["fulfillment_status"])}>
          {statusOptions.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
        </select>
      </div>
      {visible.length === 0 ? <div className="panel"><p className="muted">Заказов нет</p></div> : visible.map((order) => (
        <article className="order" key={order.id}>
          <div className="order-head">
            <div>
              <strong>Заказ #{order.public_number}</strong>
              <span>{createdText(order.created_at)}</span>
            </div>
            <StatusBadge status={order.fulfillment_status} />
            <strong>{money(order.total_minor)}</strong>
          </div>
          <div className="order-info">
            <span>Клиент</span>
            <strong><OrderClientLink order={order} /></strong>
          </div>
          <div className="order-info">
            <span>Телефон</span>
            <strong>{order.phone || "не указан"}</strong>
          </div>
          <div className="order-info">
            <span>Оплата</span>
            <strong>{adminPaymentText(order)}</strong>
          </div>
          {order.payment_method === "cash" && order.cash_location_verified_at && (
            <div className="order-info">
              <span>Гео cash</span>
              <strong>проверено{typeof order.cash_location_distance_meters === "number" ? ` · ${formatMeters(order.cash_location_distance_meters)}` : ""}</strong>
            </div>
          )}
          <div className="order-info">
            <span>Адрес</span>
            <strong>{order.address || "не указан"}</strong>
          </div>
          {order.customer_comment && <div className="warn"><AlertTriangle size={16} /> {order.customer_comment}</div>}
          <ul>{order.items.map((item) => <li key={item.menu_item_id}>{item.quantity} × {item.snapshot_title}<span>{money(item.line_total_minor)}</span></li>)}</ul>
          <div className="actions wrap">
            {order.fulfillment_status !== "CANCELLED" && order.fulfillment_status !== "DELIVERED" && <button className="danger-button" onClick={() => void promptAction("Причина отмены", (reason) => onAction((authToken) => api.cancelOrder(authToken, order.id, reason)))}>Отменить заказ</button>}
            {order.fulfillment_status === "OUT_FOR_DELIVERY" && <button onClick={() => void promptAction("Почему вернуть на кухню?", (reason) => onAction((authToken) => api.returnOrderToNew(authToken, order.id, reason)))}>Вернуть на кухню</button>}
            <button onClick={() => void editContact(order, (input) => onAction((authToken) => api.updateOrderContact(authToken, order.id, input)))}>Исправить контакт</button>
            <button onClick={() => void promptAction("Внутренняя заметка", (reason) => onAction((authToken) => api.addOrderNote(authToken, order.id, reason)))}>Добавить заметку</button>
          </div>
        </article>
      ))}
    </section>
  );
}

function OrdersTab({
  orders,
  page,
  onLoad,
  onLoadOrder,
  onAction,
}: {
  orders: Order[];
  page: Pick<AdminOrdersResponse, "limit" | "offset" | "has_more">;
  onLoad(filter: { status?: string; q?: string; date?: string; limit?: number; offset?: number }): Promise<AdminOrdersResponse | undefined>;
  onLoadOrder(id: string): Promise<Order | undefined>;
  onAction: AdminActionRunner;
}) {
  const [status, setStatus] = useState<"" | Order["fulfillment_status"]>("");
  const [query, setQuery] = useState("");
  const [date, setDate] = useState("");
  const [expandedID, setExpandedID] = useState("");
  const [detail, setDetail] = useState<Order | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const limit = page.limit || 100;
  const offset = page.offset || 0;

  function currentFilter(nextOffset = 0) {
    return {
      status: status || undefined,
      q: query.trim() || undefined,
      date: date || undefined,
      limit,
      offset: nextOffset,
    };
  }

  async function applyFilter(nextOffset = 0) {
    setExpandedID("");
    setDetail(null);
    await onLoad(currentFilter(nextOffset));
  }

  async function resetFilter() {
    setStatus("");
    setQuery("");
    setDate("");
    setExpandedID("");
    setDetail(null);
    await onLoad({ limit, offset: 0 });
  }

  async function toggleDetails(order: Order) {
    if (expandedID === order.id) {
      setExpandedID("");
      setDetail(null);
      return;
    }
    setExpandedID(order.id);
    setDetail(null);
    setDetailLoading(true);
    try {
      const loaded = await onLoadOrder(order.id);
      setDetail(loaded || order);
    } finally {
      setDetailLoading(false);
    }
  }

  return (
    <section className="stack">
      <div className="panel toolbar">
        <input placeholder="Поиск: номер, телефон, username" value={query} onChange={(event) => setQuery(event.target.value)} />
        <select value={status} onChange={(event) => setStatus(event.target.value as "" | Order["fulfillment_status"])}>
          {statusOptions.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
        </select>
        <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        <button className="primary" onClick={() => void applyFilter(0)}>Применить</button>
        <button onClick={() => void resetFilter()}>Сброс</button>
      </div>
      <div className="panel toolbar">
        <button disabled={offset === 0} onClick={() => void applyFilter(Math.max(0, offset - limit))}>Назад</button>
        <span className="muted">Показаны {orders.length ? `${offset + 1}–${offset + orders.length}` : "0"}</span>
        <button disabled={!page.has_more} onClick={() => void applyFilter(offset + limit)}>Дальше</button>
      </div>
      {orders.length === 0 ? <div className="panel"><p className="muted">Заказов нет</p></div> : orders.map((order) => {
        const currentDetail = expandedID === order.id ? (detail || order) : null;
        return (
          <article className="order" key={order.id}>
            <div className="order-head">
              <div>
                <strong>Заказ #{order.public_number}</strong>
                <span>{createdText(order.created_at)}</span>
              </div>
              <StatusBadge status={order.fulfillment_status} />
              <strong>{money(order.total_minor)}</strong>
            </div>
            <div className="order-info">
              <span>Клиент</span>
              <strong><OrderClientLink order={order} /></strong>
            </div>
            <div className="order-info">
              <span>Телефон</span>
              <strong>{order.phone || "не указан"}</strong>
            </div>
            <div className="order-info">
              <span>Оплата</span>
              <strong>{adminPaymentText(order)}</strong>
            </div>
            {order.payment_method === "cash" && order.cash_location_verified_at && (
              <div className="order-info">
                <span>Гео cash</span>
                <strong>проверено{typeof order.cash_location_distance_meters === "number" ? ` · ${formatMeters(order.cash_location_distance_meters)}` : ""}</strong>
              </div>
            )}
            <div className="order-info">
              <span>Адрес</span>
              <strong>{order.address || "не указан"}</strong>
            </div>
            {order.customer_comment && <div className="warn"><AlertTriangle size={16} /> {order.customer_comment}</div>}
            <ul>{order.items.map((item) => <li key={item.menu_item_id}>{item.quantity} × {item.snapshot_title}<span>{money(item.line_total_minor)}</span></li>)}</ul>
            <div className="actions wrap">
              {order.fulfillment_status !== "CANCELLED" && order.fulfillment_status !== "DELIVERED" && <button className="danger-button" onClick={() => void promptAction("Причина отмены", (reason) => onAction((authToken) => api.cancelOrder(authToken, order.id, reason)))}>Отменить заказ</button>}
              {order.fulfillment_status === "OUT_FOR_DELIVERY" && <button onClick={() => void promptAction("Почему вернуть на кухню?", (reason) => onAction((authToken) => api.returnOrderToNew(authToken, order.id, reason)))}>Вернуть на кухню</button>}
              <button onClick={() => void editContact(order, (input) => onAction((authToken) => api.updateOrderContact(authToken, order.id, input)))}>Исправить контакт</button>
              <button onClick={() => void promptAction("Внутренняя заметка", (reason) => onAction((authToken) => api.addOrderNote(authToken, order.id, reason)))}>Добавить заметку</button>
              <button onClick={() => void promptAction("Причина повторной отправки клиенту", (reason) => onAction((authToken) => api.resendOrder(authToken, order.id, "client", reason)))}>Повтор клиенту</button>
              {order.fulfillment_status === "OUT_FOR_DELIVERY" && <button onClick={() => void promptAction("Причина повторной отправки курьеру", (reason) => onAction((authToken) => api.resendOrder(authToken, order.id, "courier", reason)))}>Повтор курьеру</button>}
              <button onClick={() => void toggleDetails(order)}>{expandedID === order.id ? "Скрыть события" : "События"}</button>
            </div>
            {expandedID === order.id && (
              <div className="order-events">
                {detailLoading && <p className="muted">Загружаем события…</p>}
                {!detailLoading && !currentDetail?.events?.length && <p className="muted">Событий пока нет</p>}
                {!detailLoading && currentDetail?.events?.map((event) => (
                  <div className="event-line" key={event.id}>
                    <span>{createdText(event.created_at)}</span>
                    <strong>{orderEventText(event.action)}</strong>
                    <small>{orderEventStatusText(event.from_status, event.to_status)}</small>
                    {event.reason && <p>{event.reason}</p>}
                  </div>
                ))}
              </div>
            )}
          </article>
        );
      })}
    </section>
  );
}

function StaffTab({ staff, onAction }: { staff: StaffMember[]; onAction: AdminActionRunner }) {
  const [form, setForm] = useState<StaffInput & { telegram_user_id: number }>({ telegram_user_id: 0, display_label: "", role: "KITCHEN", active: true });
  return (
    <section className="panel">
      <div className="inline-form">
        <input placeholder="Telegram ID" type="number" value={form.telegram_user_id || ""} onChange={(event) => setForm({ ...form, telegram_user_id: Number(event.target.value) })} />
        <input placeholder="Имя в админке" value={form.display_label} onChange={(event) => setForm({ ...form, display_label: event.target.value })} />
        <RoleSelect value={form.role} onChange={(role) => setForm({ ...form, role })} />
        <button className="primary" onClick={() => void onAction((authToken) => api.addStaff(authToken, form))}>Добавить</button>
      </div>
      {staff.map((member) => (
        <div className="row staff-row" key={member.id}>
          <div>
            <strong>{member.display_label || member.telegram_user_id}</strong>
            <span>{member.telegram_user_id} · {roleText(member.role)}</span>
          </div>
          <StatusPills visible={member.active} archived={false} />
          <button onClick={() => void onAction((authToken) => api.updateStaff(authToken, member.id, { display_label: member.display_label, role: member.role, active: !member.active }))}>
            {member.active ? <Eye size={16} /> : <EyeOff size={16} />} {member.active ? "Выключить" : "Включить"}
          </button>
          <button onClick={() => void editStaff(member, (input) => onAction((authToken) => api.updateStaff(authToken, member.id, input)))}>
            Изменить
          </button>
        </div>
      ))}
    </section>
  );
}

function ScheduleTab({ schedule, onSave }: { schedule: ScheduleDay[]; onSave(schedule: ScheduleDay[]): Promise<void> }) {
  const [draft, setDraft] = useState(schedule);
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(schedule), [schedule]);

  function patchDay(index: number, patch: Partial<ScheduleDay>) {
    setDraft(replace(draft, index, { ...draft[index], ...patch }));
  }

  async function patchDayAndSave(index: number, patch: Partial<ScheduleDay>) {
    const next = replace(draft, index, { ...draft[index], ...patch });
    setDraft(next);
    setSaving(true);
    try {
      await onSave(next);
    } finally {
      setSaving(false);
    }
  }

  async function saveDraft() {
    setSaving(true);
    try {
      await onSave(draft);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="stack">
      <div className="panel">
        <h2>Рабочее время</h2>
        <p className="muted">Базовое правило: понедельник — выходной. Вторник–воскресенье: работаем 13:00–22:00, заказы принимаем до 21:00. Таймзона Europe/Belgrade.</p>
        <p className="muted">Кнопки “Сделать рабочим”, “Выходной” и быстрый шаблон сохраняются сразу. Ручное изменение времени сохраняется нижней кнопкой.</p>
      </div>
      <div className="schedule-grid">
        {draft.map((day, index) => (
          <article className={day.closed ? "schedule-card is-closed" : "schedule-card"} key={day.day_of_week}>
            <div className="schedule-card-head">
              <div>
                <strong>{weekday(day.day_of_week)}</strong>
                <span>{day.closed ? "Выходной" : `${day.open_time}–${day.close_time}, заказы до ${day.order_cutoff_time}`}</span>
              </div>
              <button
                className={day.closed ? "primary" : "danger-button"}
                disabled={saving}
                onClick={() => void patchDayAndSave(index, { closed: !day.closed, ...(!day.closed ? {} : quickSchedule) })}
              >
                {saving ? "Сохраняю…" : day.closed ? "Сделать рабочим" : "Выходной"}
              </button>
            </div>
            <div className="form-grid three">
              <label><span>Открытие</span><input disabled={day.closed} type="time" value={day.open_time} onChange={(event) => patchDay(index, { open_time: event.target.value })} /></label>
              <label><span>Заказы до</span><input disabled={day.closed} type="time" value={day.order_cutoff_time} onChange={(event) => patchDay(index, { order_cutoff_time: event.target.value })} /></label>
              <label><span>Закрытие</span><input disabled={day.closed} type="time" value={day.close_time} onChange={(event) => patchDay(index, { close_time: event.target.value })} /></label>
            </div>
            {!day.closed && <button disabled={saving} onClick={() => void patchDayAndSave(index, quickSchedule)}>{saving ? "Сохраняю…" : "Поставить 13:00 / 21:00 / 22:00"}</button>}
          </article>
        ))}
      </div>
      <button className="primary sticky-save" disabled={saving} onClick={() => void saveDraft()}><Save size={16} /> {saving ? "Сохраняю…" : "Сохранить график"}</button>
    </section>
  );
}

function SettingsTab({ settings, demoMode, onSave }: { settings: Settings; demoMode: boolean; onSave(input: SettingsInput): Promise<void> }) {
  const [form, setForm] = useState(settings);
  useEffect(() => setForm(settings), [settings]);
  return (
    <section className="panel editor">
      <div className="warn">Доставка сейчас бесплатная: отдельная цена доставки отключена.</div>
      <div className="form-grid">
        <NumberInput label="Максимум одного блюда" value={form.max_item_quantity} onChange={(max_item_quantity) => setForm({ ...form, max_item_quantity })} />
        <NumberInput label="Максимум символов в комментарии" value={form.max_comment_length} onChange={(max_comment_length) => setForm({ ...form, max_comment_length })} />
        <Text label="Telegram поддержки" value={form.support_text} onChange={(support_text) => setForm({ ...form, support_text })} />
        <Text label="Телефон поддержки" value={form.support_phone} onChange={(support_phone) => setForm({ ...form, support_phone })} />
        <Text label="Ссылка на условия" value={form.terms_url} onChange={(terms_url) => setForm({ ...form, terms_url })} />
      </div>
      <label className="check"><input type="checkbox" checked={form.cash_enabled} onChange={(event) => setForm({ ...form, cash_enabled: event.target.checked })} /> Принимать оплату наличными</label>
      <label className="check"><input type="checkbox" checked={form.cash_location_required} onChange={(event) => setForm({ ...form, cash_location_required: event.target.checked })} /> Требовать геопроверку для cash</label>
      <div className="form-grid three">
        <NumberInput label="Широта ресторана" value={form.restaurant_latitude} onChange={(restaurant_latitude) => setForm({ ...form, restaurant_latitude })} />
        <NumberInput label="Долгота ресторана" value={form.restaurant_longitude} onChange={(restaurant_longitude) => setForm({ ...form, restaurant_longitude })} />
        <NumberInput label="Радиус cash, м" value={form.cash_location_radius_meters} onChange={(cash_location_radius_meters) => setForm({ ...form, cash_location_radius_meters })} />
        <NumberInput label="TTL проверки, сек" value={form.cash_location_ttl_seconds} onChange={(cash_location_ttl_seconds) => setForm({ ...form, cash_location_ttl_seconds })} />
        <NumberInput label="Макс. погрешность GPS, м" value={form.cash_location_max_accuracy_meters} onChange={(cash_location_max_accuracy_meters) => setForm({ ...form, cash_location_max_accuracy_meters })} />
      </div>
      <div className="warn">Точные координаты клиента не сохраняются. Cash-заказ использует только одноразовый Telegram challenge.</div>
      <label className={demoMode ? "check" : "check disabled-check"}>
        <input
          type="checkbox"
          checked={Boolean(form.crypto_enabled)}
          disabled={!demoMode}
          onChange={(event) => setForm({ ...form, crypto_enabled: event.target.checked })}
        />
        Тестовая crypto-оплата в demo
      </label>
      <div className="warn">{demoMode ? "Crypto сейчас работает только как sandbox: реальных денег, кошельков и provider webhook нет." : "Карта и crypto остаются выключены до этапа 5 и подключения реального provider."}</div>
      <button className="primary" onClick={() => void onSave({ ...form, flat_delivery_fee_minor: 0, card_enabled: false, crypto_enabled: demoMode ? form.crypto_enabled : false })}><Save size={16} /> Сохранить настройки</button>
    </section>
  );
}

function AnalyticsTab({ analytics, range, onRange, onExport }: { analytics: AdminAnalytics; range: AnalyticsRange; onRange(range: AnalyticsRange): void; onExport(): void }) {
  const labels: Record<AnalyticsRange, string> = { today: "Сегодня", "7d": "7 дней", month: "Месяц" };
  return (
    <section className="stack">
      <div className="toolbar panel">
        {(["today", "7d", "month"] as AnalyticsRange[]).map((entry) => <button key={entry} className={range === entry ? "primary" : ""} onClick={() => onRange(entry)}>{labels[entry]}</button>)}
        <button onClick={onExport}>CSV export</button>
      </div>
      <div className="grid">
        <Metric title="Всего заказов" value={analytics.summary.all_orders} />
        <Metric title="Доставлены" value={analytics.summary.delivered_orders} />
        <Metric title="Отменены" value={analytics.summary.cancelled_orders} />
        <Metric title="Выручка" value={money(analytics.summary.revenue_minor)} />
        <Metric title="Средний чек" value={money(analytics.summary.average_check_minor)} />
      </div>
      <div className="two">
        <SimpleTable title="Популярные блюда" rows={analytics.top_dishes.map((dish) => [dish.title, `${dish.quantity} шт`, money(dish.revenue_minor)])} />
        <SimpleTable title="По дням" rows={analytics.daily_rows.map((row) => [row.day, `${row.orders} заказов`, money(row.revenue_minor)])} />
      </div>
    </section>
  );
}

function AuditTab({ entries }: { entries: AuditEntry[] }) {
  return (
    <section className="panel">
      {entries.length === 0 ? <p className="muted">Журнал пуст</p> : entries.map((entry) => (
        <div className="audit" key={entry.id}>
          <strong>{auditActionText(entry.action)}</strong>
          <span>{auditTargetText(entry.target_type)} · {roleText(entry.actor_role)} · {new Date(entry.created_at).toLocaleString("ru-RU")}</span>
          {entry.reason && <p>{entry.reason}</p>}
        </div>
      ))}
    </section>
  );
}

function Metric({ title, value }: { title: string; value: string | number }) {
  return <div className="metric"><span>{title}</span><strong>{value}</strong></div>;
}

function StatusPills({ visible, archived }: { visible: boolean; archived: boolean }) {
  return <span className={archived ? "pill archived" : visible ? "pill visible" : "pill hidden"}>{archived ? "В архиве" : visible ? "Видно" : "Скрыто"}</span>;
}

function StatusBadge({ status }: { status: Order["fulfillment_status"] }) {
  return <span className={`status-badge status-${status.toLowerCase()}`}>{statusText(status)}</span>;
}

function SimpleTable({ title, rows }: { title: string; rows: string[][] }) {
  return <div className="panel"><h2>{title}</h2>{rows.length ? rows.map((row) => <div className="row compact" key={row.join(":")}>{row.map((cell) => <span key={cell}>{cell}</span>)}</div>) : <p className="muted">Нет данных</p>}</div>;
}

function Text({ label, value, onChange }: { label: string; value: string; onChange(value: string): void }) {
  return <label><span>{label}</span><input value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

function Textarea({ label, value, onChange }: { label: string; value: string; onChange(value: string): void }) {
  return <label><span>{label}</span><textarea value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

function NumberInput({ label, value, onChange }: { label: string; value: number; onChange(value: number): void }) {
  return <label><span>{label}</span><input type="number" value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}

function RoleSelect({ value, onChange }: { value: StaffInput["role"]; onChange(role: StaffInput["role"]): void }) {
  return <select value={value} onChange={(event) => onChange(event.target.value as StaffInput["role"])}><option value="KITCHEN">Кухня</option><option value="COURIER">Курьер</option><option value="ADMIN">Админ</option></select>;
}

function emptyCategory(): AdminCategory {
  const now = new Date().toISOString();
  return { id: "", title_ru: "", title_sr: "", title_en: "", sort_order: 100, visible: true, archived: false, item_count: 0, version: 1, created_at: now, updated_at: now };
}

function emptyItem(categoryID: string): AdminMenuItem {
  const now = new Date().toISOString();
  return {
    id: "",
    category_id: categoryID,
    title_ru: "",
    title_sr: "",
    title_en: "",
    description_ru: "",
    description_sr: "",
    description_en: "",
    price_minor: 0,
    currency: "RSD",
    photo_path: "",
    weight_text: "",
    min_quantity: 1,
    allergen_text_ru: "",
    allergen_text_sr: "",
    allergen_text_en: "",
    sort_order: 100,
    visible: true,
    archived: false,
    used_in_orders: false,
    version: 1,
    created_at: now,
    updated_at: now,
  };
}

function categoryTitle(categories: AdminCategory[], id: string): string {
  return categories.find((category) => category.id === id)?.title_ru || "без категории";
}

function weekday(day: number): string {
  return ["Воскресенье", "Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"][day] || String(day);
}

function replace<T>(items: T[], index: number, value: T): T[] {
  return items.map((item, current) => current === index ? value : item);
}

function promptAction(label: string, next: (reason: string) => Promise<unknown>): Promise<unknown> {
  const reason = window.prompt(label) || "";
  if (!reason.trim()) return Promise.resolve();
  return next(reason);
}

function orderPageMeta(page: AdminOrdersResponse): Pick<AdminOrdersResponse, "limit" | "offset" | "has_more"> {
  return {
    limit: page.limit || 100,
    offset: page.offset || 0,
    has_more: Boolean(page.has_more),
  };
}

function downloadBlob(blob: Blob, filename: string): void {
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(href);
}

function orderEventText(action: string): string {
  const map: Record<string, string> = {
    create_order: "Заказ создан",
    kitchen_ready: "Кухня нажала «Заказ готов»",
    courier_delivered: "Курьер доставил",
    admin_cancel: "Админ отменил",
    admin_return_to_new: "Админ вернул на кухню",
    admin_edit_contact: "Админ изменил контакт",
    admin_note: "Заметка админа",
    "order.demo_snapshot": "Demo snapshot",
  };
  return map[action] || auditActionText(action) || action;
}

function orderEventStatusText(from: string, to: string): string {
  const values = [from, to].filter(isOrderStatus).map((value) => statusText(value as Order["fulfillment_status"]));
  return values.join(" → ");
}

function isOrderStatus(value: string): boolean {
  return value === "NEW" || value === "OUT_FOR_DELIVERY" || value === "DELIVERED" || value === "CANCELLED";
}

function editContact(order: Order, next: (input: { phone: string; address: string; reason: string }) => Promise<unknown>): Promise<unknown> {
  const phone = window.prompt("Телефон", order.phone || "") || "";
  const address = window.prompt("Адрес", order.address || "") || "";
  const reason = window.prompt("Причина изменения", "исправление контакта") || "";
  if (!phone || !address || !reason) return Promise.resolve();
  return next({ phone, address, reason });
}

function editStaff(member: StaffMember, next: (input: StaffInput) => Promise<unknown>): Promise<unknown> {
  const displayLabel = window.prompt("Имя сотрудника в админке", member.display_label || "") || "";
  const role = (window.prompt("Роль: KITCHEN, COURIER или ADMIN", member.role) || member.role).trim().toUpperCase() as StaffInput["role"];
  if (role !== "KITCHEN" && role !== "COURIER" && role !== "ADMIN") return Promise.resolve();
  return next({ display_label: displayLabel.trim(), role, active: member.active });
}

function OrderClientLink({ order }: { order: Order }) {
  const label = orderClientLabel(order);
  const href = telegramUserLink(order);
  if (!href) return <>{label}</>;
  return (
    <a
      className="telegram-link"
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={(event) => {
        event.preventDefault();
        openTelegramLink(href);
      }}
    >
      {label}
    </a>
  );
}

function orderClientLabel(order: Order): string {
  const username = telegramUsername(order);
  if (username) return `@${username}`;
  return order.client_first_name || "Клиент Telegram";
}

function adminPaymentText(order: Order): string {
  if (order.payment_method === "crypto") return order.payment_status === "PAID" ? "Crypto TEST · PAID" : "Crypto TEST";
  if (order.payment_method === "card") return order.payment_status === "PAID" ? "Карта · PAID" : "Карта";
  return order.payment_status === "PAID" ? "Наличные · PAID" : "Наличные";
}

function telegramUsername(order: Order): string {
  const username = (order.client_username || "").trim().replace(/^@+/, "");
  return /^[A-Za-z0-9_]{5,32}$/.test(username) ? username : "";
}

function telegramUserLink(order: Order, draftText = ""): string | undefined {
  const username = telegramUsername(order);
  if (!username) return undefined;
  const query = draftText ? `?text=${encodeURIComponent(draftText)}` : "";
  return `https://t.me/${username}${query}`;
}

function openTelegramLink(url: string): void {
  const webApp = (window as Window & { Telegram?: { WebApp?: { openTelegramLink?: (value: string) => void } } }).Telegram?.WebApp;
  if (webApp?.openTelegramLink) {
    webApp.openTelegramLink(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

function createdText(value: string): string {
  return new Date(value).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function formatMeters(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(1).replace(".", ",")} км от ресторана`;
  return `${meters} м от ресторана`;
}

function runtimeReason(reason: string): string {
  if (reason === "manual_day_off") return "Включён ручной режим ВЫХОДНОЙ.";
  if (reason === "schedule_closed") return "Сейчас вне времени приёма заказов.";
  if (reason === "order_cutoff_passed") return "Приём заказов на сегодня завершён.";
  return "Работает по текущему графику.";
}

function roleText(role: string): string {
  if (role === "KITCHEN") return "Кухня";
  if (role === "COURIER") return "Курьер";
  if (role === "ADMIN") return "Админ";
  return role;
}

function auditTargetText(target: string): string {
  if (target === "category") return "Категория";
  if (target === "menu_item") return "Блюдо";
  if (target === "order") return "Заказ";
  if (target === "staff") return "Сотрудник";
  if (target === "app_settings") return "Настройки";
  if (target === "restaurant_schedule") return "График";
  return target;
}

function auditActionText(action: string): string {
  const map: Record<string, string> = {
    "category.create": "Создание категории",
    "category.update": "Изменение категории",
    "category.archive": "Категория отправлена в архив",
    "category.restore": "Категория восстановлена",
    "category.delete": "Категория удалена",
    "menu_item.create": "Создание блюда",
    "menu_item.update": "Изменение блюда",
    "menu_item.price_change": "Изменение цены",
    "menu_item.archive": "Блюдо отправлено в архив",
    "menu_item.restore": "Блюдо восстановлено",
    "menu_item.delete": "Блюдо удалено",
    "order.cancel": "Заказ отменён",
    "order.return_to_new": "Заказ возвращён на кухню",
    "order.edit_contact": "Контакт заказа изменён",
    "order.note": "Заметка к заказу",
    "order.courier_eta": "Курьер сообщил ETA",
    "settings.update": "Настройки изменены",
    "settings.manual_day_off": "Режим ВЫХОДНОЙ изменён",
    "schedule.update": "График изменён",
    "staff.create": "Сотрудник добавлен",
    "staff.update": "Сотрудник изменён",
  };
  return map[action] || action;
}

function errorText(error: unknown): string {
  const code = typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code) : "";
  if (code === "ORDER_STATUS_CONFLICT") return "Данные устарели или статус уже изменился. Обнови экран.";
  if (code === "INVALID_INPUT") return "Некорректные данные. Проверь поля и ограничения.";
  if (code === "TELEGRAM_INIT_DATA_MISSING") return "Откройте админку именно через Telegram Mini App. В обычном браузере или внешней вкладке Telegram не передаёт данные входа.";
  if (code === "AUTH_INVALID") return "Telegram-сессия устарела или открыта не через @TakoLako_main_bot. Полностью закройте Mini App и откройте заново из бота.";
  if (code === "FORBIDDEN") return "Нет ADMIN доступа.";
  return code || "Ошибка запроса";
}

function adminLoadLabel(key: AdminLoadKey): string {
  const labels: Record<AdminLoadKey, string> = {
    dashboard: "главная",
    menu: "меню",
    settings: "настройки",
    schedule: "график",
    orders: "заказы",
    staff: "сотрудники",
    analytics: "аналитика",
    audit: "журнал",
  };
  return labels[key];
}

function adminPhotoURL(path: string): string {
  const value = path.trim();
  if (!value) return "";
  if (/^(https?:|blob:|data:)/i.test(value)) return value;
  if (value.startsWith("/media/")) {
    const apiBase = String(import.meta.env.VITE_API_BASE_URL || "").replace(/\/+$/, "");
    return apiBase ? `${apiBase}${value}` : value;
  }
  if (value.startsWith("/")) return value;
  return `/${value.replace(/^\/+/, "")}`;
}
