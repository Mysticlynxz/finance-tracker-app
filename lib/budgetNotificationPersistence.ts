import AsyncStorage from "@react-native-async-storage/async-storage";

export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

const getUserPrefix = (userId: string) =>
  `@spendwise/budget-alerts/${encodeURIComponent(userId)}`;

export const getBudgetAlertPreferenceStorageKey = (userId: string) =>
  `${getUserPrefix(userId)}/enabled`;

export const getBudgetAlertDeduplicationStorageKey = (userId: string, monthId: string) =>
  `${getUserPrefix(userId)}/delivered/${monthId}`;

export const createBudgetNotificationPersistence = (storage: KeyValueStorage) => {
  const userQueues = new Map<string, Promise<void>>();
  const volatileDelivered = new Map<string, Set<string>>();

  const runExclusive = async <T>(userId: string, action: () => Promise<T>): Promise<T> => {
    const previous = userQueues.get(userId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.catch(() => undefined).then(() => current);
    userQueues.set(userId, queued);

    await previous.catch(() => undefined);
    try {
      return await action();
    } finally {
      release();
      if (userQueues.get(userId) === queued) userQueues.delete(userId);
    }
  };

  const readDelivered = async (userId: string, monthId: string): Promise<Set<string>> => {
    const storageKey = getBudgetAlertDeduplicationStorageKey(userId, monthId);
    const delivered = new Set(volatileDelivered.get(storageKey) ?? []);
    const value = await storage.getItem(storageKey);
    if (!value) return delivered;
    try {
      const parsed: unknown = JSON.parse(value);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (typeof item === "string") delivered.add(item);
        }
      }
      return delivered;
    } catch {
      return delivered;
    }
  };

  return {
    getEnabled: async (userId: string) =>
      (await storage.getItem(getBudgetAlertPreferenceStorageKey(userId))) === "true",
    setEnabled: async (userId: string, enabled: boolean) => {
      await runExclusive(userId, () =>
        storage.setItem(getBudgetAlertPreferenceStorageKey(userId), String(enabled))
      );
    },
    hasDelivered: async (userId: string, monthId: string, eventKey: string) =>
      (await readDelivered(userId, monthId)).has(eventKey),
    markDelivered: async (
      userId: string,
      monthId: string,
      eventKey: string,
      checks?: { isSessionCurrent?: () => Promise<boolean>; isGenerationCurrent?: () => boolean }
    ): Promise<boolean> => {
      const delivered = await readDelivered(userId, monthId);
      if (delivered.has(eventKey)) return true;
      const isCurrent = async () => {
        if (checks?.isGenerationCurrent && !checks.isGenerationCurrent()) return false;
        if (checks?.isSessionCurrent && !(await checks.isSessionCurrent())) return false;
        return !checks?.isGenerationCurrent || checks.isGenerationCurrent();
      };
      if (!(await isCurrent())) return false;
      delivered.add(eventKey);
      const storageKey = getBudgetAlertDeduplicationStorageKey(userId, monthId);
      volatileDelivered.set(storageKey, delivered);
      await storage.setItem(storageKey, JSON.stringify([...delivered]));
      if (await isCurrent()) return true;

      delivered.delete(eventKey);
      if (delivered.size === 0) volatileDelivered.delete(storageKey);
      else volatileDelivered.set(storageKey, delivered);
      try {
        await storage.setItem(storageKey, JSON.stringify([...delivered]));
      } catch {
        // The rollback is best effort; the event remains isolated under the original user's key.
      }
      return false;
    },
    runExclusive,
  };
};

export const budgetNotificationPersistence = createBudgetNotificationPersistence(AsyncStorage);

export const getBudgetAlertEventKey = (event: {
  scope: "overall" | "category";
  categoryKey?: string;
  threshold: string;
}) => `${event.scope}:${event.scope === "category" ? encodeURIComponent(event.categoryKey ?? "") : "overall"}:${event.threshold}`;
