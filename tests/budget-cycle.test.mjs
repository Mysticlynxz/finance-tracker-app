import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BUDGET_MONTH_STORAGE_KEY,
  getBudgetMigrationStateKey,
  syncBudgetMonth,
} from "../lib/budgetCycleCore.ts";

const identity = (overrides = {}) => ({
  amount: 50000,
  userId: "user-a",
  documentId: "budget-a",
  createdAt: "2026-10-15T12:00:00.000Z",
  ...overrides,
});
const createStorage = (monthKey = null, entries = {}) => {
  const values = new Map(Object.entries(entries));
  if (monthKey !== null) values.set(BUDGET_MONTH_STORAGE_KEY, monthKey);
  return {
    values,
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => { values.set(key, value); },
  };
};
const createdMonth = (createdAt) => createdAt.slice(0, 7);

test("eligible legacy budget one month behind migrates without reset or amount change", async () => {
  const budget = identity();
  const storage = createStorage("2026-11");
  let resetCount = 0;
  const result = await syncBudgetMonth(budget, async () => { resetCount++; }, storage, "2026-12", createdMonth);
  assert.deepEqual(result, { budgetAmount: 50000, wasReset: false });
  assert.equal(resetCount, 0);
  assert.equal(storage.values.get(BUDGET_MONTH_STORAGE_KEY), "2026-12");
  assert.ok(storage.values.has(getBudgetMigrationStateKey(budget)));
});

test("User A completion does not act as User B migration state", async () => {
  const budgetA = identity();
  const budgetB = identity({ userId: "user-b", documentId: "budget-b" });
  const storage = createStorage("2026-11");
  await syncBudgetMonth(budgetA, async () => {}, storage, "2026-12", createdMonth);
  let resetCountB = 0;
  const resultB = await syncBudgetMonth(budgetB, async () => { resetCountB++; }, storage, "2026-12", createdMonth);
  assert.equal(resultB.budgetAmount, 50000);
  assert.equal(resetCountB, 0);
  assert.notEqual(getBudgetMigrationStateKey(budgetA), getBudgetMigrationStateKey(budgetB));
  assert.ok(storage.values.has(getBudgetMigrationStateKey(budgetB)));
});

test("newly created budget does not reuse legacy migration state", async () => {
  const budget = identity({ createdAt: "2026-12-04T10:00:00.000Z" });
  const storage = createStorage("2026-11");
  let resetCount = 0;
  const result = await syncBudgetMonth(budget, async () => { resetCount++; }, storage, "2026-12", createdMonth);
  assert.equal(result.budgetAmount, budget.amount);
  assert.equal(resetCount, 0);
  assert.deepEqual(JSON.parse(storage.values.get(getBudgetMigrationStateKey(budget))), {
    monthKey: "2026-12",
    createdAt: budget.createdAt,
  });
});

test("matching canonical month stays active without resetting", async () => {
  const budget = identity();
  const storage = createStorage("2026-12");
  let resetCount = 0;
  const result = await syncBudgetMonth(budget, async () => { resetCount++; }, storage, "2026-12", createdMonth);
  assert.deepEqual(result, { budgetAmount: budget.amount, wasReset: false });
  assert.equal(resetCount, 0);
  assert.equal(JSON.parse(storage.values.get(getBudgetMigrationStateKey(budget))).monthKey, "2026-12");
});

test("recreated budget document receives a distinct migration identity", async () => {
  const oldBudget = identity();
  const replacement = identity({ documentId: "budget-recreated", createdAt: "2026-12-05T10:00:00.000Z" });
  const storage = createStorage("2026-11");
  await syncBudgetMonth(oldBudget, async () => {}, storage, "2026-12", createdMonth);
  const result = await syncBudgetMonth(replacement, async () => { throw new Error("must not reset new budget"); }, storage, "2026-12", createdMonth);
  assert.equal(result.budgetAmount, replacement.amount);
  assert.notEqual(getBudgetMigrationStateKey(oldBudget), getBudgetMigrationStateKey(replacement));
});

test("per-budget migration state survives a new app-process invocation", async () => {
  const budget = identity();
  const storage = createStorage("2026-11");
  await syncBudgetMonth(budget, async () => {}, storage, "2026-12", createdMonth);
  const restartedStorage = {
    getItem: storage.getItem,
    setItem: storage.setItem,
  };
  let resetCount = 0;
  const result = await syncBudgetMonth(budget, async () => { resetCount++; }, restartedStorage, "2026-12", createdMonth);
  assert.equal(result.budgetAmount, budget.amount);
  assert.equal(resetCount, 0);
});

test("interrupted scoped-state write fails closed and retry does not reset or alter the budget", async () => {
  const budget = identity();
  const storage = createStorage("2026-11");
  const key = getBudgetMigrationStateKey(budget);
  const failingStorage = {
    getItem: storage.getItem,
    setItem: async (writeKey, value) => {
      if (writeKey === key) throw new Error("simulated storage failure");
      await storage.setItem(writeKey, value);
    },
  };
  let resetCount = 0;
  await assert.rejects(syncBudgetMonth(budget, async () => { resetCount++; }, failingStorage, "2026-12", createdMonth), /simulated storage failure/);
  assert.equal(resetCount, 0);
  assert.equal(storage.values.get(BUDGET_MONTH_STORAGE_KEY), "2026-11");
  const retry = await syncBudgetMonth(budget, async () => { resetCount++; }, storage, "2026-12", createdMonth);
  assert.equal(retry.budgetAmount, 50000);
  assert.equal(resetCount, 0);
});

test("one-month-ahead marker preserves the existing budget without using another identity", async () => {
  const budget = identity();
  const storage = createStorage("2027-01");
  const result = await syncBudgetMonth(budget, async () => { throw new Error("must preserve ahead marker"); }, storage, "2026-12", createdMonth);
  assert.equal(result.budgetAmount, budget.amount);
  const state = JSON.parse(storage.values.get(getBudgetMigrationStateKey(budget)));
  assert.equal(state.monthKey, "2027-01");
});

test("several-months-behind marker triggers normal stale-budget reset", async () => {
  const budget = identity();
  const storage = createStorage("2026-09");
  let resetCount = 0;
  const result = await syncBudgetMonth(budget, async () => { resetCount++; }, storage, "2026-12", createdMonth);
  assert.deepEqual(result, { budgetAmount: null, wasReset: true });
  assert.equal(resetCount, 1);
  assert.equal(storage.values.get(BUDGET_MONTH_STORAGE_KEY), "2026-12");
});

test("normal reset resumes after migration and December-to-January is handled", async () => {
  const budget = identity();
  const storage = createStorage("2026-11");
  await syncBudgetMonth(budget, async () => {}, storage, "2026-12", createdMonth);
  let resetCount = 0;
  const january = await syncBudgetMonth(budget, async () => { resetCount++; }, storage, "2027-01", createdMonth);
  assert.deepEqual(january, { budgetAmount: null, wasReset: true });
  assert.equal(resetCount, 1);
  assert.equal(storage.values.get(BUDGET_MONTH_STORAGE_KEY), "2027-01");
});
