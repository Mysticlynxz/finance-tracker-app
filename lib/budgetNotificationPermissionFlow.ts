export interface NotificationPermissionState {
  granted: boolean;
  canAskAgain: boolean;
}

export interface BudgetAlertPermissionAdapter {
  createAndroidChannel: () => Promise<unknown>;
  getPermission: () => Promise<NotificationPermissionState>;
  requestPermission: () => Promise<NotificationPermissionState>;
}

export const enableBudgetAlertPermission = async (
  platform: string,
  adapter: BudgetAlertPermissionAdapter
): Promise<NotificationPermissionState> => {
  if (platform === "android") {
    await adapter.createAndroidChannel();
  }

  const existing = await adapter.getPermission();
  return existing.granted ? existing : adapter.requestPermission();
};
