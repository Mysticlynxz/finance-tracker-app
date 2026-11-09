import { runBudgetAlertSaveFlow } from "./budgetNotificationSaveFlow";

export interface ManualExpenseSaveWithAlertsOptions<Snapshot, Input, Result> {
  input: Input;
  createExpense: (input: Input) => Promise<Result>;
  captureBefore: () => Promise<Snapshot | null>;
  evaluateAfter: (snapshot: Snapshot) => Promise<void>;
  onNotificationError?: () => void;
}

export const saveManualExpenseWithBudgetAlerts = <Snapshot, Input, Result>(
  options: ManualExpenseSaveWithAlertsOptions<Snapshot, Input, Result>
) => runBudgetAlertSaveFlow({
  captureBefore: options.captureBefore,
  save: () => options.createExpense(options.input),
  shouldEvaluate: () => true,
  evaluateAfter: options.evaluateAfter,
  onNotificationError: options.onNotificationError,
});
