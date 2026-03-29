import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { ExpenseContext } from "../../Context/ExpenseContext";
import { router } from "expo-router";
import { Alert, Animated, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  getBudget,
  getExpenses,
  setBudget as saveBudget,
  type ExpenseDocument,
} from "../../lib/appwrite";

const QUICK_BUDGET_OPTIONS = [10000, 20000, 50000] as const;
const formatBudgetInputValue = (amount: number) => {
  if (!Number.isFinite(amount) || amount <= 0) {
    return "";
  }

  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
};

export default function Budget() {
  const {
    setBudget: setBudgetLocal,
    isDarkMode,
    currency,
    formatAmount,
    convertToINR,
    convertFromINR,
  } =
    useContext(ExpenseContext);
  const [budget, setBudgetValue] = useState("");
  const [isEditing, setIsEditing] = useState(true);
  const [savedBudgetInINR, setSavedBudgetInINR] = useState<number>(0);
  const [spentAmountInINR, setSpentAmountInINR] = useState<number>(0);
  const [expenses, setExpenses] = useState<ExpenseDocument[]>([]);
  const animatedWidth = useRef(new Animated.Value(0)).current;

  useFocusEffect(
    useCallback(() => {
      let isActive = true;

      const loadBudgetData = async () => {
        try {
          const [budgetFromDb, expensesFromDb] = await Promise.all([
            getBudget(),
            getExpenses(),
          ]);

          if (isActive) {
            const nextSavedBudget = budgetFromDb ?? 0;
            setSpentAmountInINR(
              expensesFromDb.reduce((total, expense) => total + Number(expense.amount || 0), 0)
            );
            setExpenses(expensesFromDb);
            setSavedBudgetInINR(nextSavedBudget);
            setBudgetValue(formatBudgetInputValue(convertFromINR(nextSavedBudget)));
            setIsEditing(nextSavedBudget <= 0);
          }
        } catch (error) {
          console.error("Failed to load budget data", error);
        }
      };

      void loadBudgetData();

      return () => {
        isActive = false;
      };
    }, [convertFromINR])
  );
  const colors = isDarkMode
    ? {
        screen: "#020617",
        card: "#0f172a",
        border: "#334155",
        input: "#1e293b",
        chip: "#312e81",
        primary: "#f8fafc",
        secondary: "#94a3b8",
        placeholder: "#64748b",
        accent: "#8b5cf6",
        progressTrack: "#1e293b",
        progressFill: "#3b82f6",
        warningBg: "#450a0a",
        warningText: "#fca5a5",
        statBg: "#111827",
      }
    : {
        screen: "#f8fafc",
        card: "#ffffff",
        border: "#e2e8f0",
        input: "#f8fafc",
        chip: "#ede9fe",
        primary: "#0f172a",
        secondary: "#475569",
        placeholder: "#94a3b8",
        accent: "#7c3aed",
        progressTrack: "#e5e7eb",
        progressFill: "#3b82f6",
        warningBg: "#fee2e2",
        warningText: "#b91c1c",
        statBg: "#f8fafc",
      };

  const numericBudget = Number(budget) || 0;
  const hasInput = budget.trim().length > 0;
  const hasSavedBudget = savedBudgetInINR > 0;
  const spentAmount = convertFromINR(spentAmountInINR);
  const suggestedBudget = Math.round(spentAmount * 1.5);
  const remaining = numericBudget - spentAmount;
  const remainingDisplayAmount = remaining > 0 ? remaining : 0;
  const progress = numericBudget > 0 ? spentAmount / numericBudget : 0;
  const usagePercent = numericBudget > 0 ? (spentAmount / numericBudget) * 100 : 0;
  const selectedQuickBudget = QUICK_BUDGET_OPTIONS.find((option) => option === numericBudget);
  const lastMonthSpending = convertFromINR(18000);

  let health = "Healthy";
  let healthColor = "#16a34a";

  if (usagePercent > 80) {
    health = "Overspending";
    healthColor = "#dc2626";
  } else if (usagePercent > 50) {
    health = "Moderate";
    healthColor = "#d97706";
  }

  const categoryTotals = expenses.reduce<Record<string, number>>((accumulator, expense) => {
    const key =
      typeof expense.category === "string" && expense.category.trim()
        ? expense.category.trim()
        : "Other";

    accumulator[key] = (accumulator[key] ?? 0) + Number(expense.amount || 0);
    return accumulator;
  }, {});

  const categories = Object.entries(categoryTotals)
    .map(([name, amount]) => ({
      name,
      amount: convertFromINR(amount),
    }))
    .sort((left, right) => right.amount - left.amount)
    .slice(0, 3);

  useEffect(() => {
    const targetWidth = Math.min(progress * 100, 100);

    Animated.timing(animatedWidth, {
      toValue: targetWidth,
      duration: 800,
      useNativeDriver: false,
    }).start();
  }, [animatedWidth, progress]);

  const handleSave = async () => {
    const parsedBudget = Number(budget);
    if (!Number.isFinite(parsedBudget) || parsedBudget <= 0) {
      Alert.alert("Invalid budget", "Please enter a valid budget greater than 0.");
      return;
    }

    try {
      const budgetInINR = convertToINR(parsedBudget);

      if (!Number.isFinite(budgetInINR) || budgetInINR <= 0) {
        throw new Error("Budget amount could not be converted to INR.");
      }

      await saveBudget({ amount: Number(budgetInINR) });
      setBudgetLocal(budgetInINR);
      setSavedBudgetInINR(budgetInINR);
      setBudgetValue(formatBudgetInputValue(parsedBudget));
      setIsEditing(false);
      Alert.alert("Success", "Budget updated successfully");
    } catch (error) {
      console.error("Failed to save budget", error);
      Alert.alert("Error", "Unable to save budget.");
    }
  };

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: colors.screen }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingHorizontal: 24,
          paddingTop: 16,
          paddingBottom: 32,
        }}
      >
      <View className="mb-6 flex-row items-center gap-3">
        <View
          className="h-11 w-11 items-center justify-center rounded-full"
          style={{ backgroundColor: colors.chip }}
        >
          <Ionicons name="wallet-outline" size={22} color="#7c3aed" />
        </View>
        <View>
          <Text className="text-2xl font-bold" style={{ color: colors.primary }}>
            Set Budget
          </Text>
          <Text style={{ color: colors.secondary }}>
            Define your monthly spending limits
          </Text>
          <Text className="mt-2 text-sm font-medium" style={{ color: colors.secondary }}>
            {`🤖 Suggested budget: ${currency} ${suggestedBudget.toLocaleString()}`}
          </Text>
        </View>
      </View>

      <View
        className="rounded-2xl border p-4"
        style={{ backgroundColor: colors.card, borderColor: colors.border }}
      >
        <Text className="mb-2 text-xs font-semibold uppercase tracking-wide" style={{ color: colors.secondary }}>
          Current Budget: {hasSavedBudget ? formatAmount(savedBudgetInINR) : "No budget saved yet"}
        </Text>
        <Text className="mb-2 text-sm font-semibold" style={{ color: colors.secondary }}>
          Monthly Budget Amount ({currency})
        </Text>

        {isEditing ? (
          <View
            className="flex-row items-center rounded-xl border px-3"
            style={{ backgroundColor: colors.input, borderColor: colors.border }}
          >
            <MaterialCommunityIcons name="cash-multiple" size={20} color={colors.secondary} />
            <TextInput
              placeholder="0.00"
              keyboardType="decimal-pad"
              value={budget}
              onChangeText={setBudgetValue}
              className="flex-1 px-3 py-3 text-base"
              style={{ color: colors.primary }}
              placeholderTextColor={colors.placeholder}
            />
          </View>
        ) : (
          <Text className="mt-2 text-2xl font-bold" style={{ color: colors.primary }}>
            {currency} {numericBudget.toFixed(2)}
          </Text>
        )}

        {hasSavedBudget && !isEditing && (
          <Pressable
            onPress={() => setIsEditing(true)}
            className="mt-3 self-start rounded-lg px-3 py-2"
            style={{ backgroundColor: colors.input }}
          >
            <Text className="text-sm font-semibold" style={{ color: colors.primary }}>
              Edit Budget
            </Text>
          </Pressable>
        )}

        {!hasSavedBudget && (
          <View className="mt-4">
            <Text className="text-sm font-semibold" style={{ color: colors.primary }}>
              Quick select
            </Text>
            <View
              className="mt-3 flex-row flex-wrap"
              style={{ gap: 10 }}
            >
              {QUICK_BUDGET_OPTIONS.map((option) => {
                const isSelected = selectedQuickBudget === option;

                return (
                  <Pressable
                    key={option}
                    onPress={() => setBudgetValue(String(option))}
                    className="rounded-xl px-4 py-2"
                    style={{
                      backgroundColor: isSelected ? colors.accent : colors.input,
                      borderWidth: 1,
                      borderColor: isSelected ? colors.accent : colors.border,
                      marginBottom: 8,
                    }}
                  >
                    <Text
                      className="text-sm font-semibold"
                      style={{ color: isSelected ? "#ffffff" : colors.primary }}
                    >
                      {currency} {option.toLocaleString()}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}

        {(isEditing || numericBudget === 0 || hasInput) && (
          <Pressable
            onPress={handleSave}
            className="mt-4 items-center rounded-xl bg-violet-600 py-4"
          >
            <View className="flex-row items-center gap-2">
              <Ionicons name="checkmark-circle-outline" size={20} color="#ffffff" />
              <Text className="text-base font-semibold text-white">Save Budget</Text>
            </View>
          </Pressable>
        )}

        <View className="mt-5 rounded-2xl border p-4" style={{ backgroundColor: colors.statBg, borderColor: colors.border }}>
          <View className="flex-row items-center justify-between">
            <Text className="text-sm font-semibold" style={{ color: colors.primary }}>
              Spending progress
            </Text>
            <Text className="text-xs font-semibold" style={{ color: colors.secondary }}>
              {numericBudget > 0 ? `${Math.min(progress * 100, 100).toFixed(1)}% used` : "Set a budget"}
            </Text>
          </View>

          <Text className="mt-3 text-sm" style={{ color: colors.secondary }}>
            {currency} {spentAmount.toFixed(2)} spent / {currency} {numericBudget.toFixed(2)}
          </Text>

          <View
            className="mt-2 h-2 overflow-hidden rounded-full"
            style={{ backgroundColor: colors.progressTrack }}
          >
            <Animated.View
              style={{
                width: animatedWidth.interpolate({
                  inputRange: [0, 100],
                  outputRange: ["0%", "100%"],
                }),
                height: "100%",
                backgroundColor: colors.progressFill,
              }}
            />
          </View>

          <View className="mt-4">
            <Text className="text-base font-semibold" style={{ color: colors.primary }}>
              Remaining: {currency} {remainingDisplayAmount.toFixed(2)}
            </Text>
            <Text className="mt-2 text-sm font-semibold" style={{ color: healthColor }}>
              {health} spending
            </Text>

            {numericBudget > 0 && remaining < 0 && (
              <View
                className="mt-3 rounded-xl px-3 py-2"
                style={{ backgroundColor: colors.warningBg }}
              >
                <Text className="text-sm font-semibold" style={{ color: colors.warningText }}>
                  Budget is lower than current spending.
                </Text>
              </View>
            )}

            {usagePercent > 80 && (
              <Text className="mt-2 text-sm font-semibold" style={{ color: colors.warningText }}>
                You are close to exceeding your budget.
              </Text>
            )}

            <Text className="mt-3 text-sm" style={{ color: colors.secondary }}>
              {`📊 Last month: ${currency} ${lastMonthSpending.toFixed(2)}`}
            </Text>
          </View>

          <View className="mt-4">
            <Text className="text-sm font-semibold" style={{ color: colors.primary }}>
              Top Spending
            </Text>

            {categories.length === 0 ? (
              <Text className="mt-2 text-sm" style={{ color: colors.secondary }}>
                Add expenses to see your top categories.
              </Text>
            ) : (
              categories.map((category, index) => (
                <Text
                  key={`${category.name}-${index}`}
                  className="mt-2 text-sm"
                  style={{ color: colors.secondary }}
                >
                  {`${category.name} — ${currency} ${category.amount.toFixed(2)}`}
                </Text>
              ))
            )}
          </View>
        </View>
      </View>

      <View className="mt-6 gap-3">
        <Pressable
          onPress={() => router.replace("/home")}
          className="items-center rounded-xl border py-4"
          style={{ backgroundColor: colors.card, borderColor: colors.border }}
        >
          <Text className="text-base font-semibold" style={{ color: colors.secondary }}>
            Cancel
          </Text>
        </Pressable>
      </View>
      </ScrollView>
    </SafeAreaView>
  );
}
