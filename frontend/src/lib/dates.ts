// Работа с датами в часовом поясе пользователя (поле timezone профиля), а не браузера:
// «сегодня» и «завтра» на Главной считаются по нему.

/** Дата YYYY-MM-DD момента time в часовом поясе tz. */
export function dayKey(time: Date | string, tz: string): string {
  const date = typeof time === 'string' ? new Date(time) : time;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export const todayKey = (tz: string) => dayKey(new Date(), tz);

function keyToUtc(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** Сдвиг календарной даты YYYY-MM-DD на n дней. */
export function addDays(key: string, n: number): string {
  const date = keyToUtc(key);
  date.setUTCDate(date.getUTCDate() + n);
  return date.toISOString().slice(0, 10);
}

/** Номер дня недели с понедельника: 0 — Пн … 6 — Вс. */
export function weekdayIndex(key: string): number {
  return (keyToUtc(key).getUTCDay() + 6) % 7;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function monthTitle(year: number, month: number): string {
  return new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(year, month - 1, 1)),
  );
}

export function formatTime(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('ru-RU', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(
    new Date(iso),
  );
}

export function formatDayMonth(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('ru-RU', { timeZone: tz, day: 'numeric', month: 'long' }).format(
    new Date(iso),
  );
}

// На сколько часовой пояс tz отличается от UTC в момент ts (мс).
function offsetMs(ts: number, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(new Date(ts));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(ts / 1000) * 1000;
}

/** «Настенное» время YYYY-MM-DDTHH:mm в поясе tz → момент в ISO 8601 (UTC) для API. */
export function zonedToIso(local: string, tz: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) throw new Error(`Неверный формат даты: ${local}`);
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let result = guess - offsetMs(guess, tz);
  // Если между догадкой и результатом сменился сдвиг (переход на летнее время), уточняем.
  const corrected = guess - offsetMs(result, tz);
  if (corrected !== result) result = corrected;
  return new Date(result).toISOString();
}

/** Список часовых поясов для выбора; текущий пояс браузера и выбранный всегда в списке. */
export function timezoneOptions(...extra: string[]): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  const all = new Set(intl.supportedValuesOf?.('timeZone') ?? ['Europe/Moscow', 'UTC']);
  all.add(browserTimezone());
  extra.forEach((tz) => all.add(tz));
  return [...all].sort();
}

export const browserTimezone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Moscow';
