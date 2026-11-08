export interface CategoryBudgetProgress {
  hasLimit: boolean;
  remainingInINR: number | null;
  usagePercent: number | null;
  progress: number | null;
  isOverLimit: boolean;
}

export const normalizeCategoryKey = (value: unknown) =>
  (typeof value === "string" ? value.normalize("NFKC").trim() : "").toLocaleLowerCase("en-US");

export interface CategorySpendItem {
  key: string;
  name: string;
  amountInINR: number;
}

export interface CategoryPickerOption {
  name: string;
  icon: string;
  source: "built-in" | "custom";
}

export const buildAvailableCategoryOptions = <T extends { name: string; icon: string }>(
  builtInCategories: T[],
  customCategories: T[],
  activeLimitKeys: string[]
): CategoryPickerOption[] => {
  const seen = new Set(activeLimitKeys.map(normalizeCategoryKey));
  const result: CategoryPickerOption[] = [];

  for (const [source, categories] of [["built-in", builtInCategories], ["custom", customCategories]] as const) {
    const ordered = source === "custom"
      ? [...categories].sort((left, right) => left.name.localeCompare(right.name))
      : categories;
    for (const category of ordered) {
      const key = normalizeCategoryKey(category.name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      result.push({ name: category.name.trim(), icon: category.icon, source });
    }
  }

  return result;
};

export const aggregateCategoryBudgetSpending = <T>(
  items: T[],
  getCategory: (item: T) => unknown,
  getAmount: (item: T) => number
): CategorySpendItem[] => {
  const grouped = new Map<string, CategorySpendItem>();
  for (const item of items) {
    const category = getCategory(item);
    const rawCategory = typeof category === "string" ? category.trim() : "";
    const name = rawCategory || "Uncategorized";
    const key = normalizeCategoryKey(name) || "uncategorized";
    const amount = getAmount(item);
    if (!Number.isFinite(amount) || amount < 0) continue;
    const current = grouped.get(key);
    if (current) current.amountInINR += amount;
    else grouped.set(key, { key, name, amountInINR: amount });
  }
  return [...grouped.values()];
};

export const calculateCategoryBudgetProgress = (spentInINR: number, limitInINR?: number | null): CategoryBudgetProgress => {
  if (!Number.isFinite(spentInINR) || spentInINR < 0) throw new RangeError("Category spending must be finite and non-negative.");
  if (limitInINR == null) return { hasLimit: false, remainingInINR: null, usagePercent: null, progress: null, isOverLimit: false };
  if (!Number.isFinite(limitInINR) || limitInINR <= 0) throw new RangeError("Category limit must be finite and positive.");
  const usage = spentInINR / limitInINR;
  return {
    hasLimit: true,
    remainingInINR: Math.max(0, limitInINR - spentInINR),
    usagePercent: usage * 100,
    progress: Math.min(usage, 1),
    isOverLimit: spentInINR > limitInINR,
  };
};

export const categoryLimitsExceedOverallBudget = (categoryLimitsInINR: number[], overallBudgetInINR: number) =>
  Number.isFinite(overallBudgetInINR) && overallBudgetInINR > 0 &&
  categoryLimitsInINR.every((limit) => Number.isFinite(limit) && limit >= 0) &&
  categoryLimitsInINR.reduce((sum, limit) => sum + limit, 0) > overallBudgetInINR;
