import type { Order, Role } from "@tk-delivery/api-client/generated";
import { isOwnerTelegramId, roleLinks } from "@tk-delivery/api-client/role-switch";
import { clientLabel, createStaffApi, kitchenTimeText, money, openTelegramLink, paymentText, problemLink, telegramUserLink } from "@tk-delivery/staff-core";
import { AlertTriangle, Check, MoreVertical, RefreshCw, WifiOff } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

const api = createStaffApi("KITCHEN");
const kitchenSeenOrdersKey = "tk-kitchen-seen-orders-v1";
let notificationAudioContext: AudioContext | null = null;
let pendingNotificationSound = false;

export function App() {
  const [token, setToken] = useState("");
  const [telegramUserId, setTelegramUserId] = useState<number | undefined>();
  const [orders, setOrders] = useState<Order[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState("");
  const seenIdsRef = useRef(loadSeenOrderIds(kitchenSeenOrdersKey));
  const notifiedIds = useRef(new Set<string>());
  const [seenIds, setSeenIds] = useState<Set<string>>(() => new Set(seenIdsRef.current));

  const sortedOrders = useMemo(() => [...orders].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()), [orders]);

  function markSeen(orderId: string) {
    if (seenIdsRef.current.has(orderId)) return;
    const next = new Set(seenIdsRef.current);
    next.add(orderId);
    seenIdsRef.current = next;
    setSeenIds(next);
    saveSeenOrderIds(kitchenSeenOrdersKey, next);
  }

  async function refresh(authToken = token) {
    if (!authToken) return;
    try {
      const response = await api.listKitchenOrders(authToken);
      const incoming = response.orders.filter((order) => !seenIdsRef.current.has(order.id) && !notifiedIds.current.has(order.id));
      response.orders.forEach((order) => notifiedIds.current.add(order.id));
      if (incoming.length) playBeep();
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
  }, [token]);

  useEffect(() => {
    void unlockNotificationSound();
    void requestWakeLock();

    const unlockOnInteraction = () => {
      void unlockNotificationSound();
      void requestWakeLock();
    };
    const unlockOnVisible = () => {
      if (!document.hidden) {
        void unlockNotificationSound();
        void requestWakeLock();
      }
    };

    window.addEventListener("pointerdown", unlockOnInteraction, { once: true, passive: true });
    window.addEventListener("keydown", unlockOnInteraction, { once: true });
    document.addEventListener("visibilitychange", unlockOnVisible);
    window.addEventListener("focus", unlockOnVisible);

    return () => {
      window.removeEventListener("pointerdown", unlockOnInteraction);
      window.removeEventListener("keydown", unlockOnInteraction);
      document.removeEventListener("visibilitychange", unlockOnVisible);
      window.removeEventListener("focus", unlockOnVisible);
    };
  }, []);

  async function markReady(order: Order) {
    if (!window.confirm(`Заказ #${order.public_number} готов и передаётся курьеру?`)) return;
    markSeen(order.id);
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
      <main className="list">
        {sortedOrders.length === 0 ? <div className="empty">Новых заказов нет</div> : sortedOrders.map((order) => {
          const unread = !seenIds.has(order.id);
          return (
            <article className={`order-row${unread ? " is-new" : ""}`} key={order.id} onClick={() => markSeen(order.id)}>
              <OrderAvatar order={order} unread={unread} />
              <div className="order-main">
                <div className="order-top">
                  <div className="order-title">
                    <strong>Заказ #{order.public_number}</strong>
                    <span>{kitchenTimeText(order)}</span>
                  </div>
                  <div className="order-side">
                    <span className={unread ? "new-badge" : "read-badge"}>{unread ? "Новый" : "Прочитано"}</span>
                    <Menu order={order} />
                  </div>
                </div>
                <div className="order-meta-line">
                  <CustomerBadge order={order} />
                  <span className="payment-chip">{paymentText(order)}</span>
                </div>
                <ul className="items-compact" aria-label={`Блюда заказа #${order.public_number}`}>
                  {order.items.map((item, index) => (
                    <li key={`${item.menu_item_id}-${index}`}>
                      <b>{item.quantity}×</b>
                      <span>{item.snapshot_title}</span>
                    </li>
                  ))}
                </ul>
                {order.customer_comment && <p className="comment compact-comment"><AlertTriangle size={16} /> {order.customer_comment}</p>}
                <button
                  className="primary compact-action"
                  disabled={busy === order.id}
                  onClick={(event) => {
                    event.stopPropagation();
                    void markReady(order);
                  }}
                >
                  <Check size={20} /> ЗАКАЗ ГОТОВ
                </button>
              </div>
            </article>
          );
        })}
      </main>
    </div>
  );
}

function OrderAvatar({ order, unread }: { order: Order; unread: boolean }) {
  return (
    <span className="order-avatar" aria-hidden="true">
      {order.client_photo_url ? <img src={order.client_photo_url} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span>{clientInitials(order)}</span>}
      <small>#{order.public_number}</small>
      {unread && <i />}
    </span>
  );
}

function CustomerBadge({ order }: { order: Order }) {
  const href = telegramUserLink(order);
  const content = (
    <>
      <span className="customer-avatar">
        <span>{clientInitials(order)}</span>
        {order.client_photo_url && <img src={order.client_photo_url} alt="" loading="lazy" referrerPolicy="no-referrer" />}
      </span>
      <b>{clientLabel(order)}</b>
    </>
  );
  if (!href) return <div className="customer-badge" title={clientLabel(order)}>{content}</div>;
  return (
    <a
      className="customer-badge is-link"
      href={href}
      target="_blank"
      rel="noreferrer"
      title={`Открыть ЛС ${clientLabel(order)}`}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        openTelegramLink(href);
      }}
    >
      {content}
    </a>
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
      <button
        className="icon row-icon"
        onClick={(event) => {
          event.stopPropagation();
          setOpen(!open);
        }}
        aria-label="Ещё"
      >
        <MoreVertical size={20} />
      </button>
      {open && (
        <div className="popover" onClick={(event) => event.stopPropagation()}>
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

function loadSeenOrderIds(key: string): Set<string> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) || "[]");
    if (Array.isArray(value)) return new Set(value.filter((item): item is string => typeof item === "string"));
  } catch {
    // Local read markers are nice-to-have only.
  }
  return new Set();
}

function saveSeenOrderIds(key: string, value: Set<string>) {
  try {
    localStorage.setItem(key, JSON.stringify([...value].slice(-200)));
  } catch {
    // Local read markers are nice-to-have only.
  }
}

function clientInitials(order: Order): string {
  const source = (order.client_first_name || order.client_username || "TG").trim();
  return source.slice(0, 2).toUpperCase();
}

async function requestWakeLock() {
  try {
    const nav = navigator as Navigator & { wakeLock?: { request(type: "screen"): Promise<unknown> } };
    await nav.wakeLock?.request("screen");
  } catch {
    // Wake Lock is best-effort. The UI should stay simple for staff.
  }
}

async function unlockNotificationSound() {
  const ctx = getNotificationAudioContext();
  if (!ctx) return;

  try {
    if (ctx.state === "suspended") await ctx.resume();
    if (ctx.state !== "running") return;
    playSilentUnlockTone(ctx);
    if (pendingNotificationSound) {
      pendingNotificationSound = false;
      window.setTimeout(() => playBeep(), 60);
    }
  } catch {
    // Browser/WebView will allow audio after a real user gesture.
  }
}

function playBeep() {
  const ctx = getNotificationAudioContext();
  if (!ctx) return;

  if (ctx.state === "suspended") {
    void ctx.resume().then(() => {
      if (ctx.state === "running") {
        playBeepNow(ctx);
      } else {
        pendingNotificationSound = true;
      }
    }).catch(() => {
      pendingNotificationSound = true;
    });
    return;
  }

  if (ctx.state !== "running") {
    pendingNotificationSound = true;
    return;
  }

  playBeepNow(ctx);
}

function getNotificationAudioContext() {
  if (notificationAudioContext && notificationAudioContext.state !== "closed") return notificationAudioContext;

  const AudioContextClass = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return null;
  notificationAudioContext = new AudioContextClass();
  return notificationAudioContext;
}

function playSilentUnlockTone(ctx: AudioContext) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const now = ctx.currentTime;
  gain.gain.setValueAtTime(0.00001, now);
  osc.frequency.setValueAtTime(440, now);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.03);
}

function playBeepNow(ctx: AudioContext) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const now = ctx.currentTime;
  osc.frequency.setValueAtTime(880, now);
  osc.frequency.setValueAtTime(1040, now + 0.12);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.08, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.26);
}
