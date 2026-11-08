import { functions } from "./appwrite";
import { executeCategoryBudgetRequest, type FunctionResponse } from "./categoryBudgetExecution";

export const CATEGORY_BUDGETS_FUNCTION_ID =
  process.env.EXPO_PUBLIC_CATEGORY_BUDGETS_FUNCTION_ID?.trim() || "category-budgets";

export interface CategoryBudget {
  $id: string;
  userId: string;
  category: string;
  categoryKey: string;
  amountInINR: number;
  monthId: string;
  deletedAt: string | null;
}

const execute = (payload: Record<string, unknown>) => executeCategoryBudgetRequest(functions, CATEGORY_BUDGETS_FUNCTION_ID, payload);

export const listCategoryBudgets = async () => {
  const response = await execute({ action: "list" }) as FunctionResponse & { monthId?: string; budgets?: CategoryBudget[] };
  return { monthId: response.monthId ?? "", budgets: response.budgets ?? [] };
};

export const createCategoryBudget = async (category: string, amountInINR: number, monthId: string) => {
  if (!Number.isFinite(amountInINR) || amountInINR <= 0) throw new RangeError("Enter a finite amount greater than zero.");
  const response = await execute({ action: "create", category, amountInINR, monthId }) as FunctionResponse & { budget?: CategoryBudget };
  if (!response.budget) throw new Error("Category budget was not returned by the service.");
  return response.budget;
};

export const updateCategoryBudget = async (rowId: string, amountInINR: number, category?: string) => {
  if (!Number.isFinite(amountInINR) || amountInINR <= 0) throw new RangeError("Enter a finite amount greater than zero.");
  const response = await execute({ action: "update", rowId, amountInINR, ...(category ? { category } : {}) }) as FunctionResponse & { budget?: CategoryBudget };
  if (!response.budget) throw new Error("Category budget was not returned by the service.");
  return response.budget;
};

export const deleteCategoryBudget = async (rowId: string) => {
  await execute({ action: "delete", rowId });
};

export const carryForwardCategoryBudgets = async (monthId: string) =>
  execute({ action: "carry-forward", monthId });
