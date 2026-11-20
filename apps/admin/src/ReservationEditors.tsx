import { useState, type FormEvent } from "react";
import type { AdminReservationInput, Reservation, ReservationLocation, ReservationLocationSettings, ReservationSettingsInput, ReservationTable, ReservationTableInput } from "@tk-delivery/api-client/generated";
import { reservationLocationName } from "@tk-delivery/api-client/reservation-locations";
import type { AdminApi } from "./api";

type Action = <T>(action: (token: string) => Promise<T>, options?: { reload?: boolean; successMessage?: string }) => Promise<T | undefined>;

export function reservationTime(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function parseTime(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function defaultReservationStart(date: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Belgrade", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value || "00";
  const today = `${part("year")}-${part("month")}-${part("day")}`;
  if (date !== today) return 13 * 60;
  const now = Number(part("hour")) * 60 + Number(part("minute"));
  return Math.min(1425, Math.max(13 * 60, Math.ceil((now + 1) / 15) * 15));
}

function durationLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return [hours ? `${hours} ч` : "", rest ? `${rest} мин` : ""].filter(Boolean).join(" ");
}

function DurationSelect({ value, onChange }: { value: number; onChange(value: number): void }) {
  return <select value={value} onChange={(event) => onChange(Number(event.target.value))}>
    {Array.from({ length: 48 }, (_, index) => (index + 1) * 15).map((minutes) => <option key={minutes} value={minutes}>{durationLabel(minutes)}</option>)}
  </select>;
}

export function ReservationEditor({ reservation, date, locations, api, onAction, onClose, onSaved }: {
  reservation?: Reservation;
  date: string;
  locations: ReservationLocation[];
  api: AdminApi;
  onAction: Action;
  onClose(): void;
  onSaved(reservation: Reservation): void;
}) {
  const initialLocation = locations.find((location) => location.code === reservation?.location_code) || locations[0];
  const [input, setInput] = useState<AdminReservationInput>({
    location_code: initialLocation?.code || "",
    date: reservation?.date || date,
    start_minute: reservation?.start_minute ?? defaultReservationStart(date),
    duration_minutes: reservation ? reservation.end_minute - reservation.start_minute : initialLocation?.duration_minutes || 120,
    guests: reservation?.guests || 1,
    guest_name: reservation?.manual ? reservation.client_first_name || "" : "",
    ...(reservation ? { expected_version: reservation.version } : {}),
  });
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const endsAfterMidnight = input.start_minute + input.duration_minutes > 1440;
  const patch = (change: Partial<AdminReservationInput>) => setInput((current) => ({ ...current, ...change }));

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFailed(false);
    const saved = await onAction((token) => reservation
      ? api.updateReservation(token, reservation.id, input)
      : api.createManualReservation(token, input, idempotencyKey),
    { reload: false, successMessage: reservation ? "Бронь изменена" : "Бронь добавлена" });
    setBusy(false);
    if (saved) onSaved(saved);
    else setFailed(true);
  }

  return <section className="panel reservation-editor" aria-label={reservation ? "Изменить бронь" : "Новая бронь"}>
    <h2>{reservation ? "Изменить бронь" : "Новая бронь"}</h2>
    <form className="stack" onSubmit={(event) => void save(event)}>
      <div className="form-grid">
        {(!reservation || reservation.manual) ? <label><span>Имя гостя</span><input required maxLength={80} value={input.guest_name} onChange={(event) => patch({ guest_name: event.target.value })} /></label> :
          <label><span>Гость</span><input readOnly value={reservation.client_first_name || (reservation.client_username ? `@${reservation.client_username}` : "Гость Telegram")} /></label>}
        <label><span>Точка</span><select value={input.location_code} onChange={(event) => {
          const next = locations.find((location) => location.code === event.target.value);
          patch({ location_code: event.target.value, ...(!reservation && next ? { duration_minutes: next.duration_minutes } : {}) });
        }}>{locations.map((location) => <option key={location.code} value={location.code}>{reservationLocationName(location.code, "ru", location.name)} · {location.address}</option>)}</select></label>
        <label><span>Дата</span><input type="date" required value={input.date} onChange={(event) => patch({ date: event.target.value })} /></label>
        <label><span>Начало</span><input type="time" step={900} required value={reservationTime(input.start_minute)} onChange={(event) => { if (event.target.value) patch({ start_minute: parseTime(event.target.value) }); }} /></label>
        <label><span>Длительность</span><DurationSelect value={input.duration_minutes} onChange={(value) => patch({ duration_minutes: value })} /></label>
        <label><span>Количество гостей</span><input type="number" required min={1} max={100} value={input.guests} onChange={(event) => patch({ guests: Number(event.target.value) })} /></label>
      </div>
      <p className="muted">Ручную бронь можно добавить и когда онлайн-приём точки закрыт. Свободные места проверяются автоматически.</p>
      {reservation && !reservation.manual && <p className="muted">При переносе гостю в Telegram придёт уведомление.</p>}
      {endsAfterMidnight && <p className="reservation-editor-error">Бронь должна закончиться до полуночи. Измените начало или длительность.</p>}
      {failed && <p className="reservation-editor-error">Не удалось сохранить. Проверьте данные и сообщение об ошибке вверху страницы.</p>}
      <div className="actions"><button className="primary" disabled={busy || endsAfterMidnight} type="submit">{busy ? "Сохраняем…" : "Сохранить бронь"}</button><button type="button" onClick={onClose} disabled={busy}>Отмена</button></div>
    </form>
  </section>;
}

const weekdayNames = ["Воскресенье", "Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"];

export function ReservationSettingsEditor({ settings, api, onAction, onClose, onUpdated }: {
  settings: ReservationLocationSettings;
  api: AdminApi;
  onAction: Action;
  onClose(): void;
  onUpdated(settings: ReservationLocationSettings): void;
}) {
  const [form, setForm] = useState<ReservationSettingsInput>(() => ({
    name: settings.location.name, address: settings.location.address, max_guests: settings.location.max_guests,
    seat_capacity: settings.location.seat_capacity, slot_step_minutes: settings.location.slot_step_minutes,
    duration_minutes: settings.location.duration_minutes, advance_days: settings.location.advance_days,
    version: settings.location.version, schedule: settings.schedule.map((day) => ({ ...day })),
  }));
  const [tables, setTables] = useState(settings.tables);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const invalidSchedule = form.schedule.some((day) => day.is_open && (day.first_start_minute > day.last_start_minute || day.last_start_minute + form.duration_minutes > 1440));
  const patch = (change: Partial<ReservationSettingsInput>) => setForm((current) => ({ ...current, ...change }));

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFailed(false);
    const updated = await onAction((token) => api.updateReservationSettings(token, settings.location.code, form), { reload: false, successMessage: "Настройки точки сохранены" });
    setBusy(false);
    if (updated) { setForm((current) => ({ ...current, version: updated.location.version })); onUpdated(updated); }
    else setFailed(true);
  }

  async function saveTable(id: string | undefined, input: ReservationTableInput) {
    const saved = await onAction((token) => id ? api.updateReservationTable(token, id, input) : api.createReservationTable(token, input), { reload: false, successMessage: "Стол сохранён" });
    if (saved) setTables((current) => id ? current.map((table) => table.id === id ? saved : table) : [...current, saved]);
    return Boolean(saved);
  }

  return <section className="panel reservation-editor" aria-label="Настройки точки">
    <div className="section-heading"><h2>Настройки: {reservationLocationName(settings.location.code, "ru", settings.location.name)}</h2><button type="button" onClick={onClose}>Готово</button></div>
    <p className="muted">Изменения действуют для новых броней. Существующие сохраняют адрес, время и стол.</p>
    <form className="stack" onSubmit={(event) => void save(event)}>
      <div className="form-grid">
        <label><span>Название</span><input required maxLength={80} value={form.name} onChange={(event) => patch({ name: event.target.value })} /></label>
        <label><span>Адрес</span><input required maxLength={200} value={form.address} onChange={(event) => patch({ address: event.target.value })} /></label>
        {settings.location.booking_mode === "seats" && <label><span>Всего мест</span><input type="number" required min={1} max={100} value={form.seat_capacity} onChange={(event) => patch({ seat_capacity: Number(event.target.value) })} /></label>}
        <label><span>Гостей в одной брони, максимум</span><input type="number" required min={1} max={100} value={form.max_guests} onChange={(event) => patch({ max_guests: Number(event.target.value) })} /></label>
        <label><span>Длительность брони</span><DurationSelect value={form.duration_minutes} onChange={(value) => patch({ duration_minutes: value })} /></label>
        <label><span>Шаг времени</span><select value={form.slot_step_minutes} onChange={(event) => patch({ slot_step_minutes: Number(event.target.value) })}><option value={15}>15 минут</option><option value={30}>30 минут</option><option value={60}>1 час</option></select></label>
        <label><span>На сколько дней вперёд</span><input type="number" required min={1} max={365} value={form.advance_days} onChange={(event) => patch({ advance_days: Number(event.target.value) })} /></label>
      </div>
      <div><h3>Время начала брони по дням</h3><p className="muted">Укажите первый и последний возможный старт. В закрытые дни онлайн-бронирование недоступно.</p></div>
      <div className="reservation-schedule">
        {[1, 2, 3, 4, 5, 6, 0].map((dayNumber) => {
          const day = form.schedule.find((item) => item.day_of_week === dayNumber);
          if (!day) return null;
          const updateDay = (changes: Partial<typeof day>) => patch({ schedule: form.schedule.map((item) => item.day_of_week === dayNumber ? { ...item, ...changes } : item) });
          return <div className="reservation-schedule-row" key={dayNumber}>
            <label className="check"><input type="checkbox" checked={day.is_open} onChange={(event) => updateDay({ is_open: event.target.checked })} />{weekdayNames[dayNumber]}</label>
            <label><span>Первый старт</span><input type="time" step={900} required disabled={!day.is_open} value={reservationTime(day.first_start_minute)} onChange={(event) => { if (event.target.value) updateDay({ first_start_minute: parseTime(event.target.value) }); }} /></label>
            <label><span>Последний старт</span><input type="time" step={900} required disabled={!day.is_open} value={reservationTime(day.last_start_minute)} onChange={(event) => { if (event.target.value) updateDay({ last_start_minute: parseTime(event.target.value) }); }} /></label>
          </div>;
        })}
      </div>
      {invalidSchedule && <p className="reservation-editor-error">В открытые дни первый старт должен быть не позже последнего, а бронь должна закончиться до полуночи.</p>}
      {failed && <p className="reservation-editor-error">Настройки не сохранены. Проверьте сообщение об ошибке вверху страницы.</p>}
      <div className="actions"><button className="primary" type="submit" disabled={busy || invalidSchedule}>{busy ? "Сохраняем…" : "Сохранить настройки"}</button></div>
    </form>
    {settings.location.booking_mode === "tables" && <div className="reservation-tables-editor">
      <h3>Столы</h3><p className="muted">Выключенный стол не предлагается для новых броней. Действующие брони сохраняются.</p>
      {tables.map((table) => <TableEditor key={table.id} table={table} onSave={(input) => saveTable(table.id, input)} />)}
      <TableEditor onSave={(input) => saveTable(undefined, input)} />
    </div>}
  </section>;
}

function TableEditor({ table, onSave }: { table?: ReservationTable; onSave(input: ReservationTableInput): Promise<boolean> }) {
  const [input, setInput] = useState<ReservationTableInput>(() => ({ label: table?.label || "", capacity: table?.capacity || 1, active: table?.active ?? true }));
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    const saved = await onSave(input);
    setBusy(false);
    setFailed(!saved);
    if (saved && !table) setInput({ label: "", capacity: 1, active: true });
  }
  return <form className="reservation-table-row" onSubmit={(event) => void save(event)}>
    <label><span>{table ? "Название стола" : "Новый стол"}</span><input required maxLength={80} value={input.label} onChange={(event) => setInput({ ...input, label: event.target.value })} /></label>
    <label><span>Мест</span><input type="number" required min={1} max={100} value={input.capacity} onChange={(event) => setInput({ ...input, capacity: Number(event.target.value) })} /></label>
    <label className="check"><input type="checkbox" checked={input.active} onChange={(event) => setInput({ ...input, active: event.target.checked })} />Доступен</label>
    <button type="submit" disabled={busy}>{table ? "Сохранить стол" : "Добавить стол"}</button>
    {failed && <span className="reservation-editor-error">Не удалось сохранить стол. Проверьте сообщение вверху.</span>}
  </form>;
}
