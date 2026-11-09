export interface SessionEvaluationDependencies<Data, Event> {
  isSessionCurrent: () => Promise<boolean>;
  loadPreference: () => Promise<boolean>;
  checkPermission: () => Promise<boolean>;
  fetchCurrentData: () => Promise<Data>;
  buildEvents: (data: Data) => Event[];
  deliverEvents: (events: Event[], isSessionCurrent: () => Promise<boolean>) => Promise<void>;
}

export const runSessionBoundBudgetNotificationEvaluation = async <Data, Event>(
  dependencies: SessionEvaluationDependencies<Data, Event>
): Promise<boolean> => {
  const runStage = async <Value>(operation: () => Promise<Value>) => {
    if (!(await dependencies.isSessionCurrent())) return { current: false as const };
    const value = await operation();
    if (!(await dependencies.isSessionCurrent())) return { current: false as const };
    return { current: true as const, value };
  };

  const preference = await runStage(dependencies.loadPreference);
  if (!preference.current || !preference.value) return false;

  const permission = await runStage(dependencies.checkPermission);
  if (!permission.current || !permission.value) return false;

  const data = await runStage(dependencies.fetchCurrentData);
  if (!data.current) return false;

  const events = dependencies.buildEvents(data.value);
  if (events.length === 0 || !(await dependencies.isSessionCurrent())) return false;

  await dependencies.deliverEvents(events, dependencies.isSessionCurrent);
  return dependencies.isSessionCurrent();
};

export const runAuthSessionBoundRead = async <Value>(
  isSessionCurrent: () => Promise<boolean>,
  operation: () => Promise<Value>
): Promise<{ current: true; value: Value } | { current: false }> => {
  if (!(await isSessionCurrent())) return { current: false };
  const value = await operation();
  if (!(await isSessionCurrent())) return { current: false };
  return { current: true, value };
};
