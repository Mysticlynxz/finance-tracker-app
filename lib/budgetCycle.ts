import AsyncStorage from "@react-native-async-storage/async-storage";

const BUDGET_MONTH_STORAGE_KEY = "@finance-tracker/budget-month";

export const getCurrentBudgetMonthKey = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

export const markCurrentBudgetMonth = async () => {
  await AsyncStorage.setItem(BUDGET_MONTH_STORAGE_KEY, getCurrentBudgetMonthKey());
};

export const syncBudgetForCurrentMonth = async (
  budgetAmountInINR: number | null,
  resetBudget: () => Promise<unknown>
) => {
  const currentMonthKey = getCurrentBudgetMonthKey();
  const storedMonthKey = await AsyncStorage.getItem(BUDGET_MONTH_STORAGE_KEY);

  if (!budgetAmountInINR || budgetAmountInINR <= 0) {
    if (storedMonthKey && storedMonthKey !== currentMonthKey) {
      await markCurrentBudgetMonth();
    }

    return {
      budgetAmount: budgetAmountInINR ?? null,
      wasReset: false,
    };
  }

  if (!storedMonthKey) {
    await markCurrentBudgetMonth();
    return {
      budgetAmount: budgetAmountInINR,
      wasReset: false,
    };
  }

  if (storedMonthKey !== currentMonthKey) {
    await resetBudget();
    await markCurrentBudgetMonth();

    return {
      budgetAmount: null,
      wasReset: true,
    };
  }

  return {
    budgetAmount: budgetAmountInINR,
    wasReset: false,
  };
};
