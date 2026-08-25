import type { AdminAnalytics, AnalyticsBreakdown, AuditEntry, AuditLogResponse } from "@tk-delivery/api-client/generated";
import { money, type AnalyticsRange } from "./api";

export function AnalyticsSection({ analytics, range, onRange, onExport }: { analytics: AdminAnalytics; range: AnalyticsRange; onRange(range: AnalyticsRange): void; onExport(): void }) {
  const labels: Record<AnalyticsRange, string> = { today: "Сегодня", "7d": "7 дней", month: "Месяц" };
  const paymentRows = paymentBreakdownRows(analytics.payments ?? []);
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
