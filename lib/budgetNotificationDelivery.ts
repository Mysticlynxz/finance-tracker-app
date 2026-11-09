import { getBudgetAlertEventKey } from "./budgetNotificationPersistence";
import type { BudgetAlertEvent } from "./budgetNotificationThresholds";

export interface BudgetNotificationDeliveryStore {
  runExclusive: <T>(userId: string, action: () => Promise<T>) => Promise<T>;
  hasDelivered: (userId: string, monthId: string, eventKey: string) => Promise<boolean>;
  markDelivered: (
    userId: string,
    monthId: string,
    eventKey: string,
    checks?: { isSessionCurrent?: () => Promise<boolean>; isGenerationCurrent?: () => boolean }
  ) => Promise<boolean | void>;
}

export interface BudgetNotificationSessionChecks {
  isSessionCurrent: () => Promise<boolean>;
  isGenerationCurrent: () => boolean;
  cancelScheduled: (notificationId: string) => Promise<void>;
}

export const deliverBudgetAlertEvents = async (
  store: BudgetNotificationDeliveryStore,
  userId: string,
  monthId: string,
  events: BudgetAlertEvent[],
  schedule: (event: BudgetAlertEvent) => Promise<unknown>,
  onFailure: (stage: "scheduling" | "persistence") => void,
  canDeliver?: () => Promise<boolean>,
  sessionChecks?: BudgetNotificationSessionChecks
) => {
  await store.runExclusive(userId, async () => {
    const isCurrent = async () => {
      if (sessionChecks && !sessionChecks.isGenerationCurrent()) return false;
      if (sessionChecks && !(await sessionChecks.isSessionCurrent())) return false;
      return !sessionChecks || sessionChecks.isGenerationCurrent();
    };
    if (!(await isCurrent())) return;
    if (canDeliver && !(await canDeliver())) return;
    if (!(await isCurrent())) return;
    for (const event of events) {
      if (!(await isCurrent())) return;
      const eventKey = getBudgetAlertEventKey(event);
      const alreadyDelivered = await store.hasDelivered(userId, monthId, eventKey);
      if (!(await isCurrent())) return;
      if (alreadyDelivered) continue;

      if (canDeliver && !(await canDeliver())) return;
      if (!(await isCurrent())) return;
      let notificationId: string | null = null;
      try {
        const scheduled = await schedule(event);
        notificationId = typeof scheduled === "string" ? scheduled : null;
      } catch {
        onFailure("scheduling");
        continue;
      }

      if (!(await isCurrent())) {
        if (notificationId && sessionChecks) await sessionChecks.cancelScheduled(notificationId);
        return;
      }

      try {
        const marked = await store.markDelivered(userId, monthId, eventKey, sessionChecks && {
          isSessionCurrent: sessionChecks.isSessionCurrent,
          isGenerationCurrent: sessionChecks.isGenerationCurrent,
        });
        if (marked === false && notificationId && sessionChecks) {
          await sessionChecks.cancelScheduled(notificationId);
          return;
        }
      } catch {
        onFailure("persistence");
      }
    }
  });
};
