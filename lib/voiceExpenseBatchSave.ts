import { runBudgetAlertSaveFlow } from "./budgetNotificationSaveFlow";

export interface VoiceExpenseSaveInput {
  documentId: string;
  amount: number;
  category: string;
  date: string;
}

export interface VoiceExpenseBatchItem {
  id: string;
  amount: string;
  category: string;
  date: string;
}

export interface VoiceExpenseBatchResult {
  savedCount: number;
  failedIds: Set<string>;
}

export interface VoiceExpenseBatchSaveOptions<Snapshot> {
  expenses: VoiceExpenseBatchItem[];
  createExpense: (input: VoiceExpenseSaveInput) => Promise<unknown>;
  convertToINR: (amount: number) => number;
  toExpenseTimestamp: (date: string) => string;
  captureBefore: () => Promise<Snapshot | null>;
  evaluateAfter: (snapshot: Snapshot) => Promise<void>;
  onExpenseSaveError?: (error: unknown) => void;
  onExpenseSaved?: (expense: VoiceExpenseBatchItem) => void;
  onNotificationError?: () => void;
}

export const saveVoiceExpenseBatchWithBudgetAlerts = <Snapshot>(
  options: VoiceExpenseBatchSaveOptions<Snapshot>
) => runBudgetAlertSaveFlow<Snapshot, VoiceExpenseBatchResult>({
  captureBefore: options.captureBefore,
  save: async () => {
    let savedCount = 0;
    const failedIds = new Set<string>();

    for (const expense of options.expenses) {
      const { id, amount, category, date } = expense;
      const parsedAmount = Number(amount.trim());
      if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
        failedIds.add(id);
        continue;
      }

      const amountInINR = options.convertToINR(parsedAmount);
      if (!Number.isFinite(amountInINR) || amountInINR <= 0) {
        failedIds.add(id);
        continue;
      }

      try {
        await options.createExpense({
          documentId: id,
          amount: amountInINR,
          category: category.trim(),
          date: options.toExpenseTimestamp(date),
        });
        savedCount++;
        options.onExpenseSaved?.(expense);
      } catch (error) {
        options.onExpenseSaveError?.(error);
        failedIds.add(id);
      }
    }

    return { savedCount, failedIds };
  },
  shouldEvaluate: ({ savedCount }) => savedCount > 0,
  evaluateAfter: options.evaluateAfter,
  onNotificationError: options.onNotificationError,
});
