import assert from "node:assert/strict";
import { test } from "node:test";
import { createAuthSessionGuard } from "../lib/authSessionGuard.ts";
import { captureBudgetAlertSnapshot } from "../lib/budgetNotificationSnapshot.ts";
import { buildBudgetAlertNotificationContent } from "../lib/budgetNotificationContent.ts";
import { deliverBudgetAlertEvents } from "../lib/budgetNotificationDelivery.ts";
import {
  createBudgetNotificationPersistence,
  getBudgetAlertDeduplicationStorageKey,
  getBudgetAlertPreferenceStorageKey,
} from "../lib/budgetNotificationPersistence.ts";
import { enableBudgetAlertPermission } from "../lib/budgetNotificationPermissionFlow.ts";
import { saveManualExpenseWithBudgetAlerts } from "../lib/manualExpenseSave.ts";
import { runBudgetAlertSaveFlow } from "../lib/budgetNotificationSaveFlow.ts";
import { createBudgetNotificationScheduler } from "../lib/budgetNotificationSchedulerCore.ts";
import { runSessionBoundBudgetNotificationEvaluation } from "../lib/budgetNotificationSessionEvaluation.ts";
import { evaluateBudgetThresholds } from "../lib/budgetNotificationThresholds.ts";
import { saveVoiceExpenseBatchWithBudgetAlerts } from "../lib/voiceExpenseBatchSave.ts";

const appwriteAuth = await import("../lib/appwrite.ts");

const evaluateOverall = (previous, next, budget = 100) => evaluateBudgetThresholds({
  previousOverallSpendingInINR: previous,
  newOverallSpendingInINR: next,
  overallBudgetInINR: budget,
  previousCategorySpendingInINR: {},
  newCategorySpendingInINR: {},
  categoryBudgets: [],
});

test("overall alerts trigger on 79-to-80, 80-to-100, and 100-to-over-budget crossings", () => {
  assert.equal(evaluateOverall(79, 80)[0].threshold, "80");
  assert.equal(evaluateOverall(80, 100)[0].threshold, "100");
  assert.equal(evaluateOverall(100, 100.01)[0].threshold, "exceeded");
});

test("a jump across multiple thresholds emits only the highest alert", () => {
  const [event] = evaluateOverall(20, 130);
  assert.equal(event.threshold, "exceeded");
});

test("no alert is generated while spending remains on the same side of thresholds", () => {
  assert.deepEqual(evaluateOverall(81, 90), []);
  assert.deepEqual(evaluateOverall(100, 100), []);
  assert.deepEqual(evaluateOverall(110, 120), []);
});

test("category alerts use normalized keys and coexist with overall alerts", () => {
  const events = evaluateBudgetThresholds({
    previousOverallSpendingInINR: 75,
    newOverallSpendingInINR: 80,
    overallBudgetInINR: 100,
    previousCategorySpendingInINR: { "Food ": 79 },
    newCategorySpendingInINR: { "ＦOOD": 80 },
    categoryBudgets: [{ categoryKey: "food", category: "Food", amountInINR: 100 }],
  });
  assert.deepEqual(events.map(({ scope, threshold }) => [scope, threshold]), [
    ["overall", "80"],
    ["category", "80"],
  ]);
  assert.equal(events[1].categoryName, "Food");
});

test("missing, zero, negative, non-finite budgets and invalid spend are ignored", () => {
  const base = {
    previousOverallSpendingInINR: 0,
    newOverallSpendingInINR: 100,
    previousCategorySpendingInINR: {},
    newCategorySpendingInINR: { food: 100 },
    categoryBudgets: [
      { categoryKey: "food", category: "Food", amountInINR: 0 },
      { categoryKey: "travel", category: "Travel", amountInINR: -1 },
      { categoryKey: "bills", category: "Bills", amountInINR: Number.NaN },
    ],
  };
  assert.deepEqual(evaluateBudgetThresholds({ ...base, overallBudgetInINR: null }), []);
  assert.deepEqual(evaluateBudgetThresholds({ ...base, overallBudgetInINR: 0 }), []);
  assert.deepEqual(evaluateBudgetThresholds({ ...base, overallBudgetInINR: Infinity }), []);
  assert.deepEqual(evaluateOverall(-1, 100), []);
  assert.deepEqual(evaluateOverall(Number.NaN, 100), []);
});

test("duplicate normalized category limits produce at most one event", () => {
  const events = evaluateBudgetThresholds({
    previousOverallSpendingInINR: 0,
    newOverallSpendingInINR: 0,
    overallBudgetInINR: null,
    previousCategorySpendingInINR: { Food: 0 },
    newCategorySpendingInINR: { Food: 90 },
    categoryBudgets: [
      { categoryKey: "Food", category: "Food", amountInINR: 100 },
      { categoryKey: "ＦOOD ", category: "Ｆood", amountInINR: 100 },
    ],
  });
  assert.equal(events.length, 1);
});

test("notification content differentiates overall and category limits and formats display values", () => {
  const formatAmount = (amount) => `$${amount.toFixed(2)}`;
  assert.deepEqual(buildBudgetAlertNotificationContent({
    scope: "overall", threshold: "80", spentInINR: 80, limitInINR: 100, percentage: 80,
  }, formatAmount), {
    title: "Approaching budget",
    body: "Used 80% of your monthly budget: $80.00 of $100.00.",
  });
  assert.deepEqual(buildBudgetAlertNotificationContent({
    scope: "category", categoryKey: "food", categoryName: "Food", threshold: "exceeded",
    spentInINR: 110, limitInINR: 100, percentage: 110,
  }, formatAmount), {
    title: "Food · Budget exceeded",
    body: "Spent $110.00 against $100.00 (110%).",
  });
});

test("permission flow creates Android channel before checking or requesting permission", async () => {
  const calls = [];
  const result = await enableBudgetAlertPermission("android", {
    createAndroidChannel: async () => calls.push("channel"),
    getPermission: async () => { calls.push("check"); return { granted: false, canAskAgain: true }; },
    requestPermission: async () => { calls.push("request"); return { granted: true, canAskAgain: true }; },
  });
  assert.deepEqual(calls, ["channel", "check", "request"]);
  assert.equal(result.granted, true);
});

test("permission is not requested when already granted and denied permanence is preserved", async () => {
  let requested = false;
  const alreadyGranted = await enableBudgetAlertPermission("ios", {
    createAndroidChannel: async () => assert.fail("iOS should not create Android channels"),
    getPermission: async () => ({ granted: true, canAskAgain: true }),
    requestPermission: async () => { requested = true; return { granted: true, canAskAgain: true }; },
  });
  assert.equal(alreadyGranted.granted, true);
  assert.equal(requested, false);

  const denied = await enableBudgetAlertPermission("android", {
    createAndroidChannel: async () => undefined,
    getPermission: async () => ({ granted: false, canAskAgain: true }),
    requestPermission: async () => ({ granted: false, canAskAgain: false }),
  });
  assert.deepEqual(denied, { granted: false, canAskAgain: false });
});

test("permission denial remains askable when Android can show the prompt again", async () => {
  const result = await enableBudgetAlertPermission("android", {
    createAndroidChannel: async () => undefined,
    getPermission: async () => ({ granted: false, canAskAgain: true }),
    requestPermission: async () => ({ granted: false, canAskAgain: true }),
  });
  assert.deepEqual(result, { granted: false, canAskAgain: true });
});

const createMemoryStorage = () => {
  const values = new Map();
  const reads = [];
  const writes = [];
  return {
    values,
    reads,
    writes,
    async getItem(key) { reads.push(key); return values.get(key) ?? null; },
    async setItem(key, value) { writes.push([key, value]); values.set(key, value); },
  };
};

test("preferences and deduplication are isolated by user and month", async () => {
  const storage = createMemoryStorage();
  const persistence = createBudgetNotificationPersistence(storage);
  assert.equal(await persistence.getEnabled("user-a"), false);
  await persistence.setEnabled("user-a", true);
  assert.equal(await persistence.getEnabled("user-a"), true);
  assert.equal(await persistence.getEnabled("user-b"), false);

  await persistence.markDelivered("user-a", "2026-11", "overall:overall:80");
  assert.equal(await persistence.hasDelivered("user-a", "2026-11", "overall:overall:80"), true);
  assert.equal(await persistence.hasDelivered("user-a", "2026-12", "overall:overall:80"), false);
  assert.equal(await persistence.hasDelivered("user-b", "2026-11", "overall:overall:80"), false);
});

test("serialized concurrent evaluations prevent duplicate threshold scheduling", async () => {
  const persistence = createBudgetNotificationPersistence(createMemoryStorage());
  let schedules = 0;
  const scheduleEntered = deferred();
  const finishSchedule = deferred();
  const event = { scope: "overall", threshold: "80", spentInINR: 80, limitInINR: 100, percentage: 80 };
  const evaluateOnce = () => deliverBudgetAlertEvents(
    persistence,
    "user-a",
    "2026-11",
    [event],
    async () => {
      schedules++;
      scheduleEntered.resolve();
      await finishSchedule.promise;
    },
    () => undefined
  );
  const concurrentEvaluations = Promise.all([evaluateOnce(), evaluateOnce(), evaluateOnce()]);
  await scheduleEntered.promise;
  finishSchedule.resolve();
  await concurrentEvaluations;
  assert.equal(schedules, 1);
});

test("deduplication is persisted only after scheduling succeeds", async () => {
  const persistence = createBudgetNotificationPersistence(createMemoryStorage());
  const event = { scope: "category", categoryKey: "food", categoryName: "Food", threshold: "80", spentInINR: 80, limitInINR: 100, percentage: 80 };
  await deliverBudgetAlertEvents(
    persistence, "user-a", "2026-11", [event],
    async () => { throw new Error("schedule failed"); },
    () => undefined
  );
  assert.equal(await persistence.hasDelivered("user-a", "2026-11", "category:food:80"), false);

  let scheduled = 0;
  await deliverBudgetAlertEvents(
    persistence, "user-a", "2026-11", [event],
    async () => { scheduled++; },
    () => undefined
  );
  assert.equal(scheduled, 1);
  assert.equal(await persistence.hasDelivered("user-a", "2026-11", "category:food:80"), true);
});

test("a deduplication write failure avoids rescheduling during the current process", async () => {
  const storage = createMemoryStorage();
  storage.setItem = async () => { throw new Error("storage unavailable"); };
  const persistence = createBudgetNotificationPersistence(storage);
  const event = { scope: "overall", threshold: "100", spentInINR: 100, limitInINR: 100, percentage: 100 };
  let scheduled = 0;
  const deliver = () => deliverBudgetAlertEvents(
    persistence, "user-a", "2026-11", [event],
    async () => { scheduled++; },
    () => undefined
  );
  await deliver();
  await deliver();
  assert.equal(scheduled, 1);
});

test("storage failures remain isolated from a successful expense save", async () => {
  let saved = false;
  const result = await saveManualExpenseWithBudgetAlerts({
    input: { amount: 50 },
    createExpense: async () => { saved = true; return "saved"; },
    captureBefore: async () => { throw new Error("storage failure"); },
    evaluateAfter: async () => assert.fail("missing baseline must skip evaluation"),
    onNotificationError: () => undefined,
  });
  assert.equal(saved, true);
  assert.equal(result.result, "saved");
  await result.notificationTask;
});

test("manual save failure propagates and does not evaluate notifications", async () => {
  let evaluated = false;
  await assert.rejects(saveManualExpenseWithBudgetAlerts({
    input: { amount: 50 },
    createExpense: async () => { throw new Error("expense save failed"); },
    captureBefore: async () => ({ total: 0 }),
    evaluateAfter: async () => { evaluated = true; },
  }), /expense save failed/);
  assert.equal(evaluated, false);
});

test("manual helper persists first and keeps notification failure detached", async () => {
  const calls = [];
  const result = await saveManualExpenseWithBudgetAlerts({
    input: { amount: 75, category: "Food" },
    captureBefore: async () => ({ total: 10 }),
    createExpense: async (input) => { calls.push(["save", input]); return { $id: "manual-id" }; },
    evaluateAfter: async () => {
      calls.push(["evaluate"]);
      assert.equal(calls[0][0], "save");
      throw new Error("notification failed");
    },
    onNotificationError: () => calls.push(["notification-error"]),
  });
  await result.notificationTask;
  assert.equal(result.result.$id, "manual-id");
  assert.deepEqual(calls.map(([kind]) => kind), ["save", "evaluate", "notification-error"]);
});

test("voice production helper handles all-success, partial-success and all-failure batches", async () => {
  const expense = (id) => ({ id, amount: "10", category: " Food ", date: "2026-11-08" });
  const evaluations = [];
  const createBatch = (failingIds) => saveVoiceExpenseBatchWithBudgetAlerts({
    expenses: [expense("a"), expense("b")],
    createExpense: async ({ documentId }) => {
      if (failingIds.has(documentId)) throw new Error(`failed ${documentId}`);
    },
    convertToINR: (value) => value,
    toExpenseTimestamp: (value) => `${value}T12:00:00.000Z`,
    captureBefore: async () => ({ baseline: true }),
    evaluateAfter: async () => { evaluations.push("evaluate"); },
  });

  const allSuccess = await createBatch(new Set());
  assert.equal(allSuccess.result.savedCount, 2);
  assert.deepEqual([...allSuccess.result.failedIds], []);
  await allSuccess.notificationTask;

  const partial = await createBatch(new Set(["b"]));
  assert.equal(partial.result.savedCount, 1);
  assert.deepEqual([...partial.result.failedIds], ["b"]);
  await partial.notificationTask;

  const allFailure = await createBatch(new Set(["a", "b"]));
  assert.equal(allFailure.result.savedCount, 0);
  assert.deepEqual([...allFailure.result.failedIds].sort(), ["a", "b"]);
  await allFailure.notificationTask;

  assert.equal(evaluations.length, 2);
});

test("voice production helper saves batch expenses sequentially", async () => {
  const enteredFirst = deferred();
  const releaseFirst = deferred();
  const calls = [];
  const batchPromise = saveVoiceExpenseBatchWithBudgetAlerts({
    expenses: [
      { id: "first", amount: "10", category: " Food ", date: "2026-11-08" },
      { id: "second", amount: "20", category: "Bills", date: "2026-11-09" },
    ],
    createExpense: async (input) => {
      calls.push(input);
      if (input.documentId === "first") {
        enteredFirst.resolve();
        await releaseFirst.promise;
      }
    },
    convertToINR: (amount) => amount * 2,
    toExpenseTimestamp: (date) => `${date}T12:00:00.000Z`,
    captureBefore: async () => ({ before: true }),
    evaluateAfter: async () => undefined,
  });
  await enteredFirst.promise;
  assert.deepEqual(calls.map(({ documentId }) => documentId), ["first"]);
  releaseFirst.resolve();
  const batch = await batchPromise;
  await batch.notificationTask;
  assert.deepEqual(calls.map(({ documentId }) => documentId), ["first", "second"]);
  assert.equal(calls[0].amount, 20);
  assert.equal(calls[0].category, "Food");
  assert.equal(calls[0].date, "2026-11-08T12:00:00.000Z");
});

test("voice notification failure cannot change successful persisted batch results", async () => {
  let persisted = 0;
  const batch = await saveVoiceExpenseBatchWithBudgetAlerts({
    expenses: [{ id: "stable-1", amount: "12", category: "Food", date: "2026-11-08" }],
    createExpense: async () => { persisted++; },
    convertToINR: (amount) => amount,
    toExpenseTimestamp: (date) => `${date}T12:00:00.000Z`,
    captureBefore: async () => ({ total: 0 }),
    evaluateAfter: async () => { throw new Error("notification failure"); },
    onNotificationError: () => undefined,
  });
  await batch.notificationTask;
  assert.equal(persisted, 1);
  assert.equal(batch.result.savedCount, 1);
  assert.deepEqual([...batch.result.failedIds], []);
});

test("voice partial saves evaluate once and stable-ID retries do not duplicate the alert", async () => {
  const persistedById = new Map([["before", 70]]);
  const failNext = new Set(["retry-me"]);
  const persistence = createBudgetNotificationPersistence(createMemoryStorage());
  const notificationApi = makeNotificationApi();
  const scheduler = createBudgetNotificationScheduler(notificationApi, "android", "budget-alerts");
  let evaluationCount = 0;
  const total = () => [...persistedById.values()].reduce((sum, amount) => sum + amount, 0);

  const saveVoiceBatch = (expenses) => saveVoiceExpenseBatchWithBudgetAlerts({
    expenses,
    createExpense: async ({ documentId, amount }) => {
      if (failNext.delete(documentId)) throw new Error("transient Appwrite failure");
      // Appwrite's stable document ID keeps retries idempotent.
      persistedById.set(documentId, amount);
    },
    convertToINR: (amount) => amount,
    toExpenseTimestamp: (date) => `${date}T12:00:00.000Z`,
    captureBefore: async () => ({ spentInINR: total() }),
    evaluateAfter: async (before) => {
      evaluationCount++;
      const events = evaluateBudgetThresholds({
        previousOverallSpendingInINR: before.spentInINR,
        newOverallSpendingInINR: total(),
        overallBudgetInINR: 100,
        previousCategorySpendingInINR: {},
        newCategorySpendingInINR: {},
        categoryBudgets: [],
      });
      await deliverBudgetAlertEvents(
        persistence,
        "user-a",
        "2026-11",
        events,
        (event) => scheduler.scheduleBudgetAlert(event, (amount) => `₹${amount.toFixed(2)}`),
        () => undefined
      );
    },
  });

  const partial = await saveVoiceBatch([
    { id: "new-expense", amount: "10", category: "Food", date: "2026-11-08" },
    { id: "retry-me", amount: "5", category: "Bills", date: "2026-11-08" },
  ]);
  assert.equal(partial.result.savedCount, 1);
  assert.deepEqual([...partial.result.failedIds], ["retry-me"]);
  await partial.notificationTask;

  const retry = await saveVoiceBatch([{ id: "retry-me", amount: "5", category: "Bills", date: "2026-11-08" }]);
  assert.equal(retry.result.savedCount, 1);
  await retry.notificationTask;

  const retryAllStableIds = await saveVoiceBatch([
    { id: "new-expense", amount: "10", category: "Food", date: "2026-11-08" },
    { id: "retry-me", amount: "5", category: "Bills", date: "2026-11-08" },
  ]);
  await retryAllStableIds.notificationTask;

  assert.equal(evaluationCount, 3);
  assert.equal(total(), 85);
  assert.equal(notificationApi.calls.filter(([kind]) => kind === "schedule").length, 1);
  assert.equal(await persistence.hasDelivered("user-a", "2026-11", "overall:overall:80"), true);
});

test("successful manual expense save schedules one post-save evaluation", async () => {
  let evaluated = 0;
  const flow = await saveManualExpenseWithBudgetAlerts({
    input: { amount: 25 },
    captureBefore: async () => ({ total: 25 }),
    createExpense: async () => ({ id: "manual-1" }),
    evaluateAfter: async () => { evaluated++; },
  });
  assert.equal(flow.result.id, "manual-1");
  await flow.notificationTask;
  assert.equal(evaluated, 1);
});

test("retried stable IDs with no net spending change do not cross a threshold again", () => {
  assert.deepEqual(evaluateOverall(81, 81), []);
});

test("notification scheduling failures do not turn a saved expense into a failure", async () => {
  const result = await runBudgetAlertSaveFlow({
    captureBefore: async () => ({ total: 0 }),
    save: async () => "persisted",
    shouldEvaluate: () => true,
    evaluateAfter: async () => { throw new Error("schedule failed"); },
    onNotificationError: () => undefined,
  });
  assert.equal(result.result, "persisted");
  await result.notificationTask;
});

test("disabled alerts skip notification evaluation and create no retroactive event", async () => {
  let evaluations = 0;
  const flow = await runBudgetAlertSaveFlow({
    captureBefore: async () => null,
    save: async () => "saved",
    shouldEvaluate: () => true,
    evaluateAfter: async () => { evaluations++; },
  });
  await flow.notificationTask;
  assert.equal(evaluations, 0);
});

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

const sessionReader = (readCurrentSession) => createAuthSessionGuard(readCurrentSession);

const runRaceEvaluation = (guard, identity, overrides = {}) => {
  const calls = [];
  const isSessionCurrent = () => guard.isCurrent(identity);
  const evaluation = runSessionBoundBudgetNotificationEvaluation({
    isSessionCurrent,
    loadPreference: async () => { calls.push("preference"); return true; },
    checkPermission: async () => { calls.push("permission"); return true; },
    fetchCurrentData: async () => { calls.push("expenses"); return { userId: "user-a", total: 90 }; },
    buildEvents: (data) => { calls.push(`build:${data.userId}`); return [{ scope: "overall", threshold: "80" }]; },
    deliverEvents: async () => { calls.push("deliver"); },
    ...overrides,
  });
  return { calls, evaluation };
};

test("switching accounts while preferences load aborts before permissions or expense fetch", async () => {
  let current = { userId: "user-a", sessionId: "session-a" };
  const guard = sessionReader(async () => current);
  const identity = await guard.capture();
  const wait = deferred();
  const entered = deferred();
  const { calls, evaluation } = runRaceEvaluation(guard, identity, {
    loadPreference: async () => { calls.push("preference"); entered.resolve(); await wait.promise; return true; },
  });
  await entered.promise;

  const transition = guard.beginTransition();
  current = { userId: "user-b", sessionId: "session-b" };
  guard.finishTransition(transition);
  wait.resolve();

  assert.equal(await evaluation, false);
  assert.deepEqual(calls, ["preference"]);
});

test("switching accounts while permission is checked aborts before expense fetch", async () => {
  let current = { userId: "user-a", sessionId: "session-a" };
  const guard = sessionReader(async () => current);
  const identity = await guard.capture();
  const wait = deferred();
  const entered = deferred();
  const { calls, evaluation } = runRaceEvaluation(guard, identity, {
    checkPermission: async () => { calls.push("permission"); entered.resolve(); await wait.promise; return true; },
  });
  await entered.promise;

  const transition = guard.beginTransition();
  current = { userId: "user-b", sessionId: "session-b" };
  guard.finishTransition(transition);
  wait.resolve();

  assert.equal(await evaluation, false);
  assert.deepEqual(calls, ["preference", "permission"]);
});

test("switching accounts while expenses load discards returned data before event building", async () => {
  let current = { userId: "user-a", sessionId: "session-a" };
  const guard = sessionReader(async () => current);
  const identity = await guard.capture();
  const wait = deferred();
  const entered = deferred();
  const { calls, evaluation } = runRaceEvaluation(guard, identity, {
    fetchCurrentData: async () => { calls.push("expenses"); entered.resolve(); await wait.promise; return { userId: "user-b", total: 500 }; },
  });
  await entered.promise;

  const transition = guard.beginTransition();
  current = { userId: "user-b", sessionId: "session-b" };
  guard.finishTransition(transition);
  wait.resolve();

  assert.equal(await evaluation, false);
  assert.deepEqual(calls, ["preference", "permission", "expenses"]);
});

test("switch immediately before scheduling prevents delivery", async () => {
  let current = { userId: "user-a", sessionId: "session-a" };
  const guard = sessionReader(async () => current);
  const identity = await guard.capture();
  const calls = [];
  const wait = deferred();
  const entered = deferred();
  const evaluation = runSessionBoundBudgetNotificationEvaluation({
    isSessionCurrent: () => guard.isCurrent(identity),
    loadPreference: async () => true,
    checkPermission: async () => true,
    fetchCurrentData: async () => ({}),
    buildEvents: () => [{ scope: "overall", threshold: "80" }],
    deliverEvents: async () => {
      entered.resolve();
      await wait.promise;
      if (await guard.isCurrent(identity)) calls.push("scheduled");
    },
  });
  await entered.promise;
  const transition = guard.beginTransition();
  current = { userId: "user-b", sessionId: "session-b" };
  guard.finishTransition(transition);
  wait.resolve();

  assert.equal(await evaluation, false);
  assert.deepEqual(calls, []);
});

test("account change during notification scheduling cancels it and never marks delivered", async () => {
  let current = { userId: "user-a", sessionId: "session-a" };
  const guard = sessionReader(async () => current);
  const identity = await guard.capture();
  const persistence = createBudgetNotificationPersistence(createMemoryStorage());
  const event = { scope: "overall", threshold: "80", spentInINR: 80, limitInINR: 100, percentage: 80 };
  const wait = deferred();
  const entered = deferred();
  const calls = [];
  const transition = {
    isSessionCurrent: () => guard.isCurrent(identity),
    isGenerationCurrent: () => guard.isGenerationCurrent(identity),
    cancelScheduled: async (id) => { calls.push(`cancel:${id}`); },
  };
  const delivery = deliverBudgetAlertEvents(
    persistence,
    identity.userId,
    "2026-11",
    [event],
    async () => { calls.push("schedule"); entered.resolve(); await wait.promise; return "notification-a"; },
    () => calls.push("failure"),
    undefined,
    transition
  );
  await entered.promise;
  const authTransition = guard.beginTransition();
  current = { userId: "user-b", sessionId: "session-b" };
  guard.finishTransition(authTransition);
  wait.resolve();
  await delivery;

  assert.deepEqual(calls, ["schedule", "cancel:notification-a"]);
  assert.equal(await persistence.hasDelivered("user-a", "2026-11", "overall:overall:80"), false);
  assert.equal(await persistence.hasDelivered("user-b", "2026-11", "overall:overall:80"), false);
});

test("sign-out and sign-in invalidates pending work even if the original account returns", async () => {
  let current = { userId: "user-a", sessionId: "session-a" };
  const guard = sessionReader(async () => current);
  const identity = await guard.capture();
  const transition = guard.beginTransition();
  current = { userId: "user-b", sessionId: "session-b" };
  guard.finishTransition(transition);
  const nextTransition = guard.beginTransition();
  current = { userId: "user-a", sessionId: "session-a-new" };
  guard.finishTransition(nextTransition);

  assert.equal(await guard.isCurrent(identity), false);
  assert.equal(guard.isGenerationCurrent(identity), false);
});

test("same-user session without a generation change can finish and mark its alert", async () => {
  const current = { userId: "user-a", sessionId: "session-a" };
  const guard = sessionReader(async () => current);
  const identity = await guard.capture();
  const persistence = createBudgetNotificationPersistence(createMemoryStorage());
  const event = { scope: "overall", threshold: "80", spentInINR: 80, limitInINR: 100, percentage: 80 };
  await deliverBudgetAlertEvents(
    persistence,
    identity.userId,
    "2026-11",
    [event],
    async () => "notification-a",
    () => assert.fail("same-user delivery should succeed"),
    undefined,
    {
      isSessionCurrent: () => guard.isCurrent(identity),
      isGenerationCurrent: () => guard.isGenerationCurrent(identity),
      cancelScheduled: async () => assert.fail("valid notification should not be cancelled"),
    }
  );
  assert.equal(await persistence.hasDelivered("user-a", "2026-11", "overall:overall:80"), true);
});

test("stale evaluation does not mark delivery after account changes during deduplication read", async () => {
  let current = { userId: "user-a", sessionId: "session-a" };
  const guard = sessionReader(async () => current);
  const identity = await guard.capture();
  const storage = createMemoryStorage();
  const originalGet = storage.getItem.bind(storage);
  const read = deferred();
  const readEntered = deferred();
  const userBKey = getBudgetAlertDeduplicationStorageKey("user-b", "2026-11");
  storage.values.set(userBKey, JSON.stringify(["overall:overall:100"]));
  let delayed = true;
  storage.getItem = async (key) => {
    if (delayed && key.includes("/delivered/")) {
      delayed = false;
      readEntered.resolve();
      await read.promise;
    }
    return originalGet(key);
  };
  const persistence = createBudgetNotificationPersistence(storage);
  const event = { scope: "overall", threshold: "80", spentInINR: 80, limitInINR: 100, percentage: 80 };
  const calls = [];
  const delivery = deliverBudgetAlertEvents(
    persistence,
    "user-a",
    "2026-11",
    [event],
    async () => { calls.push("schedule"); },
    () => undefined,
    undefined,
    {
      isSessionCurrent: () => guard.isCurrent(identity),
      isGenerationCurrent: () => guard.isGenerationCurrent(identity),
      cancelScheduled: async () => undefined,
    }
  );
  await readEntered.promise;
  const transition = guard.beginTransition();
  current = { userId: "user-b", sessionId: "session-b" };
  guard.finishTransition(transition);
  read.resolve();
  await delivery;

  assert.deepEqual(calls, []);
  assert.equal(storage.reads.includes(getBudgetAlertDeduplicationStorageKey("user-a", "2026-11")), true);
  assert.equal(await persistence.hasDelivered("user-a", "2026-11", "overall:overall:80"), false);
  assert.deepEqual(JSON.parse(storage.values.get(userBKey)), ["overall:overall:100"]);
});

test("account changes and notification failures remain detached from successful expense persistence", async () => {
  let current = { userId: "user-a", sessionId: "session-a" };
  const guard = sessionReader(async () => current);
  const identity = await guard.capture();
  let saved = false;
  const flow = await runBudgetAlertSaveFlow({
    captureBefore: async () => ({ userId: identity.userId }),
    save: async () => { saved = true; return "persisted"; },
    shouldEvaluate: () => true,
    evaluateAfter: async () => {
      const transition = guard.beginTransition();
      current = { userId: "user-b", sessionId: "session-b" };
      guard.finishTransition(transition);
      if (!(await guard.isCurrent(identity))) throw new Error("stale notification task");
    },
    onNotificationError: () => undefined,
  });
  assert.equal(saved, true);
  assert.equal(flow.result, "persisted");
  await flow.notificationTask;
});

const createSnapshotTestContext = async () => {
  let current = { userId: "user-a", sessionId: "session-a" };
  const guard = createAuthSessionGuard(async () => current);
  const storage = createMemoryStorage();
  const persistence = createBudgetNotificationPersistence(storage);
  await persistence.setEnabled("user-a", true);
  storage.writes.length = 0;
  const expenseRequests = [];
  const calls = [];
  const dependencies = {
    captureSessionIdentity: () => guard.capture(),
    isSessionIdentityCurrent: (identity) => guard.isCurrent(identity),
    isSessionGenerationCurrent: (identity) => guard.isGenerationCurrent(identity),
    getPreference: (userId) => persistence.getEnabled(userId),
    hasPermission: async () => true,
    getExpenses: async (userId) => {
      expenseRequests.push(userId);
      calls.push("expenses");
      return [{ $id: "expense-a", userId, amount: 60, category: "Food", date: "2026-11-08" }];
    },
    getBudget: async (userId) => ({ amount: 100, userId, documentId: "budget-a", createdAt: "2026-01-01T00:00:00.000Z" }),
    clearBudget: async () => undefined,
    syncBudget: async (record) => ({ budgetAmount: record?.amount ?? null, wasReset: false }),
    carryForwardCategories: async () => undefined,
    listCategoryBudgets: async () => ({ budgets: [] }),
    now: () => new Date("2026-11-08T12:00:00.000Z"),
    logFailure: (stage) => calls.push(`log:${stage}`),
  };
  return {
    guard,
    persistence,
    storage,
    dependencies,
    calls,
    expenseRequests,
    setCurrent: (next) => { current = next; },
  };
};

const assertNoDeliveryStateWrites = (storage) => {
  assert.equal(storage.writes.some(([key]) => key.includes("/delivered/")), false);
};

test("production snapshot aborts when User A changes account while preferences load", async () => {
  const context = await createSnapshotTestContext();
  const entered = deferred();
  const release = deferred();
  const originalGet = context.storage.getItem.bind(context.storage);
  context.storage.getItem = async (key) => {
    if (key === getBudgetAlertPreferenceStorageKey("user-a")) {
      entered.resolve();
      await release.promise;
    }
    return originalGet(key);
  };
  let expenseSaved = false;
  let evaluated = false;
  const saveFlowPromise = runBudgetAlertSaveFlow({
    captureBefore: () => captureBudgetAlertSnapshot(context.dependencies),
    save: async () => { expenseSaved = true; return "expense-saved"; },
    shouldEvaluate: () => true,
    evaluateAfter: async () => { evaluated = true; },
  });
  await entered.promise;
  const transition = context.guard.beginTransition();
  context.setCurrent({ userId: "user-b", sessionId: "session-b" });
  context.guard.finishTransition(transition);
  release.resolve();

  const saveFlow = await saveFlowPromise;
  await saveFlow.notificationTask;
  assert.equal(saveFlow.result, "expense-saved");
  assert.equal(expenseSaved, true);
  assert.equal(evaluated, false);
  assert.deepEqual(context.expenseRequests, []);
  assertNoDeliveryStateWrites(context.storage);
});

test("production snapshot stays invalid after User A to B to A while preference read is pending", async () => {
  const context = await createSnapshotTestContext();
  const entered = deferred();
  const release = deferred();
  const originalGet = context.storage.getItem.bind(context.storage);
  context.storage.getItem = async (key) => {
    if (key === getBudgetAlertPreferenceStorageKey("user-a")) {
      entered.resolve();
      await release.promise;
    }
    return originalGet(key);
  };
  const notificationApi = makeNotificationApi();
  const scheduler = createBudgetNotificationScheduler(notificationApi, "android", "budget-alerts");
  let expenseSaved = false;
  let evaluationLaunched = false;
  const flowPromise = saveManualExpenseWithBudgetAlerts({
    input: { amount: 80 },
    createExpense: async () => { expenseSaved = true; return "saved"; },
    captureBefore: () => captureBudgetAlertSnapshot(context.dependencies),
    evaluateAfter: async () => {
      evaluationLaunched = true;
      await deliverBudgetAlertEvents(
        context.persistence,
        "user-a",
        "2026-11",
        [{ scope: "overall", threshold: "80", spentInINR: 80, limitInINR: 100, percentage: 80 }],
        (event) => scheduler.scheduleBudgetAlert(event, (amount) => `₹${amount.toFixed(2)}`),
        () => undefined
      );
    },
  });
  await entered.promise;

  const toUserB = context.guard.beginTransition();
  context.setCurrent({ userId: "user-b", sessionId: "session-b1" });
  context.guard.finishTransition(toUserB);
  const backToUserA = context.guard.beginTransition();
  context.setCurrent({ userId: "user-a", sessionId: "session-a2" });
  context.guard.finishTransition(backToUserA);
  release.resolve();

  const flow = await flowPromise;
  await flow.notificationTask;
  assert.equal(flow.result, "saved");
  assert.equal(expenseSaved, true);
  assert.equal(evaluationLaunched, false);
  assert.equal(notificationApi.calls.some(([kind]) => kind === "schedule"), false);
  assert.deepEqual(context.expenseRequests, []);
  assert.equal(context.calls.includes("expenses"), false);
  assertNoDeliveryStateWrites(context.storage);
});

test("production snapshot aborts when User A changes account during permission checking", async () => {
  const context = await createSnapshotTestContext();
  const entered = deferred();
  const release = deferred();
  context.dependencies.hasPermission = async () => {
    entered.resolve();
    await release.promise;
    return true;
  };
  const snapshotPromise = captureBudgetAlertSnapshot(context.dependencies);
  await entered.promise;
  const transition = context.guard.beginTransition();
  context.setCurrent({ userId: "user-b", sessionId: "session-b" });
  context.guard.finishTransition(transition);
  release.resolve();

  assert.equal(await snapshotPromise, null);
  assert.deepEqual(context.expenseRequests, []);
  assertNoDeliveryStateWrites(context.storage);
});

test("production snapshot discards expense response when account changes during Appwrite fetch", async () => {
  const context = await createSnapshotTestContext();
  const entered = deferred();
  const release = deferred();
  context.dependencies.getExpenses = async (userId) => {
    context.expenseRequests.push(userId);
    entered.resolve();
    await release.promise;
    // Simulate an adversarial/stale SDK result. The production path must never return it.
    return [{ $id: "expense-b", userId: "user-b", amount: 500, category: "Food", date: "2026-11-08" }];
  };
  const snapshotPromise = captureBudgetAlertSnapshot(context.dependencies);
  await entered.promise;
  const transition = context.guard.beginTransition();
  context.setCurrent({ userId: "user-b", sessionId: "session-b" });
  context.guard.finishTransition(transition);
  release.resolve();

  assert.equal(await snapshotPromise, null);
  assert.deepEqual(context.expenseRequests, ["user-a"]);
  assertNoDeliveryStateWrites(context.storage);
});

const makeNotificationApi = ({ schedule, calls = [] } = {}) => ({
  calls,
  scheduleNotificationAsync: async (request) => {
    calls.push(["schedule", request]);
    return schedule ? schedule(request) : "scheduled-id";
  },
  cancelScheduledNotificationAsync: async (id) => { calls.push(["cancel", id]); },
  dismissNotificationAsync: async (id) => { calls.push(["dismiss", id]); },
});

const makeGuardedDelivery = ({ guard, identity, persistence, scheduler, canDeliver }) => {
  const event = { scope: "overall", threshold: "80", spentInINR: 80, limitInINR: 100, percentage: 80 };
  return deliverBudgetAlertEvents(
    persistence,
    identity.userId,
    "2026-11",
    [event],
    (alert) => scheduler.scheduleBudgetAlert(alert, (amount) => `₹${amount.toFixed(2)}`),
    () => undefined,
    canDeliver,
    {
      isSessionCurrent: () => guard.isCurrent(identity),
      isGenerationCurrent: () => guard.isGenerationCurrent(identity),
      cancelScheduled: scheduler.cancelScheduledBudgetAlert,
    }
  );
};

test("production delivery checks the captured session immediately before actual scheduling", async () => {
  let current = { userId: "user-a", sessionId: "session-a" };
  const guard = createAuthSessionGuard(async () => current);
  const identity = await guard.capture();
  const storage = createMemoryStorage();
  const persistence = createBudgetNotificationPersistence(storage);
  const api = makeNotificationApi();
  const scheduler = createBudgetNotificationScheduler(api, "android", "budget-alerts");
  const delivery = makeGuardedDelivery({
    guard,
    identity,
    persistence,
    scheduler,
    canDeliver: async () => {
      const transition = guard.beginTransition();
      current = { userId: "user-b", sessionId: "session-b" };
      guard.finishTransition(transition);
      return true;
    },
  });
  await delivery;

  assert.equal(api.calls.some(([kind]) => kind === "schedule"), false);
  assert.equal(await persistence.hasDelivered("user-a", "2026-11", "overall:overall:80"), false);
  assert.equal(await persistence.hasDelivered("user-b", "2026-11", "overall:overall:80"), false);
});

test("production scheduler cancels and dismisses an alert if the account changes while scheduling", async () => {
  let current = { userId: "user-a", sessionId: "session-a" };
  const guard = createAuthSessionGuard(async () => current);
  const identity = await guard.capture();
  const storage = createMemoryStorage();
  const persistence = createBudgetNotificationPersistence(storage);
  const entered = deferred();
  const release = deferred();
  const api = makeNotificationApi({
    schedule: async () => {
      entered.resolve();
      await release.promise;
      return "notification-from-user-a";
    },
  });
  const scheduler = createBudgetNotificationScheduler(api, "android", "budget-alerts");
  const delivery = makeGuardedDelivery({ guard, identity, persistence, scheduler });
  await entered.promise;
  const transition = guard.beginTransition();
  current = { userId: "user-b", sessionId: "session-b" };
  guard.finishTransition(transition);
  release.resolve();
  await delivery;

  assert.deepEqual(api.calls.map(([kind, value]) => [kind, kind === "schedule" ? value.trigger : value]), [
    ["schedule", { channelId: "budget-alerts" }],
    ["cancel", "notification-from-user-a"],
    ["dismiss", "notification-from-user-a"],
  ]);
  assert.equal(await persistence.hasDelivered("user-a", "2026-11", "overall:overall:80"), false);
  assert.equal(await persistence.hasDelivered("user-b", "2026-11", "overall:overall:80"), false);
});

test("production persistence pins stale writes and rollback to User A's key", async () => {
  let current = { userId: "user-a", sessionId: "session-a" };
  const guard = createAuthSessionGuard(async () => current);
  const identity = await guard.capture();
  const storage = createMemoryStorage();
  const persistence = createBudgetNotificationPersistence(storage);
  const month = "2026-11";
  const eventKey = "overall:overall:80";
  const userBKey = getBudgetAlertDeduplicationStorageKey("user-b", month);
  storage.values.set(userBKey, JSON.stringify(["overall:overall:100"]));
  const writeEntered = deferred();
  const releaseWrite = deferred();
  const originalSet = storage.setItem.bind(storage);
  let delayNextAWrite = true;
  storage.setItem = async (key, value) => {
    if (key === getBudgetAlertDeduplicationStorageKey("user-a", month) && delayNextAWrite) {
      delayNextAWrite = false;
      writeEntered.resolve();
      await releaseWrite.promise;
    }
    await originalSet(key, value);
  };

  const marking = persistence.markDelivered("user-a", month, eventKey, {
    isSessionCurrent: () => guard.isCurrent(identity),
    isGenerationCurrent: () => guard.isGenerationCurrent(identity),
  });
  await writeEntered.promise;
  const transition = guard.beginTransition();
  current = { userId: "user-b", sessionId: "session-b" };
  guard.finishTransition(transition);
  releaseWrite.resolve();

  assert.equal(await marking, false);
  assert.deepEqual(JSON.parse(storage.values.get(getBudgetAlertDeduplicationStorageKey("user-a", month))), []);
  assert.deepEqual(JSON.parse(storage.values.get(userBKey)), ["overall:overall:100"]);
  assert.equal(storage.writes.every(([key]) => key !== userBKey), true);
});

test("a scheduling failure during account replacement writes no delivery marker for either user", async () => {
  let current = { userId: "user-a", sessionId: "session-a" };
  const guard = createAuthSessionGuard(async () => current);
  const identity = await guard.capture();
  const storage = createMemoryStorage();
  const persistence = createBudgetNotificationPersistence(storage);
  const userBKey = getBudgetAlertDeduplicationStorageKey("user-b", "2026-11");
  storage.values.set(userBKey, JSON.stringify(["overall:overall:100"]));
  const entered = deferred();
  const release = deferred();
  const api = makeNotificationApi({
    schedule: async () => {
      entered.resolve();
      await release.promise;
      throw new Error("OS scheduling failure");
    },
  });
  const scheduler = createBudgetNotificationScheduler(api, "android");
  const delivery = makeGuardedDelivery({ guard, identity, persistence, scheduler });
  await entered.promise;
  const transition = guard.beginTransition();
  current = { userId: "user-b", sessionId: "session-b" };
  guard.finishTransition(transition);
  release.resolve();
  await delivery;

  assert.equal(await persistence.hasDelivered("user-a", "2026-11", "overall:overall:80"), false);
  assert.deepEqual(JSON.parse(storage.values.get(userBKey)), ["overall:overall:100"]);
  assert.equal(storage.writes.some(([key]) => key.includes("/delivered/")), false);
});

test("auth guard invalidates old generations across account return, same-user relogin, and failed login", async () => {
  let current = { userId: "user-a", sessionId: "session-a1" };
  const guard = createAuthSessionGuard(async () => current);
  const first = await guard.capture();

  const switchAway = guard.beginTransition();
  current = { userId: "user-b", sessionId: "session-b1" };
  guard.finishTransition(switchAway);
  const switchBack = guard.beginTransition();
  current = { userId: "user-a", sessionId: "session-a2" };
  guard.finishTransition(switchBack);
  assert.equal(await guard.isCurrent(first), false);
  assert.equal(guard.isGenerationCurrent(first), false);

  const second = await guard.capture();
  assert.equal(second.sessionId, "session-a2");
  const sameUserRelogin = guard.beginTransition();
  current = { userId: "user-a", sessionId: "session-a3" };
  guard.finishTransition(sameUserRelogin);
  assert.equal(await guard.isCurrent(second), false);

  const beforeFailedLogin = await guard.capture();
  const failedLogin = guard.beginTransition();
  try {
    await Promise.reject(new Error("invalid credentials"));
  } catch {
    // Mirrors loginUser's finally transition completion when Appwrite rejects.
  } finally {
    guard.finishTransition(failedLogin);
  }
  assert.equal(await guard.isCurrent(beforeFailedLogin), false);
  const afterFailedLogin = await guard.capture();
  assert.equal(afterFailedLogin.userId, "user-a");
  assert.equal(await guard.isCurrent(afterFailedLogin), true);
});

test("real loginUser and logoutUser transitions invalidate pending notification identities", async () => {
  const { account, captureAuthSessionIdentity, isAuthSessionIdentityCurrent, loginUser, logoutUser } = appwriteAuth;
  const originals = {
    get: account.get,
    getSession: account.getSession,
    createEmailPasswordSession: account.createEmailPasswordSession,
    deleteSession: account.deleteSession,
  };
  let current = { userId: "user-a", sessionId: "session-a0" };
  let sameUserSession = 0;
  account.get = async () => ({ $id: current.userId });
  account.getSession = async () => ({ $id: current.sessionId });
  account.createEmailPasswordSession = async ({ email }) => {
    if (email === "reject@example.test") throw new Error("invalid credentials");
    if (email === "user-a@example.test") {
      current = { userId: "user-a", sessionId: `session-a${++sameUserSession}` };
    } else {
      current = { userId: "user-b", sessionId: "session-b1" };
    }
    return { $id: current.sessionId };
  };
  account.deleteSession = async () => {
    current = { userId: "", sessionId: "" };
    return {};
  };

  try {
    const userAIdentity = await captureAuthSessionIdentity();
    await loginUser({ email: "user-b@example.test", password: "test" });
    assert.equal(await isAuthSessionIdentityCurrent(userAIdentity), false);

    await loginUser({ email: "user-a@example.test", password: "test" });
    assert.equal(await isAuthSessionIdentityCurrent(userAIdentity), false);

    const sameUserFirstSession = await captureAuthSessionIdentity();
    await loginUser({ email: "user-a@example.test", password: "test" });
    assert.notEqual((await captureAuthSessionIdentity()).sessionId, sameUserFirstSession.sessionId);
    assert.equal(await isAuthSessionIdentityCurrent(sameUserFirstSession), false);

    const beforeLogout = await captureAuthSessionIdentity();
    await logoutUser();
    await loginUser({ email: "user-b@example.test", password: "test" });
    assert.equal(await isAuthSessionIdentityCurrent(beforeLogout), false);

    const beforeFailedLogin = await captureAuthSessionIdentity();
    const previousConsoleError = console.error;
    console.error = () => undefined;
    try {
      await assert.rejects(
        loginUser({ email: "reject@example.test", password: "test" }),
        /invalid credentials/
      );
    } finally {
      console.error = previousConsoleError;
    }
    assert.equal(await isAuthSessionIdentityCurrent(beforeFailedLogin), false);
    const afterFailedLogin = await captureAuthSessionIdentity();
    assert.equal(afterFailedLogin.userId, "user-b");
    assert.equal(await isAuthSessionIdentityCurrent(afterFailedLogin), true);
  } finally {
    account.get = originals.get;
    account.getSession = originals.getSession;
    account.createEmailPasswordSession = originals.createEmailPasswordSession;
    account.deleteSession = originals.deleteSession;
  }
});
