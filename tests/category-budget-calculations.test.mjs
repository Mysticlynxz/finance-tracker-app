import assert from "node:assert/strict";
import { test } from "node:test";
import {
  aggregateCategoryBudgetSpending,
  buildAvailableCategoryOptions,
  calculateCategoryBudgetProgress,
  categoryLimitsExceedOverallBudget,
  normalizeCategoryKey,
} from "../lib/categoryBudgetCalculations.ts";
import { convertFromINR, convertToINR, SUPPORTED_CURRENCIES } from "../constants/currency.ts";
import { executeCategoryBudgetRequest } from "../lib/categoryBudgetExecution.ts";
import { loadCategorySource } from "../lib/categoryBudgetLoading.ts";

test("category limit progress handles no limit, zero spend, and over-limit spending", () => {
  assert.deepEqual(calculateCategoryBudgetProgress(25), {
    hasLimit: false, remainingInINR: null, usagePercent: null, progress: null, isOverLimit: false,
  });
  assert.equal(calculateCategoryBudgetProgress(0, 100).usagePercent, 0);
  const over = calculateCategoryBudgetProgress(150, 100);
  assert.equal(over.remainingInINR, 0);
  assert.equal(over.usagePercent, 150);
  assert.equal(over.progress, 1);
  assert.equal(over.isOverLimit, true);
});

test("category limits exceeding overall budget only trigger a warning condition", () => {
  assert.equal(categoryLimitsExceedOverallBudget([60, 50], 100), true);
  assert.equal(categoryLimitsExceedOverallBudget([40, 50], 100), false);
  assert.equal(categoryLimitsExceedOverallBudget([100], 0), false);
});

test("selected currency amounts round-trip through INR for all supported currencies", () => {
  for (const currency of SUPPORTED_CURRENCIES) {
    const entered = 125.25;
    assert.equal(convertFromINR(convertToINR(entered, currency), currency), entered, currency);
  }
});

test("category spending groups NFKC, case, and whitespace variants without losing totals", () => {
  const grouped = aggregateCategoryBudgetSpending([
    { category: "Food", amount: 500 },
    { category: "Ｆood", amount: 300 },
    { category: "FOOD", amount: 200 },
    { category: "  Food  ", amount: 100 },
    { category: "Travel", amount: 75 },
  ], (item) => item.category, (item) => item.amount);

  assert.deepEqual(grouped, [
    { key: "food", name: "Food", amountInINR: 1100 },
    { key: "travel", name: "Travel", amountInINR: 75 },
  ]);
  assert.equal(normalizeCategoryKey(" ＦOOD "), "food");
});

test("blank categories group under Uncategorized and normalized limits match", () => {
  const grouped = aggregateCategoryBudgetSpending([
    { category: "", amount: 20 },
    { category: "   ", amount: 30 },
    { category: null, amount: 10 },
    { category: "  Ｆood ", amount: 40 },
  ], (item) => item.category, (item) => item.amount);
  assert.deepEqual(grouped, [
    { key: "uncategorized", name: "Uncategorized", amountInINR: 60 },
    { key: "food", name: "Ｆood", amountInINR: 40 },
  ]);
  const configuredLimitKey = normalizeCategoryKey("Food");
  assert.equal(grouped.find((item) => item.key === configuredLimitKey)?.amountInINR, 40);
});

test("category-budget execution uses the authenticated Functions client without reserved custom headers", async () => {
  let received;
  const authenticatedFunctionsClient = {
    async createExecution(params) {
      received = params;
      return {
        status: "completed",
        responseStatusCode: 200,
        responseBody: JSON.stringify({ ok: true, budgets: [] }),
      };
    },
  };

  const result = await executeCategoryBudgetRequest(authenticatedFunctionsClient, "category-budgets", { action: "list" });
  assert.equal(result.ok, true);
  assert.equal(received.functionId, "category-budgets");
  assert.equal(received.async, false);
  assert.equal(received.method, "POST");
  assert.deepEqual(JSON.parse(received.body), { action: "list" });
  assert.equal(received.headers, undefined);
  assert.equal(Object.keys(received).some((key) => key.toLowerCase().startsWith("x-appwrite")), false);
});

test("category picker retains built-in order, adds sorted custom options, and deduplicates normalized collisions", () => {
  const options = buildAvailableCategoryOptions(
    [{ name: "Food", icon: "🍎" }, { name: "Bills", icon: "💡" }],
    [{ name: "z-custom", icon: "Z" }, { name: " Ｆood ", icon: "F" }, { name: "a-custom", icon: "A" }],
    []
  );
  assert.deepEqual(options, [
    { name: "Food", icon: "🍎", source: "built-in" },
    { name: "Bills", icon: "💡", source: "built-in" },
    { name: "a-custom", icon: "A", source: "custom" },
    { name: "z-custom", icon: "Z", source: "custom" },
  ]);
});

test("active limits are excluded while deleted limits do not block a category option", () => {
  const categories = [{ name: "Food", icon: "🍎" }, { name: "Travel", icon: "✈️" }];
  const withActiveFoodLimit = buildAvailableCategoryOptions(categories, [], [" food "]);
  assert.deepEqual(withActiveFoodLimit.map(({ name }) => name), ["Travel"]);

  // The backend list omits tombstones, so a deleted limit contributes no active key.
  const afterDeletion = buildAvailableCategoryOptions(categories, [], []);
  assert.deepEqual(afterDeletion.map(({ name }) => name), ["Food", "Travel"]);
  const refreshedAfterCreate = buildAvailableCategoryOptions(categories, [], ["food"]);
  assert.deepEqual(refreshedAfterCreate.map(({ name }) => name), ["Travel"]);
});

test("budget and custom-category loads keep independent success and failure results", async () => {
  const [budgetsOk, customFailed] = await Promise.all([
    loadCategorySource(async () => ["monthly-limit"]),
    loadCategorySource(async () => { throw new Error("custom categories unavailable"); }),
  ]);
  assert.deepEqual(budgetsOk, { ok: true, value: ["monthly-limit"] });
  assert.equal(customFailed.ok, false);
  assert.match(customFailed.error.message, /custom categories unavailable/);

  const [budgetsFailed, customOk] = await Promise.all([
    loadCategorySource(async () => { throw new Error("category budgets unavailable"); }),
    loadCategorySource(async () => ["custom-category"]),
  ]);
  assert.equal(budgetsFailed.ok, false);
  assert.match(budgetsFailed.error.message, /category budgets unavailable/);
  assert.deepEqual(customOk, { ok: true, value: ["custom-category"] });

  const [bothFailedBudgets, bothFailedCustom] = await Promise.all([
    loadCategorySource(async () => { throw new Error("budgets failed"); }),
    loadCategorySource(async () => { throw new Error("customs failed"); }),
  ]);
  assert.equal(bothFailedBudgets.ok, false);
  assert.equal(bothFailedCustom.ok, false);
});

test("custom-category loading can retry successfully without another budget request", async () => {
  let budgetLoads = 0;
  let customLoads = 0;
  const loadBudgets = async () => { budgetLoads += 1; return ["limit"]; };
  const loadCustomCategories = async () => {
    customLoads += 1;
    if (customLoads === 1) throw new Error("temporary custom category failure");
    return ["my-category"];
  };

  const firstBudgetResult = await loadCategorySource(loadBudgets);
  const firstCustomResult = await loadCategorySource(loadCustomCategories);
  assert.equal(firstBudgetResult.ok, true);
  assert.equal(firstCustomResult.ok, false);

  const retryResult = await loadCategorySource(loadCustomCategories);
  assert.deepEqual(retryResult, { ok: true, value: ["my-category"] });
  assert.equal(budgetLoads, 1);
  assert.equal(customLoads, 2);
});
