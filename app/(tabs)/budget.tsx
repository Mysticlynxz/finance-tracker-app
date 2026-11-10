import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { ExpenseContext } from "../../Context/ExpenseContext";
import { formatCurrencyAmount } from "../../constants/currency";
import { DEFAULT_CATEGORIES, type CategoryOption } from "../../constants/categories";
import { router } from "expo-router";
import { Alert, Animated, Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  clearBudget,
  getExpenses,
  setBudget as saveBudget,
  getBudgetRecord,
  type ExpenseDocument,
} from "../../lib/appwrite";
import { markCurrentBudgetMonth, syncBudgetForCurrentMonth } from "../../lib/budgetCycle";
import { getCategories } from "../../lib/categoryService";
import { getCategorySourceErrorMessage, loadCategorySource } from "../../lib/categoryBudgetLoading";
import {
  aggregateSpendingForMonth,
  getCalendarMonthKey,
  getCurrentMonthDateKeys,
  getHistoricalBudgetRecommendation,
  getPreviousCompletedMonthDateKeys,
} from "../../lib/reportDates";
import {
  createCategoryBudget,
  carryForwardCategoryBudgets,
  deleteCategoryBudget,
  listCategoryBudgets,
  updateCategoryBudget,
  type CategoryBudget,
} from "../../lib/categoryBudgets";
import {
  aggregateCategoryBudgetSpending,
  buildAvailableCategoryOptions,
  calculateCategoryBudgetProgress,
  categoryLimitsExceedOverallBudget,
  normalizeCategoryKey,
} from "../../lib/categoryBudgetCalculations";

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
    isCurrencyReady,
    formatAmount,
    convertToINR,
    convertFromINR,
  } =
    useContext(ExpenseContext);
  const [budget, setBudgetValue] = useState("");
  const [isEditing, setIsEditing] = useState(true);
  const [savedBudgetInINR, setSavedBudgetInINR] = useState<number>(0);
  const [expenses, setExpenses] = useState<ExpenseDocument[]>([]);
  const [categoryBudgets, setCategoryBudgets] = useState<CategoryBudget[]>([]);
  const [categoryBudgetsLoading, setCategoryBudgetsLoading] = useState(true);
  const [categoryBudgetsError, setCategoryBudgetsError] = useState("");
  const [customCategories, setCustomCategories] = useState<CategoryOption[]>([]);
  const [customCategoriesLoading, setCustomCategoriesLoading] = useState(true);
  const [customCategoriesError, setCustomCategoriesError] = useState("");
  const customCategoriesRequestId = useRef(0);
  const [isCategoryPickerVisible, setIsCategoryPickerVisible] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<CategoryOption | null>(null);
  const [categoryLimitInput, setCategoryLimitInput] = useState("");
  const [categoryBusy, setCategoryBusy] = useState(false);
  const [budgetCycleMessage, setBudgetCycleMessage] = useState("");
  const animatedWidth = useRef(new Animated.Value(0)).current;

  const loadCustomCategories = useCallback(async () => {
    const requestId = ++customCategoriesRequestId.current;
    setCustomCategoriesLoading(true);
    const result = await loadCategorySource(getCategories);
    if (requestId === customCategoriesRequestId.current) {
      if (result.ok) {
        setCustomCategories(result.value.map(({ name, icon }) => ({ name, icon })));
        setCustomCategoriesError("");
      } else {
        setCustomCategoriesError(getCategorySourceErrorMessage(result.error, "Unable to load custom categories."));
      }
      setCustomCategoriesLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      let isActive = true;

      const loadBudgetData = async () => {
        try {
          const [budgetFromDb, expensesFromDb] = await Promise.all([
            getBudgetRecord(),
            getExpenses(),
          ]);

          if (isActive) {
            const { budgetAmount: activeBudget, wasReset } = await syncBudgetForCurrentMonth(
              budgetFromDb,
              clearBudget
            );
            const nextSavedBudget = activeBudget ?? 0;
            setExpenses(expensesFromDb);
            setSavedBudgetInINR(nextSavedBudget);
            setBudgetLocal(nextSavedBudget);
            setBudgetValue(formatBudgetInputValue(convertFromINR(nextSavedBudget)));
            setIsEditing(nextSavedBudget <= 0);
            setBudgetCycleMessage(
              wasReset ? "New month detected. Set a fresh budget for this month." : ""
            );
          }
        } catch (error) {
          console.error("Failed to load budget data", error);
        }
      };

      void loadBudgetData();

      const loadCategoryBudgets = async () => {
        setCategoryBudgetsLoading(true);
        const result = await loadCategorySource(async () => {
          await carryForwardCategoryBudgets(getCalendarMonthKey());
          return listCategoryBudgets();
        });
        if (isActive) {
          if (result.ok) {
            setCategoryBudgets(result.value.budgets.filter((item) => item.monthId === getCalendarMonthKey()));
            setCategoryBudgetsError("");
          } else {
            setCategoryBudgetsError(getCategorySourceErrorMessage(result.error, "Unable to load category limits."));
          }
          setCategoryBudgetsLoading(false);
        }
      };
      void loadCategoryBudgets();

      void loadCustomCategories();

      return () => {
        isActive = false;
        customCategoriesRequestId.current += 1;
      };
    }, [convertFromINR, loadCustomCategories, setBudgetLocal])
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
  const formatSelectedAmount = (amount: number) =>
    !isCurrencyReady ? "Loading currency…" : Number.isFinite(amount)
      ? formatCurrencyAmount(amount, currency)
      : "Invalid amount";
  const hasInput = budget.trim().length > 0;
  const hasSavedBudget = savedBudgetInINR > 0;
  const now = new Date();
  const getExpenseAmount = (expense: ExpenseDocument) => {
    const amount = Number(expense.amount);
    return Number.isFinite(amount) && amount > 0 ? amount : 0;
  };
  const currentMonthSpending = aggregateSpendingForMonth(expenses, getExpenseAmount, getCurrentMonthDateKeys(now));
  const currentMonthExpenses = currentMonthSpending.items;
  const spentAmountInINR = currentMonthSpending.total;
  const spentAmount = convertFromINR(spentAmountInINR);
  const historicalRecommendation = getHistoricalBudgetRecommendation(expenses, getExpenseAmount, now, 3);
  const lastMonthSpendingInINR = aggregateSpendingForMonth(
    expenses,
    getExpenseAmount,
    getPreviousCompletedMonthDateKeys(now)
  ).total;
  const lastMonthSpending = convertFromINR(lastMonthSpendingInINR);
  const remaining = numericBudget - spentAmount;
  const remainingDisplayAmount = remaining > 0 ? remaining : 0;
  const progress = numericBudget > 0 ? spentAmount / numericBudget : 0;
  const usagePercent = numericBudget > 0 ? (spentAmount / numericBudget) * 100 : 0;
  const selectedQuickBudget = QUICK_BUDGET_OPTIONS.find((option) => option === numericBudget);
  const smartAlertMessage =
    numericBudget <= 0
      ? ""
      : usagePercent > 100
        ? "Budget exceeded!"
        : usagePercent > 80
          ? "You've used 80% of your budget"
          : "";

  let health = numericBudget > 0 ? "Healthy" : "No budget set";
  let healthColor = "#16a34a";

  if (numericBudget <= 0) {
    healthColor = colors.secondary;
  } else if (usagePercent > 80) {
    health = "Overspending";
    healthColor = "#dc2626";
  } else if (usagePercent > 50) {
    health = "Moderate";
    healthColor = "#d97706";
  }

  const groupedCategorySpending = aggregateCategoryBudgetSpending(
    currentMonthExpenses,
    (expense) => expense.category,
    getExpenseAmount
  );
  const allCategories = groupedCategorySpending
    .map(({ name, amountInINR }) => ({ name, amount: convertFromINR(amountInINR) }))
    .sort((left, right) => right.amount - left.amount);
  const categories = allCategories.slice(0, 3);

  const categorySpending = new Map(groupedCategorySpending.map(({ key, amountInINR }) => [key, amountInINR]));
  const availableCategoryOptions = buildAvailableCategoryOptions(
    DEFAULT_CATEGORIES,
    customCategories,
    categoryBudgets.map((item) => item.categoryKey)
  );
  const saveCategoryLimit = async (existing?: CategoryBudget) => {
    if (!isCurrencyReady || categoryBusy) return;
    const name = (existing?.category ?? selectedCategory?.name ?? "").trim();
    const selectedAmount = Number(existing ? categoryLimitInput : categoryLimitInput);
    if (!name || !Number.isFinite(selectedAmount) || selectedAmount <= 0) {
      Alert.alert("Invalid category limit", "Enter a category and an amount greater than zero.");
      return;
    }
    setCategoryBusy(true);
    try {
      const amountInINR = convertToINR(selectedAmount);
      if (!Number.isFinite(amountInINR) || amountInINR <= 0) throw new Error("Amount cannot be safely converted to INR.");
      if (existing) {
        await updateCategoryBudget(existing.$id, amountInINR);
      } else {
        await createCategoryBudget(name, amountInINR, getCalendarMonthKey());
        setSelectedCategory(null);
        setIsCategoryPickerVisible(false);
      }
      const result = await listCategoryBudgets();
      setCategoryBudgets(result.budgets.filter((item) => item.monthId === getCalendarMonthKey()));
      setCategoryLimitInput("");
      setCategoryBudgetsError("");
    } catch (error) {
      Alert.alert("Category limit not saved", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setCategoryBusy(false);
    }
  };

  const removeCategoryLimit = async (item: CategoryBudget) => {
    if (categoryBusy) return;
    setCategoryBusy(true);
    try {
      await deleteCategoryBudget(item.$id);
      setCategoryBudgets((current) => current.filter((budgetItem) => budgetItem.$id !== item.$id));
    } catch (error) {
      Alert.alert("Category limit not removed", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setCategoryBusy(false);
    }
  };

  useEffect(() => {
    const targetWidth = Math.min(progress * 100, 100);

    Animated.timing(animatedWidth, {
      toValue: targetWidth,
      duration: 800,
      useNativeDriver: false,
    }).start();
  }, [animatedWidth, progress]);

  const handleSave = async () => {
    if (!isCurrencyReady) {
      Alert.alert("Currency loading", "Please wait for currency settings to finish loading before saving.");
      return;
    }

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

      const savedBudget = await saveBudget({ amount: Number(budgetInINR) });
      await markCurrentBudgetMonth({
        amount: budgetInINR,
        userId: savedBudget.userId,
        documentId: savedBudget.$id,
        createdAt: savedBudget.$createdAt,
      });
      setBudgetLocal(budgetInINR);
      setSavedBudgetInINR(budgetInINR);
      setBudgetValue(formatBudgetInputValue(parsedBudget));
      setIsEditing(false);
      setBudgetCycleMessage("");
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
            {!isCurrencyReady
              ? "Loading currency…"
              : historicalRecommendation.recommendedBudgetInINR === null
                ? "Add expenses in completed months to get a budget recommendation."
                : `Suggested budget: ${formatAmount(historicalRecommendation.recommendedBudgetInINR)} (average of ${historicalRecommendation.monthsWithHistory} completed month${historicalRecommendation.monthsWithHistory === 1 ? "" : "s"} + 10% cushion).${historicalRecommendation.monthsWithHistory < 3 ? " Based on limited history." : ""}`}
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
        {budgetCycleMessage ? (
          <Text className="mb-3 text-sm font-medium" style={{ color: colors.warningText }}>
            {budgetCycleMessage}
          </Text>
        ) : null}
        <Text className="mb-2 text-sm font-semibold" style={{ color: colors.secondary }}>
          Monthly Budget Amount ({isCurrencyReady ? currency : "Loading currency…"})
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
              editable={isCurrencyReady}
              className="flex-1 px-3 py-3 text-base"
              style={{ color: colors.primary }}
              placeholderTextColor={colors.placeholder}
            />
          </View>
        ) : (
          <Text className="mt-2 text-2xl font-bold" style={{ color: colors.primary }}>
            {formatSelectedAmount(numericBudget)}
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
                    disabled={!isCurrencyReady}
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
                      {formatSelectedAmount(option)}
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
            disabled={!isCurrencyReady}
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
            {isCurrencyReady
              ? `${formatSelectedAmount(spentAmount)} spent / ${formatSelectedAmount(numericBudget)}`
              : "Loading currency…"}
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
              Remaining: {formatSelectedAmount(remainingDisplayAmount)}
            </Text>
            <Text className="mt-2 text-sm font-semibold" style={{ color: healthColor }}>
              {numericBudget > 0 ? `${health} spending` : "Set a budget to see spending status"}
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

            {smartAlertMessage ? (
              <Text className="mt-2 text-sm font-semibold" style={{ color: colors.warningText }}>
                {smartAlertMessage}
              </Text>
            ) : null}

            <Text className="mt-3 text-sm" style={{ color: colors.secondary }}>
              {isCurrencyReady ? `📊 Last month: ${formatSelectedAmount(lastMonthSpending)}` : "Loading currency…"}
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
                  {isCurrencyReady
                    ? `${category.name} — ${formatSelectedAmount(category.amount)}`
                    : `${category.name} — Loading currency…`}
                </Text>
              ))
            )}
          </View>
        </View>
      </View>

      <View className="mt-5 rounded-2xl border p-4" style={{ backgroundColor: colors.card, borderColor: colors.border }}>
        <Text className="text-lg font-bold" style={{ color: colors.primary }}>Category limits</Text>
        <Text className="mt-1 text-sm" style={{ color: colors.secondary }}>Optional monthly sublimits. Amounts are stored in INR.</Text>
        {!isCurrencyReady ? <Text className="mt-3" style={{ color: colors.secondary }}>Loading currency…</Text> : null}
        {categoryBudgetsLoading ? <Text className="mt-3" style={{ color: colors.secondary }}>Loading category limits…</Text> : null}
        {categoryBudgetsError ? <Text className="mt-3" style={{ color: colors.warningText }}>{categoryBudgetsError}</Text> : null}
        {customCategoriesError ? (
          <View className="mt-3 rounded-xl border p-3" style={{ borderColor: colors.warningText, backgroundColor: colors.warningBg }}>
            <Text className="text-sm" style={{ color: colors.warningText }}>Custom categories could not be loaded. Built-in categories are still available.</Text>
            <Pressable accessibilityRole="button" disabled={customCategoriesLoading} onPress={() => void loadCustomCategories()} className="mt-2 items-center justify-center rounded-lg border px-3" style={{ borderColor: colors.warningText, minHeight: 48, opacity: customCategoriesLoading ? 0.5 : 1 }}>
              <Text className="font-semibold" style={{ color: colors.warningText }}>Retry custom categories</Text>
            </Pressable>
          </View>
        ) : null}

        {!categoryBudgetsLoading && !categoryBudgetsError && allCategories.length === 0 && categoryBudgets.length === 0 ? (
          <Text className="mt-3" style={{ color: colors.secondary }}>No category spending yet. You can still create a limit below.</Text>
        ) : null}

        {allCategories.map((category) => {
          const categoryKey = normalizeCategoryKey(category.name) || "uncategorized";
          const limit = categoryBudgets.find((item) => item.categoryKey === categoryKey);
          const spentInINR = categorySpending.get(categoryKey) ?? 0;
          const progressData = calculateCategoryBudgetProgress(spentInINR, limit?.amountInINR);
          const ratio = progressData.usagePercent === null ? 0 : progressData.usagePercent / 100;
          return (
            <View key={category.name} className="mt-4 rounded-xl border p-3" style={{ borderColor: colors.border }}>
              <View className="flex-row items-center justify-between gap-2">
                <Text numberOfLines={1} className="flex-1 font-semibold" style={{ color: colors.primary }}>{category.name}</Text>
                <Text className="text-xs" style={{ color: colors.secondary }}>{formatAmount(spentInINR)} spent</Text>
              </View>
              {limit ? (
                <>
                  <Text className="mt-2 text-sm" style={{ color: colors.secondary }}>Limit {formatAmount(limit.amountInINR)} · Remaining {formatAmount(Math.max(0, limit.amountInINR - spentInINR))}</Text>
                  <Text className="mt-1 text-xs" style={{ color: colors.secondary }}>{Math.round(ratio * 100)}% used{ratio > 1 ? " · Over limit" : ""}</Text>
                  <View className="mt-2 h-2 overflow-hidden rounded-full" style={{ backgroundColor: colors.progressTrack }}>
                    <View style={{ height: 8, width: `${Math.min(ratio * 100, 100)}%`, backgroundColor: ratio > 1 ? colors.warningText : colors.progressFill }} />
                  </View>
                  <TextInput value={categoryLimitInput} onChangeText={setCategoryLimitInput} placeholder={isCurrencyReady ? `New limit (${currency})` : "Loading currency…"} keyboardType="decimal-pad" editable={isCurrencyReady && !categoryBusy} className="mt-3 w-full rounded-lg border px-3 py-3 text-base" style={{ color: colors.primary, borderColor: colors.border, minHeight: 48 }} />
                  <View className="mt-2 flex-row gap-2">
                    <Pressable disabled={!isCurrencyReady || categoryBusy} onPress={() => void saveCategoryLimit(limit)} className="flex-1 items-center justify-center rounded-lg border px-3 py-3" style={{ borderColor: colors.border, minHeight: 48, opacity: !isCurrencyReady || categoryBusy ? 0.5 : 1 }}><Text className="text-sm font-semibold" style={{ color: colors.accent }}>Update</Text></Pressable>
                    <Pressable disabled={categoryBusy} onPress={() => void removeCategoryLimit(limit)} className="flex-1 items-center justify-center rounded-lg border px-3 py-3" style={{ borderColor: colors.border, minHeight: 48, opacity: categoryBusy ? 0.5 : 1 }}><Text className="text-sm font-semibold" style={{ color: colors.warningText }}>Remove</Text></Pressable>
                  </View>
                </>
              ) : (
                <View className="mt-2 flex-row items-center justify-between">
                  <Text className="text-sm" style={{ color: colors.secondary }}>No limit set</Text>
                  <Pressable onPress={() => {
                    const option = [...DEFAULT_CATEGORIES, ...customCategories].find((item) => normalizeCategoryKey(item.name) === categoryKey);
                    setSelectedCategory(option ?? { name: category.name, icon: "" });
                  }} className="rounded-lg border px-3 py-2" style={{ borderColor: colors.border, minHeight: 48, justifyContent: "center" }}><Text className="text-sm font-semibold" style={{ color: colors.accent }}>Set limit</Text></Pressable>
                </View>
              )}
            </View>
          );
        })}

        {categoryBudgets.filter((limit) => !allCategories.some((category) => normalizeCategoryKey(category.name) === limit.categoryKey)).map((limit) => {
          const spentInINR = categorySpending.get(limit.categoryKey) ?? 0;
          const progressData = calculateCategoryBudgetProgress(spentInINR, limit.amountInINR);
          const ratio = progressData.usagePercent! / 100;
          return (
            <View key={limit.$id} className="mt-4 rounded-xl border p-3" style={{ borderColor: colors.border }}>
              <Text numberOfLines={1} className="font-semibold" style={{ color: colors.primary }}>{limit.category}</Text>
              <Text className="mt-2 text-sm" style={{ color: colors.secondary }}>{formatAmount(spentInINR)} spent · Limit {formatAmount(limit.amountInINR)} · Remaining {formatAmount(Math.max(0, limit.amountInINR - spentInINR))}</Text>
              <Text className="mt-1 text-xs" style={{ color: colors.secondary }}>{Math.round(ratio * 100)}% used{ratio > 1 ? " · Over limit" : ""}</Text>
              <View className="mt-2 h-2 overflow-hidden rounded-full" style={{ backgroundColor: colors.progressTrack }}><View style={{ height: 8, width: `${Math.min(ratio * 100, 100)}%`, backgroundColor: ratio > 1 ? colors.warningText : colors.progressFill }} /></View>
              <TextInput value={categoryLimitInput} onChangeText={setCategoryLimitInput} placeholder={isCurrencyReady ? `New limit (${currency})` : "Loading currency…"} keyboardType="decimal-pad" editable={isCurrencyReady && !categoryBusy} className="mt-3 w-full rounded-lg border px-3 py-3 text-base" style={{ color: colors.primary, borderColor: colors.border, minHeight: 48 }} />
              <View className="mt-2 flex-row gap-2">
                <Pressable disabled={!isCurrencyReady || categoryBusy} onPress={() => void saveCategoryLimit(limit)} className="flex-1 items-center justify-center rounded-lg border px-3 py-3" style={{ borderColor: colors.border, minHeight: 48, opacity: !isCurrencyReady || categoryBusy ? 0.5 : 1 }}><Text className="text-sm font-semibold" style={{ color: colors.accent }}>Update</Text></Pressable>
                <Pressable disabled={categoryBusy} onPress={() => void removeCategoryLimit(limit)} className="flex-1 items-center justify-center rounded-lg border px-3 py-3" style={{ borderColor: colors.border, minHeight: 48, opacity: categoryBusy ? 0.5 : 1 }}><Text className="text-sm font-semibold" style={{ color: colors.warningText }}>Remove</Text></Pressable>
              </View>
            </View>
          );
        })}

        <Text className="mt-4 text-sm font-semibold" style={{ color: colors.primary }}>Add a category limit</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={selectedCategory ? `Selected category ${selectedCategory.name}. Choose category` : "Choose a category"}
          onPress={() => setIsCategoryPickerVisible(true)}
          className="mt-2 w-full flex-row items-center justify-between rounded-lg border px-3 py-3"
          style={{ borderColor: colors.border, minHeight: 52, backgroundColor: colors.input }}
        >
          <Text className="flex-1 text-base" numberOfLines={1} style={{ color: selectedCategory ? colors.primary : colors.placeholder }}>
            {selectedCategory ? `${selectedCategory.icon}  ${selectedCategory.name}` : "Choose category"}
          </Text>
          <Ionicons name="chevron-down" size={20} color={colors.secondary} />
        </Pressable>
        <TextInput value={categoryLimitInput} onChangeText={setCategoryLimitInput} placeholder={isCurrencyReady ? `Amount (${currency})` : "Loading currency…"} keyboardType="decimal-pad" editable={isCurrencyReady && !categoryBusy} className="mt-2 w-full rounded-lg border px-3 py-3 text-base" style={{ color: colors.primary, borderColor: colors.border, minHeight: 48 }} />
        <Pressable disabled={!isCurrencyReady || categoryBusy || !selectedCategory} onPress={() => void saveCategoryLimit()} className="mt-2 w-full items-center justify-center rounded-lg px-4 py-3" style={{ backgroundColor: colors.accent, minHeight: 48, opacity: !isCurrencyReady || categoryBusy || !selectedCategory ? 0.5 : 1 }}><Text className="font-semibold text-white">Add category limit</Text></Pressable>
        {categoryLimitsExceedOverallBudget(categoryBudgets.map((item) => item.amountInINR), savedBudgetInINR) ? <Text className="mt-3 text-sm" style={{ color: colors.warningText }}>Category limits total more than the monthly budget. These optional limits do not change your overall budget.</Text> : null}
        {!categoryBudgetsLoading && categoryBudgets.length === 0 ? <Text className="mt-3 text-sm" style={{ color: colors.secondary }}>No category limits configured.</Text> : null}
      </View>

      <Modal
        visible={isCategoryPickerVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setIsCategoryPickerVisible(false)}
      >
        <View className="flex-1 justify-end" style={{ backgroundColor: "rgba(0,0,0,0.45)" }}>
          <View className="max-h-[82%] rounded-t-3xl p-5" style={{ backgroundColor: colors.card }}>
            <View className="mb-3 flex-row items-center justify-between">
              <Text className="text-lg font-bold" style={{ color: colors.primary }}>Choose category</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Close category selector" onPress={() => setIsCategoryPickerVisible(false)} className="items-center justify-center rounded-lg p-2" style={{ minWidth: 48, minHeight: 48 }}>
                <Ionicons name="close" size={24} color={colors.secondary} />
              </Pressable>
            </View>
            {customCategoriesLoading ? <Text className="py-4" style={{ color: colors.secondary }}>Loading your categories…</Text> : null}
            {customCategoriesError ? (
              <View className="my-2 rounded-xl border p-3" style={{ borderColor: colors.warningText, backgroundColor: colors.warningBg }}>
                <Text className="text-sm" style={{ color: colors.warningText }}>Custom categories could not be loaded. Built-in categories are still available.</Text>
                <Pressable accessibilityRole="button" disabled={customCategoriesLoading} onPress={() => void loadCustomCategories()} className="mt-2 items-center justify-center rounded-lg border px-3" style={{ borderColor: colors.warningText, minHeight: 48, opacity: customCategoriesLoading ? 0.5 : 1 }}>
                  <Text className="font-semibold" style={{ color: colors.warningText }}>Retry custom categories</Text>
                </Pressable>
              </View>
            ) : null}
            {!customCategoriesLoading && availableCategoryOptions.length === 0 ? (
              <Text className="py-4" style={{ color: colors.secondary }}>All available categories already have an active monthly limit.</Text>
            ) : null}
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator>
              {availableCategoryOptions.some((option) => option.source === "built-in") ? (
                <>
                  <Text className="mb-1 mt-2 text-xs font-bold uppercase tracking-wide" style={{ color: colors.secondary }}>Built-in categories</Text>
                  {availableCategoryOptions.filter((option) => option.source === "built-in").map((option) => (
                    <Pressable key={`builtin-${normalizeCategoryKey(option.name)}`} accessibilityRole="button" onPress={() => { setSelectedCategory({ name: option.name, icon: option.icon }); setIsCategoryPickerVisible(false); }} className="mb-1 w-full flex-row items-center rounded-xl px-3" style={{ minHeight: 52, backgroundColor: normalizeCategoryKey(selectedCategory?.name) === normalizeCategoryKey(option.name) ? colors.chip : "transparent" }}>
                      <Text className="mr-3 text-xl">{option.icon}</Text>
                      <Text className="flex-1 text-base" style={{ color: colors.primary }}>{option.name}</Text>
                    </Pressable>
                  ))}
                </>
              ) : null}
              {availableCategoryOptions.some((option) => option.source === "custom") ? (
                <>
                  <Text className="mb-1 mt-3 text-xs font-bold uppercase tracking-wide" style={{ color: colors.secondary }}>Your categories</Text>
                  {availableCategoryOptions.filter((option) => option.source === "custom").map((option) => (
                    <Pressable key={`custom-${normalizeCategoryKey(option.name)}`} accessibilityRole="button" onPress={() => { setSelectedCategory({ name: option.name, icon: option.icon }); setIsCategoryPickerVisible(false); }} className="mb-1 w-full flex-row items-center rounded-xl px-3" style={{ minHeight: 52, backgroundColor: normalizeCategoryKey(selectedCategory?.name) === normalizeCategoryKey(option.name) ? colors.chip : "transparent" }}>
                      <Text className="mr-3 text-xl">{option.icon}</Text>
                      <Text className="flex-1 text-base" numberOfLines={1} style={{ color: colors.primary }}>{option.name}</Text>
                    </Pressable>
                  ))}
                </>
              ) : null}
            </ScrollView>
            <Pressable onPress={() => setIsCategoryPickerVisible(false)} className="mt-3 w-full items-center justify-center rounded-xl border px-4" style={{ borderColor: colors.border, minHeight: 48 }}>
              <Text className="font-semibold" style={{ color: colors.secondary }}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

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
