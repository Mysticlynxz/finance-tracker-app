export interface BudgetAlertSaveFlowOptions<Snapshot, Result> {
  captureBefore: () => Promise<Snapshot | null>;
  save: () => Promise<Result>;
  shouldEvaluate: (result: Result) => boolean;
  evaluateAfter: (snapshot: Snapshot) => Promise<void>;
  onNotificationError?: () => void;
}

export const runBudgetAlertSaveFlow = async <Snapshot, Result>(
  options: BudgetAlertSaveFlowOptions<Snapshot, Result>
) => {
  let snapshot: Snapshot | null = null;
  try {
    snapshot = await options.captureBefore();
  } catch {
    options.onNotificationError?.();
  }

  const result = await options.save();
  const notificationTask = snapshot && options.shouldEvaluate(result)
    ? Promise.resolve()
        .then(() => options.evaluateAfter(snapshot as Snapshot))
        .catch(() => options.onNotificationError?.())
    : Promise.resolve();

  return { result, notificationTask };
};
