
export const BUDGET_MONTH_STORAGE_KEY = "@finance-tracker/budget-month";
const MIGRATION_STATE_PREFIX = "@finance-tracker/budget-month-migration-v2:";

export interface BudgetRecordIdentity {
  userId: string;
  documentId: string;
  createdAt: string;
  amount: number;
}

export interface BudgetMonthStorage {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
}

const monthIndex = (monthKey: string): number | null => {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(monthKey);
  return match ? Number(match[1]) * 12 + Number(match[2]) : null;
};

export const isExactlyOneMonthBehind = (storedMonthKey: string, currentMonthKey: string) => {
  const storedIndex = monthIndex(storedMonthKey);
  const currentIndex = monthIndex(currentMonthKey);
  return storedIndex !== null && currentIndex !== null && currentIndex - storedIndex === 1;
};

export const getBudgetMigrationStateKey = ({ userId, documentId, createdAt }: BudgetRecordIdentity) =>
  `${MIGRATION_STATE_PREFIX}${encodeURIComponent(userId)}:${encodeURIComponent(documentId)}:${encodeURIComponent(createdAt)}`;

interface BudgetMigrationState {
  monthKey: string;
  createdAt: string;
}

export const syncBudgetMonth = async (
  budget: BudgetRecordIdentity | null,
  resetBudget: () => Promise<unknown>,
  storage: BudgetMonthStorage,
  currentMonthKey: string,
  getCreatedMonthKey: (createdAt: string) => string
) => {
  const legacyMonthKey = await storage.getItem(BUDGET_MONTH_STORAGE_KEY);

  if (!budget || !Number.isFinite(budget.amount) || budget.amount <= 0) {
    if (legacyMonthKey !== currentMonthKey) {
      await storage.setItem(BUDGET_MONTH_STORAGE_KEY, currentMonthKey);
    }
    return { budgetAmount: budget?.amount ?? null, wasReset: false };
  }

  if (!budget.userId || !budget.documentId || !budget.createdAt) {
    throw new Error("Budget identity is incomplete; refusing to apply a month migration.");
  }

  const stateKey = getBudgetMigrationStateKey(budget);
  const storedStateValue = await storage.getItem(stateKey);
  let storedState: BudgetMigrationState | null = null;
  if (storedStateValue) {
    try {
      const candidate = JSON.parse(storedStateValue) as BudgetMigrationState;
      if (candidate.createdAt === budget.createdAt && monthIndex(candidate.monthKey) !== null) {
        storedState = candidate;
      }
    } catch {
      storedState = null;
    }
  }

  const saveState = async (monthKey: string) => {
    await storage.setItem(stateKey, JSON.stringify({ monthKey, createdAt: budget.createdAt }));
    await storage.setItem(BUDGET_MONTH_STORAGE_KEY, monthKey);
  };

  if (storedState) {
    if (storedState.monthKey === currentMonthKey) {
      await storage.setItem(BUDGET_MONTH_STORAGE_KEY, currentMonthKey);
      return { budgetAmount: budget.amount, wasReset: false };
    }
    if (storedState.monthKey > currentMonthKey) {
      return { budgetAmount: budget.amount, wasReset: false };
    }
    await resetBudget();
    await saveState(currentMonthKey);
    return { budgetAmount: null, wasReset: true };
  }

  const createdMonthKey = getCreatedMonthKey(budget.createdAt);
  const createdMonthIndex = monthIndex(createdMonthKey);
  const currentMonthIndex = monthIndex(currentMonthKey);
  const wasCreatedThisMonth = createdMonthKey === currentMonthKey;

  if (!legacyMonthKey || legacyMonthKey === currentMonthKey || wasCreatedThisMonth) {
    await saveState(currentMonthKey);
    return { budgetAmount: budget.amount, wasReset: false };
  }

  if (legacyMonthKey > currentMonthKey) {
    await saveState(legacyMonthKey);
    return { budgetAmount: budget.amount, wasReset: false };
  }

  if (
    isExactlyOneMonthBehind(legacyMonthKey, currentMonthKey) &&
    createdMonthIndex !== null &&
    currentMonthIndex !== null &&
    createdMonthIndex <= (monthIndex(legacyMonthKey) ?? -1)
  ) {
    await saveState(currentMonthKey);
    return { budgetAmount: budget.amount, wasReset: false };
  }

  await resetBudget();
  await saveState(currentMonthKey);
  return { budgetAmount: null, wasReset: true };
};
