import { useCallback, useContext, useMemo, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { Dimensions, ScrollView, Text, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { PieChart } from "react-native-chart-kit";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  VictoryArea,
  VictoryAxis,
  VictoryChart,
  VictoryLine,
  VictoryScatter,
  VictoryTheme,
  VictoryTooltip,
} from "victory-native";
import { ExpenseContext } from "../../Context/ExpenseContext";
import {
  allocateCurrencyDisplayAmounts,
  formatCurrencyAmount,
} from "../../constants/currency";
import { clearBudget, getBudgetRecord, getExpenses, type ExpenseDocument } from "../../lib/appwrite";
import { syncBudgetForCurrentMonth } from "../../lib/budgetCycle";
import {
  aggregateDailyAmounts,
  aggregateCategorySpending,
  compareSpendingTotals,
  filterItemsForMonth,
  getCurrentMonthDateKeys,
  getMonthToDateDateKeys,
  getPreviousMonthToDateDateKeys,
  sumAmountsCompensated,
} from "../../lib/reportDates";

interface TrendPoint {
  x: string;
  y: number;
}

const formatDateLabel = (dateKey: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    return dateKey;
  }
  const [, month, day] = dateKey.split("-");
  return `${Number(month)}/${Number(day)}`;
};

export default function Reports() {
  const { isDarkMode, formatAmount, convertFromINR, currency, isCurrencyReady } =
    useContext(ExpenseContext);
  const [expenses, setExpenses] = useState<ExpenseDocument[]>([]);
  const [budget, setBudgetState] = useState<number | null>(null);
  const [monthDateKeys, setMonthDateKeys] = useState(() => getCurrentMonthDateKeys());
  const [reportNow, setReportNow] = useState(() => new Date());
  const screenWidth = Dimensions.get("window").width;
  const chartWidth = Math.max(screenWidth - 48, 280);
  const pieChartWidth = Math.max(screenWidth - 80, 220);
  useFocusEffect(
    useCallback(() => {
      let isActive = true;
      const now = new Date();
      setReportNow(now);
      setMonthDateKeys(getCurrentMonthDateKeys(now));

      const loadReportData = async () => {
        try {
          const [budgetResult, expenseResult] = await Promise.all([getBudgetRecord(), getExpenses()]);
          if (!isActive) return;
          const { budgetAmount } = await syncBudgetForCurrentMonth(budgetResult, clearBudget);
          if (!isActive) return;
          setBudgetState(budgetAmount !== null && budgetAmount > 0 ? budgetAmount : null);
          setExpenses(expenseResult);
        } catch (error) {
          console.error("Failed to load reports data", error);
        }
      };

      void loadReportData();
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
        primary: "#f8fafc",
        secondary: "#94a3b8",
        spent: "#ef4444",
        remaining: "#22c55e",
      }
    : {
        screen: "#f8fafc",
        card: "#ffffff",
        border: "#e2e8f0",
        primary: "#0f172a",
        secondary: "#475569",
        spent: "#ef4444",
        remaining: "#22c55e",
      };

  const getExpenseAmount = (expense: ExpenseDocument) => {
    const numericAmount = Number(expense.amount);
    return Number.isFinite(numericAmount) ? numericAmount : 0;
  };

  const monthExpenses = useMemo(
    () => filterItemsForMonth(expenses, monthDateKeys),
    [expenses, monthDateKeys]
  );
  const totalExpense = useMemo(
    () => sumAmountsCompensated(monthExpenses.map(getExpenseAmount)),
    [monthExpenses]
  );
  const categoryBreakdown = useMemo(
    () => aggregateCategorySpending(monthExpenses, getExpenseAmount),
    [monthExpenses]
  );
  const categoryDisplayAmounts = useMemo(
    () => allocateCurrencyDisplayAmounts(
      totalExpense,
      categoryBreakdown.map(({ amount }) => amount),
      currency
    ),
    [categoryBreakdown, currency, totalExpense]
  );
  const highestCategoryAmount = categoryBreakdown[0]?.amount ?? 0;
  const highestCategories = categoryBreakdown
    .filter((category) => category.amount === highestCategoryAmount && highestCategoryAmount > 0)
    .map(({ name }) => name);
  const remainingBudget = budget === null ? null : Math.max(0, budget - totalExpense);
  const budgetUsagePercentage = budget !== null && budget > 0 ? (totalExpense / budget) * 100 : null;
  const convertedTotalExpense = convertFromINR(totalExpense);
  const convertedRemainingBudget = convertFromINR(remainingBudget ?? 0);

  const pieData = useMemo(
    () => [
      {
        name: "Spent",
        amount: Number(convertedTotalExpense.toFixed(2)),
        color: colors.spent,
        legendFontColor: colors.secondary,
        legendFontSize: 13,
      },
      {
        name: "Remaining",
        amount: Number(convertedRemainingBudget.toFixed(2)),
        color: colors.remaining,
        legendFontColor: colors.secondary,
        legendFontSize: 13,
      },
    ],
    [
      colors.remaining,
      colors.secondary,
      colors.spent,
      convertedRemainingBudget,
      convertedTotalExpense,
    ]
  );

  const dailyTrendData = useMemo<TrendPoint[]>(() => {
    return aggregateDailyAmounts(monthExpenses, getExpenseAmount);
  }, [monthExpenses]);

  const currentComparisonKeys = useMemo(() => getMonthToDateDateKeys(reportNow), [reportNow]);
  const previousComparisonKeys = useMemo(
    () => getPreviousMonthToDateDateKeys(reportNow),
    [reportNow]
  );
  const currentComparisonTotal = useMemo(
    () => filterItemsForMonth(expenses, currentComparisonKeys)
      .reduce((total, expense) => total + getExpenseAmount(expense), 0),
    [currentComparisonKeys, expenses]
  );
  const previousComparisonTotal = useMemo(
    () => filterItemsForMonth(expenses, previousComparisonKeys)
      .reduce((total, expense) => total + getExpenseAmount(expense), 0),
    [expenses, previousComparisonKeys]
  );
  const spendingComparison = compareSpendingTotals(currentComparisonTotal, previousComparisonTotal);
  const comparisonDifference = spendingComparison.difference;
  const comparisonPercentChange = spendingComparison.percentChange;

  const trendTickValues = useMemo(() => {
    if (dailyTrendData.length <= 5) {
      return dailyTrendData.map((point) => point.x);
    }

    const step = Math.ceil(dailyTrendData.length / 5);
    return dailyTrendData
      .filter((_, index) => index % step === 0 || index === dailyTrendData.length - 1)
      .map((point) => point.x);
  }, [dailyTrendData]);

  const formatYAxisTick = (value: number) => {
    return convertFromINR(value).toFixed(0);
  };

  const maxTrendValue = useMemo(
    () => Math.max(...dailyTrendData.map((point) => point.y), 0),
    [dailyTrendData]
  );
  const monthDates = monthDateKeys;
  const expenseDates = useMemo(
    () => new Set(dailyTrendData.map((point) => point.x)),
    [dailyTrendData]
  );

  const hasBudget = budget !== null && budget > 0;
  const hasMonthExpenses = totalExpense > 0;
  const hasPieData = hasBudget;
  const distributionMessage = !hasMonthExpenses && !hasBudget
    ? "No expenses or monthly budget yet. Add expenses or set a budget to get started."
    : hasMonthExpenses && !hasBudget
      ? `You spent ${formatAmount(totalExpense)} this month. Set a monthly budget to track what remains.`
      : !hasMonthExpenses
        ? "No expenses recorded this month. Your full monthly budget remains."
        : totalExpense > (budget ?? 0)
          ? `You exceeded your monthly budget by ${formatAmount(totalExpense - (budget ?? 0))}.`
          : totalExpense === budget
            ? "Your monthly budget has been fully spent."
            : "Your monthly budget is partially spent.";

  const getCategoryIcon = (category: string) => {
    const normalized = category.trim().toLowerCase();
    if (normalized.includes("food")) return "food-apple";
    if (normalized.includes("grocer")) return "cart-outline";
    if (normalized.includes("transport")) return "bus";
    if (normalized.includes("travel")) return "airplane";
    if (normalized.includes("bill")) return "receipt-text-outline";
    if (normalized.includes("health")) return "heart-pulse";
    if (normalized.includes("shop")) return "shopping-outline";
    if (normalized.includes("education")) return "school-outline";
    if (normalized.includes("entertain")) return "movie-open-outline";
    return "shape-outline";
  };

  const formatDateRange = (dateKeys: string[]) => {
    if (dateKeys.length === 0) return "—";
    const first = dateKeys[0].split("-").map(Number);
    const last = dateKeys[dateKeys.length - 1].split("-").map(Number);
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${monthNames[first[1] - 1]} ${first[2]}–${last[2]}, ${first[0]}`;
  };

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: colors.screen }}>
      <ScrollView
        className="flex-1 px-6 py-4"
        contentContainerStyle={{ paddingBottom: 32 }}
        nestedScrollEnabled
      >
        <Text className="mb-1 text-3xl font-extrabold" style={{ color: colors.primary }}>
          Reports
        </Text>
        <Text className="mb-6 text-base" style={{ color: colors.secondary }}>
          Visual breakdown of your budget and daily expenses.
        </Text>
        <Text className="mb-4 text-xs font-semibold uppercase" style={{ color: colors.secondary }}>
          Display Currency: {isCurrencyReady ? currency : "Loading currency…"}
        </Text>

        <View
          className="mb-4 rounded-2xl border p-4 shadow"
          style={{ backgroundColor: colors.card, borderColor: colors.border }}
        >
          <Text
            className="mb-3 text-xs font-semibold uppercase tracking-wide"
            style={{ color: colors.secondary }}
          >
            Summary
          </Text>

          <View className="mb-2 flex-row items-center justify-between">
            <Text style={{ color: colors.secondary }}>Spent This Month</Text>
            <Text className="font-semibold" style={{ color: colors.primary }}>
              {formatAmount(totalExpense)}
            </Text>
          </View>

          <View className="mb-2 flex-row items-center justify-between">
            <Text style={{ color: colors.secondary }}>Monthly Budget</Text>
            <Text className="font-semibold" style={{ color: colors.primary }}>
              {budget === null ? "No budget set" : formatAmount(budget)}
            </Text>
          </View>

          <View className="flex-row items-center justify-between">
            <Text style={{ color: colors.secondary }}>Budget Used</Text>
            <Text className="font-semibold" style={{ color: colors.primary }}>
              {budgetUsagePercentage === null
                ? "Set a budget to track"
                : `${budgetUsagePercentage.toFixed(1)}%`}
            </Text>
          </View>
        </View>

        <View
          className="mb-4 rounded-2xl border p-4 shadow"
          style={{ backgroundColor: colors.card, borderColor: colors.border }}
        >
          <Text className="mb-3 text-lg font-bold" style={{ color: colors.primary }}>
            Category Breakdown
          </Text>
          {totalExpense <= 0 || categoryBreakdown.length === 0 ? (
            <Text style={{ color: colors.secondary }}>
              No category spending recorded this month yet.
            </Text>
          ) : (
            <>
              <Text className="mb-3 text-sm" style={{ color: colors.secondary }}>
                Highest spending: {highestCategories.join(", ")} · {formatAmount(highestCategoryAmount)}
              </Text>
              <View className="gap-4">
                {categoryBreakdown.map((category, index) => (
                  <View key={category.name.toLowerCase()}>
                    <View className="flex-row items-center justify-between gap-2">
                      <View className="min-w-0 flex-1 flex-row items-center">
                        <MaterialCommunityIcons
                          name={getCategoryIcon(category.name)}
                          size={18}
                          color={isDarkMode ? "#93c5fd" : "#2563eb"}
                        />
                        <Text
                          className="ml-2 flex-1 text-sm font-semibold"
                          numberOfLines={1}
                          ellipsizeMode="tail"
                          style={{ color: colors.primary }}
                        >
                          {category.name}
                        </Text>
                      </View>
                      <Text
                        className="shrink text-right text-sm font-semibold"
                        numberOfLines={1}
                        adjustsFontSizeToFit
                        minimumFontScale={0.75}
                        style={{ color: colors.primary }}
                      >
                        {isCurrencyReady
                          ? formatCurrencyAmount(categoryDisplayAmounts[index] ?? 0, currency)
                          : "Loading currency…"}
                      </Text>
                    </View>
                    <View className="mt-1 flex-row items-center gap-2">
                      <View
                        className="h-2 flex-1 overflow-hidden rounded-full"
                        style={{ backgroundColor: isDarkMode ? "#1e293b" : "#e2e8f0" }}
                      >
                        <View
                          className="h-full rounded-full bg-blue-600"
                          style={{ width: `${Math.min(category.percentage, 100)}%` }}
                        />
                      </View>
                      <Text className="w-12 text-right text-xs" style={{ color: colors.secondary }}>
                        {category.percentage.toFixed(1)}%
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            </>
          )}
        </View>

        <View
          className="mb-4 rounded-2xl border p-4 shadow"
          style={{ backgroundColor: colors.card, borderColor: colors.border }}
        >
          <Text className="mb-1 text-lg font-bold" style={{ color: colors.primary }}>
            Monthly Comparison
          </Text>
          <Text className="mb-3 text-xs" style={{ color: colors.secondary }}>
            Month to date compared with the same elapsed period last month.
          </Text>
          <View className="flex-row gap-3">
            <View className="min-w-0 flex-1 rounded-xl p-3" style={{ backgroundColor: isDarkMode ? "#111827" : "#f1f5f9" }}>
              <Text className="text-xs font-semibold" style={{ color: colors.secondary }}>
                This month · {formatDateRange(currentComparisonKeys)}
              </Text>
              <Text className="mt-1 text-base font-bold" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} style={{ color: colors.primary }}>
                {formatAmount(currentComparisonTotal)}
              </Text>
            </View>
            <View className="min-w-0 flex-1 rounded-xl p-3" style={{ backgroundColor: isDarkMode ? "#111827" : "#f1f5f9" }}>
              <Text className="text-xs font-semibold" style={{ color: colors.secondary }}>
                Last month · {formatDateRange(previousComparisonKeys)}
              </Text>
              <Text className="mt-1 text-base font-bold" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} style={{ color: colors.primary }}>
                {formatAmount(previousComparisonTotal)}
              </Text>
            </View>
          </View>
          <Text className="mt-3 text-sm font-semibold" style={{ color: colors.primary }}>
            {currentComparisonTotal === 0 && previousComparisonTotal === 0
              ? "No spending in either comparison period."
              : previousComparisonTotal === 0
                ? `Spending increased from zero by ${formatAmount(currentComparisonTotal)}; percentage change is unavailable.`
                : `${spendingComparison.direction === "increased" ? "Increased" : spendingComparison.direction === "decreased" ? "Decreased" : "Unchanged"} by ${formatAmount(Math.abs(comparisonDifference))}${comparisonPercentChange === null ? "" : ` (${Math.abs(comparisonPercentChange).toFixed(1)}%)`}.`}
          </Text>
        </View>

        <View
          className="mb-4 rounded-2xl border p-4 shadow"
          style={{ backgroundColor: colors.card, borderColor: colors.border }}
        >
          <Text className="mb-3 text-lg font-bold" style={{ color: colors.primary }}>
            Budget Distribution
          </Text>
          {hasPieData ? (
            <View>
              <View className="items-center">
                <PieChart
                  data={pieData}
                  width={pieChartWidth}
                  height={220}
                  center={[pieChartWidth / 4, 0]}
                  chartConfig={{
                    backgroundGradientFrom: "transparent",
                    backgroundGradientTo: "transparent",
                    color: (opacity = 1) =>
                      isDarkMode
                        ? `rgba(226, 232, 240, ${opacity})`
                        : `rgba(51, 65, 85, ${opacity})`,
                    labelColor: (opacity = 1) =>
                      isDarkMode
                        ? `rgba(226, 232, 240, ${opacity})`
                        : `rgba(51, 65, 85, ${opacity})`,
                  }}
                  accessor="amount"
                  backgroundColor="transparent"
                  paddingLeft="0"
                  hasLegend={false}
                  absolute={false}
                />
              </View>

              <View className="mt-1 gap-2">
                <View className="flex-row items-center justify-between rounded-lg px-2 py-1">
                  <View className="flex-row items-center">
                    <View
                      className="mr-2 h-3 w-3 rounded-full"
                      style={{ backgroundColor: colors.spent }}
                    />
                    <Text className="font-semibold" style={{ color: colors.primary }}>
                      Spent
                    </Text>
                  </View>
                  <Text className="font-semibold" style={{ color: colors.secondary }}>
                    {formatAmount(totalExpense)}
                  </Text>
                </View>

                <View className="flex-row items-center justify-between rounded-lg px-2 py-1">
                  <View className="flex-row items-center">
                    <View
                      className="mr-2 h-3 w-3 rounded-full"
                      style={{ backgroundColor: colors.remaining }}
                    />
                    <Text className="font-semibold" style={{ color: colors.primary }}>
                      Remaining
                    </Text>
                  </View>
                  <Text className="font-semibold" style={{ color: colors.secondary }}>
                    {formatAmount(remainingBudget ?? 0)}
                  </Text>
                </View>
              </View>
            </View>
          ) : null}
          <Text className={hasPieData ? "mt-3" : ""} style={{ color: colors.secondary }}>
            {distributionMessage}
          </Text>
        </View>

        <View
          className="rounded-2xl border p-4 shadow"
          style={{ backgroundColor: colors.card, borderColor: colors.border }}
        >
          <Text className="mb-3 text-lg font-bold" style={{ color: colors.primary }}>
            Daily Expense Trend
          </Text>

          {dailyTrendData.length === 0 ? (
            <Text style={{ color: colors.secondary }}>
              No expenses yet. Add expenses to see your daily trend.
            </Text>
          ) : (
            <View>
              <VictoryChart
                width={chartWidth}
                height={280}
                padding={{ top: 20, bottom: 52, left: 56, right: 24 }}
                theme={VictoryTheme.material}
                domain={{
                  y: [0, Math.max(maxTrendValue * 1.2, 1)],
                }}
                domainPadding={{ x: 20, y: 40 }}
              >
                <VictoryAxis
                  tickValues={trendTickValues}
                  tickFormat={(tick) => formatDateLabel(String(tick))}
                  style={{
                    axis: { stroke: colors.border },
                    tickLabels: { fill: colors.secondary, fontSize: 10, padding: 6 },
                    grid: { stroke: "transparent" },
                  }}
                />
                <VictoryAxis
                  dependentAxis
                  tickFormat={(tick) => formatYAxisTick(Number(tick))}
                  style={{
                    axis: { stroke: colors.border },
                    tickLabels: { fill: colors.secondary, fontSize: 10, padding: 6 },
                    grid: { stroke: isDarkMode ? "#1e293b" : "#f1f5f9" },
                  }}
                />
                <VictoryArea
                  data={dailyTrendData}
                  interpolation="monotoneX"
                  animate={{
                    duration: 1200,
                    onLoad: { duration: 800 },
                  }}
                  style={{
                    data: {
                      fill: "#3b82f6",
                      fillOpacity: 0.15,
                      strokeWidth: 0,
                    },
                  }}
                />
                <VictoryLine
                  data={dailyTrendData}
                  interpolation="monotoneX"
                  animate={{
                    duration: 1200,
                    easing: "quadInOut",
                    onLoad: { duration: 800 },
                  }}
                  style={{
                    data: {
                      stroke: "#3b82f6",
                      strokeWidth: 3,
                    },
                  }}
                />
                <VictoryScatter
                  data={dailyTrendData}
                  size={4}
                  animate={{ duration: 1000 }}
                  labels={({ datum }) => formatAmount(Number(datum.y))}
                  labelComponent={
                    <VictoryTooltip
                      renderInPortal={false}
                      flyoutStyle={{
                        fill: isDarkMode ? "#1e293b" : "#ffffff",
                        stroke: colors.border,
                      }}
                      style={{ fill: colors.primary, fontSize: 12 }}
                    />
                  }
                  style={{
                    data: { fill: "#3b82f6" },
                  }}
                />
              </VictoryChart>

              <View style={{ marginTop: 16 }}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  {monthDates.map((date) => {
                    const dayNumber = Number(date.slice(-2));
                    const hasExpense = expenseDates.has(date);

                    return (
                      <View
                        key={date}
                        style={{
                          marginRight: 8,
                          paddingVertical: 6,
                          paddingHorizontal: 10,
                          borderRadius: 12,
                          backgroundColor: hasExpense
                            ? "#3b82f6"
                            : isDarkMode
                              ? "#1e293b"
                              : "#e2e8f0",
                        }}
                      >
                        <Text
                          style={{
                            fontSize: 12,
                            color: hasExpense ? "#ffffff" : colors.secondary,
                            fontWeight: hasExpense ? "600" : "400",
                          }}
                        >
                          {dayNumber}
                        </Text>
                      </View>
                    );
                  })}
                </ScrollView>
              </View>
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
