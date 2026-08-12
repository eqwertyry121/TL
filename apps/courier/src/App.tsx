import type { Order, Role } from "@tk-delivery/api-client/generated";
import { isOwnerTelegramId, roleLinks } from "@tk-delivery/api-client/role-switch";
import { clientLabel, courierEtaLink, courierTimeText, createStaffApi, isAuthError, mapLink, money, openTelegramLink, paymentText, problemLink, telegramUserLink } from "@tk-delivery/staff-core";
import { Check, Copy, MapPin, MoreVertical, Phone, RefreshCw, WifiOff } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

const api = createStaffApi("COURIER");
const courierSeenOrdersKey = "tk-courier-seen-orders-v1";

export function App() {
  const [token, setToken] = useState("");
  const [telegramUserId, setTelegramUserId] = useState<number | undefined>();
  const [orders, setOrders] = useState<Order[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState("");
  const [etaBusy, setEtaBusy] = useState("");
  const seenIdsRef = useRef(loadSeenOrderIds(courierSeenOrdersKey));
  const authRefreshRef = useRef<Promise<string> | null>(null);
  const [seenIds, setSeenIds] = useState<Set<string>>(() => new Set(seenIdsRef.current));

  const sortedOrders = useMemo(() => [...orders].sort((a, b) => new Date(a.ready_at || a.created_at).getTime() - new Date(b.ready_at || b.created_at).getTime()), [orders]);

  function markSeen(orderId: string) {
    if (seenIdsRef.current.has(orderId)) return;
    const next = new Set(seenIdsRef.current);
    next.add(orderId);
    seenIdsRef.current = next;
    setSeenIds(next);
    saveSeenOrderIds(courierSeenOrdersKey, next);
  }

  function applySession(session: Awaited<ReturnType<typeof api.authenticate>>) {
    setToken(session.token);
    setTelegramUserId(session.telegram_user_id);
    setOffline(false);
    return session.token;
  }

  async function authenticate() {
    return applySession(await api.authenticate("COURIER"));
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
    } catch (error) {
      if (!isAuthError(error)) throw error;
      const freshToken = await refreshAuth();
      return action(freshToken);
    }
  }

  async function refresh(authToken = token) {
    try {
      const response = await withAuth((currentToken) => api.listCourierOrders(currentToken), authToken);
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
      const nextToken = applySession(session);
      void refresh(nextToken);
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
    markSeen(order.id);
    setBusy(order.id);
    try {
      await withAuth((authToken) => api.markDelivered(authToken, order.id, `delivered-${order.id}-${order.version}`));
      setOrders((current) => current.filter((entry) => entry.id !== order.id));
    } catch {
      await refresh();
    } finally {
      setBusy("");
    }
  }

  async function sendETA(order: Order, minutes: number) {
    markSeen(order.id);
    const telegramLink = courierEtaLink(order, minutes);
    if (telegramLink) {
      openTelegramLink(telegramLink);
      return;
    }

    const key = `${order.id}:${minutes}`;
    setEtaBusy(key);
    try {
      await withAuth((authToken) => api.sendCourierETA(authToken, order.id, minutes));
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
        {sortedOrders.length === 0 ? <div className="empty">Готовых доставок нет</div> : sortedOrders.map((order) => {
          const unread = !seenIds.has(order.id);
          return (
            <article className={`order-row${unread ? " is-new" : ""}`} key={order.id} onClick={() => markSeen(order.id)}>
              <OrderAvatar order={order} unread={unread} />
              <div className="order-main">
                <div className="order-top">
                  <div className="order-title">
                    <strong>Заказ #{order.public_number}</strong>
                    <span>{courierTimeText(order)}</span>
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
                <div className="address-compact">
                  <MapPin size={18} />
                  <span>{order.address || "Адрес не указан"}</span>
                </div>
                <a
                  className="phone-compact"
                  href={`tel:${order.phone || ""}`}
                  onClick={(event) => event.stopPropagation()}
                >
                  <Phone size={18} />
                  <span>{order.phone || "Телефон не указан"}</span>
                </a>
                <ul className="items-compact" aria-label={`Состав заказа #${order.public_number}`}>
                  {order.items.map((item, index) => (
                    <li key={`${item.menu_item_id}-${index}`}>
                      <b>{item.quantity}×</b>
                      <span>{item.snapshot_title}</span>
                    </li>
                  ))}
                </ul>
                <div className="courier-footer">
                  <div className="cash-compact">{order.payment_method === "cash" ? money(order.total_minor) : "ОПЛАЧЕН"}</div>
                  <button
                    className="primary compact-action"
                    disabled={busy === order.id}
                    onClick={(event) => {
                      event.stopPropagation();
                      void markDelivered(order);
                    }}
                  >
                    <Check size={20} /> ДОСТАВЛЕНО
                  </button>
                </div>
                <div className="eta compact-eta" onClick={(event) => event.stopPropagation()}>
                  <span>Сообщить ETA:</span>
                  <div>
                    {[5, 10, 15, 20].map((minutes) => (
                      <button
                        key={minutes}
                        disabled={etaBusy === `${order.id}:${minutes}`}
                        title={courierEtaLink(order, minutes) ? "Открыть ЛС с готовым сообщением" : "У клиента нет username, отправим через bot"}
                        onClick={() => void sendETA(order, minutes)}
                      >
                        {minutes} мин
                      </button>
                    ))}
                  </div>
                </div>
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
