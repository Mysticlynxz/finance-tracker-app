import assert from "node:assert/strict";
import { test } from "node:test";
import {
  aggregateCategorySpending,
  aggregateDailyAmounts,
  aggregateSpendingForMonth,
  compareSpendingTotals,
  filterItemsForMonth,
  getCalendarMonthKey,
  isBudgetMonthAhead,
  getCalendarDateKey,
  getCurrentMonthDateKeys,
  getMonthToDateDateKeys,
  getPreviousMonthToDateDateKeys,
  getPreviousCompletedMonthDateKeys,
  getHistoricalBudgetRecommendation,
  getRecentCompletedMonthDateKeys,
  sumAmountsCompensated,
} from "../lib/reportDates.ts";

test("current month day keys use Asia/Kolkata calendar boundaries", () => {
  const keys = getCurrentMonthDateKeys(new Date("2026-11-01T00:30:00+05:30"));
  assert.equal(keys[0], "2026-11-01");
  assert.equal(keys.at(-1), "2026-11-30");
  assert.equal(keys.length, 30);
});

test("canonical budget month ignores device offset and handles year and leap-month transitions", () => {
  const decemberBeforeBoundary = new Date("2026-12-31T18:29:59.000Z");
  const januaryAtBoundaryUtc = new Date("2026-12-31T18:30:00.000Z");
  assert.equal(getCalendarMonthKey(decemberBeforeBoundary), "2026-12");
  assert.equal(getCalendarMonthKey(januaryAtBoundaryUtc), "2027-01");
  for (const offsetRepresentation of [
    "2026-12-31T13:30:00-05:00",
    "2027-01-01T01:30:00+07:00",
    "2026-12-31T18:30:00Z",
  ]) {
    assert.equal(getCalendarMonthKey(new Date(offsetRepresentation)), "2027-01");
  }

  const leapDayBefore = new Date("2028-02-28T18:29:59.000Z");
  const leapDayStart = new Date("2028-02-28T18:30:00.000Z");
  assert.equal(getCalendarMonthKey(leapDayBefore), "2028-02");
  assert.equal(getCalendarMonthKey(leapDayStart), "2028-02");
  assert.equal(getCurrentMonthDateKeys(leapDayStart).length, 29);

  const marchBoundary = new Date("2028-03-31T18:30:00.000Z");
  assert.equal(getCalendarMonthKey(marchBoundary), "2028-04");
  assert.equal(isBudgetMonthAhead("2027-01", "2026-12"), true);
  assert.equal(isBudgetMonthAhead("2026-11", "2026-12"), false);
  assert.equal(isBudgetMonthAhead("invalid", "2026-12"), false);
});

test("date keys preserve date-only calendar dates and use Kolkata days for timestamps", () => {
  assert.equal(getCalendarDateKey("2026-11-01"), "2026-11-01");
  assert.equal(getCalendarDateKey("2026-10-31T19:00:00.000Z"), "2026-11-01");
  assert.equal(getCalendarDateKey("2026-11-30T18:30:00.000Z"), "2026-12-01");
  assert.equal(getCalendarDateKey("invalid"), null);
});

test("month filter and daily totals share the same boundary and aggregate per calendar day", () => {
  const monthKeys = getCurrentMonthDateKeys(new Date("2026-11-15T12:00:00+05:30"));
  const expenses = [
    { date: "2026-10-31T18:29:59.000Z", amount: 100 },
    { date: "2026-10-31T18:30:00.000Z", amount: 10 },
    { date: "2026-10-31T19:00:00.000Z", amount: 20 },
    { date: "2026-11-30T18:29:59.000Z", amount: 30 },
    { date: "2026-11-30T18:30:00.000Z", amount: 1000 },
  ];
  const filtered = filterItemsForMonth(expenses, monthKeys);
  assert.deepEqual(filtered.map(({ amount }) => amount), [10, 20, 30]);
  assert.deepEqual(aggregateDailyAmounts(filtered, ({ amount }) => amount), [
    { x: "2026-11-01", y: 30 },
    { x: "2026-11-30", y: 30 },
  ]);
});

test("aggregation skips invalid dates and non-finite amounts", () => {
  const items = [
    { date: "invalid", amount: 50 },
    { date: "2026-11-01", amount: Infinity },
    { date: "2026-11-01", amount: 1.234 },
  ];
  assert.deepEqual(aggregateDailyAmounts(items, ({ amount }) => amount), [
    { x: "2026-11-01", y: 1.23 },
  ]);
});

test("category aggregation trims names, groups case-insensitively, and includes uncategorized expenses", () => {
  const expenses = [
    { category: " Food ", amount: 75 },
    { category: "food", amount: 25 },
    { category: "Bills", amount: 100 },
    { category: "   ", amount: 50 },
  ];
  const categories = aggregateCategorySpending(expenses, ({ amount }) => amount);
  assert.deepEqual(categories, [
    { name: "Food", amount: 100, percentage: 40 },
    { name: "Bills", amount: 100, percentage: 40 },
    { name: "Uncategorized", amount: 50, percentage: 20 },
  ]);
  assert.deepEqual(categories.filter(({ amount }) => amount === categories[0].amount).map(({ name }) => name), ["Food", "Bills"]);
});

test("zero category total returns zero percentages without division errors", () => {
  const categories = aggregateCategorySpending(
    [{ category: "Food", amount: 0 }, { category: " food ", amount: 0 }],
    ({ amount }) => amount
  );
  assert.deepEqual(categories, [{ name: "Food", amount: 0, percentage: 0 }]);
});

test("category aggregation retains raw sub-cent INR totals and percentages", () => {
  const categories = aggregateCategorySpending(
    [
      { category: "Food", amount: 0.005 },
      { category: "Travel", amount: 0.005 },
    ],
    ({ amount }) => amount
  );
  assert.deepEqual(categories, [
    { name: "Food", amount: 0.005, percentage: 50 },
    { name: "Travel", amount: 0.005, percentage: 50 },
  ]);
});

test("compensated report sums retain small values beside large amounts", () => {
  assert.equal(sumAmountsCompensated([10_000_000_000_000, 0.05, 0.004]), 10_000_000_000_000.055);
  const categories = aggregateCategorySpending(
    [
      { category: "Food", amount: 10_000_000_000_000 },
      { category: "food", amount: 0.05 },
      { category: "Food", amount: 0.004 },
    ],
    ({ amount }) => amount
  );
  assert.equal(categories[0].amount, 10_000_000_000_000.055);
});

test("monthly spending aggregation includes only the Asia/Kolkata calendar month", () => {
  const expenses = [
    { date: "2026-10-31T18:29:59.000Z", amount: 100 },
    { date: "2026-10-31T18:30:00.000Z", amount: 25 },
    { date: "2026-11-15T10:00:00.000Z", amount: 50 },
    { date: "2026-11-30T18:30:00.000Z", amount: 900 },
  ];
  const monthly = aggregateSpendingForMonth(
    expenses,
    ({ amount }) => amount,
    getCurrentMonthDateKeys(new Date("2026-11-15T12:00:00+05:30"))
  );
  assert.deepEqual(monthly.items.map(({ amount }) => amount), [25, 50]);
  assert.equal(monthly.total, 75);
});

test("completed month keys handle December rollover and leap February", () => {
  assert.equal(getPreviousCompletedMonthDateKeys(new Date("2027-01-03T12:00:00+05:30"))[0], "2026-12-01");
  assert.equal(getPreviousCompletedMonthDateKeys(new Date("2027-01-03T12:00:00+05:30")).at(-1), "2026-12-31");
  const march = getPreviousCompletedMonthDateKeys(new Date("2024-03-15T12:00:00+05:30"));
  assert.equal(march.length, 29);
  assert.equal(march.at(-1), "2024-02-29");
  assert.equal(getRecentCompletedMonthDateKeys(3, new Date("2027-01-15T12:00:00+05:30"))[2][0], "2026-10-01");
});

test("recommendation averages only completed months with expense history and adds 10 percent", () => {
  const expenses = [
    { date: "2026-10-02", amount: 1000 },
    { date: "2026-12-10", amount: 3000 },
    { date: "2027-01-02", amount: 9000 },
    { date: "2026-09-15", amount: 7000 },
  ];
  assert.deepEqual(
    getHistoricalBudgetRecommendation(expenses, ({ amount }) => amount, new Date("2027-01-15T12:00:00+05:30")),
    {
      monthsWithHistory: 2,
      averageMonthlySpendingInINR: 2000,
      recommendedBudgetInINR: 2200,
    }
  );
});

test("recommendation explains sparse history without treating empty months as zero", () => {
  const now = new Date("2027-01-15T12:00:00+05:30");
  const noHistory = getHistoricalBudgetRecommendation([], ({ amount }) => amount, now);
  assert.deepEqual(noHistory, {
    monthsWithHistory: 0,
    averageMonthlySpendingInINR: null,
    recommendedBudgetInINR: null,
  });
  const oneMonth = getHistoricalBudgetRecommendation(
    [{ date: "2026-11-03", amount: 500 }],
    ({ amount }) => amount,
    now
  );
  assert.equal(oneMonth.monthsWithHistory, 1);
  assert.equal(oneMonth.recommendedBudgetInINR, 550);
});

test("month-to-date periods use matching elapsed days and clamp shorter previous months", () => {
  const march31 = new Date("2026-03-31T12:00:00+05:30");
  const current = getMonthToDateDateKeys(march31);
  const previous = getPreviousMonthToDateDateKeys(march31);
  assert.equal(current.length, 31);
  assert.equal(current.at(-1), "2026-03-31");
  assert.equal(previous.length, 28);
  assert.equal(previous.at(-1), "2026-02-28");

  const leapMarch31 = new Date("2024-03-31T12:00:00+05:30");
  assert.equal(getPreviousMonthToDateDateKeys(leapMarch31).length, 29);
  assert.equal(getPreviousMonthToDateDateKeys(leapMarch31).at(-1), "2024-02-29");
});

test("month-to-date periods handle December-to-January rollover", () => {
  const now = new Date("2027-01-05T12:00:00+05:30");
  assert.deepEqual(getMonthToDateDateKeys(now), [
    "2027-01-01", "2027-01-02", "2027-01-03", "2027-01-04", "2027-01-05",
  ]);
  assert.deepEqual(getPreviousMonthToDateDateKeys(now), [
    "2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04", "2026-12-05",
  ]);
});

test("current and previous month-to-date totals use equivalent Asia/Kolkata dates", () => {
  const now = new Date("2027-01-05T12:00:00+05:30");
  const expenses = [
    { date: "2026-12-04T18:30:00.000Z", amount: 10 },
    { date: "2027-01-04T18:30:00.000Z", amount: 20 },
    { date: "2027-01-05T18:29:59.000Z", amount: 30 },
    { date: "2027-01-05T18:30:00.000Z", amount: 999 },
  ];
  const current = filterItemsForMonth(expenses, getMonthToDateDateKeys(now))
    .reduce((sum, expense) => sum + expense.amount, 0);
  const previous = filterItemsForMonth(expenses, getPreviousMonthToDateDateKeys(now))
    .reduce((sum, expense) => sum + expense.amount, 0);
  assert.equal(current, 50);
  assert.equal(previous, 10);
});

test("comparison handles zero prior spending without invalid percentages", () => {
  assert.deepEqual(compareSpendingTotals(0, 0), {
    difference: 0, percentChange: null, direction: "unchanged",
  });
  assert.deepEqual(compareSpendingTotals(100, 0), {
    difference: 100, percentChange: null, direction: "increased",
  });
  assert.deepEqual(compareSpendingTotals(0, 100), {
    difference: -100, percentChange: -100, direction: "decreased",
  });
});
