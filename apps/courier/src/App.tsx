import type { Order, Role } from "@tk-delivery/api-client/generated";
import { isOwnerTelegramId, roleLinks } from "@tk-delivery/api-client/role-switch";
import { clientLabel, courierTimeText, createStaffApi, mapLink, money, paymentText, problemLink } from "@tk-delivery/staff-core";
import { Check, Copy, MapPin, MoreVertical, Phone, RefreshCw, WifiOff } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

const api = createStaffApi("COURIER");

export function App() {
  const [token, setToken] = useState("");
  const [telegramUserId, setTelegramUserId] = useState<number | undefined>();
  const [orders, setOrders] = useState<Order[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState("");
  const [etaBusy, setEtaBusy] = useState("");

  const sortedOrders = useMemo(() => [...orders].sort((a, b) => new Date(a.ready_at || a.created_at).getTime() - new Date(b.ready_at || b.created_at).getTime()), [orders]);

  async function refresh(authToken = token) {
    if (!authToken) return;
    try {
      const response = await api.listCourierOrders(authToken);
      setOrders(response.orders);
      setLastUpdated(new Date());
      setOffline(false);
    } catch {
      setOffline(true);
    }
  }

  useEffect(() => {
    let stopped = false;
    api.authenticate("COURIER").then((session) => {
      if (stopped) return;
      setToken(session.token);
      setTelegramUserId(session.telegram_user_id);
      void refresh(session.token);
    }).catch(() => setOffline(true));
    return () => {
      stopped = true;
    };
  }, []);

  useEffect(() => {
    if (!token) return;
    const timer = window.setInterval(() => void refresh(), 5000);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [token]);

  async function markDelivered(order: Order) {
    const text = order.payment_method === "cash" ? `Получены наличные ${money(order.total_minor)}?` : `Заказ #${order.public_number} доставлен?`;
    if (!window.confirm(text)) return;
    setBusy(order.id);
    try {
      await api.markDelivered(token, order.id, `delivered-${order.id}-${order.version}`);
      setOrders((current) => current.filter((entry) => entry.id !== order.id));
    } catch {
      await refresh();
    } finally {
      setBusy("");
    }
  }

  async function sendETA(order: Order, minutes: number) {
    const key = `${order.id}:${minutes}`;
    setEtaBusy(key);
    try {
      await api.sendCourierETA(token, order.id, minutes);
    } catch {
      await refresh();
    } finally {
      setEtaBusy("");
    }
  }

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>Курьер</h1>
          <p>{sortedOrders.length} в доставке · {lastUpdated ? `обновлено ${secondsAgo(lastUpdated)} сек назад` : "ожидание"}</p>
        </div>
        <button className="icon" onClick={() => void refresh()} aria-label="Обновить"><RefreshCw size={20} /></button>
      </header>
      {offline && <div className="status bad"><WifiOff size={18} /><span>Нет связи с сервером</span></div>}
      {isOwnerTelegramId(telegramUserId) && <OwnerRoleSwitch activeRole="COURIER" />}
      <main className="list">
        {sortedOrders.length === 0 ? <div className="empty">Готовых доставок нет</div> : sortedOrders.map((order) => (
          <article className="card" key={order.id}>
            <div className="card-head">
              <div>
                <strong>Заказ #{order.public_number}</strong>
                <span>{courierTimeText(order)} · {paymentText(order)}</span>
              </div>
              <Menu order={order} />
            </div>
            <div className="client">
              <span>Клиент</span>
              <strong>{clientLabel(order)}</strong>
            </div>
            <div className="address">
              <MapPin size={20} />
              <span>{order.address || "Адрес не указан"}</span>
            </div>
            <a className="phone" href={`tel:${order.phone || ""}`}>
              <Phone size={20} />
              <span>{order.phone || "Телефон не указан"}</span>
            </a>
            <ul>
              {order.items.map((item) => <li key={item.menu_item_id}>{item.quantity} × {item.snapshot_title}</li>)}
            </ul>
            <div className="cash">{order.payment_method === "cash" ? money(order.total_minor) : "ОПЛАЧЕН"}</div>
            <div className="eta">
              <span>Сообщить клиенту, что приедешь через:</span>
              <div>
                {[5, 10, 15, 20].map((minutes) => (
                  <button key={minutes} disabled={etaBusy === `${order.id}:${minutes}`} onClick={() => void sendETA(order, minutes)}>
                    {minutes} мин
                  </button>
                ))}
              </div>
            </div>
            <button className="primary full" disabled={busy === order.id} onClick={() => void markDelivered(order)}>
              <Check size={20} /> ДОСТАВЛЕНО
            </button>
          </article>
        ))}
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

function Menu({ order }: { order: Order }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="menu">
      <button className="icon" onClick={() => setOpen(!open)} aria-label="Ещё"><MoreVertical size={20} /></button>
      {open && (
        <div className="popover">
          <a href={`tel:${order.phone || ""}`}>Позвонить</a>
          <button onClick={() => void navigator.clipboard?.writeText(order.address || "")}><Copy size={16} /> Скопировать адрес</button>
          <a href={mapLink(order.address)} target="_blank">Открыть карту</a>
          <a href={problemLink(order)} target="_blank">Проблема с доставкой</a>
        </div>
      )}
    </div>
  );
}

function secondsAgo(value: Date) {
  return Math.max(0, Math.floor((Date.now() - value.getTime()) / 1000));
}
