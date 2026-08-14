import type { MenuItem, Order, OrderSummary, OrderSummaryPage, PaymentMethod, Role } from "@tk-delivery/api-client/generated";
import { createSingleFlightAuthRetry, isAuthErrorLike } from "@tk-delivery/api-client/auth-retry";
import { installPerformanceBeacon } from "@tk-delivery/api-client/performance";
import { startVisiblePolling } from "@tk-delivery/api-client/polling";
import { isOwnerTelegramId, roleLinks } from "@tk-delivery/api-client/role-switch";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  ChevronRight,
  MapPin,
  Minus,
  Phone,
  Plus,
  ReceiptText,
  ShoppingCart,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createApi } from "./api";
import { orderStatusText } from "./fixtures";
import { t } from "./i18n";
import { maskPhone, money } from "./money";
import { currentRoute, navigate, replaceRoute, routeToHash } from "./route";
import {
  clearCart,
  clearCheckoutProgress,
  checkoutCartSignature,
  loadCart,
  loadCachedPublicData,
  loadCheckoutDraft,
  loadCheckoutProgress,
  loadLocale,
  pendingIdempotencyKey,
  resetPendingIdempotencyKey,
  saveCart,
  saveCachedPublicData,
  saveCheckoutDraft,
  saveCheckoutProgress,
  saveLocale,
  upsertCartLine,
} from "./storage";
import {
  haptic,
  initialLocale,
  openTelegramLink,
  rawInitData,
  requestTelegramContact,
  syncBackButton,
} from "./telegram";
import type { Api, AppData, Calculation, CashLocationChallenge, CartLine, CartState, CheckoutDraft, Locale, Route, Session, VerifiedContact } from "./types";

const api = createApi();
const clientBotMiniAppURL = "https://t.me/TakoLako_main_bot?startapp";

export function App() {
  if (isPortalPath()) {
    if (rawInitData()) return <ClientMiniApp />;
    return <PortalLanding />;
  }
  return <ClientMiniApp />;
}

function ClientMiniApp() {
  const [route, setRoute] = useState<Route>(currentRoute);
  const [locale, setLocale] = useState<Locale>(() => loadLocale(initialLocale()));
  const [cart, setCart] = useState<CartState>(loadCart);
  const [draft, setDraft] = useState<CheckoutDraft>(loadCheckoutDraft);
  const [data, setData] = useState<AppData>(() => {
    const cached = loadCachedPublicData(locale);
    return { session: null, runtime: null, categories: cached?.categories || [], orders: [] };
  });
  const [ordersPage, setOrdersPage] = useState<Pick<OrderSummaryPage, "limit" | "offset" | "has_more">>({ limit: 20, offset: 0, has_more: false });
  const [calculation, setCalculation] = useState<Calculation | null>(null);
  const [verifiedContact, setVerifiedContact] = useState<VerifiedContact | null>(null);
  const [cashLocation, setCashLocation] = useState<CashLocationChallenge | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<Extract<PaymentMethod, "cash" | "crypto">>("cash");
  const [contactLoading, setContactLoading] = useState(false);
  const [locationLoading, setLocationLoading] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [restoredCheckoutSignature, setRestoredCheckoutSignature] = useState("");
  const [loading, setLoading] = useState(!data.runtime && data.categories.length === 0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const token = data.session?.token || "";
  const items = useMemo(() => data.categories.flatMap((category) => category.items), [data.categories]);
  const itemLookup = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const cartLines = useMemo(() => Object.values(cart.lines), [cart.lines]);
  const availableCartLines = useMemo(() => cartLines.filter((line) => itemLookup.has(line.itemId)), [cartLines, itemLookup]);
  const checkoutSignature = useMemo(() => checkoutCartSignature(availableCartLines), [availableCartLines]);
  const cartQuantity = availableCartLines.reduce((sum, line) => sum + line.quantity, 0);
  const subtotal = availableCartLines.reduce((sum, line) => sum + line.quantity * line.unitPriceMinor, 0);
  const total = subtotal;
  const checkoutOpen = Boolean(data.runtime?.accepting_orders);
  const dayOffBlocked = isDayOffRuntime(data.runtime) && !isOwnerTelegramId(data.session?.telegram_user_id);
  const paymentMethods = useMemo(() => checkoutPaymentMethods(data.runtime?.enabled_payments || []), [data.runtime?.enabled_payments]);
  const cashLocationRequired = data.runtime?.cash_location_required ?? true;
  const routedOrder = route.name === "order"
    ? data.orders.find((order) => order.id === route.id)
    : undefined;
  const routeOrderTerminal = routedOrder
    ? isFullOrder(routedOrder) && isTerminalOrderStatus(routedOrder.fulfillment_status)
    : false;

  useEffect(() => installPerformanceBeacon("client", () => currentRoute().name), []);

  const applySession = useCallback((session: Session) => {
    setData((current) => ({ ...current, session }));
    return session.token;
  }, []);

  const authRetry = useMemo(() => createSingleFlightAuthRetry({
    authenticate: () => api.authenticate(locale).then(applySession),
    isAuthError: isAuthErrorLike,
  }), [applySession, locale]);

  const withAuth = useCallback(<T,>(action: (authToken: string) => Promise<T>, authToken = token): Promise<T> => {
    return authRetry.withAuth(action, authToken);
  }, [authRetry, token]);

  const bootstrap = useCallback(async () => {
    setError("");
    const response = await api.bootstrap(locale);
    saveCachedPublicData(locale, response.menu_revision ?? 0, response.categories);
    setData({
      session: response.session || null,
      runtime: response.runtime,
      categories: response.categories,
      orders: response.orders || [],
    });
    setVerifiedContact(response.contact || { verified: false });
    return response.session || null;
  }, [locale]);

  useEffect(() => {
    let alive = true;
    setLoading(data.categories.length === 0);
    bootstrap()
      .catch((err) => alive && setError(errorText(err)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [bootstrap]);

  useEffect(() => {
    return startVisiblePolling(async (signal) => {
      const runtime = await api.runtime(signal);
      setData((current) => ({ ...current, runtime }));
    }, 10000);
  }, []);

  useEffect(() => {
    const onHash = () => setRoute(currentRoute());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => syncBackButton(route, () => window.history.back()), [route]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [route]);

  useEffect(() => {
    if (!token || cashLocation?.status !== "PENDING") return;
    return startVisiblePolling(async (signal) => {
      const next = await withAuth((authToken) => api.getCashLocationChallenge(authToken, cashLocation.id, signal), token);
      setCashLocation(next);
    }, 2000, true);
  }, [token, cashLocation?.id, cashLocation?.status, withAuth]);

  useEffect(() => {
    document.body.classList.toggle("has-day-off-overlay", dayOffBlocked);
    return () => document.body.classList.remove("has-day-off-overlay");
  }, [dayOffBlocked]);

  useEffect(() => {
    if (!paymentMethods.includes(paymentMethod)) setPaymentMethod(paymentMethods[0] || "cash");
  }, [paymentMethod, paymentMethods]);

  useEffect(() => {
    if (!token || !checkoutSignature || restoredCheckoutSignature === checkoutSignature) return;
    const progress = loadCheckoutProgress(checkoutSignature);
    setRestoredCheckoutSignature(checkoutSignature);
    if (!progress) return;
    setCalculation(progress.calculation);
    if (!progress.cashLocation) return;
    setCashLocation(progress.cashLocation);
    const challengeId = progress.cashLocation.id;
    withAuth((authToken) => api.getCashLocationChallenge(authToken, challengeId), token)
      .then((next) => {
        if (next.status === "EXPIRED" || next.status === "USED") {
          setCashLocation(null);
          saveCheckoutProgress(checkoutSignature, progress.calculation, null);
          return;
        }
        setCashLocation(next);
      })
      .catch(() => undefined);
  }, [token, checkoutSignature, restoredCheckoutSignature, withAuth]);

  useEffect(() => {
    if (!checkoutSignature || restoredCheckoutSignature !== checkoutSignature) return;
    saveCheckoutProgress(checkoutSignature, calculation, cashLocation);
  }, [checkoutSignature, restoredCheckoutSignature, calculation, cashLocation]);

  useEffect(() => {
    if (!token || route.name !== "checkout" || verifiedContact?.verified) return;
    let stopped = false;
    withAuth((authToken) => api.contact(authToken), token)
      .then((contact) => {
        if (!stopped) setVerifiedContact(contact);
      })
      .catch(() => undefined);
    return () => {
      stopped = true;
    };
  }, [route.name, token, verifiedContact?.verified, withAuth]);

  useEffect(() => {
    if (!token || route.name !== "orders") return;
    let stopped = false;
    withAuth((authToken) => api.listOrders(authToken, { limit: 20, offset: 0 }), token)
      .then((response) => {
        if (stopped) return;
        setData((current) => ({ ...current, orders: response.orders }));
        setOrdersPage(orderPageMeta(response));
      })
      .catch(() => undefined);
    return () => {
      stopped = true;
    };
  }, [route.name, token, withAuth]);

  useEffect(() => {
    if (route.name !== "order" || !token || routeOrderTerminal) return;
    return startVisiblePolling(async (signal) => {
      try {
        const order = await withAuth((authToken) => api.getOrder(authToken, route.id, signal), token);
        mergeOrder(order);
      } catch {
        if (signal.aborted) return;
        setError("Не удалось обновить статус заказа");
      }
    }, 10000, true);
  }, [route, token, routeOrderTerminal, withAuth]);

  function updateLocale(next: Locale) {
    setLocale(next);
    saveLocale(next);
    const cached = loadCachedPublicData(next);
    setData((current) => ({
      ...current,
      session: null,
      runtime: null,
      categories: cached?.categories || [],
      orders: [],
    }));
  }

  function setLine(item: MenuItem, quantity: number) {
    const minQuantity = itemMinQuantity(item);
    const nextQuantity = quantity <= 0 ? 0 : Math.max(minQuantity, Math.min(99, quantity));
    const line: CartLine = {
      itemId: item.id,
      title: item.title,
      unitPriceMinor: item.price_minor,
      quantity: nextQuantity,
      menuVersion: item.version,
      updatedAt: new Date().toISOString(),
    };
    const next = upsertCartLine(cart, line);
    setCart(next);
    saveCart(next);
    setCalculation(null);
    setCashLocation(null);
    clearCheckoutProgress();
    haptic();
  }

  function removeCartLine(itemId: string) {
    const nextLines = { ...cart.lines };
    delete nextLines[itemId];
    const next = { version: 1, lines: nextLines } satisfies CartState;
    setCart(next);
    saveCart(next);
    setCalculation(null);
    setCashLocation(null);
    clearCheckoutProgress();
    haptic();
  }

  useEffect(() => {
    if (itemLookup.size === 0) return;
    let changed = false;
    let hasUnavailableLine = false;
    const nextLines = { ...cart.lines };
    for (const line of Object.values(nextLines)) {
      const item = itemLookup.get(line.itemId);
      if (!item) {
        hasUnavailableLine = true;
        continue;
      }
      const minQuantity = itemMinQuantity(item);
      const quantity = line.quantity > 0 && line.quantity < minQuantity ? minQuantity : line.quantity;
      if (quantity !== line.quantity || line.title !== item.title || line.unitPriceMinor !== item.price_minor || line.menuVersion !== item.version) {
        nextLines[line.itemId] = {
          ...line,
          title: item.title,
          unitPriceMinor: item.price_minor,
          quantity,
          menuVersion: item.version,
          updatedAt: new Date().toISOString(),
        };
        changed = true;
      }
    }
    if (hasUnavailableLine) {
      setCalculation(null);
      setCashLocation(null);
      clearCheckoutProgress();
    }
    if (!changed) return;
    const next = { version: 1, lines: nextLines } satisfies CartState;
    setCart(next);
    saveCart(next);
    setCalculation(null);
    setCashLocation(null);
    clearCheckoutProgress();
  }, [cart.lines, itemLookup]);

  function updateDraft(patch: Partial<CheckoutDraft>) {
    const next = { ...draft, ...patch };
    setDraft(next);
    saveCheckoutDraft(next);
  }

  useEffect(() => {
    if (verifiedContact?.verified && verifiedContact.phone && draft.phone !== verifiedContact.phone) {
      updateDraft({ phone: verifiedContact.phone });
    }
  }, [verifiedContact?.phone, verifiedContact?.verified]);

  async function calculate() {
    if (!token || availableCartLines.length === 0) return null;
    const result = await withAuth(
      (authToken) => api.calculate(
        authToken,
        availableCartLines.map((line) => ({ item_id: line.itemId, quantity: line.quantity })),
      ),
      token,
    );
    setCalculation(result);
    setCashLocation(null);
    return result;
  }

  async function confirmContact() {
    if (!token || contactLoading) return;
    setContactLoading(true);
    setError("");
    try {
      const allowed = await requestTelegramContact();
      if (!allowed) {
        setError("Telegram не передал телефон. Нажмите кнопку и разрешите отправку номера.");
        return;
      }
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const contact = await withAuth((authToken) => api.contact(authToken), token);
        if (contact.verified && contact.phone) {
          setVerifiedContact(contact);
          updateDraft({ phone: contact.phone });
          return;
        }
        await delay(1200);
      }
      setError("Телефон ещё не дошёл до бота. Откройте чат с ботом и попробуйте ещё раз.");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setContactLoading(false);
    }
  }

  async function confirmCashLocation() {
    if (!token || locationLoading) return;
    setLocationLoading(true);
    setError("");
    try {
      const calc = calculation || (await calculate());
      if (!calc) throw new Error("EMPTY_CART");
      const challenge = await withAuth((authToken) => api.createCashLocationChallenge(authToken, {
        calculation_token: calc.calculation_token,
        send_prompt: true,
      }), token);
      setCashLocation(challenge);
      if (challenge.status !== "PENDING") return;
      if (challenge.bot_url) {
        openTelegramLink(challenge.bot_url);
      }
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLocationLoading(false);
    }
  }

  async function submitOrder() {
    if (!token || submitting) return;
    if (!verifiedContact?.verified || !draft.phone.trim() || !draft.street.trim() || !draft.houseNumber.trim()) {
      setError("Поделитесь телефоном через Telegram и заполните адрес");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const calc = calculation || (await calculate());
      if (!calc) throw new Error("EMPTY_CART");
      if (paymentMethod === "cash" && cashLocationRequired && cashLocation?.status !== "VERIFIED") {
        setError("Для оплаты наличными подтвердите местоположение");
        return;
      }
      if (!termsAccepted) {
        setError(t(locale, "termsRequired"));
        return;
      }
      if (paymentMethod === "crypto" && !window.confirm(`Тестовая crypto-оплата ${money(calc.total_minor)} будет сразу отмечена как PAID. Реальные деньги не списываются.`)) return;
      const order = await withAuth((authToken) => api.createOrder(
        authToken,
        {
          calculation_token: calc.calculation_token,
          phone: draft.phone.trim(),
          address: buildCheckoutAddress(draft),
          comment: draft.comment.trim(),
          payment_method: paymentMethod,
          cash_location_challenge_id: paymentMethod === "cash" ? cashLocation?.id : undefined,
          terms_accepted: termsAccepted,
          locale,
        },
        pendingIdempotencyKey(),
      ), token);
      clearCart();
      clearCheckoutProgress();
      resetPendingIdempotencyKey();
      setCart(loadCart());
      setCalculation(null);
      setCashLocation(null);
      setTermsAccepted(false);
      mergeOrder(order);
      replaceRoute({ name: "order", id: order.id });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSubmitting(false);
    }
  }

  function mergeOrder(order: Order) {
    setData((current) => ({
      ...current,
      orders: [order, ...current.orders.filter((entry) => entry.id !== order.id)],
    }));
  }

  async function loadMoreOrders() {
    if (!token || !ordersPage.has_more) return;
    const limit = ordersPage.limit || 20;
    const offset = (ordersPage.offset || 0) + limit;
    const response = await withAuth((authToken) => api.listOrders(authToken, { limit, offset }), token);
    setData((current) => {
      const seen = new Set(current.orders.map((order) => order.id));
      return {
        ...current,
        orders: [...current.orders, ...response.orders.filter((order) => !seen.has(order.id))],
      };
    });
    setOrdersPage(orderPageMeta(response));
  }

  if (loading && !data.runtime) {
    return <Shell locale={locale} route={route} onLocale={updateLocale} cartQuantity={0} header="Tako Lako - Грузинская кухня"><div className="state">Загрузка...</div></Shell>;
  }

  if (!data.runtime) {
    return (
      <Shell locale={locale} route={route} onLocale={updateLocale} cartQuantity={0} header="Tako Lako - Грузинская кухня">
        <PublicBotLanding />
      </Shell>
    );
  }

  const content =
    route.name === "dish" ? (
      <Dish item={itemLookup.get(route.id)} line={cart.lines[route.id]} onSetLine={setLine} locale={locale} />
    ) : route.name === "cart" ? (
      <Cart lines={cartLines} itemLookup={itemLookup} subtotal={subtotal} total={total} checkoutOpen={checkoutOpen} locale={locale} onSetLine={setLine} onRemoveLine={removeCartLine} />
    ) : route.name === "checkout" ? (
      <Checkout
        lines={availableCartLines}
        draft={draft}
        calculation={calculation}
        subtotal={subtotal}
        total={total}
        checkoutOpen={checkoutOpen}
        locale={locale}
        paymentMethod={paymentMethod}
        paymentMethods={paymentMethods}
        verifiedContact={verifiedContact}
        contactLoading={contactLoading}
        cashLocation={cashLocation}
        cashLocationRequired={cashLocationRequired}
        cashLocationRadiusMeters={data.runtime?.cash_location_radius_meters || 12000}
        termsUrl={data.runtime?.terms_url || ""}
        termsAccepted={termsAccepted}
        locationLoading={locationLoading}
        submitting={submitting}
        onDraft={updateDraft}
        onPaymentMethod={setPaymentMethod}
        onTermsAccepted={setTermsAccepted}
        onConfirmContact={confirmContact}
        onConfirmCashLocation={confirmCashLocation}
        onCalculate={calculate}
        onSubmit={submitOrder}
      />
    ) : route.name === "order" ? (
      <OrderScreen order={fullOrderFromCache(data.orders, route.id)} locale={locale} />
    ) : route.name === "orders" ? (
      <Orders orders={data.orders} page={ordersPage} locale={locale} onLoadMore={loadMoreOrders} />
    ) : route.name === "support" ? (
      <Support support={data.runtime?.support_text || "@Tako_Lako"} />
    ) : route.name === "terms" ? (
      <Terms />
    ) : (
      <Menu categories={data.categories} cart={cart} onSetLine={setLine} />
    );

  return (
    <Shell locale={locale} route={route} onLocale={updateLocale} cartQuantity={cartQuantity} header="Tako Lako - Грузинская кухня" runtime={data.runtime} session={data.session}>
      {error && (
        <div className="notice error">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}
      {route.name === "menu" && !data.session && <OpenInTelegramCard />}
      {content}
      {cartQuantity > 0 && route.name !== "checkout" && route.name !== "cart" && (
        <button className="cart-float" onClick={() => navigate({ name: "cart" })}>
          <ShoppingCart size={18} />
          <span>{cartQuantity}</span>
          <strong>{money(total)}</strong>
        </button>
      )}
    </Shell>
  );
}

function isPortalPath(): boolean {
  const pathname = window.location.pathname.replace(/\/+$/, "") || "/";
  return pathname === "/";
}

function PortalLanding() {
  useEffect(() => {
    const timer = window.setTimeout(() => {
      window.location.assign(clientBotMiniAppURL);
    }, 900);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <main className="portal-page">
      <section className="portal-card">
        <h1>Грузинская кухня в Telegram</h1>
        <a
          className="portal-button"
          href={clientBotMiniAppURL}
          onClick={(event) => {
            event.preventDefault();
            window.location.assign(clientBotMiniAppURL);
          }}
        >
          Открыть Mini App
          <ChevronRight size={18} />
        </a>
        <small>Если Telegram не открылся автоматически, найдите бота @takolako_main_bot.</small>
      </section>
    </main>
  );
}

function PublicBotLanding() {
  return (
    <section className="bot-landing">
      <h1>Грузинская кухня в Telegram</h1>
      <TelegramBotButton label="Открыть Mini App" />
      <small>Если Telegram не открылся автоматически, найдите бота @takolako_main_bot.</small>
    </section>
  );
}

function OpenInTelegramCard() {
  return (
    <section className="telegram-open-card">
      <div>
        <strong>Заказ оформляется в Telegram</strong>
        <p>Так мы безопасно получаем ваш Telegram contact и подтверждаем геолокацию для cash-заказа.</p>
      </div>
      <TelegramBotButton label="Открыть бота" compact />
    </section>
  );
}

function TelegramBotButton({ label, compact = false }: { label: string; compact?: boolean }) {
  return (
    <a
      className={compact ? "telegram-button compact" : "telegram-button"}
      href={clientBotMiniAppURL}
      onClick={(event) => {
        event.preventDefault();
        openTelegramLink(clientBotMiniAppURL);
      }}
    >
      {label}
      <ChevronRight size={18} />
    </a>
  );
}

function Shell({
  children,
  locale,
  route,
  header,
  cartQuantity,
  runtime,
  session,
  onLocale,
}: {
  children: React.ReactNode;
  locale: Locale;
  route: Route;
  header: string;
  cartQuantity: number;
  runtime?: AppData["runtime"];
  session?: Session | null;
  onLocale: (locale: Locale) => void;
}) {
  const isRoot = route.name === "menu";
  const dayOffBlocked = isDayOffRuntime(runtime) && !isOwnerTelegramId(session?.telegram_user_id);
  const showClosedBanner = runtime && !runtime.accepting_orders && !dayOffBlocked;

  return (
    <div className={dayOffBlocked ? "app-shell is-day-off-blocked" : "app-shell"}>
      <header className="app-header">
        <div className="top-row">
          <div className="header-main">
            {!isRoot && (
              <button className="icon-button" onClick={() => window.history.back()} aria-label="Назад">
                <ArrowLeft size={20} />
              </button>
            )}
            {isRoot && <span className="brand-mark" aria-hidden="true">TL</span>}
            <div className="brand">
              <strong>{header}</strong>
              <span className="worktime" aria-label="Приём заказов с 13:00 до 21:00">
                <span>Заказы</span>
                <strong>13:00–21:00</strong>
              </span>
            </div>
          </div>
          <div className="header-actions">
            <ProfileBadge session={session} />
            {isRoot && (
              <div className="locale">
                {(["ru", "sr", "en"] as Locale[]).map((entry) => (
                  <button key={entry} className={entry === locale ? "active" : ""} onClick={() => onLocale(entry)}>
                    {entry.toUpperCase()}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        {showClosedBanner && <div className="closed-banner">{t(locale, "checkoutClosed")}</div>}
        <nav className="nav">
          <a className={route.name === "menu" ? "active" : ""} href="#/">
            {t(locale, "menu")}
          </a>
          <a className={route.name === "cart" ? "active" : ""} href="#/cart">
            {t(locale, "cart")}{cartQuantity ? ` · ${cartQuantity}` : ""}
          </a>
          <a className={route.name === "orders" ? "active" : ""} href="#/orders">
            {t(locale, "orders")}
          </a>
          <a className={route.name === "support" ? "active" : ""} href="#/support">
            {t(locale, "support")}
          </a>
        </nav>
        {isOwnerTelegramId(session?.telegram_user_id) && <OwnerRoleSwitch activeRole="CLIENT" />}
      </header>
      <main className="app-content" aria-hidden={dayOffBlocked ? "true" : undefined}>{children}</main>
      {dayOffBlocked && <DayOffOverlay locale={locale} runtime={runtime} />}
    </div>
  );
}

function DayOffOverlay({ locale, runtime }: { locale: Locale; runtime?: AppData["runtime"] }) {
  const nextOpening = formatNextOpening(runtime?.next_opening, locale, runtime?.timezone);
  const title = dayOffTitle(runtime, locale);

  return (
    <div className="day-off-overlay" role="dialog" aria-modal="true" aria-labelledby="day-off-title">
      <section className="day-off-card">
        <span className="day-off-kicker">Tako Lako</span>
        <h1 id="day-off-title">{title}</h1>
        <p>{t(locale, "dayOffMessage")}</p>
        {nextOpening && (
          <small className="next-opening">
            <span>{t(locale, "nextOpening")}</span> <strong>{nextOpening}</strong>
          </small>
        )}
      </section>
    </div>
  );
}

function ProfileBadge({ session }: { session?: Session | null }) {
  if (!session?.telegram_user_id) return null;
  const label = profileLabel(session);
  const initials = profileInitials(session);
  return (
    <div className="profile-badge" title={label}>
      <span className="profile-avatar">
        <span>{initials}</span>
        {session.photo_url && <img src={session.photo_url} alt="" loading="lazy" referrerPolicy="no-referrer" />}
      </span>
      <span>{label}</span>
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

function Menu({ categories, cart, onSetLine }: { categories: AppData["categories"]; cart: CartState; onSetLine: (item: MenuItem, quantity: number) => void }) {
  const flatItems = categories.flatMap((category, categoryIndex) => category.items.map((item, index) => ({ item, visualIndex: categoryIndex + index })));
  return (
    <div className="page">
      <section className="menu-section">
        <div className="menu-grid">
          {flatItems.map(({ item, visualIndex }) => {
            const qty = cart.lines[item.id]?.quantity || 0;
            const minQuantity = itemMinQuantity(item);
            return (
              <article className={qty > 0 ? "dish-card in-cart" : "dish-card"} key={item.id}>
                <DishVisual item={item} visualIndex={visualIndex} asButton onClick={() => navigate({ name: "dish", id: item.id })} />
                <div className="dish-body">
                  <button className="link-title" onClick={() => navigate({ name: "dish", id: item.id })}>
                    {item.title}
                  </button>
                  <p>{item.description}</p>
                  <div className="meta-row">
                    <span>{item.weight_text}</span>
                    <strong>{money(item.price_minor)}</strong>
                  </div>
                  <div className="row-actions">
                    {qty > 0 ? (
                      <Qty value={qty} onMinus={() => onSetLine(item, qty <= minQuantity ? 0 : qty - 1)} onPlus={() => onSetLine(item, qty + 1)} />
                    ) : (
                      <button className="primary add-only" onClick={() => onSetLine(item, minQuantity)}>
                        В корзину{minQuantity > 1 ? ` · ${minQuantity} шт` : ""}
                      </button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
function Dish({ item, line, locale, onSetLine }: { item?: MenuItem; line?: CartLine; locale: Locale; onSetLine: (item: MenuItem, quantity: number) => void }) {
  const [qty, setQty] = useState(line?.quantity || (item ? itemMinQuantity(item) : 1));
  if (!item) return <div className="state">Блюдо не найдено</div>;
  const minQuantity = itemMinQuantity(item);
  return (
    <div className="page narrow dish-page">
      <DishVisual item={item} visualIndex={2} hero />
      <span className="eyebrow">Tako Lako special</span>
      <h1>{item.title}</h1>
      <p className="lead">{item.description}</p>
      <div className="panel-list">
        <div className="split">
          <span>{item.weight_text}</span>
          <strong>{money(item.price_minor)}</strong>
        </div>
      </div>
      <div className="bottom-action">
        <Qty value={qty} onMinus={() => setQty(Math.max(minQuantity, qty - 1))} onPlus={() => setQty(Math.min(99, qty + 1))} />
        <button className="primary" onClick={() => {
          onSetLine(item, qty);
          navigate({ name: "cart" });
        }}>
          {t(locale, "add")} · {money(item.price_minor * qty)}
        </button>
      </div>
    </div>
  );
}

function DishVisual({
  item,
  visualIndex,
  hero = false,
  asButton = false,
  onClick,
}: {
  item: MenuItem;
  visualIndex: number;
  hero?: boolean;
  asButton?: boolean;
  onClick?: () => void;
}) {
  const src = menuPhotoURL(item.photo_path);
  const srcSet = menuPhotoSrcSet(item);
  const dimensions = menuPhotoDimensions(item, hero);
  const className = `${hero ? "hero-art" : "dish-art"} art-${visualIndex % 6}${src ? " has-photo" : ""}`;
  const content = (
    <>
      {src && (
        <img
          className="dish-photo"
          src={src}
          srcSet={srcSet}
          sizes={hero ? "(max-width: 720px) 100vw, 720px" : "(max-width: 720px) 45vw, 220px"}
          width={dimensions?.width}
          height={dimensions?.height}
          alt=""
          loading={hero ? "eager" : "lazy"}
          decoding="async"
          fetchPriority={hero ? "high" : undefined}
          onError={(event) => {
            event.currentTarget.hidden = true;
            event.currentTarget.parentElement?.classList.add("photo-failed");
          }}
        />
      )}
      <span className="dish-emoji">{foodVisual(item.title)}</span>
      {item.weight_text && <small className="dish-badge">{item.weight_text}</small>}
    </>
  );
  if (asButton) {
    return (
      <button className={className} type="button" onClick={onClick}>
        {content}
      </button>
    );
  }
  return <div className={className}>{content}</div>;
}

function Cart({
  lines,
  itemLookup,
  subtotal,
  total,
  checkoutOpen,
  locale,
  onSetLine,
  onRemoveLine,
}: {
  lines: CartLine[];
  itemLookup: Map<string, MenuItem>;
  subtotal: number;
  total: number;
  checkoutOpen: boolean;
  locale: Locale;
  onSetLine: (item: MenuItem, quantity: number) => void;
  onRemoveLine: (itemId: string) => void;
}) {
  if (!lines.length) return <div className="state">{t(locale, "emptyCart")}</div>;
  const hasAvailableLines = lines.some((line) => itemLookup.has(line.itemId));
  return (
    <div className="page narrow cart-page">
      <h1>{t(locale, "cart")}</h1>
      <div className="list">
        {lines.map((line) => {
          const item = itemLookup.get(line.itemId);
          const isUnavailable = !item;
          return (
            <div className={isUnavailable ? "line unavailable-line" : "line"} key={line.itemId}>
              <div>
                <strong>{line.title}</strong>
                <span>{isUnavailable ? `0 × ${money(0)}` : `${line.quantity} × ${money(line.unitPriceMinor)}`}</span>
                {isUnavailable && <span className="danger-text">Блюдо недоступно</span>}
              </div>
              {item ? (
                <Qty value={line.quantity} onMinus={() => onSetLine(item, line.quantity <= itemMinQuantity(item) ? 0 : line.quantity - 1)} onPlus={() => onSetLine(item, line.quantity + 1)} />
              ) : (
                <button className="trash-button" type="button" aria-label="Удалить недоступное блюдо" onClick={() => onRemoveLine(line.itemId)}>
                  <Trash2 size={18} />
                </button>
              )}
            </div>
          );
        })}
      </div>
      <Totals subtotal={subtotal} total={total} locale={locale} />
      <button className="primary full" disabled={!checkoutOpen || !hasAvailableLines} onClick={() => navigate({ name: "checkout" })}>
        {!checkoutOpen ? t(locale, "checkoutClosed") : hasAvailableLines ? `${t(locale, "goCheckout")} · ${money(total)}` : t(locale, "noAvailableItems")}
      </button>
    </div>
  );
}

function Checkout({
  lines,
  draft,
  calculation,
  subtotal,
  total,
  checkoutOpen,
  locale,
  paymentMethod,
  paymentMethods,
  verifiedContact,
  contactLoading,
  cashLocation,
  cashLocationRequired,
  cashLocationRadiusMeters,
  termsUrl,
  termsAccepted,
  locationLoading,
  submitting,
  onDraft,
  onPaymentMethod,
  onTermsAccepted,
  onConfirmContact,
  onConfirmCashLocation,
  onCalculate,
  onSubmit,
}: {
  lines: CartLine[];
  draft: CheckoutDraft;
  calculation: Calculation | null;
  subtotal: number;
  total: number;
  checkoutOpen: boolean;
  locale: Locale;
  paymentMethod: Extract<PaymentMethod, "cash" | "crypto">;
  paymentMethods: Array<Extract<PaymentMethod, "cash" | "crypto">>;
  verifiedContact: VerifiedContact | null;
  contactLoading: boolean;
  cashLocation: CashLocationChallenge | null;
  cashLocationRequired: boolean;
  cashLocationRadiusMeters: number;
  termsUrl: string;
  termsAccepted: boolean;
  locationLoading: boolean;
  submitting: boolean;
  onDraft: (patch: Partial<CheckoutDraft>) => void;
  onPaymentMethod: (method: Extract<PaymentMethod, "cash" | "crypto">) => void;
  onTermsAccepted: (accepted: boolean) => void;
  onConfirmContact: () => Promise<void>;
  onConfirmCashLocation: () => Promise<void>;
  onCalculate: () => Promise<Calculation | null>;
  onSubmit: () => Promise<void>;
}) {
  useEffect(() => {
    if (lines.length) void onCalculate().catch(() => undefined);
  }, [lines.length]);
  if (!lines.length) return <div className="state">{t(locale, "emptyCart")}</div>;
  const locationRequired = paymentMethod === "cash" && cashLocationRequired;
  const locationVerified = !locationRequired || cashLocation?.status === "VERIFIED";
  const contactVerified = Boolean(verifiedContact?.verified);
  const termsHref = termsUrl.trim() || routeToHash({ name: "terms" });
  const termsExternal = /^https?:\/\//i.test(termsHref);
  return (
    <div className="page narrow checkout-page">
      <h1>{t(locale, "checkout")}</h1>
      <div className="form">
        <button
          className={contactVerified ? "contact-share active-contact" : "contact-share"}
          type="button"
          onClick={() => void onConfirmContact()}
          disabled={contactLoading}
          aria-label={contactVerified ? "Телефон подтверждён" : "Поделиться телефоном через Telegram"}
        >
          <span className="contact-share-icon" aria-hidden="true">
            {contactVerified ? <Check size={22} /> : <Phone size={22} />}
          </span>
          <span className="contact-share-copy">
            <strong>{contactLoading ? "Ожидаем Telegram" : contactVerified ? "Телефон подтверждён" : "Поделиться телефоном"}</strong>
            <small>{contactVerified ? (verifiedContact?.masked || maskPhone(draft.phone)) : "Нажмите, Telegram покажет системное окно"}</small>
          </span>
          {!contactVerified && <ChevronRight className="contact-share-arrow" size={22} aria-hidden="true" />}
        </button>
        <div className="address-grid main-address-grid">
          <label>
            <span>{t(locale, "street")}</span>
            <input value={draft.street} maxLength={90} autoComplete="street-address" onChange={(event) => onDraft({ street: event.target.value })} />
          </label>
          <label>
            <span>{t(locale, "houseNumber")}</span>
            <input value={draft.houseNumber} maxLength={16} autoComplete="address-line2" onChange={(event) => onDraft({ houseNumber: event.target.value })} />
          </label>
        </div>
        <div className="address-grid details-address-grid">
          <label>
            <span>{t(locale, "entrance")}</span>
            <input value={draft.entrance} maxLength={24} inputMode="text" onChange={(event) => onDraft({ entrance: event.target.value })} />
          </label>
          <label>
            <span>{t(locale, "floor")}</span>
            <input value={draft.floor} maxLength={16} inputMode="text" onChange={(event) => onDraft({ floor: event.target.value })} />
          </label>
          <label>
            <span>{t(locale, "apartment")}</span>
            <input value={draft.apartment} maxLength={24} inputMode="text" onChange={(event) => onDraft({ apartment: event.target.value })} />
          </label>
        </div>
        <label>
          <span>{t(locale, "comment")}</span>
          <textarea value={draft.comment} maxLength={300} onChange={(event) => onDraft({ comment: event.target.value })} />
        </label>
      </div>
      <div className="payment-selector">
        <span>Способ оплаты</span>
        <div>
          {paymentMethods.map((method) => (
            <button key={method} className={paymentMethod === method ? "active" : ""} type="button" onClick={() => onPaymentMethod(method)}>
              <strong>{paymentMethodTitle(method)}</strong>
              <small>{paymentMethodDescription(method)}</small>
            </button>
          ))}
        </div>
        {paymentMethod === "crypto" && (
          <p>
            Тестовый режим: реальная крипта не списывается. Заказ создаётся как оплаченный,
            чтобы проверить flow кухни, курьера и админки.
          </p>
        )}
      </div>
      {locationRequired && (
        <div className={`cash-location ${cashLocation?.status === "VERIFIED" ? "verified" : cashLocation?.status === "REJECTED" || cashLocation?.status === "EXPIRED" ? "rejected" : ""}`}>
          <div>
            <MapPin size={18} />
            <div>
              <strong>{cashLocationTitle(cashLocation)}</strong>
              <p>{cashLocationText(cashLocation, cashLocationRadiusMeters)}</p>
            </div>
          </div>
          <button className="primary full" type="button" onClick={() => void onConfirmCashLocation()} disabled={locationLoading || !contactVerified}>
            {locationLoading ? "Проверяем геолокацию…" : cashLocation?.status === "VERIFIED" ? "Обновить геолокацию" : "📍 Подтвердить геолокацию"}
          </button>
        </div>
      )}
      <Totals subtotal={calculation?.subtotal_minor || subtotal} total={calculation?.total_minor || total} locale={locale} />
      <label className="terms-check">
        <input type="checkbox" checked={termsAccepted} onChange={(event) => onTermsAccepted(event.target.checked)} />
        <span>
          {t(locale, "acceptTerms")}{" "}
          <a href={termsHref} target={termsExternal ? "_blank" : undefined} rel={termsExternal ? "noreferrer" : undefined}>
            {t(locale, "terms")}
          </a>
        </span>
      </label>
      <button className="primary full" disabled={!checkoutOpen || submitting || !contactVerified || !locationVerified || !termsAccepted} onClick={onSubmit}>
        {submitting ? "..." : `${paymentMethod === "crypto" ? "ОПЛАТИТЬ TEST CRYPTO" : t(locale, "placeOrder")} · ${money(calculation?.total_minor || total)}`}
      </button>
    </div>
  );
}

function buildCheckoutAddress(draft: CheckoutDraft): string {
  const main = [draft.street.trim(), draft.houseNumber.trim()].filter(Boolean).join(" ");
  const details = [
    addressPart("подъезд", draft.entrance),
    addressPart("этаж", draft.floor),
    addressPart("кв.", draft.apartment),
  ].filter(Boolean);
  return [main, ...details].filter(Boolean).join(", ");
}

function addressPart(label: string, value: string): string {
  const trimmed = value.trim();
  return trimmed ? `${label} ${trimmed}` : "";
}

function cashLocationTitle(challenge: CashLocationChallenge | null): string {
  switch (challenge?.status) {
    case "VERIFIED":
      return "Местоположение подтверждено";
    case "PENDING":
      return "Ожидаем геолокацию";
    case "REJECTED":
      return "Местоположение не подтверждено";
    case "EXPIRED":
      return "Проверка истекла";
    default:
      return "Подтвердите местоположение";
  }
}

function cashLocationText(challenge: CashLocationChallenge | null, radiusMeters: number): string {
  if (challenge?.status === "VERIFIED") {
    const distance = typeof challenge.distance_meters === "number" ? ` · ${formatDistance(challenge.distance_meters)} от ресторана` : "";
    return `Для cash всё готово${distance}`;
  }
  if (challenge?.status === "PENDING") return "Открылся бот? Нажмите там кнопку геолокации. Если кнопки нет — отправьте /share. С компьютера лучше открыть заказ на телефоне.";
  if (challenge?.status === "EXPIRED") return "Повторите проверку перед оформлением заказа.";
  if (challenge?.rejection_reason === "OUTSIDE_CASH_AREA") return `Оплата наличными доступна в радиусе ${formatDistance(radiusMeters)} от ресторана.`;
  if (challenge?.rejection_reason === "LOCATION_INACCURATE" || challenge?.rejection_reason === "LOCATION_ACCURACY_MISSING") return "Геолокация неточная. На компьютере так бывает часто — откройте заказ на телефоне или повторите у окна/на улице.";
  if (challenge?.rejection_reason === "LOCATION_NOT_CONFIGURED") return "Оплата наличными временно недоступна: ресторан ещё не настроил точку.";
  return "Для оплаты наличными Telegram подтвердит, что вы находитесь в Нови Саде, чтобы мы могли к вам приехать. Точные координаты не сохраняются.";
}

function formatDistance(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(1).replace(".", ",")} км`;
  return `${meters} м`;
}

function OrderScreen({ order, locale }: { order?: Order; locale: Locale }) {
  if (!order) return <div className="state">Загружаем заказ...</div>;
  return (
    <div className="page narrow order-page">
      <div className="order-status">
        <Check size={22} />
        <div>
          <h1>#{order.public_number}</h1>
          <p>{localizedStatus(order, locale)}</p>
        </div>
      </div>
      <div className="list">
        {order.items.map((item) => (
          <div className="line" key={item.menu_item_id}>
            <div>
              <strong>{item.quantity} × {item.snapshot_title}</strong>
              <span>{money(item.line_total_minor)}</span>
            </div>
          </div>
        ))}
      </div>
      <Totals subtotal={order.subtotal_minor} total={order.total_minor} locale={locale} />
      <div className="panel-list">
        <div className="split"><span>{t(locale, "phone")}</span><strong>{maskPhone(order.phone)}</strong></div>
        <div className="split"><span>Оплата</span><strong>{paymentStatusLabel(order)}</strong></div>
      </div>
      <button className="secondary full" onClick={() => navigate({ name: "support" })}>{t(locale, "support")}</button>
    </div>
  );
}

function Orders({
  orders,
  page,
  locale,
  onLoadMore,
}: {
  orders: OrderSummary[];
  page: Pick<OrderSummaryPage, "limit" | "offset" | "has_more">;
  locale: Locale;
  onLoadMore(): Promise<void>;
}) {
  if (!orders.length) return <div className="state">{t(locale, "orders")} пустая</div>;
  return (
    <div className="page narrow">
      <h1>{t(locale, "orders")}</h1>
      <div className="list">
        {orders.map((order) => (
          <button className="history-line" key={order.id} onClick={() => navigate({ name: "order", id: order.id })}>
            <ReceiptText size={20} />
            <span>#{order.public_number}<small>{localizedStatus(order, locale)}</small></span>
            <strong>{money(order.total_minor)}</strong>
            <ChevronRight size={18} />
          </button>
        ))}
      </div>
      {page.has_more && <button className="secondary full" type="button" onClick={() => void onLoadMore()}>Показать ещё</button>}
    </div>
  );
}

function Support({ support }: { support: string }) {
  const handle = support.replace("@", "") || "Tako_Lako";
  return (
    <div className="page narrow">
      <h1>Поддержка</h1>
      <p className="lead">По любому вопросу по заказу напишите менеджеру напрямую в Telegram.</p>
      <a className="primary full as-link" href={`https://t.me/${handle}`}>Написать менеджеру @{handle}</a>
    </div>
  );
}

function Terms() {
  return (
    <div className="page narrow">
      <h1>Условия доставки</h1>
      <p className="lead">Доставка оформляется по текстовому адресу клиента. Проверьте телефон и адрес перед отправкой заказа. Реальная оплата сейчас производится наличными; crypto доступна только как тестовый sandbox-flow.</p>
    </div>
  );
}

function Qty({ value, onMinus, onPlus }: { value: number; onMinus: () => void; onPlus: () => void }) {
  return (
    <div className="qty">
      <button onClick={onMinus} aria-label="Минус"><Minus size={16} /></button>
      <span>{value}</span>
      <button onClick={onPlus} aria-label="Плюс"><Plus size={16} /></button>
    </div>
  );
}

function Totals({ subtotal, total, locale }: { subtotal: number; total: number; locale: Locale }) {
  if (subtotal === total) {
    return (
      <div className="totals single-total">
        <div><span>{t(locale, "total")}</span><strong>{money(total)}</strong></div>
      </div>
    );
  }
  return (
    <div className="totals">
      <div><span>{t(locale, "subtotal")}</span><strong>{money(subtotal)}</strong></div>
      <div><span>{t(locale, "total")}</span><strong>{money(total)}</strong></div>
    </div>
  );
}

function checkoutPaymentMethods(methods: PaymentMethod[]): Array<Extract<PaymentMethod, "cash" | "crypto">> {
  const supported = methods.filter((method): method is Extract<PaymentMethod, "cash" | "crypto"> => method === "cash" || method === "crypto");
  return supported.length ? supported : ["cash"];
}

function paymentMethodTitle(method: Extract<PaymentMethod, "cash" | "crypto">): string {
  if (method === "crypto") return "Crypto TEST";
  return "Наличными";
}

function paymentMethodDescription(method: Extract<PaymentMethod, "cash" | "crypto">): string {
  if (method === "crypto") return "sandbox · без реальных денег";
  return "курьеру при получении";
}

function paymentStatusLabel(order: Order): string {
  if (order.payment_method === "crypto") return order.payment_status === "PAID" ? "Crypto TEST · PAID" : "Crypto TEST";
  if (order.payment_method === "card") return order.payment_status === "PAID" ? "Карта · PAID" : "Карта";
  return order.payment_status === "PAID" ? "Наличные · PAID" : "Наличные";
}

function localizedStatus(order: OrderSummary, locale: Locale): string {
  if (locale === "ru") return orderStatusText(order);
  if (order.fulfillment_status === "NEW") return t(locale, "accepted");
  if (order.fulfillment_status === "OUT_FOR_DELIVERY") return t(locale, "delivery");
  if (order.fulfillment_status === "DELIVERED") return t(locale, "delivered");
  return t(locale, "cancelled");
}

function fullOrderFromCache(orders: OrderSummary[], id: string): Order | undefined {
  const order = orders.find((entry) => entry.id === id);
  return order && isFullOrder(order) ? order : undefined;
}

function isFullOrder(order: OrderSummary): order is Order {
  return Array.isArray((order as Partial<Order>).items);
}

function isTerminalOrderStatus(status?: OrderSummary["fulfillment_status"]): boolean {
  return status === "DELIVERED" || status === "CANCELLED";
}

function orderPageMeta(page: OrderSummaryPage): Pick<OrderSummaryPage, "limit" | "offset" | "has_more"> {
  return {
    limit: page.limit || 20,
    offset: page.offset || 0,
    has_more: Boolean(page.has_more),
  };
}

function foodVisual(title: string): string {
  const lower = title.toLowerCase();
  if (lower.includes("хинкали")) return "🥟";
  if (lower.includes("хачапури")) return "🧀";
  if (lower.includes("чахохбили")) return "🍗";
  if (lower.includes("лобио")) return "🍲";
  if (lower.includes("лимонад")) return "🥤";
  if (lower.includes("морс")) return "🍓";
  return "🍽️";
}

function menuPhotoURL(path: string): string {
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

function menuPhotoSrcSet(item: MenuItem): string | undefined {
  const variants = item.photo_variants;
  if (!variants) return undefined;
  const thumbnail = menuPhotoURL(variants.thumbnail?.url || "");
  const display = menuPhotoURL(variants.display?.url || "");
  const parts = [
    thumbnail ? `${thumbnail} ${variants.thumbnail.width || 360}w` : "",
    display ? `${display} ${variants.display.width || 1280}w` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : undefined;
}

function menuPhotoDimensions(item: MenuItem, hero: boolean): { width: number; height: number } | undefined {
  const variants = item.photo_variants;
  const preferred = hero ? variants?.display : variants?.thumbnail || variants?.display;
  if (!preferred || preferred.width <= 0 || preferred.height <= 0) return undefined;

  return { width: preferred.width, height: preferred.height };
}

function itemMinQuantity(item: MenuItem): number {
  return Math.max(1, item.min_quantity || 1);
}

function isDayOffRuntime(runtime?: AppData["runtime"]): boolean {
  return Boolean(runtime && !runtime.accepting_orders && (runtime.reason === "manual_day_off" || runtime.reason === "weekly_day_off"));
}

function formatNextOpening(value: string | undefined, locale: Locale, timezone = "Europe/Belgrade"): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = displayDateParts(date, timezone);
  const weekday = fullWeekdayText(parts.dayOfWeek, locale);
  const month = fullMonthText(parts.month - 1, locale);
  const day = parts.day;
  const time = `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
  if (locale === "en") return `${weekday} ${day} ${month} at ${time}`;
  if (locale === "sr") return `${weekday} ${day} ${month} u ${time}`;
  return `${weekday} ${day} ${month} в ${time}`;
}

function displayDateParts(value: Date, timezone: string): { month: number; day: number; dayOfWeek: number; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const pick = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value || 0);
  const year = pick("year");
  const month = pick("month");
  const day = pick("day");
  return {
    month,
    day,
    dayOfWeek: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
    hour: pick("hour"),
    minute: pick("minute"),
  };
}

function fullWeekdayText(day: number, locale: Locale): string {
  const ru = ["в воскресенье", "в понедельник", "во вторник", "в среду", "в четверг", "в пятницу", "в субботу"];
  const sr = ["u nedelju", "u ponedeljak", "u utorak", "u sredu", "u četvrtak", "u petak", "u subotu"];
  const en = ["on Sunday", "on Monday", "on Tuesday", "on Wednesday", "on Thursday", "on Friday", "on Saturday"];
  if (locale === "en") return en[day] || en[0];
  if (locale === "sr") return sr[day] || sr[0];
  return ru[day] || ru[0];
}

function fullMonthText(month: number, locale: Locale): string {
  const ru = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
  const sr = ["januara", "februara", "marta", "aprila", "maja", "juna", "jula", "avgusta", "septembra", "oktobra", "novembra", "decembra"];
  const en = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  if (locale === "en") return en[month] || en[0];
  if (locale === "sr") return sr[month] || sr[0];
  return ru[month] || ru[0];
}

function dayOffTitle(runtime: AppData["runtime"] | undefined, locale: Locale): string {
  const title = (runtime?.day_off_banner || "").trim();
  if (!title || /^\?+$/.test(title)) return t(locale, "closed");
  return title;
}

function profileLabel(profile: Pick<Session, "telegram_user_id" | "username" | "first_name">): string {
  const username = (profile.username || "").trim();
  if (username) return username.startsWith("@") ? username : `@${username}`;
  const firstName = (profile.first_name || "").trim();
  if (firstName) return firstName;
  return `TG ${profile.telegram_user_id}`;
}

function profileInitials(profile: Pick<Session, "username" | "first_name">): string {
  const source = (profile.first_name || profile.username || "TG").trim();
  return source.slice(0, 2).toUpperCase();
}

function errorText(err: unknown): string {
  const code = typeof err === "object" && err && "code" in err ? String((err as { code: unknown }).code) : String((err as Error)?.message || err);
  switch (code) {
    case "MANUAL_DAY_OFF":
      return "Сегодня выходной";
    case "RESTAURANT_CLOSED":
      return "Сейчас заказы не принимаются";
    case "ITEM_UNAVAILABLE":
      return "Одно из блюд недоступно";
    case "INVALID_QUANTITY":
      return "Проверьте количество блюд";
    case "EMPTY_CART":
      return "В корзине нет доступных блюд";
    case "IDEMPOTENCY_CONFLICT":
      return "Заказ уже отправляется. Проверьте статус";
    case "ACTIVE_ORDER_EXISTS":
      return "У вас уже есть активный заказ. Новый можно оформить после доставки текущего.";
    case "AUTH_INVALID":
      return "Telegram авторизация не прошла";
    case "CONTACT_NOT_VERIFIED":
      return "Для cash нужен телефон, подтверждённый через Telegram";
    case "CASH_LOCATION_REQUIRED":
      return "Для оплаты наличными подтвердите местоположение";
    case "CASH_LOCATION_OUTSIDE":
      return "Вы вне зоны доставки для оплаты наличными";
    case "CASH_LOCATION_INACCURATE":
      return "Геолокация неточная. Откройте заказ на телефоне или повторите у окна/на улице.";
    case "INVALID_INPUT":
      return "Поделитесь телефоном через Telegram и заполните адрес";
    default:
      return "Сервер недоступен. Попробуйте ещё раз";
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
