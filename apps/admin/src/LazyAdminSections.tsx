import type { AdminAnalytics, AnalyticsBreakdown, AuditEntry, AuditLogResponse, Settings } from "@tk-delivery/api-client/generated";
import { Save } from "lucide-react";
import { useEffect, useState } from "react";
import { money, type AnalyticsRange, type SettingsInput } from "./api";
import { parseNumberDraft } from "./number-draft";

export function AnalyticsSection({ analytics, range, onRange, onExport }: { analytics: AdminAnalytics; range: AnalyticsRange; onRange(range: AnalyticsRange): void; onExport(): void }) {
  const labels: Record<AnalyticsRange, string> = { today: "Сегодня", "7d": "7 дней", month: "Месяц" };
  const paymentRows = paymentBreakdownRows(analytics.payments ?? []);
  const audience = analytics.audience ?? {
    visits: 0, unique_visitors: 0, ordering_customers: 0, delivery_customers: 0, delivery_orders: 0,
    pickup_customers: 0, pickup_orders: 0, reservation_customers: 0, reservations: 0,
    order_conversion_percent: 0, reservation_conversion_percent: 0,
  };
  const product = analytics.product ?? { retention: [], screens: [], clicks: [], order_funnel: [], booking_funnel: [] };
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
        <Metric title="Загрузка delivery-слотов" value={`${analytics.summary.delivery_slot_fill_percent}%`} />
        <Metric title="Средняя очередь" value={`${analytics.summary.average_delivery_queue_delay_minutes} мин`} />
        <Metric title="Отклонение готовности" value={`${analytics.summary.average_ready_plan_deviation_minutes} мин`} />
      </div>
      <section className="panel">
        <h2>Аудитория и действия</h2>
        <div className="grid analytics-audience-grid">
          <Metric title="Уникальные посетители" value={audience.unique_visitors} />
          <Metric title="Открытия Mini App" value={audience.visits} />
          <Metric title="Заказали еду" value={audience.ordering_customers} />
          <Metric title="Доставка" value={`${audience.delivery_customers} чел · ${audience.delivery_orders} зак.`} />
          <Metric title="Самовывоз" value={`${audience.pickup_customers} чел · ${audience.pickup_orders} зак.`} />
          <Metric title="Брони столов" value={`${audience.reservation_customers} чел · ${audience.reservations} брон.`} />
          <Metric title="Конверсия в заказ" value={`${audience.order_conversion_percent}%`} />
          <Metric title="Конверсия в бронь" value={`${audience.reservation_conversion_percent}%`} />
        </div>
      </section>
      <section className="panel">
        <h2>Возвращаются в приложение</h2>
        <div className="grid analytics-audience-grid">
          {[1, 7, 30].map((days) => {
            const row = product.retention.find((entry) => entry.days === days);
            return <Metric key={days} title={`D${days}`} value={row?.eligible_users ? `${row.percent}% · ${row.returned_users}/${row.eligible_users}` : "—"} />;
          })}
        </div>
      </section>
      <div className="two">
        <SimpleTable title="Воронка заказа" rows={product.order_funnel.map((row) => [productMetricLabel(row.key), `${row.unique_users} чел`, `${row.events} действий`])} />
        <SimpleTable title="Воронка брони" rows={product.booking_funnel.map((row) => [productMetricLabel(row.key), `${row.unique_users} чел`, `${row.events} действий`])} />
      </div>
      <div className="two">
        <SimpleTable title="Экраны" rows={product.screens.map((row) => [productMetricLabel(row.key), `${row.unique_users} чел`, `${row.events} просмотров`])} />
        <SimpleTable title="Куда нажимают" rows={product.clicks.map((row) => [productMetricLabel(row.key), `${row.unique_users} чел`, `${row.events} нажатий`])} />
      </div>
      <section className="panel analytics-payments">
        <div><h2>Оплата</h2><p className="muted">Заказы и выручка по способам оплаты.</p></div>
        <div className="payment-breakdown">
          {paymentRows.map((row) => (
            <article className={`payment-card payment-kind-${row.key}`} key={row.key}>
              <div className="payment-card-head"><span>{paymentMethodLabel(row.key)}</span><strong>{money(row.revenue_minor)}</strong></div>
              <div className="payment-card-grid">
                <span>Всего <b>{row.count}</b></span><span>Доставлено <b>{row.delivered_count}</b></span>
                <span>Оплачено <b>{row.paid_count}</b></span><span>Отменено <b>{row.cancelled_count}</b></span>
              </div>
            </article>
          ))}
        </div>
      </section>
      <div className="two">
        <SimpleTable title="Популярные блюда" rows={(analytics.top_dishes ?? []).map((dish) => [dish.title, `${dish.quantity} шт`, money(dish.revenue_minor)])} />
        <SimpleTable title="По дням" rows={(analytics.daily_rows ?? []).map((row) => [row.day, `${row.orders} заказов`, money(row.revenue_minor)])} />
      </div>
      <SimpleTable title="Активность по дням" rows={(analytics.daily_audience_rows ?? []).map((row) => [row.day, `${row.unique_visitors} чел / ${row.visits} входов`, `Д ${row.delivery_orders} · С ${row.pickup_orders} · Б ${row.reservations}`])} />
    </section>
  );
}

export function AuditSection({ entries, page, onPageChange }: { entries: AuditEntry[]; page: Pick<AuditLogResponse, "limit" | "offset" | "has_more">; onPageChange(offset: number): Promise<void> }) {
  const limit = page.limit || 50;
  const offset = page.offset || 0;
  return (
    <section className="panel">
      {entries.length === 0 ? <p className="muted">Журнал пуст</p> : entries.map((entry) => (
        <div className="audit" key={entry.id}><strong>{auditActionText(entry.action)}</strong><span>{new Date(entry.created_at).toLocaleString("ru-RU")}</span>{entry.reason && <p>{entry.reason}</p>}</div>
      ))}
      {(offset > 0 || page.has_more) && <div className="orders-pagination audit-pagination">
        <button disabled={offset === 0} onClick={() => void onPageChange(Math.max(0, offset - limit))}>Назад</button>
        <span>{entries.length ? `${offset + 1}–${offset + entries.length}` : "0"}</span>
        <button disabled={!page.has_more} onClick={() => void onPageChange(offset + limit)}>Дальше</button>
      </div>}
    </section>
  );
}

export function SettingsSection({ settings, demoMode, onSave }: { settings: Settings; demoMode: boolean; onSave(input: SettingsInput): Promise<void> }) {
  const [form, setForm] = useState(settings);
  useEffect(() => setForm(settings), [settings]);
  return (
    <section className="settings-workspace">
      <div className="panel settings-card">
        <h2>Заказы</h2>
        <div className="form-grid">
          <NumberInput label="Максимум блюда" value={form.max_item_quantity} onChange={(max_item_quantity) => setForm({ ...form, max_item_quantity })} />
          <NumberInput label="Комментарий" value={form.max_comment_length} onChange={(max_comment_length) => setForm({ ...form, max_comment_length })} />
        </div>
      </div>

      <div className="panel settings-card">
        <div className="settings-card-head">
          <h2>Поддержка</h2>
          <p>Эти контакты видит клиент в разделе “Поддержка” и в юридических страницах.</p>
        </div>
        <div className="support-settings">
          <label>
            <span>Telegram поддержки</span>
            <input value={form.support_text} placeholder="@Tako_Lako_N" onChange={(event) => setForm({ ...form, support_text: event.target.value })} />
            <small>Основной канал: клиент нажимает кнопку и сразу пишет сюда.</small>
          </label>
          <label>
            <span>Телефон поддержки</span>
            <input value={form.support_phone} placeholder="+381 ..." onChange={(event) => setForm({ ...form, support_phone: event.target.value })} />
            <small>Можно оставить пустым, если сейчас работает только Telegram.</small>
          </label>
          <label>
            <span>Ссылка на условия</span>
            <input value={form.terms_url} placeholder="Оставь пустым — откроется встроенная страница" onChange={(event) => setForm({ ...form, terms_url: event.target.value })} />
            <small>Нужна только если условия будут на внешнем сайте.</small>
          </label>
        </div>
        <div className="support-preview">
          <span>Как это выглядит клиенту</span>
          <strong>{form.support_text.trim() || "@Tako_Lako_N"}</strong>
          {form.support_phone.trim() && <small>{form.support_phone.trim()}</small>}
        </div>
      </div>

      <div className="panel settings-card">
        <h2>Наличные</h2>
        <label className="check"><input type="checkbox" checked={form.cash_enabled} onChange={(event) => setForm({ ...form, cash_enabled: event.target.checked })} /> Принимать наличные</label>
        <label className="check"><input type="checkbox" checked={form.cash_location_required} onChange={(event) => setForm({ ...form, cash_location_required: event.target.checked })} /> Проверять геопозицию</label>
      </div>

      <div className="panel settings-card pickup-settings-card">
        <div className="settings-card-head">
          <h2>Самовывоз</h2>
          <p>Клиент выбирает свободное время. Кухня видит заказ заранее и готовит его к выбранному часу.</p>
        </div>
        <label className="check"><input type="checkbox" checked={form.pickup_enabled} onChange={(event) => setForm({ ...form, pickup_enabled: event.target.checked })} /> Принимать заказы на самовывоз</label>
        <div className="form-grid three">
          <NumberInput label="Готовить за, мин" value={form.pickup_min_lead_minutes} onChange={(pickup_min_lead_minutes) => setForm({ ...form, pickup_min_lead_minutes })} />
          <NumberInput label="Шаг времени, мин" value={form.pickup_slot_minutes} onChange={(pickup_slot_minutes) => setForm({ ...form, pickup_slot_minutes })} />
          <NumberInput label="Заказов на время" value={form.pickup_max_orders_per_slot} onChange={(pickup_max_orders_per_slot) => setForm({ ...form, pickup_max_orders_per_slot })} />
        </div>
        <label><span>Последний самовывоз</span><input type="time" value={form.pickup_last_time} onChange={(event) => setForm({ ...form, pickup_last_time: event.target.value })} /></label>
        <Text label="Адрес самовывоза" value={form.pickup_address} onChange={(pickup_address) => setForm({ ...form, pickup_address })} />
        <Text label="Ссылка на карту" value={form.pickup_map_url} onChange={(pickup_map_url) => setForm({ ...form, pickup_map_url })} />
        <details className="pickup-copy-settings">
          <summary>Инструкция для клиента</summary>
          <div className="stack compact-stack">
            <Textarea label="Русский" value={form.pickup_instructions_ru} onChange={(pickup_instructions_ru) => setForm({ ...form, pickup_instructions_ru })} />
            <Textarea label="Сербский" value={form.pickup_instructions_sr} onChange={(pickup_instructions_sr) => setForm({ ...form, pickup_instructions_sr })} />
            <Textarea label="Английский" value={form.pickup_instructions_en} onChange={(pickup_instructions_en) => setForm({ ...form, pickup_instructions_en })} />
          </div>
        </details>
      </div>

      <div className="panel settings-card">
        <div className="settings-card-head"><h2>Время доставки</h2></div>
        <label className="check"><input type="checkbox" checked={form.delivery_timing_enabled} onChange={(event) => setForm({ ...form, delivery_timing_enabled: event.target.checked })} /> Разрешить выбор времени</label>
        <p className="muted">Первое время через 30 минут · один заказ на каждые 30 минут · последнее время 21:00</p>
      </div>

      <div className="panel settings-card">
        <h2>Способы оплаты</h2>
        <label className="check disabled-check"><input type="checkbox" checked={false} disabled /> Карта — этап 5</label>
        <label className={demoMode ? "check" : "check disabled-check"}>
          <input type="checkbox" checked={Boolean(form.crypto_enabled)} disabled={!demoMode} onChange={(event) => setForm({ ...form, crypto_enabled: event.target.checked })} />
          Crypto demo
        </label>
      </div>

      <details className="panel advanced-fields settings-card">
        <summary>Расширенные</summary>
        <div className="advanced-fields-body">
          <div className="form-grid three">
            <NumberInput label="Широта" value={form.restaurant_latitude} onChange={(restaurant_latitude) => setForm({ ...form, restaurant_latitude })} />
            <NumberInput label="Долгота" value={form.restaurant_longitude} onChange={(restaurant_longitude) => setForm({ ...form, restaurant_longitude })} />
            <NumberInput label="Радиус проверки" value={form.cash_location_radius_meters} onChange={(cash_location_radius_meters) => setForm({ ...form, cash_location_radius_meters })} />
            <NumberInput label="Срок подтверждения" value={form.cash_location_ttl_seconds} onChange={(cash_location_ttl_seconds) => setForm({ ...form, cash_location_ttl_seconds })} />
            <NumberInput label="Погрешность" value={form.cash_location_max_accuracy_meters} onChange={(cash_location_max_accuracy_meters) => setForm({ ...form, cash_location_max_accuracy_meters })} />
          </div>
        </div>
      </details>

      <button className="primary sticky-save" onClick={() => void onSave({ ...form, flat_delivery_fee_minor: 0, card_enabled: false, crypto_enabled: demoMode ? form.crypto_enabled : false })}>
        <Save size={16} /> Сохранить настройки
      </button>
    </section>
  );
}

function Text({ label, value, onChange }: { label: string; value: string; onChange(value: string): void }) {
  return <label><span>{label}</span><input value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

function Textarea({ label, value, onChange }: { label: string; value: string; onChange(value: string): void }) {
  return <label><span>{label}</span><textarea value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

function NumberInput({ label, value, onChange }: { label: string; value: number; onChange(value: number): void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return (
    <label>
      <span>{label}</span>
      <input
        type="number"
        value={draft}
        autoComplete="off"
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => {
          const nextDraft = event.target.value;
          setDraft(nextDraft);
          const parsed = parseNumberDraft(nextDraft);
          if (parsed !== undefined) onChange(parsed);
        }}
        onBlur={() => {
          const parsed = parseNumberDraft(draft);
          if (parsed === undefined) setDraft(String(value));
        }}
      />
    </label>
  );
}

function Metric({ title, value }: { title: string; value: string | number }) {
  return <div className="metric"><span>{title}</span><strong>{value}</strong></div>;
}

function SimpleTable({ title, rows }: { title: string; rows: string[][] }) {
  return <div className="panel"><h2>{title}</h2>{rows.length ? rows.map((row) => <div className="row compact" key={row.join(":")}>{row.map((cell) => <span key={cell}>{cell}</span>)}</div>) : <p className="muted">Нет данных</p>}</div>;
}

function paymentBreakdownRows(rows: AnalyticsBreakdown[]): AnalyticsBreakdown[] {
  const empty = (key: string): AnalyticsBreakdown => ({ key, count: 0, delivered_count: 0, paid_count: 0, cancelled_count: 0, revenue_minor: 0 });
  const byKey = new Map(rows.map((row) => [row.key, row]));
  const orderedKeys = ["cash", "card", ...rows.map((row) => row.key).filter((key) => key !== "cash" && key !== "card")];
  return [...new Set(orderedKeys)].map((key) => ({ ...empty(key), ...(byKey.get(key) || {}) }));
}

function productMetricLabel(key: string): string {
  const labels: Record<string, string> = {
    app_open: "Открыли Mini App", menu: "Меню", cart: "Корзина", checkout: "Оформление",
    order_created: "Создали заказ", booking: "Бронь стола", reservation_created: "Создали бронь",
    dish: "Карточка блюда", order: "Заказ", orders: "История", support: "Поддержка",
  };
  if (labels[key]) return labels[key];
  const [screen, action = ""] = key.split(":", 2);
  const actionLabel = action.replace(/^button_/, "").replace(/^navigate_/, "переход ").replaceAll("_", " ");
  return actionLabel ? `${labels[screen] || screen}: ${actionLabel}` : key.replaceAll("_", " ");
}

function paymentMethodLabel(method: string): string {
  if (method === "cash") return "Наличные";
  if (method === "card") return "Карта";
  if (method === "crypto") return "Crypto";
  return method;
}

function auditActionText(action: string): string {
  const labels: Record<string, string> = {
    "settings.manual_day_off": "Изменён режим выходного дня",
    "schedule.update": "Изменён график",
    "menu_item.create": "Добавлено блюдо",
    "menu_item.update": "Изменено блюдо",
    "menu_item.archive": "Блюдо отправлено в архив",
    "menu_item.restore": "Блюдо восстановлено",
    "order.cancel": "Заказ отменён",
    "order.return_to_new": "Заказ возвращён на кухню",
    "order.edit_contact": "Изменены контакты заказа",
    "staff.create": "Добавлен сотрудник",
    "staff.update": "Изменён сотрудник",
  };
  return labels[action] || action;
}
