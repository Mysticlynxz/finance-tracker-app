export const APP_CALENDAR_TIME_ZONE = "Asia/Kolkata";

const getZonedDateParts = (date: Date) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: APP_CALENDAR_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  return Object.fromEntries(parts.map(({ type, value }) => [type, value]));
};

export const getCalendarDateKey = (value: string | Date): string | null => {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day
      ? value
      : null;
  }

  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  const parts = getZonedDateParts(parsed);
  return `${parts.year}-${parts.month}-${parts.day}`;
};

export const getCalendarMonthKey = (date = new Date()): string => {
  const parts = getZonedDateParts(date);
  return `${parts.year}-${parts.month}`;
};

export const isBudgetMonthAhead = (storedMonthKey: string, currentMonthKey: string) =>
  /^\d{4}-(0[1-9]|1[0-2])$/.test(storedMonthKey) && storedMonthKey > currentMonthKey;

export const getCurrentMonthDateKeys = (now = new Date()): string[] => {
  const parts = getZonedDateParts(now);
  const [year, month] = getCalendarMonthKey(now).split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from({ length: lastDay }, (_, index) =>
    `${parts.year}-${parts.month}-${String(index + 1).padStart(2, "0")}`
  );
};

export const filterItemsForMonth = <T extends { date: string }>(
  items: T[],
  monthDateKeys: string[]
): T[] => {
  const firstDate = monthDateKeys[0];
  const lastDate = monthDateKeys[monthDateKeys.length - 1];
  if (!firstDate || !lastDate) return [];

  return items.filter((item) => {
    const key = getCalendarDateKey(item.date);
    return key !== null && key >= firstDate && key <= lastDate;
  });
};

export const aggregateDailyAmounts = <T extends { date: string }>(
  items: T[],
  getAmount: (item: T) => number
): { x: string; y: number }[] => {
  const totals: Record<string, number> = {};
  items.forEach((item) => {
    const key = getCalendarDateKey(item.date);
    if (key === null) return;
    const amount = getAmount(item);
    if (!Number.isFinite(amount)) return;
    totals[key] = (totals[key] ?? 0) + amount;
  });
  return Object.entries(totals)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([x, y]) => ({ x, y: Math.round(y * 100) / 100 }));
};
