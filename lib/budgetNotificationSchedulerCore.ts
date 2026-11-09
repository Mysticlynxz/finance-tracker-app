import type * as Notifications from "expo-notifications";
import { buildBudgetAlertNotificationContent } from "./budgetNotificationContent";
import type { BudgetAlertEvent } from "./budgetNotificationThresholds";

type NotificationApi = Pick<
  typeof Notifications,
  "scheduleNotificationAsync" | "cancelScheduledNotificationAsync" | "dismissNotificationAsync"
>;

export const createBudgetNotificationScheduler = (
  notifications: NotificationApi,
  platform: string,
  channelId: string
) => ({
  scheduleBudgetAlert: (
    event: BudgetAlertEvent,
    formatAmount: (amountInINR: number) => string
  ) => {
    const content = buildBudgetAlertNotificationContent(event, formatAmount);
    return notifications.scheduleNotificationAsync({
      content: {
        ...content,
        data: { scope: event.scope, categoryKey: event.categoryKey, threshold: event.threshold },
      },
      trigger: platform === "android" ? { channelId } : null,
    });
  },
  cancelScheduledBudgetAlert: async (notificationId: string) => {
    await Promise.allSettled([
      notifications.cancelScheduledNotificationAsync(notificationId),
      notifications.dismissNotificationAsync(notificationId),
    ]);
  },
});
