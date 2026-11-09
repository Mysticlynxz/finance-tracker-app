import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { BUDGET_ALERT_CHANNEL_ID } from "./budgetNotificationPermissions";
import { createBudgetNotificationScheduler } from "./budgetNotificationSchedulerCore";

export { createBudgetNotificationScheduler } from "./budgetNotificationSchedulerCore";

const productionScheduler = createBudgetNotificationScheduler(Notifications, Platform.OS, BUDGET_ALERT_CHANNEL_ID);

export const scheduleBudgetAlert = productionScheduler.scheduleBudgetAlert;
export const cancelScheduledBudgetAlert = productionScheduler.cancelScheduledBudgetAlert;
