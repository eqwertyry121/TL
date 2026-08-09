import type { Order, Role } from "@tk-delivery/api-client/generated";
import { isOwnerTelegramId, roleLinks } from "@tk-delivery/api-client/role-switch";
import { clientLabel, createStaffApi, kitchenTimeText, money, paymentText, problemLink } from "@tk-delivery/staff-core";
import { AlertTriangle, Check, MoreVertical, RefreshCw, Volume2, WifiOff } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

const api = createStaffApi("KITCHEN");

export function App() {
  const [token, setToken] = useState("");
  const [telegramUserId, setTelegramUserId] = useState<number | undefined>();
  const [orders, setOrders] = useState<Order[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState("");
  const [soundEnabled, setSoundEnabled] = useState(false);
  const seen = useRef(new Set<string>());

  const sortedOrders = useMemo(() => [...orders].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()), [orders]);

  async function refresh(authToken = token) {
    if (!authToken) return;
    try {
      const response = await api.listKitchenOrders(authToken);
      const incoming = response.orders.filter((order) => !seen.current.has(order.id));
      response.orders.forEach((order) => seen.current.add(order.id));
      if (incoming.length && soundEnabled) playBeep();
      setOrders(response.orders);
      setLastUpdated(new Date());
      setOffline(false);
    } catch {
      setOffline(true);
    }
  }

  useEffect(() => {
    let stopped = false;
    api.authenticate("KITCHEN").then((session) => {
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
  }, [token, soundEnabled]);

  async function enableSoundAndWake() {
    setSoundEnabled(true);
    playBeep();
    try {
      const nav = navigator as Navigator & { wakeLock?: { request(type: "screen"): Promise<unknown> } };
      await nav.wakeLock?.request("screen");
    } catch {
      // Wake Lock is best-effort. The UI should stay simple for staff.
    }
  }

  async function markReady(order: Order) {
    if (!window.confirm(`Заказ #${order.public_number} готов и передаётся курьеру?`)) return;
    setBusy(order.id);
    try {
      await api.markReady(token, order.id, `ready-${order.id}-${order.version}`);
      setOrders((current) => current.filter((entry) => entry.id !== order.id));
    } catch {
      await refresh();
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>Кухня</h1>
          <p>{sortedOrders.length} новых · {lastUpdated ? `обновлено ${secondsAgo(lastUpdated)} сек назад` : "ожидание"}</p>
        </div>
        <button className="icon" onClick={() => void refresh()} aria-label="Обновить"><RefreshCw size={20} /></button>
      </header>
      {offline && <div className="status bad"><WifiOff size={18} /><span>Нет связи с сервером</span></div>}
      {isOwnerTelegramId(telegramUserId) && <OwnerRoleSwitch activeRole="KITCHEN" />}
      {!soundEnabled && (
        <button className="secondary full" onClick={enableSoundAndWake}>
          <Volume2 size={18} /> Включить звук новых заказов
        </button>
      )}
      <main className="list">
        {sortedOrders.length === 0 ? <div className="empty">Новых заказов нет</div> : sortedOrders.map((order) => (
          <article className="card" key={order.id}>
            <div className="card-head">
              <div>
                <strong>Заказ #{order.public_number}</strong>
                <span>{kitchenTimeText(order)}</span>
              </div>
              <Menu order={order} />
            </div>
            <div className="meta-grid">
              <div><span>Клиент</span><CustomerBadge order={order} /></div>
              <div><span>Оплата</span><strong>{paymentText(order)}</strong></div>
            </div>
            <ul>
              {order.items.map((item) => <li key={item.menu_item_id}>{item.quantity} × {item.snapshot_title}</li>)}
            </ul>
            {order.customer_comment && <p className="comment"><AlertTriangle size={16} /> {order.customer_comment}</p>}
            <button className="primary full" disabled={busy === order.id} onClick={() => void markReady(order)}>
              <Check size={20} /> ЗАКАЗ ГОТОВ
            </button>
          </article>
        ))}
      </main>
    </div>
  );
}

function CustomerBadge({ order }: { order: Order }) {
  return (
    <div className="customer-badge" title={clientLabel(order)}>
      <span className="customer-avatar">
        <span>{clientInitials(order)}</span>
        {order.client_photo_url && <img src={order.client_photo_url} alt="" loading="lazy" referrerPolicy="no-referrer" />}
      </span>
      <b>{clientLabel(order)}</b>
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
          <a href={problemLink(order)} target="_blank">Сообщить о проблеме</a>
          <span>Сумма: {money(order.total_minor)}</span>
        </div>
      )}
    </div>
  );
}

function secondsAgo(value: Date) {
  return Math.max(0, Math.floor((Date.now() - value.getTime()) / 1000));
}

function clientInitials(order: Order): string {
  const source = (order.client_first_name || order.client_username || "TG").trim();
  return source.slice(0, 2).toUpperCase();
}

function playBeep() {
  const AudioContextClass = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return;
  const ctx = new AudioContextClass();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = 880;
  gain.gain.value = 0.05;
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  window.setTimeout(() => {
    osc.stop();
    void ctx.close();
  }, 140);
}
