import type { AdminAnalytics, AdminCategory, AdminDashboard, AdminMenuItem, AuditEntry, Order, ScheduleDay, Settings, StaffMember } from "@tk-delivery/api-client/generated";
import { createAdminApi, money, statusText, type AdminMenuResponse, type AdminTab, type AnalyticsRange, type CategoryInput, type MenuItemInput, type SettingsInput, type StaffInput } from "./api";
import { AlertTriangle, Archive, BarChart3, CalendarDays, Check, ClipboardList, Eye, EyeOff, Home, Menu as MenuIcon, RefreshCw, Save, Settings as SettingsIcon, Shield, Trash2, Upload, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

const api = createAdminApi();
const tabs: Array<{ id: AdminTab; label: string; icon: typeof Home }> = [
  { id: "home", label: "Главная", icon: Home },
  { id: "menu", label: "Меню", icon: MenuIcon },
  { id: "orders", label: "Заказы", icon: ClipboardList },
  { id: "staff", label: "Сотрудники", icon: Users },
  { id: "schedule", label: "График", icon: CalendarDays },
  { id: "analytics", label: "Аналитика", icon: BarChart3 },
  { id: "settings", label: "Настройки", icon: SettingsIcon },
  { id: "audit", label: "Audit", icon: Shield },
];

export function App() {
  const [token, setToken] = useState("");
  const [tab, setTab] = useState<AdminTab>("home");
  const [dashboard, setDashboard] = useState<AdminDashboard | null>(null);
  const [menu, setMenu] = useState<AdminMenuResponse>({ categories: [], items: [] });
  const [settings, setSettings] = useState<Settings | null>(null);
  const [schedule, setSchedule] = useState<ScheduleDay[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [analytics, setAnalytics] = useState<AdminAnalytics | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [range, setRange] = useState<AnalyticsRange>("today");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load(authToken = token, analyticsRange = range) {
    if (!authToken) return;
    setLoading(true);
    setError("");
    try {
      const [dash, menuData, settingsData, scheduleData, orderData, staffData, analyticsData, auditData] = await Promise.all([
        api.dashboard(authToken),
        api.menu(authToken),
        api.settings(authToken),
        api.schedule(authToken),
        api.orders(authToken),
        api.staff(authToken),
        api.analytics(authToken, analyticsRange),
        api.audit(authToken),
      ]);
      setDashboard(dash);
      setMenu(menuData);
      setSettings(settingsData);
      setSchedule(scheduleData.schedule);
      setOrders(orderData.orders);
      setStaff(staffData.staff);
      setAnalytics(analyticsData);
      setAudit(auditData.entries);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let stopped = false;
    api.authenticate().then((session) => {
      if (stopped) return;
      setToken(session.token);
      void load(session.token);
    }).catch((err) => {
      if (!stopped) setError(errorText(err));
      setLoading(false);
    });
    return () => {
      stopped = true;
    };
  }, []);

  async function run(action: () => Promise<unknown>) {
    setError("");
    try {
      await action();
      await load();
    } catch (err) {
      setError(errorText(err));
    }
  }

  async function setDayOff(enabled: boolean) {
    if (enabled && !window.confirm("Новые заказы будут остановлены. Уже созданные заказы останутся активны.")) return;
    await run(() => api.setManualDayOff(token, enabled));
  }

  return (
    <div className="admin">
      <aside className="sidebar">
        <div className="brand">
          <strong>TK ADMIN</strong>
          <span>control panel</span>
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
            <p>ADMIN Telegram ID owner/tester: 1048084234</p>
          </div>
          <button className="secondary" onClick={() => void load()} disabled={!token || loading}><RefreshCw size={18} /> Обновить</button>
        </header>
        {error && <div className="error"><AlertTriangle size={18} /> {error}</div>}
        {loading && <div className="muted">Загрузка…</div>}
        {tab === "home" && dashboard && settings && <HomeTab dashboard={dashboard} settings={settings} onDayOff={setDayOff} />}
        {tab === "menu" && <MenuTab menu={menu} onAction={run} token={token} />}
        {tab === "orders" && <OrdersTab orders={orders} onAction={run} token={token} />}
        {tab === "staff" && <StaffTab staff={staff} onAction={run} token={token} />}
        {tab === "schedule" && <ScheduleTab schedule={schedule} onSave={(next) => run(() => api.updateSchedule(token, next))} />}
        {tab === "analytics" && analytics && <AnalyticsTab analytics={analytics} range={range} onRange={(next) => { setRange(next); void load(token, next); }} />}
        {tab === "settings" && settings && <SettingsTab settings={settings} onSave={(input) => run(() => api.updateSettings(token, input))} />}
        {tab === "audit" && <AuditTab entries={audit} />}
      </main>
    </div>
  );
}

function HomeTab({ dashboard, settings, onDayOff }: { dashboard: AdminDashboard; settings: Settings; onDayOff(enabled: boolean): Promise<void> }) {
  const accepting = dashboard.runtime.accepting_orders;
  return (
    <section className="grid">
      <div className={accepting ? "panel ok" : "panel danger"}>
        <h2>{accepting ? "Приём заказов включён" : "Приём заказов остановлен"}</h2>
        <p>Причина: {dashboard.runtime.reason}</p>
        <button className={settings.manual_day_off ? "primary" : "danger-button"} onClick={() => void onDayOff(!settings.manual_day_off)}>
          {settings.manual_day_off ? "Включить приём" : "Остановить приём заказов"}
        </button>
      </div>
      <Metric title="NEW" value={dashboard.new_orders} />
      <Metric title="OUT_FOR_DELIVERY" value={dashboard.out_for_delivery} />
      <Metric title="Заказов сегодня" value={dashboard.orders_today} />
      <Metric title="Выручка сегодня" value={money(dashboard.revenue_today_minor)} />
      <div className="panel wide">
        <h2>Последние ошибки уведомлений/оплат</h2>
        {dashboard.notification_errors.length ? dashboard.notification_errors.map((item) => <p key={item}>{item}</p>) : <p className="muted">Ошибок нет</p>}
      </div>
    </section>
  );
}

function MenuTab({ menu, token, onAction }: { menu: AdminMenuResponse; token: string; onAction(action: () => Promise<unknown>): Promise<void> }) {
  const [cat, setCat] = useState<AdminCategory | null>(null);
  const [item, setItem] = useState<AdminMenuItem | null>(null);
  const activeCategories = menu.categories.filter((entry) => !entry.archived);
  return (
    <section className="stack">
      <div className="two">
        <div className="panel">
          <h2>Categories</h2>
          <button className="primary" onClick={() => setCat(emptyCategory())}>+ Category</button>
          {menu.categories.map((category) => (
            <div className="row" key={category.id}>
              <div>
                <strong>{category.title_ru}</strong>
                <span>{category.item_count} items · sort {category.sort_order} · v{category.version}</span>
              </div>
              <StatusPills visible={category.visible} archived={category.archived} />
              <button onClick={() => setCat(category)}>Edit</button>
              <button onClick={() => void onAction(() => api.archiveCategory(token, category.id, "archive from admin"))}><Archive size={16} /></button>
              <button onClick={() => void onAction(() => api.deleteCategory(token, category.id, "delete/archive from admin"))}><Trash2 size={16} /></button>
            </div>
          ))}
        </div>
        <div className="panel">
          <h2>Dishes</h2>
          <button className="primary" onClick={() => setItem(emptyItem(activeCategories[0]?.id || ""))}>+ Dish</button>
          {menu.items.map((dish) => (
            <div className="row" key={dish.id}>
              <div>
                <strong>{dish.title_ru}</strong>
                <span>{money(dish.price_minor)} · {categoryTitle(menu.categories, dish.category_id)} · v{dish.version}</span>
              </div>
              <StatusPills visible={dish.visible} archived={dish.archived} />
              <button onClick={() => setItem(dish)}>Edit</button>
              <button onClick={() => void onAction(() => api.archiveItem(token, dish.id, "archive from admin"))}><Archive size={16} /></button>
              <button onClick={() => void onAction(() => api.deleteItem(token, dish.id, "delete/archive from admin"))}><Trash2 size={16} /></button>
            </div>
          ))}
        </div>
      </div>
      {cat && <CategoryForm category={cat} onCancel={() => setCat(null)} onSave={(input) => onAction(() => cat.id ? api.updateCategory(token, cat.id, input) : api.createCategory(token, input)).then(() => setCat(null))} />}
      {item && <DishForm item={item} categories={activeCategories} token={token} onCancel={() => setItem(null)} onSave={(input) => onAction(() => item.id ? api.updateItem(token, item.id, input) : api.createItem(token, input)).then(() => setItem(null))} />}
    </section>
  );
}

function CategoryForm({ category, onSave, onCancel }: { category: AdminCategory; onSave(input: CategoryInput): Promise<void>; onCancel(): void }) {
  const [form, setForm] = useState(category);
  return (
    <div className="panel editor">
      <h2>{category.id ? "Edit category" : "New category"}</h2>
      <Text label="RU" value={form.title_ru} onChange={(title_ru) => setForm({ ...form, title_ru })} />
      <Text label="SR-Latn" value={form.title_sr} onChange={(title_sr) => setForm({ ...form, title_sr })} />
      <Text label="EN" value={form.title_en} onChange={(title_en) => setForm({ ...form, title_en })} />
      <NumberInput label="Sort" value={form.sort_order} onChange={(sort_order) => setForm({ ...form, sort_order })} />
      <label className="check"><input type="checkbox" checked={form.visible} onChange={(event) => setForm({ ...form, visible: event.target.checked })} /> Visible</label>
      <div className="actions">
        <button className="primary" onClick={() => void onSave(form)}><Save size={16} /> Save</button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function DishForm({ item, categories, token, onSave, onCancel }: { item: AdminMenuItem; categories: AdminCategory[]; token: string; onSave(input: MenuItemInput): Promise<void>; onCancel(): void }) {
  const [form, setForm] = useState(item);
  async function upload(file?: File) {
    if (!file) return;
    const response = await api.uploadMenuPhoto(token, file);
    setForm((current) => ({ ...current, photo_path: response.photo_path }));
  }
  return (
    <div className="panel editor">
      <h2>{item.id ? "Edit dish" : "New dish"}</h2>
      <select value={form.category_id} onChange={(event) => setForm({ ...form, category_id: event.target.value })}>
        {categories.map((category) => <option key={category.id} value={category.id}>{category.title_ru}</option>)}
      </select>
      <Text label="Title RU" value={form.title_ru} onChange={(title_ru) => setForm({ ...form, title_ru })} />
      <Text label="Title SR" value={form.title_sr} onChange={(title_sr) => setForm({ ...form, title_sr })} />
      <Text label="Title EN" value={form.title_en} onChange={(title_en) => setForm({ ...form, title_en })} />
      <Text label="Description RU" value={form.description_ru} onChange={(description_ru) => setForm({ ...form, description_ru })} />
      <NumberInput label="Price RSD" value={form.price_minor} onChange={(price_minor) => setForm({ ...form, price_minor })} />
      <Text label="Weight text" value={form.weight_text} onChange={(weight_text) => setForm({ ...form, weight_text })} />
      <Text label="Photo path" value={form.photo_path} onChange={(photo_path) => setForm({ ...form, photo_path })} />
      <label className="upload"><Upload size={16} /> Upload photo <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void upload(event.target.files?.[0])} /></label>
      <NumberInput label="Sort" value={form.sort_order} onChange={(sort_order) => setForm({ ...form, sort_order })} />
      <label className="check"><input type="checkbox" checked={form.visible} onChange={(event) => setForm({ ...form, visible: event.target.checked })} /> Visible</label>
      {item.id && item.price_minor !== form.price_minor && <div className="warn">Цена меняется: {money(item.price_minor)} → {money(form.price_minor)}. Старые заказы не изменятся.</div>}
      <div className="actions">
        <button className="primary" onClick={() => void onSave(form)}><Save size={16} /> Save</button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function OrdersTab({ orders, token, onAction }: { orders: Order[]; token: string; onAction(action: () => Promise<unknown>): Promise<void> }) {
  const [status, setStatus] = useState("");
  const visible = useMemo(() => status ? orders.filter((order) => order.fulfillment_status === status) : orders, [orders, status]);
  return (
    <section className="panel">
      <div className="toolbar">
        <select value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">All</option>
          <option value="NEW">NEW</option>
          <option value="OUT_FOR_DELIVERY">OUT_FOR_DELIVERY</option>
          <option value="DELIVERED">DELIVERED</option>
          <option value="CANCELLED">CANCELLED</option>
        </select>
      </div>
      {visible.length === 0 ? <p className="muted">Заказов нет</p> : visible.map((order) => (
        <article className="order" key={order.id}>
          <div className="order-head">
            <strong>#{order.public_number}</strong>
            <span>{statusText(order.fulfillment_status)}</span>
            <span>{money(order.total_minor)}</span>
          </div>
          <p>{order.phone || "phone hidden"} · {order.address || "address hidden"}</p>
          <ul>{order.items.map((item) => <li key={item.menu_item_id}>{item.quantity} × {item.snapshot_title}</li>)}</ul>
          <div className="actions wrap">
            {order.fulfillment_status !== "CANCELLED" && order.fulfillment_status !== "DELIVERED" && <button onClick={() => void promptAction("Причина отмены", (reason) => onAction(() => api.cancelOrder(token, order.id, reason)))}>Cancel</button>}
            {order.fulfillment_status === "OUT_FOR_DELIVERY" && <button onClick={() => void promptAction("Почему вернуть в NEW?", (reason) => onAction(() => api.returnOrderToNew(token, order.id, reason)))}>Return to NEW</button>}
            <button onClick={() => void editContact(order, (input) => onAction(() => api.updateOrderContact(token, order.id, input)))}>Edit contact</button>
            <button onClick={() => void onAction(() => api.resendOrder(token, order.id, "client", "manual resend"))}>Resend client</button>
            <button onClick={() => void promptAction("Internal note", (reason) => onAction(() => api.addOrderNote(token, order.id, reason)))}>Note</button>
          </div>
        </article>
      ))}
    </section>
  );
}

function StaffTab({ staff, token, onAction }: { staff: StaffMember[]; token: string; onAction(action: () => Promise<unknown>): Promise<void> }) {
  const [form, setForm] = useState<StaffInput & { telegram_user_id: number }>({ telegram_user_id: 0, display_label: "", role: "KITCHEN", active: true });
  return (
    <section className="panel">
      <div className="inline-form">
        <input placeholder="Telegram ID" type="number" value={form.telegram_user_id || ""} onChange={(event) => setForm({ ...form, telegram_user_id: Number(event.target.value) })} />
        <input placeholder="Label" value={form.display_label} onChange={(event) => setForm({ ...form, display_label: event.target.value })} />
        <RoleSelect value={form.role} onChange={(role) => setForm({ ...form, role })} />
        <button className="primary" onClick={() => void onAction(() => api.addStaff(token, form))}>Add</button>
      </div>
      {staff.map((member) => (
        <div className="row" key={member.id}>
          <div>
            <strong>{member.display_label}</strong>
            <span>{member.telegram_user_id} · {member.role}</span>
          </div>
          <button onClick={() => void onAction(() => api.updateStaff(token, member.id, { display_label: member.display_label, role: member.role, active: !member.active }))}>
            {member.active ? <Eye size={16} /> : <EyeOff size={16} />} {member.active ? "Active" : "Inactive"}
          </button>
        </div>
      ))}
    </section>
  );
}

function ScheduleTab({ schedule, onSave }: { schedule: ScheduleDay[]; onSave(schedule: ScheduleDay[]): Promise<void> }) {
  const [draft, setDraft] = useState(schedule);
  useEffect(() => setDraft(schedule), [schedule]);
  return (
    <section className="panel">
      {draft.map((day, index) => (
        <div className="schedule-row" key={day.day_of_week}>
          <strong>{weekday(day.day_of_week)}</strong>
          <label><input type="checkbox" checked={day.closed} onChange={(event) => setDraft(replace(draft, index, { ...day, closed: event.target.checked }))} /> closed</label>
          <input type="time" value={day.open_time} onChange={(event) => setDraft(replace(draft, index, { ...day, open_time: event.target.value }))} />
          <input type="time" value={day.order_cutoff_time} onChange={(event) => setDraft(replace(draft, index, { ...day, order_cutoff_time: event.target.value }))} />
          <input type="time" value={day.close_time} onChange={(event) => setDraft(replace(draft, index, { ...day, close_time: event.target.value }))} />
        </div>
      ))}
      <p className="muted">Initial rule: Monday closed; Tue–Sun 13:00–22:00, orders until 21:00. Timezone Europe/Belgrade.</p>
      <button className="primary" onClick={() => void onSave(draft)}><Save size={16} /> Save schedule</button>
    </section>
  );
}

function SettingsTab({ settings, onSave }: { settings: Settings; onSave(input: SettingsInput): Promise<void> }) {
  const [form, setForm] = useState(settings);
  useEffect(() => setForm(settings), [settings]);
  return (
    <section className="panel editor">
      <div className="warn">Доставка бесплатно: отдельная цена доставки отключена.</div>
      <NumberInput label="Max dish quantity" value={form.max_item_quantity} onChange={(max_item_quantity) => setForm({ ...form, max_item_quantity })} />
      <NumberInput label="Max comment length" value={form.max_comment_length} onChange={(max_comment_length) => setForm({ ...form, max_comment_length })} />
      <Text label="Support Telegram" value={form.support_text} onChange={(support_text) => setForm({ ...form, support_text })} />
      <Text label="Support phone" value={form.support_phone} onChange={(support_phone) => setForm({ ...form, support_phone })} />
      <Text label="Terms URL" value={form.terms_url} onChange={(terms_url) => setForm({ ...form, terms_url })} />
      <label className="check"><input type="checkbox" checked={form.cash_enabled} onChange={(event) => setForm({ ...form, cash_enabled: event.target.checked })} /> Cash enabled</label>
      <div className="warn">Card/crypto остаются disabled до этапа 5 и production provider config.</div>
      <button className="primary" onClick={() => void onSave({ ...form, flat_delivery_fee_minor: 0 })}><Save size={16} /> Save settings</button>
    </section>
  );
}

function AnalyticsTab({ analytics, range, onRange }: { analytics: AdminAnalytics; range: AnalyticsRange; onRange(range: AnalyticsRange): void }) {
  return (
    <section className="stack">
      <div className="toolbar">
        {(["today", "7d", "month"] as AnalyticsRange[]).map((entry) => <button key={entry} className={range === entry ? "primary" : ""} onClick={() => onRange(entry)}>{entry}</button>)}
      </div>
      <div className="grid">
        <Metric title="All" value={analytics.summary.all_orders} />
        <Metric title="Delivered" value={analytics.summary.delivered_orders} />
        <Metric title="Cancelled" value={analytics.summary.cancelled_orders} />
        <Metric title="Revenue" value={money(analytics.summary.revenue_minor)} />
        <Metric title="Average check" value={money(analytics.summary.average_check_minor)} />
      </div>
      <div className="two">
        <SimpleTable title="Top dishes" rows={analytics.top_dishes.map((dish) => [dish.title, String(dish.quantity), money(dish.revenue_minor)])} />
        <SimpleTable title="Daily rows" rows={analytics.daily_rows.map((row) => [row.day, String(row.orders), money(row.revenue_minor)])} />
      </div>
    </section>
  );
}

function AuditTab({ entries }: { entries: AuditEntry[] }) {
  return (
    <section className="panel">
      {entries.length === 0 ? <p className="muted">Audit пуст</p> : entries.map((entry) => (
        <div className="audit" key={entry.id}>
          <strong>{entry.action}</strong>
          <span>{entry.target_type} · {entry.actor_role} · {new Date(entry.created_at).toLocaleString("ru-RU")}</span>
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
  return <span className={archived ? "pill archived" : visible ? "pill visible" : "pill hidden"}>{archived ? "archived" : visible ? "visible" : "hidden"}</span>;
}

function SimpleTable({ title, rows }: { title: string; rows: string[][] }) {
  return <div className="panel"><h2>{title}</h2>{rows.length ? rows.map((row) => <div className="row compact" key={row.join(":")}>{row.map((cell) => <span key={cell}>{cell}</span>)}</div>) : <p className="muted">Нет данных</p>}</div>;
}

function Text({ label, value, onChange }: { label: string; value: string; onChange(value: string): void }) {
  return <label><span>{label}</span><input value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

function NumberInput({ label, value, onChange }: { label: string; value: number; onChange(value: number): void }) {
  return <label><span>{label}</span><input type="number" value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}

function RoleSelect({ value, onChange }: { value: StaffInput["role"]; onChange(role: StaffInput["role"]): void }) {
  return <select value={value} onChange={(event) => onChange(event.target.value as StaffInput["role"])}><option value="KITCHEN">KITCHEN</option><option value="COURIER">COURIER</option><option value="ADMIN">ADMIN</option></select>;
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
  return categories.find((category) => category.id === id)?.title_ru || "no category";
}

function weekday(day: number): string {
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][day] || String(day);
}

function replace<T>(items: T[], index: number, value: T): T[] {
  return items.map((item, current) => current === index ? value : item);
}

function promptAction(label: string, next: (reason: string) => Promise<void>): Promise<void> {
  const reason = window.prompt(label) || "";
  if (!reason.trim()) return Promise.resolve();
  return next(reason);
}

function editContact(order: Order, next: (input: { phone: string; address: string; reason: string }) => Promise<void>): Promise<void> {
  const phone = window.prompt("Phone", order.phone || "") || "";
  const address = window.prompt("Address", order.address || "") || "";
  const reason = window.prompt("Reason", "edit contact") || "";
  if (!phone || !address || !reason) return Promise.resolve();
  return next({ phone, address, reason });
}

function errorText(error: unknown): string {
  const code = typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code) : "";
  if (code === "ORDER_STATUS_CONFLICT") return "Данные устарели или status уже изменился. Обнови экран.";
  if (code === "INVALID_INPUT") return "Некорректные данные. Проверь поля и ограничения.";
  if (code === "FORBIDDEN") return "Нет ADMIN доступа.";
  return code || "Ошибка запроса";
}
