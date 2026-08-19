import type { FulfillmentType, MenuItem, Order, OrderSummary, OrderSummaryPage, PaymentMethod, Role } from "@tk-delivery/api-client/generated";
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
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { createApi } from "./api";
import { orderStatusText } from "./fixtures";
import { t } from "./i18n";
import { termsVersion } from "./legal-version";
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
  pendingAdditionIdempotencyKey,
  pendingIdempotencyKey,
  resetPendingAdditionIdempotencyKey,
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
const Terms = lazy(() => import("./legal").then((module) => ({ default: module.Terms })));
const Returns = lazy(() => import("./legal").then((module) => ({ default: module.Returns })));
const Privacy = lazy(() => import("./legal").then((module) => ({ default: module.Privacy })));
type ConfirmDialogState = {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  resolve(confirmed: boolean): void;
};

function isPublicInformationRoute(route: Route): boolean {
  return route.name === "terms" || route.name === "returns" || route.name === "privacy" || route.name === "support";
}

export function App() {
  const [entryRoute, setEntryRoute] = useState<Route>(currentRoute);

  useEffect(() => {
    const onHash = () => setEntryRoute(currentRoute());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  if (isPortalPath()) {
    if (rawInitData()) return <ClientMiniApp />;
    if (isPublicInformationRoute(entryRoute)) return <ClientMiniApp />;
    return <PortalLanding />;
  }
  return <ClientMiniApp />;
}

function ClientMiniApp() {
  const [route, setRoute] = useState<Route>(currentRoute);
  const [locale, setLocale] = useState<Locale>(() => loadLocale(initialLocale()));
  const [cart, setCart] = useState<CartState>(loadCart);
  const [additionCart, setAdditionCart] = useState<CartState>({ version: 1, lines: {} });
  const [draft, setDraft] = useState<CheckoutDraft>(loadCheckoutDraft);
  const [data, setData] = useState<AppData>(() => {
    const cached = loadCachedPublicData(locale);
    return { session: null, runtime: null, categories: cached?.categories || [], orders: [] };
  });
  const [ordersPage, setOrdersPage] = useState<Pick<OrderSummaryPage, "limit" | "offset" | "has_more">>({ limit: 20, offset: 0, has_more: false });
  const [calculation, setCalculation] = useState<Calculation | null>(null);
  const [additionCalculation, setAdditionCalculation] = useState<Calculation | null>(null);
  const [verifiedContact, setVerifiedContact] = useState<VerifiedContact | null>(null);
  const [cashLocation, setCashLocation] = useState<CashLocationChallenge | null>(null);
  const [fulfillmentType, setFulfillmentType] = useState<FulfillmentType>("delivery");
  const [paymentMethod, setPaymentMethod] = useState<Extract<PaymentMethod, "cash" | "crypto">>("cash");
  const [contactLoading, setContactLoading] = useState(false);
  const [locationLoading, setLocationLoading] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [restoredCheckoutSignature, setRestoredCheckoutSignature] = useState("");
  const [loading, setLoading] = useState(!data.runtime && data.categories.length === 0);
  const [submitting, setSubmitting] = useState(false);
  const [additionSubmitting, setAdditionSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);

  const token = data.session?.token || "";
  const items = useMemo(() => data.categories.flatMap((category) => category.items), [data.categories]);
  const itemLookup = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const cartLines = useMemo(() => Object.values(cart.lines), [cart.lines]);
  const additionLines = useMemo(() => Object.values(additionCart.lines), [additionCart.lines]);
  const availableCartLines = useMemo(() => cartLines.filter((line) => itemLookup.has(line.itemId)), [cartLines, itemLookup]);
  const availableAdditionLines = useMemo(() => additionLines.filter((line) => itemLookup.has(line.itemId)), [additionLines, itemLookup]);
  const checkoutCartKey = useMemo(() => checkoutCartSignature(availableCartLines), [availableCartLines]);
  const checkoutSignature = useMemo(() => checkoutCartKey ? `${fulfillmentType}:${checkoutCartKey}` : "", [checkoutCartKey, fulfillmentType]);
  const additionSignature = useMemo(() => checkoutCartSignature(availableAdditionLines), [availableAdditionLines]);
  const cartQuantity = availableCartLines.reduce((sum, line) => sum + line.quantity, 0);
  const additionQuantity = availableAdditionLines.reduce((sum, line) => sum + line.quantity, 0);
  const subtotal = availableCartLines.reduce((sum, line) => sum + line.quantity * line.unitPriceMinor, 0);
  const additionSubtotal = availableAdditionLines.reduce((sum, line) => sum + line.quantity * line.unitPriceMinor, 0);
  const total = subtotal;
  const checkoutOpen = Boolean(data.runtime?.accepting_orders);
  const dayOffBlocked = isDayOffRuntime(data.runtime) && !isOwnerTelegramId(data.session?.telegram_user_id);
  const paymentMethods = useMemo(() => checkoutPaymentMethods(data.runtime?.enabled_payments || []), [data.runtime?.enabled_payments]);
  const cashLocationRequired = data.runtime?.cash_location_required ?? true;
  const routedOrder = route.name === "order"
    ? data.orders.find((order) => order.id === route.id)
    : route.name === "add"
      ? data.orders.find((order) => order.id === route.id)
    : undefined;
  const routedOrderId = route.name === "order" || route.name === "add" ? route.id : "";
  const routeOrderTerminal = routedOrder
    ? isFullOrder(routedOrder) && isTerminalOrderStatus(routedOrder.fulfillment_status)
    : false;
  const publicInformationRoute = isPublicInformationRoute(route);

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
    if (publicInformationRoute) {
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(data.categories.length === 0);
    bootstrap()
      .catch((err) => alive && setError(errorText(err, locale)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [bootstrap, publicInformationRoute]);

  useEffect(() => {
    if (publicInformationRoute) return;
    return startVisiblePolling(async (signal) => {
      const runtime = await api.runtime(signal);
      setData((current) => ({ ...current, runtime }));
    }, 10000);
  }, [publicInformationRoute]);

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
    if (!(route.name === "order" || route.name === "add") || !token || routeOrderTerminal) return;
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

  useEffect(() => {
    setAdditionCalculation(null);
    setAdditionCart({ version: 1, lines: {} });
  }, [routedOrderId]);

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

  function setAdditionLine(item: MenuItem, quantity: number) {
    const nextQuantity = quantity <= 0 ? 0 : Math.max(1, Math.min(99, quantity));
    const line: CartLine = {
      itemId: item.id,
      title: item.title,
      unitPriceMinor: item.price_minor,
      quantity: nextQuantity,
      menuVersion: item.version,
      updatedAt: new Date().toISOString(),
    };
    setAdditionCart((current) => upsertCartLine(current, line));
    setAdditionCalculation(null);
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

  function updateFulfillmentType(next: FulfillmentType) {
    setFulfillmentType(next);
    setCalculation(null);
    setCashLocation(null);
    clearCheckoutProgress();
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
        fulfillmentType,
      ),
      token,
    );
    setCalculation(result);
    setCashLocation(null);
    return result;
  }

  async function calculateAddition(orderId: string) {
    if (!token || availableAdditionLines.length === 0) return null;
    const result = await withAuth(
      (authToken) => api.calculateAddition(
        authToken,
        orderId,
        availableAdditionLines.map((line) => ({ item_id: line.itemId, quantity: line.quantity })),
      ),
      token,
    );
    setAdditionCalculation(result);
    return result;
  }

  async function confirmContact() {
    if (!token || contactLoading) return;
    setContactLoading(true);
    setError("");
    try {
      const allowed = await requestTelegramContact();
      if (!allowed) {
        setError(checkoutCopy(locale).contactDenied);
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
      setError(checkoutCopy(locale).contactPending);
    } catch (err) {
      setError(errorText(err, locale));
    } finally {
      setContactLoading(false);
    }
  }

  async function confirmCashLocation() {
    if (!token || locationLoading) return;
    if (fulfillmentType === "pickup") return;
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
      setError(errorText(err, locale));
    } finally {
      setLocationLoading(false);
    }
  }

  function askConfirm(input: Omit<ConfirmDialogState, "resolve">): Promise<boolean> {
    return new Promise((resolve) => setConfirmDialog({ ...input, resolve }));
  }

  function closeConfirm(confirmed: boolean) {
    confirmDialog?.resolve(confirmed);
    setConfirmDialog(null);
  }

  async function submitOrder() {
    if (!token || submitting) return;
    const deliverySelected = fulfillmentType === "delivery";
    if (!verifiedContact?.verified || !draft.phone.trim() || (deliverySelected && (!draft.street.trim() || !draft.houseNumber.trim()))) {
      setError(deliverySelected ? checkoutCopy(locale).phoneAndAddressRequired : checkoutCopy(locale).phoneRequired);
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const calc = calculation || (await calculate());
      if (!calc) throw new Error("EMPTY_CART");
      if (paymentMethod === "cash" && deliverySelected && cashLocationRequired && cashLocation?.status !== "VERIFIED") {
        setError(checkoutCopy(locale).cashLocationRequired);
        return;
      }
      if (!termsAccepted) {
        setError(t(locale, "termsRequired"));
        return;
      }
      if (paymentMethod === "crypto") {
        const confirmed = await askConfirm({
          title: cryptoConfirmTitle(locale),
          message: cryptoConfirmText(locale, calc.total_minor),
          confirmLabel: cryptoConfirmButton(locale),
          cancelLabel: cryptoCancelButton(locale),
        });
        if (!confirmed) return;
      }
      const order = await withAuth((authToken) => api.createOrder(
        authToken,
        {
          calculation_token: calc.calculation_token,
          phone: draft.phone.trim(),
          address: deliverySelected ? buildCheckoutAddress(draft, locale) : "",
          comment: draft.comment.trim(),
          fulfillment_type: fulfillmentType,
          payment_method: paymentMethod,
          cash_location_challenge_id: paymentMethod === "cash" && deliverySelected ? cashLocation?.id : undefined,
          terms_accepted: termsAccepted,
          terms_version: termsVersion,
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
      setError(errorText(err, locale));
    } finally {
      setSubmitting(false);
    }
  }

  async function submitAddition(order: Order) {
    if (!token || additionSubmitting || !additionSignature) return;
    if (!order.can_add_items) {
      setError(additionBlockedText(order));
      return;
    }
    setAdditionSubmitting(true);
    setError("");
    try {
      const calc = additionCalculation || (await calculateAddition(order.id));
      if (!calc) throw new Error("EMPTY_CART");
      const updated = await withAuth((authToken) => api.addOrderItems(
        authToken,
        order.id,
        {
          calculation_token: calc.calculation_token,
          expected_version: order.version,
        },
        pendingAdditionIdempotencyKey(order.id, additionSignature),
      ), token);
      resetPendingAdditionIdempotencyKey(order.id);
      setAdditionCart({ version: 1, lines: {} });
      setAdditionCalculation(null);
      mergeOrder(updated);
      replaceRoute({ name: "order", id: updated.id });
    } catch (err) {
      setError(errorText(err, locale));
      try {
        const fresh = await withAuth((authToken) => api.getOrder(authToken, order.id), token);
        mergeOrder(fresh);
      } catch {
        // Status refresh is best-effort after a failed addition.
      }
    } finally {
      setAdditionSubmitting(false);
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

  if (publicInformationRoute) {
    return (
      <Shell locale={locale} route={route} onLocale={updateLocale} cartQuantity={cartQuantity} header="Tako Lako - Грузинская кухня" runtime={data.runtime} session={data.session}>
        <PublicInformation route={route} locale={locale} support={data.runtime?.support_text || "@Tako_Lako"} />
      </Shell>
    );
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
    ) : route.name === "add" ? (
      <AddToOrder
        order={fullOrderFromCache(data.orders, route.id)}
        categories={data.categories}
        lines={availableAdditionLines}
        cart={additionCart}
        subtotal={additionSubtotal}
        calculation={additionCalculation}
        submitting={additionSubmitting}
        onSetLine={setAdditionLine}
        onCalculate={calculateAddition}
        onSubmit={submitAddition}
      />
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
        fulfillmentType={fulfillmentType}
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
        onFulfillmentType={updateFulfillmentType}
        onPaymentMethod={setPaymentMethod}
        onTermsAccepted={setTermsAccepted}
        onConfirmContact={confirmContact}
        onConfirmCashLocation={confirmCashLocation}
        onCalculate={calculate}
        onSubmit={submitOrder}
      />
    ) : route.name === "order" ? (
      <OrderScreen order={fullOrderFromCache(data.orders, route.id)} locale={locale} onAdd={() => navigate({ name: "add", id: route.id })} />
    ) : route.name === "orders" ? (
      <Orders orders={data.orders} page={ordersPage} locale={locale} onLoadMore={loadMoreOrders} />
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
      {cartQuantity > 0 && route.name !== "checkout" && route.name !== "cart" && route.name !== "add" && (
        <button className="cart-float" onClick={() => navigate({ name: "cart" })}>
          <ShoppingCart size={18} />
          <span>{cartQuantity}</span>
          <strong>{money(total)}</strong>
        </button>
      )}
      {confirmDialog && <ConfirmDialog dialog={confirmDialog} onClose={closeConfirm} />}
    </Shell>
  );
}

function ConfirmDialog({ dialog, onClose }: { dialog: ConfirmDialogState; onClose(confirmed: boolean): void }) {
  return (
    <div className="dialog-backdrop" role="presentation" onClick={() => onClose(false)}>
      <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title" onClick={(event) => event.stopPropagation()}>
        <h2 id="confirm-title">{dialog.title}</h2>
        <p>{dialog.message}</p>
        <div className="dialog-actions">
          <button type="button" onClick={() => onClose(false)}>{dialog.cancelLabel || "Отмена"}</button>
          <button className="primary" type="button" onClick={() => onClose(true)}>{dialog.confirmLabel}</button>
        </div>
      </section>
    </div>
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

function PublicInformation({ route, locale, support }: { route: Route; locale: Locale; support: string }) {
  if (route.name === "support") return <Support support={support} locale={locale} />;

  const Page = route.name === "terms"
    ? Terms
    : route.name === "returns"
      ? Returns
      : Privacy;

  return (
    <Suspense fallback={<div className="state">Загрузка...</div>}>
      <Page locale={locale} />
    </Suspense>
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
  const showLocale = isRoot || isPublicInformationRoute(route);
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
            {showLocale && (
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

function menuDisplayItems(categories: AppData["categories"]) {
  const entries = categories.flatMap((category, categoryIndex) => category.items.map((item, itemIndex) => ({
    categoryIndex,
    categorySort: category.sort_order,
    item,
    itemIndex,
  })));
  return [...entries]
    .sort((left, right) => Number(isRecommendedItem(right.item)) - Number(isRecommendedItem(left.item)) ||
      left.categorySort - right.categorySort ||
      left.item.sort_order - right.item.sort_order ||
      left.categoryIndex - right.categoryIndex ||
      left.itemIndex - right.itemIndex)
    .map(({ item }, visualIndex) => ({ item, visualIndex }));
}

function isRecommendedItem(item: MenuItem): boolean {
  return Boolean(splitRecommendationDescription(item.description).recommendationBadge);
}

function Menu({ categories, cart, onSetLine }: { categories: AppData["categories"]; cart: CartState; onSetLine: (item: MenuItem, quantity: number) => void }) {
  const flatItems = menuDisplayItems(categories);
  return (
    <div className="page">
      <section className="menu-section">
        <div className="menu-grid">
          {flatItems.map(({ item, visualIndex }) => {
            const qty = cart.lines[item.id]?.quantity || 0;
            const minQuantity = itemMinQuantity(item);
            const { description } = splitRecommendationDescription(item.description);
            return (
              <article className={qty > 0 ? "dish-card in-cart" : "dish-card"} key={item.id}>
                <DishVisual item={item} visualIndex={visualIndex} asButton onClick={() => navigate({ name: "dish", id: item.id })} />
                <div className="dish-body">
                  <button className="link-title" onClick={() => navigate({ name: "dish", id: item.id })}>
                    {item.title}
                  </button>
                  <p>{description}</p>
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

function AddToOrder({
  order,
  categories,
  lines,
  cart,
  subtotal,
  calculation,
  submitting,
  onSetLine,
  onCalculate,
  onSubmit,
}: {
  order?: Order;
  categories: AppData["categories"];
  lines: CartLine[];
  cart: CartState;
  subtotal: number;
  calculation: Calculation | null;
  submitting: boolean;
  onSetLine: (item: MenuItem, quantity: number) => void;
  onCalculate: (orderId: string) => Promise<Calculation | null>;
  onSubmit: (order: Order) => Promise<void>;
}) {
  useSecondTick();
  const signature = lines.map((line) => `${line.itemId}:${line.quantity}:${line.unitPriceMinor}:${line.menuVersion}`).sort().join("|");
  useEffect(() => {
    if (order?.id && lines.length) void onCalculate(order.id).catch(() => undefined);
  }, [order?.id, lines.length, signature]);
  if (!order) return <div className="state">Загружаем заказ...</div>;
  const flatItems = menuDisplayItems(categories);
  const disabledReason = order.can_add_items ? "" : additionBlockedText(order);
  const amount = calculation?.subtotal_minor || subtotal;
  return (
    <div className="page add-order-page">
      <section className={order.can_add_items ? "addition-panel" : "addition-panel blocked"}>
        <div>
          <span className="eyebrow">Дозаказ</span>
          <h1>К заказу #{order.public_number}</h1>
          <p>{order.can_add_items ? `Осталось ${timeLeft(order.add_items_until)}` : disabledReason}</p>
        </div>
        <button className="secondary" type="button" onClick={() => navigate({ name: "order", id: order.id })}>
          Назад к заказу
        </button>
      </section>
      <section className="menu-section">
        <div className="menu-grid">
          {flatItems.map(({ item, visualIndex }) => {
            const qty = cart.lines[item.id]?.quantity || 0;
            const alreadyInOrder = order.items.some((entry) => entry.menu_item_id === item.id);
            const startQuantity = alreadyInOrder ? 1 : itemMinQuantity(item);
            const minSelectedQuantity = alreadyInOrder ? 1 : itemMinQuantity(item);
            const { description } = splitRecommendationDescription(item.description);
            return (
              <article className={qty > 0 ? "dish-card in-cart" : "dish-card"} key={item.id}>
                <DishVisual item={item} visualIndex={visualIndex} />
                <div className="dish-body">
                  <strong className="plain-title">{item.title}</strong>
                  <p>{description}</p>
                  <div className="meta-row">
                    <span>{item.weight_text}</span>
                    <strong>{money(item.price_minor)}</strong>
                  </div>
                  <div className="row-actions">
                    {qty > 0 ? (
                      <Qty value={qty} onMinus={() => onSetLine(item, qty <= minSelectedQuantity ? 0 : qty - 1)} onPlus={() => onSetLine(item, qty + 1)} />
                    ) : (
                      <button className="primary add-only" disabled={!order.can_add_items} onClick={() => onSetLine(item, startQuantity)}>
                        Добавить{startQuantity > 1 ? ` · ${startQuantity} шт` : ""}
                      </button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>
      <div className="bottom-action add-bottom-action">
        <div className="addition-total">
          <span>{lines.length ? `${lines.reduce((sum, line) => sum + line.quantity, 0)} поз.` : "Ничего не выбрано"}</span>
          <strong>{money(amount)}</strong>
        </div>
        <button className="primary full" disabled={!order.can_add_items || submitting || !lines.length} onClick={() => void onSubmit(order)}>
          {submitting ? "..." : `Добавить к заказу · ${money(amount)}`}
        </button>
      </div>
    </div>
  );
}

function Dish({ item, line, locale, onSetLine }: { item?: MenuItem; line?: CartLine; locale: Locale; onSetLine: (item: MenuItem, quantity: number) => void }) {
  const [qty, setQty] = useState(line?.quantity || (item ? itemMinQuantity(item) : 1));
  if (!item) return <div className="state">Блюдо не найдено</div>;
  const minQuantity = itemMinQuantity(item);
  const { description } = splitRecommendationDescription(item.description);
  return (
    <div className="page narrow dish-page">
      <DishVisual item={item} visualIndex={2} hero />
      <span className="eyebrow">Tako Lako special</span>
      <h1>{item.title}</h1>
      <p className="lead">{description}</p>
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
  const { recommendationBadge } = splitRecommendationDescription(item.description);
  const className = `${hero ? "hero-art" : "dish-art"} art-${visualIndex % 6}${src ? " has-photo" : ""}`;
  const content = (
    <>
      {recommendationBadge && <span className="recommendation-badge">{recommendationBadge}</span>}
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
  fulfillmentType,
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
  onFulfillmentType,
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
  fulfillmentType: FulfillmentType;
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
  onFulfillmentType: (type: FulfillmentType) => void;
  onPaymentMethod: (method: Extract<PaymentMethod, "cash" | "crypto">) => void;
  onTermsAccepted: (accepted: boolean) => void;
  onConfirmContact: () => Promise<void>;
  onConfirmCashLocation: () => Promise<void>;
  onCalculate: () => Promise<Calculation | null>;
  onSubmit: () => Promise<void>;
}) {
  useEffect(() => {
    if (lines.length) void onCalculate().catch(() => undefined);
  }, [fulfillmentType, lines.length]);
  if (!lines.length) return <div className="state">{t(locale, "emptyCart")}</div>;
  const deliverySelected = fulfillmentType === "delivery";
  const locationRequired = deliverySelected && paymentMethod === "cash" && cashLocationRequired;
  const locationVerified = !locationRequired || cashLocation?.status === "VERIFIED";
  const contactVerified = Boolean(verifiedContact?.verified);
  const termsHref = termsUrl.trim() || routeToHash({ name: "terms" });
  const termsExternal = /^https?:\/\//i.test(termsHref);
  const copy = checkoutCopy(locale);
  return (
    <div className="page narrow checkout-page">
      <h1>{t(locale, "checkout")}</h1>
      <div className="form">
        <div className="fulfillment-selector">
          <span>{copy.fulfillmentTitle}</span>
          <div>
            <button type="button" className={deliverySelected ? "active" : ""} onClick={() => onFulfillmentType("delivery")}>
              <strong>{copy.deliveryTitle}</strong>
              <small>{copy.deliveryDescription}</small>
            </button>
            <button type="button" className={!deliverySelected ? "active" : ""} onClick={() => onFulfillmentType("pickup")}>
              <strong>{copy.pickupTitle}</strong>
              <small>{copy.pickupDescription}</small>
            </button>
          </div>
          {!deliverySelected && <p>{copy.pickupSelected}</p>}
        </div>
        {deliverySelected && (
          <>
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
          </>
        )}
        <label>
          <span>{t(locale, "comment")}</span>
          <textarea value={draft.comment} maxLength={300} onChange={(event) => onDraft({ comment: event.target.value })} />
        </label>
      </div>
      <div className="payment-selector">
        <span>{copy.paymentTitle}</span>
        <div>
          {paymentMethods.map((method) => (
            <button key={method} className={paymentMethod === method ? "active" : ""} type="button" onClick={() => onPaymentMethod(method)}>
              <strong>{paymentMethodTitle(method, locale)}</strong>
              <small>{paymentMethodDescription(method, fulfillmentType, locale)}</small>
            </button>
          ))}
        </div>
        {paymentMethod === "crypto" && (
          <p>{copy.cryptoNotice}</p>
        )}
      </div>
      <div className={contactVerified && locationVerified ? "required-checks verified" : "required-checks"}>
        <div className="required-checks-head">
          <strong>{copy.requiredSteps}</strong>
          <span>{contactVerified && locationVerified ? copy.ready : copy.required}</span>
        </div>
        <button
          className={contactVerified ? "contact-share active-contact required-contact" : "contact-share required-contact"}
          type="button"
          onClick={() => void onConfirmContact()}
          disabled={contactLoading}
          aria-label={contactVerified ? copy.phoneConfirmed : copy.phoneRequiredAria}
        >
          <span className="contact-share-icon" aria-hidden="true">
            {contactVerified ? <Check size={22} /> : <Phone size={22} />}
          </span>
          <span className="contact-share-copy">
            <strong>{contactLoading ? copy.contactWait : contactVerified ? copy.phoneConfirmed : copy.sharePhoneRequired}</strong>
            <small>{contactVerified ? (verifiedContact?.masked || maskPhone(draft.phone)) : locationRequired ? copy.contactThenLocation : copy.phoneNeeded}</small>
          </span>
          {!contactVerified && <ChevronRight className="contact-share-arrow" size={22} aria-hidden="true" />}
        </button>
        {locationRequired && (
          <div className={`cash-location ${!contactVerified ? "blocked" : ""} ${cashLocation?.status === "VERIFIED" ? "verified" : cashLocation?.status === "REJECTED" || cashLocation?.status === "EXPIRED" ? "rejected" : ""}`}>
            <div>
              <MapPin size={18} />
              <div>
                <strong>{cashLocationTitle(cashLocation, locale)}</strong>
                <p>{cashLocationText(cashLocation, cashLocationRadiusMeters, locale)}</p>
              </div>
            </div>
            <button className="primary full" type="button" onClick={() => void onConfirmCashLocation()} disabled={locationLoading || !contactVerified}>
              {!contactVerified ? copy.firstSharePhone : locationLoading ? copy.checkingLocation : cashLocation?.status === "VERIFIED" ? copy.updateLocation : copy.confirmLocation}
            </button>
          </div>
        )}
      </div>
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
        {submitting ? "..." : `${paymentMethod === "crypto" ? copy.placeCryptoTestOrder : t(locale, "placeOrder")} · ${money(calculation?.total_minor || total)}`}
      </button>
    </div>
  );
}

function checkoutCopy(locale: Locale) {
  const copy = {
    ru: {
      fulfillmentTitle: "Как получить заказ",
      deliveryTitle: "Доставка",
      deliveryDescription: "привезём курьером",
      pickupTitle: "Самовывоз",
      pickupDescription: "забрать в ресторане",
      pickupSelected: "Самовывоз выбран: адрес и геолокация не нужны, курьер не получает этот заказ.",
      paymentTitle: "Способ оплаты",
      cryptoNotice: "Тестовый режим: реальная крипта не списывается. Заказ создаётся как оплаченный, чтобы проверить flow кухни, курьера и админки.",
      requiredSteps: "Обязательные шаги",
      ready: "готово",
      required: "обязательно",
      phoneConfirmed: "Телефон подтверждён",
      phoneRequiredAria: "Обязательно поделиться телефоном через Telegram",
      contactWait: "Ожидаем Telegram",
      sharePhoneRequired: "Обязательно: поделиться телефоном",
      contactThenLocation: "Сначала телефон, затем геолокация",
      phoneNeeded: "Без телефона заказ не оформится",
      firstSharePhone: "Сначала поделитесь телефоном",
      checkingLocation: "Проверяем геолокацию…",
      updateLocation: "Обновить геолокацию",
      confirmLocation: "📍 Подтвердить геолокацию",
      placeCryptoTestOrder: "ОПЛАТИТЬ TEST CRYPTO",
      addressPartEntrance: "подъезд",
      addressPartFloor: "этаж",
      addressPartApartment: "кв.",
      cashTitle: "Наличными",
      cryptoDescription: "sandbox · без реальных денег",
      cashPickupDescription: "при получении в ресторане",
      cashDeliveryDescription: "курьеру при получении",
      contactDenied: "Telegram не передал телефон. Нажмите кнопку и разрешите отправку номера.",
      contactPending: "Телефон ещё не дошёл до бота. Откройте чат с ботом и попробуйте ещё раз.",
      phoneRequired: "Поделитесь телефоном через Telegram",
      phoneAndAddressRequired: "Поделитесь телефоном через Telegram и заполните адрес",
      cashLocationRequired: "Для оплаты наличными подтвердите местоположение",
      locationVerifiedTitle: "Местоположение подтверждено",
      locationPendingTitle: "Ожидаем геолокацию",
      locationRejectedTitle: "Местоположение не подтверждено",
      locationExpiredTitle: "Проверка истекла",
      locationDefaultTitle: "Подтвердите местоположение",
      locationVerifiedText: "Для cash всё готово",
      locationDistance: (distance: string) => ` · ${distance} от ресторана`,
      locationPendingText: "Открылся бот? Нажмите там кнопку геолокации. Если кнопки нет — отправьте /share.",
      locationExpiredText: "Повторите проверку перед оформлением заказа.",
      locationOutsideText: (distance: string) => `Оплата наличными доступна в радиусе ${distance} от ресторана.`,
      locationInaccurateText: "Геолокация неточная. Повторите проверку у окна или на улице.",
      locationNotConfiguredText: "Оплата наличными временно недоступна: ресторан ещё не настроил точку.",
      locationDefaultText: "Для оплаты наличными Telegram подтвердит, что вы находитесь в Нови Саде, чтобы мы могли к вам приехать. Точные координаты не сохраняются.",
    },
    sr: {
      fulfillmentTitle: "Kako želite da preuzmete porudžbinu",
      deliveryTitle: "Dostava",
      deliveryDescription: "kurir donosi porudžbinu",
      pickupTitle: "Lično preuzimanje",
      pickupDescription: "preuzimanje u restoranu",
      pickupSelected: "Izabrano je lično preuzimanje: adresa i geolokacija nisu potrebni, kurir ne dobija ovu porudžbinu.",
      paymentTitle: "Način plaćanja",
      cryptoNotice: "Test režim: prava kripto uplata se ne naplaćuje. Porudžbina se kreira kao plaćena radi provere toka kuhinje, kurira i admina.",
      requiredSteps: "Obavezni koraci",
      ready: "spremno",
      required: "obavezno",
      phoneConfirmed: "Telefon potvrđen",
      phoneRequiredAria: "Obavezno podelite telefon preko Telegrama",
      contactWait: "Čekamo Telegram",
      sharePhoneRequired: "Obavezno: podelite telefon",
      contactThenLocation: "Prvo telefon, zatim geolokacija",
      phoneNeeded: "Bez telefona porudžbina ne može biti poslata",
      firstSharePhone: "Prvo podelite telefon",
      checkingLocation: "Proveravamo geolokaciju…",
      updateLocation: "Ažuriraj geolokaciju",
      confirmLocation: "📍 Potvrdi geolokaciju",
      placeCryptoTestOrder: "PLATI TEST CRYPTO",
      addressPartEntrance: "ulaz",
      addressPartFloor: "sprat",
      addressPartApartment: "stan",
      cashTitle: "Gotovina",
      cryptoDescription: "sandbox · bez pravog plaćanja",
      cashPickupDescription: "pri preuzimanju u restoranu",
      cashDeliveryDescription: "kuriru pri dostavi",
      contactDenied: "Telegram nije poslao telefon. Pritisnite dugme i dozvolite slanje broja.",
      contactPending: "Telefon još nije stigao do bota. Otvorite chat sa botom i pokušajte ponovo.",
      phoneRequired: "Podelite telefon preko Telegrama",
      phoneAndAddressRequired: "Podelite telefon preko Telegrama i unesite adresu",
      cashLocationRequired: "Za plaćanje gotovinom potvrdite lokaciju",
      locationVerifiedTitle: "Lokacija je potvrđena",
      locationPendingTitle: "Čekamo geolokaciju",
      locationRejectedTitle: "Lokacija nije potvrđena",
      locationExpiredTitle: "Provera je istekla",
      locationDefaultTitle: "Potvrdite lokaciju",
      locationVerifiedText: "Za gotovinu je sve spremno",
      locationDistance: (distance: string) => ` · ${distance} od restorana`,
      locationPendingText: "Bot se otvorio? Pritisnite tamo dugme za geolokaciju. Ako dugmeta nema, pošaljite /share.",
      locationExpiredText: "Ponovite proveru pre slanja porudžbine.",
      locationOutsideText: (distance: string) => `Plaćanje gotovinom je dostupno u krugu od ${distance} od restorana.`,
      locationInaccurateText: "Geolokacija nije dovoljno precizna. Ponovite proveru pored prozora ili napolju.",
      locationNotConfiguredText: "Plaćanje gotovinom trenutno nije dostupno: restoran još nije podesio lokaciju.",
      locationDefaultText: "Za plaćanje gotovinom Telegram potvrđuje da ste u Novom Sadu kako bismo mogli da dostavimo porudžbinu. Tačne koordinate se ne čuvaju.",
    },
    en: {
      fulfillmentTitle: "How to receive the order",
      deliveryTitle: "Delivery",
      deliveryDescription: "courier delivery",
      pickupTitle: "Pickup",
      pickupDescription: "collect at the restaurant",
      pickupSelected: "Pickup selected: address and geolocation are not needed, and the courier will not receive this order.",
      paymentTitle: "Payment method",
      cryptoNotice: "Test mode: no real crypto is charged. The order is created as paid to test the kitchen, courier and admin flow.",
      requiredSteps: "Required steps",
      ready: "ready",
      required: "required",
      phoneConfirmed: "Phone confirmed",
      phoneRequiredAria: "Phone sharing through Telegram is required",
      contactWait: "Waiting for Telegram",
      sharePhoneRequired: "Required: share phone",
      contactThenLocation: "Phone first, then geolocation",
      phoneNeeded: "The order cannot be placed without a phone",
      firstSharePhone: "Share your phone first",
      checkingLocation: "Checking geolocation…",
      updateLocation: "Update geolocation",
      confirmLocation: "📍 Confirm geolocation",
      placeCryptoTestOrder: "PAY TEST CRYPTO",
      addressPartEntrance: "entrance",
      addressPartFloor: "floor",
      addressPartApartment: "apt.",
      cashTitle: "Cash",
      cryptoDescription: "sandbox · no real payment",
      cashPickupDescription: "at pickup in the restaurant",
      cashDeliveryDescription: "to the courier on delivery",
      contactDenied: "Telegram did not send the phone. Press the button and allow sharing your number.",
      contactPending: "The phone has not reached the bot yet. Open the bot chat and try again.",
      phoneRequired: "Share your phone through Telegram",
      phoneAndAddressRequired: "Share your phone through Telegram and enter the address",
      cashLocationRequired: "Confirm your location for cash payment",
      locationVerifiedTitle: "Location confirmed",
      locationPendingTitle: "Waiting for geolocation",
      locationRejectedTitle: "Location not confirmed",
      locationExpiredTitle: "Verification expired",
      locationDefaultTitle: "Confirm location",
      locationVerifiedText: "Cash payment is ready",
      locationDistance: (distance: string) => ` · ${distance} from the restaurant`,
      locationPendingText: "Bot opened? Press the geolocation button there. If there is no button, send /share.",
      locationExpiredText: "Repeat verification before placing the order.",
      locationOutsideText: (distance: string) => `Cash payment is available within ${distance} of the restaurant.`,
      locationInaccurateText: "Geolocation is not accurate enough. Repeat the check near a window or outside.",
      locationNotConfiguredText: "Cash payment is temporarily unavailable: the restaurant location is not configured yet.",
      locationDefaultText: "For cash payment, Telegram confirms that you are in Novi Sad so we can deliver the order. Exact coordinates are not stored.",
    },
  } satisfies Record<Locale, Record<string, string | ((value: string) => string)>>;
  return copy[locale] as typeof copy.ru;
}

function cryptoConfirmText(locale: Locale, totalMinor: number): string {
  const amount = money(totalMinor);
  if (locale === "sr") return `Test crypto plaćanje ${amount} biće odmah označeno kao PAID. Pravi novac se ne naplaćuje.`;
  if (locale === "en") return `Test crypto payment ${amount} will be marked as PAID immediately. No real money is charged.`;
  return `Тестовая crypto-оплата ${amount} будет сразу отмечена как PAID. Реальные деньги не списываются.`;
}

function cryptoConfirmTitle(locale: Locale): string {
  if (locale === "sr") return "Crypto demo";
  if (locale === "en") return "Crypto demo";
  return "Crypto demo";
}

function cryptoConfirmButton(locale: Locale): string {
  if (locale === "sr") return "Nastavi";
  if (locale === "en") return "Continue";
  return "Продолжить";
}

function cryptoCancelButton(locale: Locale): string {
  if (locale === "sr") return "Otkaži";
  if (locale === "en") return "Cancel";
  return "Отмена";
}

function buildCheckoutAddress(draft: CheckoutDraft, locale: Locale): string {
  const copy = checkoutCopy(locale);
  const main = [draft.street.trim(), draft.houseNumber.trim()].filter(Boolean).join(" ");
  const details = [
    addressPart(copy.addressPartEntrance, draft.entrance),
    addressPart(copy.addressPartFloor, draft.floor),
    addressPart(copy.addressPartApartment, draft.apartment),
  ].filter(Boolean);
  return [main, ...details].filter(Boolean).join(", ");
}

function addressPart(label: string, value: string): string {
  const trimmed = value.trim();
  return trimmed ? `${label} ${trimmed}` : "";
}

function cashLocationTitle(challenge: CashLocationChallenge | null, locale: Locale): string {
  const copy = checkoutCopy(locale);
  switch (challenge?.status) {
    case "VERIFIED":
      return copy.locationVerifiedTitle;
    case "PENDING":
      return copy.locationPendingTitle;
    case "REJECTED":
      return copy.locationRejectedTitle;
    case "EXPIRED":
      return copy.locationExpiredTitle;
    default:
      return copy.locationDefaultTitle;
  }
}

function cashLocationText(challenge: CashLocationChallenge | null, radiusMeters: number, locale: Locale): string {
  const copy = checkoutCopy(locale);
  if (challenge?.status === "VERIFIED") {
    const distance = typeof challenge.distance_meters === "number" ? copy.locationDistance(formatDistance(challenge.distance_meters)) : "";
    return `${copy.locationVerifiedText}${distance}`;
  }
  if (challenge?.status === "PENDING") return copy.locationPendingText;
  if (challenge?.status === "EXPIRED") return copy.locationExpiredText;
  if (challenge?.rejection_reason === "OUTSIDE_CASH_AREA") return copy.locationOutsideText(formatDistance(radiusMeters));
  if (challenge?.rejection_reason === "LOCATION_INACCURATE" || challenge?.rejection_reason === "LOCATION_ACCURACY_MISSING") return copy.locationInaccurateText;
  if (challenge?.rejection_reason === "LOCATION_NOT_CONFIGURED") return copy.locationNotConfiguredText;
  return copy.locationDefaultText;
}

function formatDistance(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(1).replace(".", ",")} км`;
  return `${meters} м`;
}

function useSecondTick(): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((value) => value + 1), 1000);
    return () => window.clearInterval(id);
  }, []);
}

function timeLeft(value?: string): string {
  if (!value) return "несколько минут";
  const seconds = Math.max(0, Math.floor((new Date(value).getTime() - Date.now()) / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function timeHHMM(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function additionBlockedText(order: Order): string {
  switch (order.add_items_reason) {
    case "already_added":
      return "Дозаказ уже был добавлен";
    case "time_expired":
      return "Прошло больше 5 минут";
    case "manual_day_off":
      return "Приём заказов закрыт";
    case "schedule_closed":
      return "Приём заказов завершён";
    case "payment_method":
      return "Доступно только для наличных";
    case "status":
      return "Заказ уже передан дальше";
    default:
      return order.can_add_items ? "" : "Сейчас добавить нельзя";
  }
}

function OrderScreen({ order, locale, onAdd }: { order?: Order; locale: Locale; onAdd: () => void }) {
  useSecondTick();
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
      {order.fulfillment_status === "NEW" && (
        <div className={order.can_add_items ? "add-order-cta" : "add-order-cta disabled"}>
          <div>
            <strong>{order.can_add_items ? "Забыли что-то?" : "Дозаказ недоступен"}</strong>
            <span>{order.can_add_items ? `Можно добавить ещё ${timeLeft(order.add_items_until)}` : additionBlockedText(order)}</span>
          </div>
          <button className="primary" type="button" disabled={!order.can_add_items} onClick={onAdd}>
            Добавить
          </button>
        </div>
      )}
      <div className="list">
        {order.items.map((item) => (
          <div className={item.addition_id ? "line added-line" : "line"} key={`${item.menu_item_id}-${item.addition_id || "base"}`}>
            <div>
              <strong>{item.quantity} × {item.snapshot_title}</strong>
              <span>{money(item.line_total_minor)}</span>
              {item.addition_id && <span className="addition-chip">Добавлено{item.addition_created_at ? ` в ${timeHHMM(item.addition_created_at)}` : ""}</span>}
            </div>
          </div>
        ))}
      </div>
      <Totals subtotal={order.subtotal_minor} total={order.total_minor} locale={locale} />
      <div className="panel-list">
        <div className="split"><span>Получение</span><strong>{fulfillmentText(order)}</strong></div>
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
            <span>#{order.public_number}<small>{fulfillmentText(order)} · {localizedStatus(order, locale)}</small></span>
            <strong>{money(order.total_minor)}</strong>
            <ChevronRight size={18} />
          </button>
        ))}
      </div>
      {page.has_more && <button className="secondary full" type="button" onClick={() => void onLoadMore()}>Показать ещё</button>}
    </div>
  );
}

function Support({ support, locale }: { support: string; locale: Locale }) {
  const handle = support.trim().replace(/^@+/, "") || "Tako_Lako";
  const supportCopy: Record<Locale, { title: string; intro: string; telegram: string; stepsTitle: string; steps: string[]; note: string }> = {
    ru: {
      title: "Поддержка",
      intro: "По заказу, адресу, оплате или отмене — пишите в Telegram. Так быстрее всего найти заказ и ответить.",
      telegram: "Написать в поддержку",
      stepsTitle: "Что написать",
      steps: ["номер заказа, если он уже есть", "что случилось: адрес, оплата, отмена или ошибка", "фото/скриншот, если это поможет"],
      note: "Если заказ активен, не создавайте новый — сначала напишите нам.",
    },
    sr: {
      title: "Podrška",
      intro: "Za porudžbinu, adresu, plaćanje ili otkazivanje pišite nam u Telegram. Tako najbrže nalazimo porudžbinu.",
      telegram: "Piši podršci",
      stepsTitle: "Šta poslati",
      steps: ["broj porudžbine, ako ga imate", "šta se desilo: adresa, plaćanje, otkazivanje ili greška", "foto/screenshot ako pomaže"],
      note: "Ako je porudžbina aktivna, ne pravite novu — prvo nam pišite.",
    },
    en: {
      title: "Support",
      intro: "For order, address, payment or cancellation questions, message us in Telegram. It is the fastest way to find the order.",
      telegram: "Message support",
      stepsTitle: "What to send",
      steps: ["order number, if you already have one", "what happened: address, payment, cancellation or app error", "photo/screenshot if useful"],
      note: "If an order is active, do not create another one — message us first.",
    },
  };
  const copy = supportCopy[locale];

  return (
    <div className="page narrow support-page">
      <section className="support-card support-main">
        <span className="support-kicker">Tako Lako</span>
        <h1>{copy.title}</h1>
        <p>{copy.intro}</p>
        <a className="primary full as-link" href={`https://t.me/${handle}`} target="_blank" rel="noreferrer">{copy.telegram}: @{handle}</a>
      </section>
      <section className="support-card">
        <h2>{copy.stepsTitle}</h2>
        <ol>
          {copy.steps.map((step) => <li key={step}>{step}</li>)}
        </ol>
        <p className="support-note">{copy.note}</p>
      </section>
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

function paymentMethodTitle(method: Extract<PaymentMethod, "cash" | "crypto">, locale: Locale): string {
  if (method === "crypto") return "Crypto TEST";
  return checkoutCopy(locale).cashTitle;
}

function paymentMethodDescription(method: Extract<PaymentMethod, "cash" | "crypto">, fulfillmentType: FulfillmentType, locale: Locale): string {
  const copy = checkoutCopy(locale);
  if (method === "crypto") return copy.cryptoDescription;
  if (fulfillmentType === "pickup") return copy.cashPickupDescription;
  return copy.cashDeliveryDescription;
}

function paymentStatusLabel(order: Order): string {
  if (order.payment_method === "crypto") return order.payment_status === "PAID" ? "Crypto TEST · PAID" : "Crypto TEST";
  if (order.payment_method === "card") return order.payment_status === "PAID" ? "Карта · PAID" : "Карта";
  if (order.fulfillment_type === "pickup") return order.payment_status === "PAID" ? "Наличные при самовывозе · PAID" : "Наличные при самовывозе";
  return order.payment_status === "PAID" ? "Наличные · PAID" : "Наличные";
}

function fulfillmentText(order: OrderSummary): string {
  return order.fulfillment_type === "pickup" ? "Самовывоз" : "Доставка";
}

function localizedStatus(order: OrderSummary, locale: Locale): string {
  if (order.fulfillment_type === "pickup") {
    if (order.fulfillment_status === "NEW") return locale === "ru" ? "Заказ принят · самовывоз" : t(locale, "accepted");
    if (order.fulfillment_status === "OUT_FOR_DELIVERY") return locale === "ru" ? "Готов к самовывозу" : "Ready for pickup";
    if (order.fulfillment_status === "DELIVERED") return locale === "ru" ? "Заказ выдан" : t(locale, "delivered");
  }
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
  if (lower.includes("чкмерули") || lower.includes("chkm") || lower.includes("ckm")) return "🍗";
  if (lower.includes("оджахури") || lower.includes("ojakhuri") || lower.includes("adzahuri")) return "🍲";
  if (lower.includes("чахохбили")) return "🍗";
  if (lower.includes("лобио")) return "🍲";
  if (lower.includes("салат") || lower.includes("salata")) return "🥗";
  if (lower.includes("баклажан") || lower.includes("patlid")) return "🍆";
  if (lower.includes("медовик") || lower.includes("картошка") || lower.includes("medovik") || lower.includes("kolac")) return "🍰";
  if (lower.includes("соус") || lower.includes("sos") || lower.includes("sacebeli")) return "🥣";
  if (lower.includes("лимонад") || lower.includes("натакхари") || lower.includes("natakhtari") || lower.includes("комбуч") || lower.includes("kombu") || lower.includes("coca-cola") || lower.includes("вода")) return "🥤";
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

function splitRecommendationDescription(description: string): { description: string; recommendationBadge?: string } {
  const text = (description || "").trim();
  if (!text) return { description: text };
  const prefixes = [
    { prefix: "Рекомендация от разработчика:", badge: "Рекомендация от разработчика" },
    { prefix: "Preporuka developera:", badge: "Preporuka developera" },
    { prefix: "Chef's recommendation:", badge: "Recommendation" },
  ];
  for (const { prefix, badge } of prefixes) {
    if (text.startsWith(prefix)) {
      return { description: text.slice(prefix.length).trim(), recommendationBadge: badge };
    }
  }
  return { description: text };
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

function errorText(err: unknown, locale: Locale = "ru"): string {
  const code = typeof err === "object" && err && "code" in err ? String((err as { code: unknown }).code) : String((err as Error)?.message || err);
  const messages = {
    ru: {
      MANUAL_DAY_OFF: "Сегодня выходной",
      RESTAURANT_CLOSED: "Сейчас заказы не принимаются",
      ITEM_UNAVAILABLE: "Одно из блюд недоступно",
      INVALID_QUANTITY: "Проверьте количество блюд",
      EMPTY_CART: "В корзине нет доступных блюд",
      IDEMPOTENCY_CONFLICT: "Заказ уже отправляется. Проверьте статус",
      ACTIVE_ORDER_EXISTS: "У вас уже есть активный заказ. Новый можно оформить после доставки текущего.",
      ORDER_STATUS_CONFLICT: "Заказ уже изменился. Обновите экран и проверьте статус.",
      CALCULATION_EXPIRED: "Цены или заказ изменились. Пересчитайте сумму.",
      AUTH_INVALID: "Telegram авторизация не прошла",
      CONTACT_NOT_VERIFIED: "Для cash нужен телефон, подтверждённый через Telegram",
      CASH_LOCATION_REQUIRED: "Для оплаты наличными подтвердите местоположение",
      CASH_LOCATION_OUTSIDE: "Вы вне зоны доставки для оплаты наличными",
      CASH_LOCATION_INACCURATE: "Геолокация неточная. Повторите проверку у окна или на улице.",
      INVALID_INPUT: "Поделитесь телефоном через Telegram и заполните адрес",
      RATE_LIMITED: "Слишком много запросов. Подождите минуту и попробуйте ещё раз.",
      INTERNAL: "Сервер недоступен. Попробуйте ещё раз",
      SERVER_UNAVAILABLE: "Сервер недоступен. Попробуйте ещё раз",
    },
    sr: {
      MANUAL_DAY_OFF: "Danas je neradni dan",
      RESTAURANT_CLOSED: "Porudžbine trenutno nisu dostupne",
      ITEM_UNAVAILABLE: "Jedno od jela nije dostupno",
      INVALID_QUANTITY: "Proverite količinu jela",
      EMPTY_CART: "U korpi nema dostupnih jela",
      IDEMPOTENCY_CONFLICT: "Porudžbina se već šalje. Proverite status.",
      ACTIVE_ORDER_EXISTS: "Već imate aktivnu porudžbinu. Novu možete poslati nakon završetka trenutne.",
      ORDER_STATUS_CONFLICT: "Porudžbina se promenila. Osvežite ekran i proverite status.",
      CALCULATION_EXPIRED: "Cene ili porudžbina su se promenile. Ponovo izračunajte iznos.",
      AUTH_INVALID: "Telegram autorizacija nije prošla",
      CONTACT_NOT_VERIFIED: "Za gotovinu je potreban telefon potvrđen preko Telegrama",
      CASH_LOCATION_REQUIRED: "Za plaćanje gotovinom potvrdite lokaciju",
      CASH_LOCATION_OUTSIDE: "Van ste zone za plaćanje gotovinom",
      CASH_LOCATION_INACCURATE: "Geolokacija nije dovoljno precizna. Ponovite proveru pored prozora ili napolju.",
      INVALID_INPUT: "Podelite telefon preko Telegrama i unesite adresu",
      RATE_LIMITED: "Previše zahteva. Sačekajte minut i pokušajte ponovo.",
      INTERNAL: "Server nije dostupan. Pokušajte ponovo.",
      SERVER_UNAVAILABLE: "Server nije dostupan. Pokušajte ponovo.",
    },
    en: {
      MANUAL_DAY_OFF: "We are closed today",
      RESTAURANT_CLOSED: "Orders are not accepted now",
      ITEM_UNAVAILABLE: "One of the items is unavailable",
      INVALID_QUANTITY: "Check item quantities",
      EMPTY_CART: "There are no available items in the cart",
      IDEMPOTENCY_CONFLICT: "The order is already being submitted. Check the status.",
      ACTIVE_ORDER_EXISTS: "You already have an active order. Place a new one after the current order is completed.",
      ORDER_STATUS_CONFLICT: "The order has changed. Refresh the screen and check the status.",
      CALCULATION_EXPIRED: "Prices or the order changed. Recalculate the total.",
      AUTH_INVALID: "Telegram authorization failed",
      CONTACT_NOT_VERIFIED: "Cash payment requires a phone confirmed through Telegram",
      CASH_LOCATION_REQUIRED: "Confirm your location for cash payment",
      CASH_LOCATION_OUTSIDE: "You are outside the cash payment delivery area",
      CASH_LOCATION_INACCURATE: "Geolocation is not accurate enough. Repeat the check near a window or outside.",
      INVALID_INPUT: "Share your phone through Telegram and enter the address",
      RATE_LIMITED: "Too many requests. Wait a minute and try again.",
      INTERNAL: "Server is unavailable. Try again.",
      SERVER_UNAVAILABLE: "Server is unavailable. Try again.",
    },
  } satisfies Record<Locale, Record<string, string>>;
  const localeMessages: Record<string, string> = messages[locale];
  return localeMessages[code] || localeMessages.SERVER_UNAVAILABLE;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
