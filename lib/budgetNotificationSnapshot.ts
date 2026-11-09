import { normalizeCategoryKey } from "./categoryBudgetCalculations";
import {
  aggregateSpendingForMonth,
  getCalendarMonthKey,
  getCurrentMonthDateKeys,
  sumAmountsCompensated,
} from "./reportDates";
import { runAuthSessionBoundRead } from "./budgetNotificationSessionEvaluation";
import type { AuthSessionBoundaryChecks, ExpenseDocument, UserBudgetRecord } from "./appwrite";
import type { AuthSessionIdentity } from "./authSessionGuard";

export interface BudgetAlertSnapshot {
  session: AuthSessionIdentity;
  monthId: string;
  overallSpendingInINR: number;
  overallBudgetInINR: number | null;
  categorySpendingInINR: Record<string, number>;
  categoryBudgets: { categoryKey: string; category: string; amountInINR: number }[];
}

export interface BudgetAlertSnapshotDependencies {
  captureSessionIdentity: () => Promise<AuthSessionIdentity | null>;
  isSessionIdentityCurrent: (identity: AuthSessionIdentity) => Promise<boolean>;
  isSessionGenerationCurrent: (identity: AuthSessionIdentity) => boolean;
  getPreference: (userId: string) => Promise<boolean>;
  hasPermission: () => Promise<boolean>;
  getExpenses: (userId: string, checks: AuthSessionBoundaryChecks) => Promise<ExpenseDocument[]>;
  getBudget: (userId: string, checks: AuthSessionBoundaryChecks) => Promise<UserBudgetRecord | null>;
  clearBudget: (userId: string, checks: AuthSessionBoundaryChecks) => Promise<unknown>;
  syncBudget: (budget: UserBudgetRecord | null, resetBudget: () => Promise<unknown>) => Promise<{ budgetAmount: number | null; wasReset: boolean }>;
  carryForwardCategories: (monthId: string) => Promise<unknown>;
  listCategoryBudgets: () => Promise<{ budgets: Array<{
    monthId: string;
    deletedAt: string | null;
    categoryKey: string;
    category: string;
    amountInINR: number;
  }> }>;
  now: () => Date;
  logFailure: (stage: string) => void;
}

const getExpenseAmount = (expense: ExpenseDocument) => {
  const amount = Number(expense.amount);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
};

const summarizeExpenses = (expenses: ExpenseDocument[], now: Date) => {
  const monthly = aggregateSpendingForMonth(expenses, getExpenseAmount, getCurrentMonthDateKeys(now));
  const categoryAmounts = new Map<string, number[]>();
  for (const expense of monthly.items) {
    const key = normalizeCategoryKey(expense.category) || "uncategorized";
    const list = categoryAmounts.get(key) ?? [];
    list.push(getExpenseAmount(expense));
    categoryAmounts.set(key, list);
  }

  return {
    overallSpendingInINR: monthly.total,
    categorySpendingInINR: Object.fromEntries(
      [...categoryAmounts].map(([key, values]) => [key, sumAmountsCompensated(values)])
    ),
  };
};

export const captureBudgetAlertSnapshot = async (
  dependencies: BudgetAlertSnapshotDependencies
): Promise<BudgetAlertSnapshot | null> => {
  const session = await dependencies.captureSessionIdentity();
  if (!session) return null;
  const isCurrent = async () => {
    if (!dependencies.isSessionGenerationCurrent(session)) return false;
    const current = await dependencies.isSessionIdentityCurrent(session);
    return current && dependencies.isSessionGenerationCurrent(session);
  };
  const checks: AuthSessionBoundaryChecks = {
    isCurrent,
    isGenerationCurrent: () => dependencies.isSessionGenerationCurrent(session),
  };

  const preference = await runAuthSessionBoundRead(isCurrent, () =>
    dependencies.getPreference(session.userId)
  );
  if (!preference.current || !preference.value) return null;

  const permission = await runAuthSessionBoundRead(isCurrent, dependencies.hasPermission);
  if (!permission.current || !permission.value) return null;

  const now = dependencies.now();
  const monthId = getCalendarMonthKey(now);
  const expensesResult = await runAuthSessionBoundRead(isCurrent, () =>
    dependencies.getExpenses(session.userId, checks)
  );
  if (!expensesResult.current) return null;

  let overallBudgetInINR: number | null = null;
  try {
    const budgetRecord = await runAuthSessionBoundRead(isCurrent, () =>
      dependencies.getBudget(session.userId, checks)
    );
    if (!budgetRecord.current) return null;

    const synchronized = await runAuthSessionBoundRead(isCurrent, () =>
      dependencies.syncBudget(
        budgetRecord.value,
        () => dependencies.clearBudget(session.userId, checks)
      )
    );
    if (!synchronized.current) return null;
    overallBudgetInINR = synchronized.value.budgetAmount ?? null;
  } catch {
    if (!(await isCurrent())) return null;
    dependencies.logFailure("Overall budget retrieval");
  }

  let activeCategoryBudgets: BudgetAlertSnapshot["categoryBudgets"] = [];
  try {
    const carryForward = await runAuthSessionBoundRead(isCurrent, () =>
      dependencies.carryForwardCategories(monthId)
    );
    if (!carryForward.current) return null;
    const listedBudgets = await runAuthSessionBoundRead(isCurrent, dependencies.listCategoryBudgets);
    if (!listedBudgets.current) return null;
    activeCategoryBudgets = listedBudgets.value.budgets
      .filter((budget) => budget.monthId === monthId && !budget.deletedAt)
      .map(({ categoryKey, category, amountInINR }) => ({ categoryKey, category, amountInINR }));
  } catch {
    if (!(await isCurrent())) return null;
    dependencies.logFailure("Category budget retrieval");
  }

  if (!(await isCurrent())) return null;
  return {
    session,
    monthId,
    ...summarizeExpenses(expensesResult.value, now),
    overallBudgetInINR,
    categoryBudgets: activeCategoryBudgets,
  };
};
