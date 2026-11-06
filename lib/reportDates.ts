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

export const getMonthToDateDateKeys = (now = new Date()): string[] => {
  const todayKey = getCalendarDateKey(now);
  if (!todayKey) return [];
  const day = Number(todayKey.slice(-2));
  const monthKeys = getCurrentMonthDateKeys(now);
  return monthKeys.slice(0, day);
};

export const getPreviousMonthToDateDateKeys = (now = new Date()): string[] => {
  const currentDateKey = getCalendarDateKey(now);
  if (!currentDateKey) return [];
  const [year, month, day] = currentDateKey.split("-").map(Number);
  const previousMonthDate = new Date(Date.UTC(year, month - 2, 1));
  const previousYear = previousMonthDate.getUTCFullYear();
  const previousMonth = previousMonthDate.getUTCMonth() + 1;
  const previousLastDay = new Date(Date.UTC(previousYear, previousMonth, 0)).getUTCDate();
  const elapsedDays = Math.min(day, previousLastDay);
  return Array.from({ length: elapsedDays }, (_, index) =>
    `${previousYear}-${String(previousMonth).padStart(2, "0")}-${String(index + 1).padStart(2, "0")}`
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

export const sumAmountsCompensated = (amounts: number[]): number => {
  let sum = 0;
  let correction = 0;

  for (const amount of amounts) {
    const next = sum + amount;
    correction += Math.abs(sum) >= Math.abs(amount)
      ? (sum - next) + amount
      : (amount - next) + sum;
    sum = next;
  }

  return sum + correction;
};

export interface CategorySpending {
  name: string;
  amount: number;
  percentage: number;
}

export const compareSpendingTotals = (currentAmount: number, previousAmount: number) => {
  const difference = currentAmount - previousAmount;
  return {
    difference,
    percentChange: previousAmount > 0 ? (difference / previousAmount) * 100 : null,
    direction: difference > 0 ? "increased" as const : difference < 0 ? "decreased" as const : "unchanged" as const,
  };
};

export const aggregateCategorySpending = <T extends { category: string }>(
  items: T[],
  getAmount: (item: T) => number
): CategorySpending[] => {
  const groups = new Map<string, { name: string; sum: number; correction: number }>();
  items.forEach((item) => {
    const trimmedName = typeof item.category === "string" ? item.category.trim() : "";
    const name = trimmedName || "Uncategorized";
    const key = name.toLocaleLowerCase();
    const amount = getAmount(item);
    if (!Number.isFinite(amount)) return;
    const group = groups.get(key);
    if (group) {
      const next = group.sum + amount;
      group.correction += Math.abs(group.sum) >= Math.abs(amount)
        ? (group.sum - next) + amount
        : (amount - next) + group.sum;
      group.sum = next;
    } else groups.set(key, { name, sum: amount, correction: 0 });
  });

  const finalizedGroups = Array.from(groups.values()).map(({ name, sum, correction }) => ({
    name,
    amount: sum + correction,
  }));
  const total = sumAmountsCompensated(finalizedGroups.map(({ amount }) => amount));
  return finalizedGroups
    .map(({ name, amount }) => ({
      name,
      amount,
      percentage: total > 0 ? (amount / total) * 100 : 0,
    }))
    .sort((left, right) => right.amount - left.amount);
};
