import AsyncStorage from "@react-native-async-storage/async-storage";
import { getCalendarMonthKey } from "./reportDates";
import {
  BUDGET_MONTH_STORAGE_KEY,
  getBudgetMigrationStateKey,
  syncBudgetMonth,
  type BudgetRecordIdentity,
} from "./budgetCycleCore";

export const getCurrentBudgetMonthKey = (date = new Date()) => getCalendarMonthKey(date);

export const markCurrentBudgetMonth = async (budget: BudgetRecordIdentity) => {
  const monthKey = getCurrentBudgetMonthKey();
  await AsyncStorage.setItem(
    getBudgetMigrationStateKey(budget),
    JSON.stringify({ monthKey, createdAt: budget.createdAt })
  );
  await AsyncStorage.setItem(BUDGET_MONTH_STORAGE_KEY, monthKey);
};

export const syncBudgetForCurrentMonth = (
  budget: BudgetRecordIdentity | null,
  resetBudget: () => Promise<unknown>
) => syncBudgetMonth(
  budget,
  resetBudget,
  AsyncStorage,
  getCurrentBudgetMonthKey(),
  (createdAt) => getCurrentBudgetMonthKey(new Date(createdAt))
);
