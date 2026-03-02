import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { router } from "expo-router";
import { useCallback, useContext, useEffect, useState } from "react";
import { Animated, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ExpenseContext } from "../../Context/ExpenseContext";
import { account, getBudget, getExpenses, type ExpenseDocument } from "../../lib/appwrite";

export default function Home() {
  const { isDarkMode, formatAmount } = useContext(ExpenseContext);
  const [expenses, setExpenses] = useState<ExpenseDocument[]>([]);
  const [budget, setBudgetState] = useState<number | null>(null);
  const totalSpent = expenses.reduce((sum, expense) => sum + expense.amount, 0);
  const budgetAmount = budget ?? 0;
  const remaining = budgetAmount - totalSpent;
  const percentageUsed = budgetAmount > 0 ? (totalSpent / budgetAmount) * 100 : 0;
  const cappedPercentageUsed = Math.max(0, Math.min(percentageUsed, 100));
  const [progressTrackWidth, setProgressTrackWidth] = useState(0);
  const [progressWidth] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const nextWidth = (progressTrackWidth * cappedPercentageUsed) / 100;
    Animated.timing(progressWidth, {
      toValue: nextWidth,
      duration: 450,
      useNativeDriver: false,
    }).start();
  }, [cappedPercentageUsed, progressTrackWidth, progressWidth]);

  const recentTransactions = [...expenses]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 3);

  const formatShortDate = (dateValue: string) => {
    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) {
      return dateValue;
    }
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
    }).format(date);
  };

  const statusIndicator =
    percentageUsed < 50
      ? {
          message: "You're managing your budget well.",
          icon: "\u{1F7E2}",
          background: isDarkMode ? "#052e16" : "#dcfce7",
          text: isDarkMode ? "#86efac" : "#166534",
        }
      : percentageUsed <= 80
        ? {
            message: "Keep an eye on your spending.",
            icon: "\u{1F7E1}",
            background: isDarkMode ? "#422006" : "#fef3c7",
            text: isDarkMode ? "#fcd34d" : "#92400e",
          }
        : {
            message: "Budget almost exhausted!",
            icon: "\u{1F534}",
            background: isDarkMode ? "#450a0a" : "#fee2e2",
            text: isDarkMode ? "#fca5a5" : "#991b1b",
          };

  const remainingAmountColor =
    remaining >= 0 ? (isDarkMode ? "#86efac" : "#16a34a") : (isDarkMode ? "#fca5a5" : "#dc2626");

  const spendingInsight = (() => {
    if (expenses.length === 0) {
      return "Add transactions to unlock spending insights.";
    }

    const foodSpent = expenses
      .filter((expense) => expense.category.toLowerCase().includes("food"))
      .reduce((sum, expense) => sum + expense.amount, 0);

    if (totalSpent > 0 && foodSpent / totalSpent > 0.5) {
      return "Food spending is your highest expense.";
    }

    if (budgetAmount > 0) {
      const uniqueDays = new Set(expenses.map((expense) => expense.date.slice(0, 10))).size;
      const dailyAverage = totalSpent / Math.max(uniqueDays, 1);
      const weeklyProjection = dailyAverage * 7;

      if (weeklyProjection > budgetAmount * 0.3) {
        return "You may exceed budget at this rate.";
      }
    }

    return "Your spending pace looks steady so far.";
  })();

  useFocusEffect(
    useCallback(() => {
      let isActive = true;

      const fetchBudget = async () => {
        try {
          const result = await getBudget();
          if (isActive) {
            setBudgetState(result);
          }
        } catch (error) {
          console.error("Failed to fetch budget", error);
        }
      };

      void fetchBudget();

      return () => {
        isActive = false;
      };
    }, [])
  );

  useFocusEffect(
    useCallback(() => {
      let isActive = true;

      const fetchExpenses = async () => {
        try {
          const data = await getExpenses();
          if (isActive) {
            setExpenses(data);
          }
        } catch (error) {
          console.error("Failed to load expenses", error);
        }
      };

      void fetchExpenses();

      return () => {
        isActive = false;
      };
    }, [])
  );

  useEffect(() => {
    const testAppwriteConnection = async () => {
      try {
        const user = await account.get();
        console.log("[Appwrite] Connected. Logged-in user:", user);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        console.log("[Appwrite] account.get() error:", message);

        if (
          message.toLowerCase().includes("missing session") ||
          message.toLowerCase().includes("missing scope")
        ) {
          console.log(
            "[Appwrite] Connection is successful. This error means no user session exists yet."
          );
        }
      }
    };

    void testAppwriteConnection();
  }, []);

  const colors = isDarkMode
    ? {
        screen: "#020617",
        card: "#0f172a",
        border: "#334155",
        subtle: "#111827",
        primary: "#f8fafc",
        secondary: "#94a3b8",
        spentCard: "#052e16",
        remainingCard: "#451a03",
        spentLabel: "#86efac",
        spentValue: "#dcfce7",
        remainingLabel: "#fcd34d",
        remainingValue: "#fef3c7",
        progressTrack: "#1e293b",
        progressFill: "#3b82f6",
      }
    : {
        screen: "#f8fafc",
        card: "#ffffff",
        border: "#dbeafe",
        subtle: "#f1f5f9",
        primary: "#0f172a",
        secondary: "#475569",
        spentCard: "#ecfdf5",
        remainingCard: "#fffbeb",
        spentLabel: "#047857",
        spentValue: "#064e3b",
        remainingLabel: "#b45309",
        remainingValue: "#78350f",
        progressTrack: "#e2e8f0",
        progressFill: "#2563eb",
      };

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: colors.screen }}>
      <ScrollView
        className="flex-1 px-6 py-4"
        contentContainerStyle={{ paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}
      >
      <View className="mb-6">
        <Text className="text-3xl font-extrabold" style={{ color: colors.primary }}>
          Dashboard
        </Text>
        <Text className="mt-1 text-base" style={{ color: colors.secondary }}>
          Keep your spending on track.
        </Text>
      </View>

      <View
        className="mb-6 rounded-2xl border p-5"
        style={{ backgroundColor: colors.card, borderColor: colors.border }}
      >
        <View className="flex-row items-center justify-between">
          <View>
            <Text
              className="text-sm font-semibold uppercase tracking-wide"
              style={{ color: colors.secondary }}
            >
              Monthly Budget
            </Text>
            <Text className="mt-1 text-2xl font-bold" style={{ color: colors.primary }}>
              {formatAmount(budgetAmount)}
            </Text>
          </View>
          <MaterialCommunityIcons name="cash-multiple" size={28} color="#2563eb" />
        </View>

        <View className="mt-4 flex-row gap-3">
          <View className="flex-1 rounded-xl p-3" style={{ backgroundColor: colors.spentCard }}>
            <Text className="text-xs font-semibold uppercase" style={{ color: colors.spentLabel }}>
              Spent
            </Text>
            <Text className="mt-1 text-lg font-bold" style={{ color: colors.spentValue }}>
              {formatAmount(totalSpent)}
            </Text>
          </View>
          <View className="flex-1 rounded-xl p-3" style={{ backgroundColor: colors.remainingCard }}>
            <Text
              className="text-xs font-semibold uppercase"
              style={{ color: colors.remainingLabel }}
            >
              Remaining
            </Text>
            <Text className="mt-1 text-2xl font-extrabold" style={{ color: remainingAmountColor }}>
              {formatAmount(remaining)}
            </Text>
          </View>
        </View>

        <View className="mt-4">
          <Text className="text-xs font-semibold uppercase" style={{ color: colors.secondary }}>
            {`${percentageUsed.toFixed(1)}% of budget used`}
          </Text>
          <View
            className="mt-2 h-3 w-full overflow-hidden rounded-full"
            style={{ backgroundColor: colors.progressTrack }}
            onLayout={(event) => {
              setProgressTrackWidth(event.nativeEvent.layout.width);
            }}
          >
            <Animated.View
              className="h-3 rounded-full"
              style={{
                width: progressWidth,
                backgroundColor: colors.progressFill,
              }}
            />
          </View>
        </View>

        <View
          className="mt-3 rounded-xl px-3 py-2"
          style={{ backgroundColor: statusIndicator.background }}
        >
          <Text className="text-sm font-medium" style={{ color: statusIndicator.text }}>
            {`${statusIndicator.icon} ${statusIndicator.message}`}
          </Text>
        </View>
      </View>

      <View className="gap-3">
        <Pressable
          onPress={() => router.push("/add-expense")}
          className="rounded-xl bg-blue-600 px-5 py-4"
        >
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-3">
              <Ionicons name="add-circle-outline" size={20} color="#ffffff" />
              <Text className="text-base font-semibold text-white">Add Expense</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#ffffff" />
          </View>
        </Pressable>

        <Pressable
          onPress={() => router.push("/reports")}
          className="rounded-xl bg-emerald-600 px-5 py-4"
        >
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-3">
              <Ionicons name="bar-chart-outline" size={20} color="#ffffff" />
              <Text className="text-base font-semibold text-white">View Reports</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#ffffff" />
          </View>
        </Pressable>

        <Pressable
          onPress={() => router.push("/budget")}
          className="rounded-xl bg-violet-600 px-5 py-4"
        >
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-3">
              <Ionicons name="wallet-outline" size={20} color="#ffffff" />
              <Text className="text-base font-semibold text-white">Set Budget</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#ffffff" />
          </View>
        </Pressable>
      </View>

      <View
        className="mt-6 rounded-2xl border p-4"
        style={{ backgroundColor: colors.card, borderColor: colors.border }}
      >
        <Text className="text-lg font-bold" style={{ color: colors.primary }}>
          Recent Transactions
        </Text>
        {recentTransactions.length === 0 ? (
          <Text className="mt-3 text-sm" style={{ color: colors.secondary }}>
            No transactions yet
          </Text>
        ) : (
          recentTransactions.map((expense) => (
            <View
              key={expense.$id}
              className="mt-3 flex-row items-center justify-between rounded-xl px-3 py-2"
              style={{ backgroundColor: colors.subtle }}
            >
              <View>
                <Text className="font-semibold" style={{ color: colors.primary }}>
                  {expense.category}
                </Text>
                <Text className="text-xs" style={{ color: colors.secondary }}>
                  {formatShortDate(expense.date)}
                </Text>
              </View>
              <Text className="font-semibold" style={{ color: colors.primary }}>
                {formatAmount(expense.amount)}
              </Text>
            </View>
          ))
        )}
      </View>

      <View
        className="mt-4 rounded-2xl border p-4"
        style={{ backgroundColor: colors.card, borderColor: colors.border }}
      >
        <Text className="text-lg font-bold" style={{ color: colors.primary }}>
          Spending Insight
        </Text>
        <Text className="mt-2 text-sm" style={{ color: colors.secondary }}>
          {spendingInsight}
        </Text>
      </View>
      </ScrollView>
    </SafeAreaView>
  );
}

