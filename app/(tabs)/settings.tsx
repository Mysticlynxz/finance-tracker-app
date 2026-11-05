import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { type Href, router } from "expo-router";
import { useCallback, useContext, useEffect, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Switch,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ExpenseContext, SUPPORTED_CURRENCIES } from "../../Context/ExpenseContext";
import {
  CURRENCY_CONFIG,
  CURRENCY_NAMES,
  formatCurrencyAmount,
  normalizeCurrencyCode,
} from "../../constants/currency";
import { getCurrentUser, getBudget, getExpenses, logoutUser, resetAllData } from "../../lib/appwrite";

const LOGIN_ROUTE = "/login" as Href;

export default function SettingsScreen() {
  const {
    clearExpenses: clearLocalExpenses,
    isDarkMode,
    setIsDarkMode,
    currency,
    isCurrencyReady,
    setCurrency,
    setBudget: setLocalBudget,
    convertFromINR,
  } = useContext(ExpenseContext);
  const [isCurrencyMenuOpen, setIsCurrencyMenuOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isResettingData, setIsResettingData] = useState(false);
  const [storedBudget, setStoredBudget] = useState<number>(0);
  const [storedExpenseCount, setStoredExpenseCount] = useState(0);
  const [userName, setUserName] = useState<string>("");
  const [userEmail, setUserEmail] = useState<string>("");
  const [userLoading, setUserLoading] = useState(true);
  const [userError, setUserError] = useState(false);

  const loadUserProfile = async () => {
    setUserLoading(true);
    setUserError(false);
    try {
      const user = await getCurrentUser();
      setUserName(user.name && user.name.trim() ? user.name.trim() : "");
      setUserEmail(user.email);
      setUserLoading(false);
    } catch {
      setUserError(true);
      setUserLoading(false);
    }
  };

  useEffect(() => {
    void loadUserProfile();
  }, []);

  useFocusEffect(
    useCallback(() => {
      let isActive = true;

      const loadSettingsData = async () => {
        try {
          const [budgetFromDb, expensesFromDb] = await Promise.all([
            getBudget(),
            getExpenses(),
          ]);

          if (!isActive) {
            return;
          }

          setStoredBudget(budgetFromDb ?? 0);
          setStoredExpenseCount(expensesFromDb.length);
        } catch (error) {
          console.error("Failed to load settings data", error);
        }
      };

      void loadSettingsData();

      return () => {
        isActive = false;
      };
    }, [])
  );

  const colors = isDarkMode
    ? {
        screen: "#020617",
        card: "#0f172a",
        border: "#334155",
        subtle: "#1e293b",
        iconChip: "#1e293b",
        primary: "#f8fafc",
        secondary: "#94a3b8",
      }
    : {
        screen: "#f8fafc",
        card: "#ffffff",
        border: "#e2e8f0",
        subtle: "#f1f5f9",
        iconChip: "#e2e8f0",
        primary: "#0f172a",
        secondary: "#475569",
      };

  const handleCurrencySelect = (selectedCurrency: string) => {
    setCurrency(selectedCurrency);
    setIsCurrencyMenuOpen(false);
  };

  const performResetData = async () => {
    if (isResettingData) {
      return;
    }

    setIsResettingData(true);

    try {
      await resetAllData();
      clearLocalExpenses();
      setLocalBudget(0);
      setStoredBudget(0);
      setStoredExpenseCount(0);
      Alert.alert("Reset complete", "All expenses and budget data have been deleted.", [
        {
          text: "OK",
          onPress: () => router.replace("/home"),
        },
      ]);
    } catch (resetError) {
      const message =
        resetError instanceof Error ? resetError.message : "Unable to reset data right now.";
      Alert.alert("Reset failed", message);
    } finally {
      setIsResettingData(false);
    }
  };

  const handleResetData = () => {
    Alert.alert(
      "Reset Data",
      "Are you sure you want to delete all expenses and budget?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Yes",
          style: "destructive",
          onPress: () => void performResetData(),
        },
      ]
    );
  };

  const handleLogout = async () => {
    if (isLoggingOut) {
      return;
    }

    setIsLoggingOut(true);

    try {
      await logoutUser();
      router.replace(LOGIN_ROUTE);
    } catch (logoutError) {
      const message =
        logoutError instanceof Error ? logoutError.message : "Unable to logout right now.";
      Alert.alert("Logout failed", message);
    } finally {
      setIsLoggingOut(false);
    }
  };

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: colors.screen }}>
      <ScrollView className="flex-1 px-6 py-4" contentContainerStyle={{ paddingBottom: 32 }}>
        <View className="mb-6 flex-row items-center gap-3">
          <View
            className="h-11 w-11 items-center justify-center rounded-full"
            style={{ backgroundColor: colors.iconChip }}
          >
            <Ionicons name="settings-outline" size={22} color={colors.primary} />
          </View>
          <View>
            <Text className="text-2xl font-bold" style={{ color: colors.primary }}>
              Settings
            </Text>
            <Text style={{ color: colors.secondary }}>Manage your app preferences</Text>
          </View>
        </View>

        <View
          className="mb-4 rounded-2xl border p-4 shadow"
          style={{ backgroundColor: colors.card, borderColor: colors.border }}
        >
          <Text
            className="mb-3 text-xs font-semibold uppercase tracking-wide"
            style={{ color: colors.secondary }}
          >
            Profile
          </Text>
          <View className="flex-row items-center gap-3">
            <View className="h-12 w-12 items-center justify-center rounded-full bg-blue-100">
              <Ionicons name="person-outline" size={22} color="#1d4ed8" />
            </View>
            <View>
              {userLoading ? (
                <ActivityIndicator size="small" color={colors.secondary} />
              ) : userError ? (
                <View>
                  <Text className="text-base font-semibold" style={{ color: colors.primary }}>
                    Unable to load profile
                  </Text>
                  <Text style={{ color: colors.secondary }}>Check your connection and try again.</Text>
                  <Pressable
                    onPress={() => void loadUserProfile()}
                    disabled={userLoading}
                    className="mt-2 rounded-lg px-3 py-1.5"
                    style={{ backgroundColor: colors.subtle }}
                  >
                    {userLoading ? (
                      <ActivityIndicator size="small" color="#2563eb" />
                    ) : (
                      <Text className="text-sm font-semibold" style={{ color: "#2563eb" }}>
                        Retry
                      </Text>
                    )}
                  </Pressable>
                </View>
              ) : (
                <View>
                  <Text className="text-base font-semibold" style={{ color: colors.primary }}>
                    {userName || "User"}
                  </Text>
                  <Text style={{ color: colors.secondary }}>{userEmail}</Text>
                </View>
              )}
            </View>
          </View>
        </View>

        <View
          className="mb-4 rounded-2xl border p-4 shadow"
          style={{ backgroundColor: colors.card, borderColor: colors.border }}
        >
          <Text
            className="mb-3 text-xs font-semibold uppercase tracking-wide"
            style={{ color: colors.secondary }}
          >
            Preferences
          </Text>

          <View className="mb-3">
            <Pressable
              onPress={() => setIsCurrencyMenuOpen((current) => !current)}
              className="flex-row items-center justify-between rounded-xl px-3 py-3"
              style={{ backgroundColor: colors.subtle }}
            >
              <View className="flex-1 flex-row items-center gap-2">
                <Ionicons name="globe-outline" size={20} color={colors.primary} />
                <View className="min-w-0 flex-1">
                  <Text className="font-semibold" style={{ color: colors.primary }}>
                    Currency
                  </Text>
                  <Text className="text-xs" numberOfLines={2} style={{ color: colors.secondary }}>
                    {isCurrencyReady
                      ? `Selected: ${CURRENCY_NAMES[normalizeCurrencyCode(currency)]} (${currency} - ${CURRENCY_CONFIG[normalizeCurrencyCode(currency)].symbol})`
                      : "Loading currency preference…"}
                  </Text>
                </View>
              </View>
              <View className="flex-row items-center gap-2">
                <Ionicons
                  name={isCurrencyMenuOpen ? "chevron-up" : "chevron-down"}
                  size={18}
                  color={colors.secondary}
                />
              </View>
            </Pressable>

            {isCurrencyMenuOpen && (
              <View
                className="mt-2 rounded-xl border"
                style={{ backgroundColor: colors.card, borderColor: colors.border }}
              >
                {SUPPORTED_CURRENCIES.map((supportedCurrency) => {
                  const isSelected = isCurrencyReady && supportedCurrency === currency;
                  return (
                    <Pressable
                      key={supportedCurrency}
                      onPress={() => handleCurrencySelect(supportedCurrency)}
                      className="flex-row items-center justify-between px-3 py-2.5"
                    >
                      <Text
                        className="font-semibold"
                        style={{
                          color: isSelected ? "#2563eb" : colors.primary,
                        }}
                      >
                        {supportedCurrency}
                      </Text>
                      {isSelected && (
                        <Ionicons name="checkmark" size={16} color="#2563eb" />
                      )}
                    </Pressable>
                  );
                })}
              </View>
            )}
          </View>

          <Pressable
            onPress={() => router.push("/budget")}
            className="mb-3 flex-row items-center justify-between rounded-xl px-3 py-3"
            style={{ backgroundColor: colors.subtle }}
          >
            <View className="flex-row items-center gap-2">
              <MaterialCommunityIcons name="cash-multiple" size={20} color="#7c3aed" />
              <View>
                <Text className="font-semibold" style={{ color: colors.primary }}>
                  Edit Monthly Budget
                </Text>
                <Text className="text-xs" style={{ color: colors.secondary }}>
                  Current: {isCurrencyReady
                    ? formatCurrencyAmount(convertFromINR(storedBudget), currency)
                    : "Loading currency…"}
                </Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.secondary} />
          </Pressable>

          <View
            className="flex-row items-center justify-between rounded-xl px-3 py-3"
            style={{ backgroundColor: colors.subtle }}
          >
            <View className="flex-row items-center gap-2">
              <Ionicons
                name={isDarkMode ? "moon-outline" : "sunny-outline"}
                size={20}
                color={colors.primary}
              />
              <View>
                <Text className="font-semibold" style={{ color: colors.primary }}>
                  {isDarkMode ? "Dark Mode" : "Light Mode"}
                </Text>
              </View>
            </View>
            <Switch
              value={isDarkMode}
              onValueChange={setIsDarkMode}
              trackColor={{ false: "#64748b", true: "#2563eb" }}
              thumbColor={isDarkMode ? "#e2e8f0" : "#ffffff"}
            />
          </View>
        </View>

        <View
          className="mb-4 rounded-2xl border p-4 shadow"
          style={{ backgroundColor: colors.card, borderColor: colors.border }}
        >
          <Text
            className="mb-3 text-xs font-semibold uppercase tracking-wide"
            style={{ color: colors.secondary }}
          >
            Data
          </Text>
          <Text className="mb-3 text-sm" style={{ color: colors.secondary }}>
            Synced expenses in Appwrite: {storedExpenseCount}
          </Text>
          <Pressable
            onPress={handleResetData}
            disabled={isResettingData}
            className="flex-row items-center justify-center gap-2 rounded-xl bg-red-600 py-3"
            style={isResettingData ? { opacity: 0.8 } : undefined}
          >
            {isResettingData ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <Ionicons name="trash-outline" size={18} color="#ffffff" />
            )}
            <Text className="font-semibold text-white">
              {isResettingData ? "Resetting..." : "Reset All Data"}
            </Text>
          </Pressable>
        </View>

        <View
          className="mb-4 rounded-2xl border p-4 shadow"
          style={{ backgroundColor: colors.card, borderColor: colors.border }}
        >
          <Text
            className="mb-3 text-xs font-semibold uppercase tracking-wide"
            style={{ color: colors.secondary }}
          >
            About
          </Text>
          <View className="mb-2 flex-row items-center justify-between">
            <Text style={{ color: colors.secondary }}>App Name</Text>
            <Text className="font-semibold" style={{ color: colors.primary }}>
              Smart Finance Tracker
            </Text>
          </View>
          <View className="flex-row items-center justify-between">
            <Text style={{ color: colors.secondary }}>Version </Text>
            <Text className="font-semibold" style={{ color: colors.primary }}>
              1.0.0
            </Text>
          </View>
        </View>

        <Pressable
          onPress={() => void handleLogout()}
          disabled={isLoggingOut}
          className="flex-row items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 py-4"
          style={isLoggingOut ? { opacity: 0.8 } : undefined}
        >
          {isLoggingOut ? (
            <ActivityIndicator size="small" color="#dc2626" />
          ) : (
            <Ionicons name="log-out-outline" size={20} color="#dc2626" />
          )}
          <Text className="font-semibold text-red-700">
            {isLoggingOut ? "Logging out..." : "Logout"}
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
