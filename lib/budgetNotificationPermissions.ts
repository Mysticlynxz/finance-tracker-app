import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { enableBudgetAlertPermission } from "./budgetNotificationPermissionFlow";

export const BUDGET_ALERT_CHANNEL_ID = "budget-alerts";

export const requestBudgetAlertPermission = () =>
  enableBudgetAlertPermission(Platform.OS, {
    createAndroidChannel: () => Notifications.setNotificationChannelAsync(BUDGET_ALERT_CHANNEL_ID, {
      name: "Budget Alerts",
      importance: Notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 200, 100, 200],
    }),
    getPermission: async () => {
      const result = await Notifications.getPermissionsAsync();
      return { granted: result.granted, canAskAgain: result.canAskAgain };
    },
    requestPermission: async () => {
      const result = await Notifications.requestPermissionsAsync();
      return { granted: result.granted, canAskAgain: result.canAskAgain };
    },
  });

export const hasBudgetAlertPermission = async () => {
  const result = await Notifications.getPermissionsAsync();
  return result.granted;
};
