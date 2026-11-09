import type { BudgetAlertEvent } from "./budgetNotificationThresholds";

export interface BudgetAlertNotificationContent {
  title: string;
  body: string;
}

const getThresholdLabel = (threshold: BudgetAlertEvent["threshold"]) => {
  if (threshold === "80") return "Approaching budget";
  if (threshold === "100") return "Budget reached";
  return "Budget exceeded";
};

export const buildBudgetAlertNotificationContent = (
  event: BudgetAlertEvent,
  formatAmount: (amountInINR: number) => string
): BudgetAlertNotificationContent => {
  const categoryLabel = event.scope === "category" ? `${event.categoryName ?? "Category"} · ` : "";
  const title = `${categoryLabel}${getThresholdLabel(event.threshold)}`;
  const scopeLabel = event.scope === "overall" ? "monthly budget" : `${event.categoryName ?? "category"} limit`;
  const body = event.threshold === "exceeded"
    ? `Spent ${formatAmount(event.spentInINR)} against ${formatAmount(event.limitInINR)} (${Math.round(event.percentage)}%).`
    : `Used ${Math.round(event.percentage)}% of your ${scopeLabel}: ${formatAmount(event.spentInINR)} of ${formatAmount(event.limitInINR)}.`;

  return { title, body };
};
