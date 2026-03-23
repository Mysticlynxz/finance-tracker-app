import { useCallback, useContext, useMemo, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { Dimensions, ScrollView, Text, View } from "react-native";
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
import { getBudget, getExpenses, type ExpenseDocument } from "../../lib/appwrite";

interface TrendPoint {
  x: string;
  y: number;
}

const formatDateLabel = (dateKey: string) => {
  const date = new Date(dateKey);
  if (Number.isNaN(date.getTime())) {
    return dateKey;
  }

  return `${date.getMonth() + 1}/${date.getDate()}`;
};

export default function Reports() {
  const { isDarkMode, formatAmount, convertFromUSD, currency } =
    useContext(ExpenseContext);
  const [expenses, setExpenses] = useState<ExpenseDocument[]>([]);
  const [budget, setBudgetState] = useState<number>(0);
  const screenWidth = Dimensions.get("window").width;
  const chartWidth = Math.max(screenWidth - 48, 280);
  const pieChartWidth = Math.max(screenWidth - 80, 220);
  const getCurrentMonthDates = () => {
    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth();
    const lastDay = new Date(year, month + 1, 0).getDate();

    return Array.from({ length: lastDay }, (_, index) => {
      const date = new Date(year, month, index + 1);
      return date.toISOString().slice(0, 10);
    });
  };

  useFocusEffect(
    useCallback(() => {
      const fetchBudget = async () => {
        try {
          const result = await getBudget();
          setBudgetState(result ?? 0);
        } catch (error) {
          console.error("Failed to fetch budget", error);
        }
      };

      void fetchBudget();
    }, [])
  );

  useFocusEffect(
    useCallback(() => {
      const fetchExpenses = async () => {
        try {
          const data = await getExpenses();
          setExpenses(data);
        } catch (error) {
          console.error("Failed to load expenses", error);
        }
      };

      void fetchExpenses();
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

  const totalExpense = useMemo(
    () => expenses.reduce((sum, expense) => sum + getExpenseAmount(expense), 0),
    [expenses]
  );
  const remainingBudget = Math.max(0, budget - totalExpense);
  const budgetUsagePercentage = budget > 0 ? (totalExpense / budget) * 100 : null;
  const convertedTotalExpense = convertFromUSD(totalExpense);
  const convertedRemainingBudget = convertFromUSD(remainingBudget);

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
    const totalsByDate: Record<string, number> = {};

    expenses.forEach((expense) => {
      const dateKey = expense.date.slice(0, 10);
      totalsByDate[dateKey] = (totalsByDate[dateKey] || 0) + getExpenseAmount(expense);
    });

    return Object.entries(totalsByDate)
      .sort(([a], [b]) => new Date(a).getTime() - new Date(b).getTime())
      .map(([date, amount]) => ({
        x: date,
        y: Number(amount.toFixed(2)),
      }));
  }, [expenses]);

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
    const convertedValue = convertFromUSD(value);
    return convertedValue.toFixed(0);
  };

  const maxTrendValue = useMemo(
    () => Math.max(...dailyTrendData.map((point) => point.y), 0),
    [dailyTrendData]
  );
  const monthDates = useMemo(() => getCurrentMonthDates(), []);
  const expenseDates = useMemo(
    () => new Set(dailyTrendData.map((point) => point.x)),
    [dailyTrendData]
  );

  const hasPieData = totalExpense > 0 || remainingBudget > 0;

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
          Display Currency: {currency}
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
            <Text style={{ color: colors.secondary }}>Total Expense</Text>
            <Text className="font-semibold" style={{ color: colors.primary }}>
              {formatAmount(totalExpense)}
            </Text>
          </View>

          <View className="mb-2 flex-row items-center justify-between">
            <Text style={{ color: colors.secondary }}>Current Budget</Text>
            <Text className="font-semibold" style={{ color: colors.primary }}>
              {formatAmount(budget)}
            </Text>
          </View>

          <View className="flex-row items-center justify-between">
            <Text style={{ color: colors.secondary }}>Budget Usage</Text>
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
                    {formatAmount(remainingBudget)}
                  </Text>
                </View>
              </View>
            </View>
          ) : (
            <Text style={{ color: colors.secondary }}>
              Set a budget or add expenses to view budget distribution.
            </Text>
          )}
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
                    const dayNumber = new Date(date).getDate();
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
