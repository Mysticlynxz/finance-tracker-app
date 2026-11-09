import {
  captureAuthSessionIdentity,
  clearBudgetForUser,
  getBudgetRecordForUser,
  getExpensesForUser,
  isAuthSessionGenerationCurrent,
  isAuthSessionIdentityCurrent,
  type AuthSessionBoundaryChecks,
  type ExpenseDocument,
} from "./appwrite";
import { carryForwardCategoryBudgets, listCategoryBudgets } from "./categoryBudgets";
import { normalizeCategoryKey } from "./categoryBudgetCalculations";
import { syncBudgetForCurrentMonth } from "./budgetCycle";
import {
  aggregateSpendingForMonth,
  getCalendarMonthKey,
  getCurrentMonthDateKeys,
  sumAmountsCompensated,
} from "./reportDates";
import { budgetNotificationPersistence } from "./budgetNotificationPersistence";
import { deliverBudgetAlertEvents } from "./budgetNotificationDelivery";
import { hasBudgetAlertPermission } from "./budgetNotificationPermissions";
import { scheduleBudgetAlert, cancelScheduledBudgetAlert } from "./budgetNotificationScheduler";
import { evaluateBudgetThresholds } from "./budgetNotificationThresholds";
import { runSessionBoundBudgetNotificationEvaluation } from "./budgetNotificationSessionEvaluation";
import { captureBudgetAlertSnapshot as captureBudgetAlertSnapshotCore } from "./budgetNotificationSnapshot";
import type { BudgetAlertSnapshot, BudgetAlertSnapshotDependencies } from "./budgetNotificationSnapshot";
import type { AuthSessionIdentity } from "./authSessionGuard";

export type { BudgetAlertSnapshot } from "./budgetNotificationSnapshot";

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

const logNotificationFailure = (stage: string) => {
  console.warn(`[BudgetAlerts] ${stage} failed; the expense save was not affected.`);
};

const makeSessionChecks = (identity: AuthSessionIdentity) => ({
  isCurrent: () => isAuthSessionIdentityCurrent(identity),
  isGenerationCurrent: () => isAuthSessionGenerationCurrent(identity),
});

const snapshotDependencies: BudgetAlertSnapshotDependencies = {
  captureSessionIdentity: captureAuthSessionIdentity,
  isSessionIdentityCurrent: isAuthSessionIdentityCurrent,
  isSessionGenerationCurrent: isAuthSessionGenerationCurrent,
  getPreference: (userId) => budgetNotificationPersistence.getEnabled(userId),
  hasPermission: hasBudgetAlertPermission,
  getExpenses: getExpensesForUser,
  getBudget: getBudgetRecordForUser,
  clearBudget: clearBudgetForUser,
  syncBudget: syncBudgetForCurrentMonth,
  carryForwardCategories: carryForwardCategoryBudgets,
  listCategoryBudgets,
  now: () => new Date(),
  logFailure: logNotificationFailure,
};

export const captureBudgetAlertSnapshot = () => captureBudgetAlertSnapshotCore(snapshotDependencies);

const isCurrentSession = async (identity: AuthSessionIdentity) => {
  if (!isAuthSessionGenerationCurrent(identity)) return false;
  const current = await isAuthSessionIdentityCurrent(identity);
  return current && isAuthSessionGenerationCurrent(identity);
};

export const evaluateBudgetAlertsAfterSave = async (
  before: BudgetAlertSnapshot,
  formatAmount: (amountInINR: number) => string
) => {
  const session = before.session;
  const isCurrent = () => isCurrentSession(session);
  const checks: AuthSessionBoundaryChecks = makeSessionChecks(session);
  const now = new Date();
  const monthId = getCalendarMonthKey(now);
  if (monthId !== before.monthId || !(await isCurrent())) return;

  try {
    await runSessionBoundBudgetNotificationEvaluation({
      isSessionCurrent: isCurrent,
      loadPreference: () => budgetNotificationPersistence.getEnabled(session.userId),
      checkPermission: hasBudgetAlertPermission,
      fetchCurrentData: async () => {
        const expenses = await getExpensesForUser(session.userId, checks);
        if (!(await isCurrent())) throw new Error("Authentication session changed.");
        return summarizeExpenses(expenses, now);
      },
      buildEvents: (after) => evaluateBudgetThresholds({
        previousOverallSpendingInINR: before.overallSpendingInINR,
        newOverallSpendingInINR: after.overallSpendingInINR,
        overallBudgetInINR: before.overallBudgetInINR,
        previousCategorySpendingInINR: before.categorySpendingInINR,
        newCategorySpendingInINR: after.categorySpendingInINR,
        categoryBudgets: before.categoryBudgets,
      }),
      deliverEvents: async (events, isSessionCurrent) => {
        await deliverBudgetAlertEvents(
          budgetNotificationPersistence,
          session.userId,
          monthId,
          events,
          async (event) => {
            if (!(await isSessionCurrent()) || !isAuthSessionGenerationCurrent(session)) {
              throw new Error("Authentication session changed before notification scheduling.");
            }
            return scheduleBudgetAlert(event, formatAmount);
          },
          (stage) => logNotificationFailure(stage === "scheduling" ? "Scheduling" : "Deduplication persistence"),
          async () => {
            if (!(await isSessionCurrent()) || !isAuthSessionGenerationCurrent(session)) return false;
            const enabled = await budgetNotificationPersistence.getEnabled(session.userId);
            if (!(await isSessionCurrent()) || !isAuthSessionGenerationCurrent(session) || !enabled) return false;
            const permitted = await hasBudgetAlertPermission();
            return permitted && await isSessionCurrent() && isAuthSessionGenerationCurrent(session);
          },
          {
            isSessionCurrent,
            isGenerationCurrent: () => isAuthSessionGenerationCurrent(session),
            cancelScheduled: cancelScheduledBudgetAlert,
          }
        );
      },
    });
  } catch {
    logNotificationFailure("Evaluation");
  }
};
