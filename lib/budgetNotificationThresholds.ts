import { normalizeCategoryKey } from "./categoryBudgetCalculations";

export type BudgetAlertThreshold = "80" | "100" | "exceeded";
export type BudgetAlertScope = "overall" | "category";

export interface BudgetAlertEvent {
  scope: BudgetAlertScope;
  categoryKey?: string;
  categoryName?: string;
  threshold: BudgetAlertThreshold;
  spentInINR: number;
  limitInINR: number;
  percentage: number;
}

export interface CategoryBudgetThreshold {
  categoryKey: string;
  category: string;
  amountInINR: number;
}

export interface BudgetThresholdEvaluationInput {
  previousOverallSpendingInINR: number;
  newOverallSpendingInINR: number;
  overallBudgetInINR: number | null;
  previousCategorySpendingInINR: Record<string, number>;
  newCategorySpendingInINR: Record<string, number>;
  categoryBudgets: CategoryBudgetThreshold[];
}

const isValidSpending = (value: number) => Number.isFinite(value) && value >= 0;

const getHighestCrossedThreshold = (
  previousSpendingInINR: number,
  newSpendingInINR: number,
  limitInINR: number
): BudgetAlertThreshold | null => {
  if (
    !isValidSpending(previousSpendingInINR) ||
    !isValidSpending(newSpendingInINR) ||
    !Number.isFinite(limitInINR) ||
    limitInINR <= 0
  ) {
    return null;
  }

  const previousRatio = previousSpendingInINR / limitInINR;
  const newRatio = newSpendingInINR / limitInINR;

  if (previousRatio <= 1 && newRatio > 1) return "exceeded";
  if (previousRatio < 1 && newRatio >= 1) return "100";
  if (previousRatio < 0.8 && newRatio >= 0.8) return "80";
  return null;
};

const getNormalizedSpending = (values: Record<string, number>, key: string) => {
  const normalizedKey = normalizeCategoryKey(key);
  if (!normalizedKey) return 0;

  let total = 0;
  for (const [candidate, amount] of Object.entries(values)) {
    if (normalizeCategoryKey(candidate) === normalizedKey && isValidSpending(amount)) {
      total += amount;
    }
  }
  return total;
};

export const evaluateBudgetThresholds = (
  input: BudgetThresholdEvaluationInput
): BudgetAlertEvent[] => {
  const events: BudgetAlertEvent[] = [];
  const overallThreshold = input.overallBudgetInINR == null
    ? null
    : getHighestCrossedThreshold(
        input.previousOverallSpendingInINR,
        input.newOverallSpendingInINR,
        input.overallBudgetInINR
      );

  if (overallThreshold && input.overallBudgetInINR) {
    events.push({
      scope: "overall",
      threshold: overallThreshold,
      spentInINR: input.newOverallSpendingInINR,
      limitInINR: input.overallBudgetInINR,
      percentage: (input.newOverallSpendingInINR / input.overallBudgetInINR) * 100,
    });
  }

  const seenCategoryKeys = new Set<string>();
  for (const budget of input.categoryBudgets) {
    const categoryKey = normalizeCategoryKey(budget.categoryKey || budget.category);
    if (
      !categoryKey ||
      seenCategoryKeys.has(categoryKey) ||
      !Number.isFinite(budget.amountInINR) ||
      budget.amountInINR <= 0
    ) {
      continue;
    }
    seenCategoryKeys.add(categoryKey);

    const previousSpending = getNormalizedSpending(input.previousCategorySpendingInINR, categoryKey);
    const newSpending = getNormalizedSpending(input.newCategorySpendingInINR, categoryKey);
    const threshold = getHighestCrossedThreshold(previousSpending, newSpending, budget.amountInINR);
    if (!threshold) continue;

    events.push({
      scope: "category",
      categoryKey,
      categoryName: budget.category,
      threshold,
      spentInINR: newSpending,
      limitInINR: budget.amountInINR,
      percentage: (newSpending / budget.amountInINR) * 100,
    });
  }

  return events;
};
