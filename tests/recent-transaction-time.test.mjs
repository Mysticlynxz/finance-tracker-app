import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import vm from "node:vm";
import { formatRecentTransactionTime } from "../lib/recentTransactionTime.ts";
import * as reportDates from "../lib/reportDates.ts";

process.env.TZ = "Asia/Kolkata";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const compile = (path, dependencies) => {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const output = ts.transpileModule(source, {
    fileName: path,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, {
    module, exports: module.exports, console,
    require: (name) => {
      if (name in dependencies) return dependencies[name];
      throw new Error(`Unexpected dependency ${name}`);
    },
  });
  return module.exports;
};

const saveFlow = compile("../lib/budgetNotificationSaveFlow.ts", {});
const { saveManualExpenseWithBudgetAlerts } = compile("../lib/manualExpenseSave.ts", {
  "./budgetNotificationSaveFlow": saveFlow,
});
const { saveVoiceExpenseBatchWithBudgetAlerts } = compile("../lib/voiceExpenseBatchSave.ts", {
  "./budgetNotificationSaveFlow": saveFlow,
});

const flatten = (node) => {
  if (Array.isArray(node)) return node.flatMap(flatten);
  if (!node || typeof node !== "object") return [];
  return [node, ...flatten(node.props?.children)];
};

const renderHome = async (documents) => {
  const states = [];
  let stateIndex = 0;
  let focusCallbacks = [];
  const react = {
    useState(initial) {
      const index = stateIndex++;
      if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial;
      return [states[index], (value) => { states[index] = value; }];
    },
    useContext: () => ({ isDarkMode: false, formatAmount: (value) => `₹${value}` }),
    useCallback: (callback) => callback,
    useEffect: () => {},
    useRef: (value) => ({ current: value }),
  };
  const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
  const animatedValue = class { interpolate() { return 0; } };
  const dependencies = {
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    react,
    "@expo/vector-icons": { Ionicons: "Ionicons", MaterialCommunityIcons: "MaterialCommunityIcons" },
    "@react-navigation/native": { useFocusEffect: (callback) => { focusCallbacks.push(callback); } },
    "expo-router": { router: { push() {} } },
    "react-native": {
      Animated: { Value: animatedValue, View: "AnimatedView", timing: () => ({ start() {} }) },
      Pressable: "Pressable", ScrollView: "ScrollView", Text: "Text", View: "View",
    },
    "react-native-safe-area-context": { SafeAreaView: "SafeAreaView" },
    "../../Context/ExpenseContext": { ExpenseContext: {} },
    "../../lib/appwrite": {
      account: {}, clearBudget() {}, getBudgetRecord: async () => null,
      getExpenses: async () => documents,
    },
    "../../lib/budgetCycle": { syncBudgetForCurrentMonth: async () => ({ budgetAmount: null }) },
    "../../lib/recentTransactionTime": { formatRecentTransactionTime },
    "../../lib/reportDates": reportDates,
  };
  const { default: Home } = compile("../app/(tabs)/home.tsx", dependencies);
  const render = () => { stateIndex = 0; focusCallbacks = []; return Home(); };
  render();
  for (const callback of focusCallbacks) callback();
  await new Promise((resolve) => setImmediate(resolve));
  return render();
};

const textValues = (node) => flatten(node)
  .filter((item) => item.type === "Text")
  .flatMap((item) => typeof item.props.children === "string" ? [item.props.children] : []);

test("UTC and explicit offsets format once in the device timezone", () => {
  assert.equal(formatRecentTransactionTime("2026-11-10T03:15:00.000Z"), "08:45 am");
  assert.equal(formatRecentTransactionTime("2026-11-10T08:45:00+05:30"), "08:45 am");
  assert.equal(formatRecentTransactionTime("2026-11-10T12:00:00.000Z"), "05:30 pm");
  assert.equal(formatRecentTransactionTime("2024-01-02T05:43:00.000Z"), "11:13 am");
});

test("the same timestamp follows the device timezone rather than a fixed Kolkata offset", () => {
  try {
    process.env.TZ = "UTC";
    assert.equal(formatRecentTransactionTime("2026-11-10T03:15:00Z"), "03:15 am");
    process.env.TZ = "America/New_York";
    assert.equal(formatRecentTransactionTime("2026-11-10T03:15:00Z"), "10:15 pm");
  } finally {
    process.env.TZ = "Asia/Kolkata";
  }
});

test("missing, date-only, ambiguous or invalid creation timestamps are omitted", () => {
  for (const value of [undefined, null, "", "2026-11-10", "2026-11-10T12:00:00", "2026-02-30T12:00:00Z", "2026-11-10T24:00:00Z", "invalid"]) {
    assert.equal(formatRecentTransactionTime(value), "", String(value));
  }
});

test("manual and voice saves retain expense date while Home uses Appwrite creation metadata", async () => {
  const documents = [];
  const createdTimes = ["2026-11-10T03:15:00.000Z", "2026-11-10T04:45:00.000Z"];
  const createExpense = async (input) => {
    const document = { ...input, $id: `expense-${documents.length}`, $createdAt: createdTimes[documents.length] };
    documents.push(document);
    return document;
  };
  const common = { captureBefore: async () => null, evaluateAfter: async () => {} };
  const manual = await saveManualExpenseWithBudgetAlerts({
    ...common, createExpense, input: { amount: 10, category: "Manual", date: "2026-11-10T03:14:00.000Z" },
  });
  await manual.notificationTask;
  const voice = await saveVoiceExpenseBatchWithBudgetAlerts({
    ...common, createExpense, convertToINR: (amount) => amount,
    toExpenseTimestamp: (date) => `${date}T12:00:00.000Z`,
    expenses: [{ id: "voice", amount: "20", category: "Voice", date: "2026-11-10" }],
  });
  await voice.notificationTask;
  assert.equal(voice.result.savedCount, 1);
  assert.equal(documents[1].date, "2026-11-10T12:00:00.000Z");
  const tree = await renderHome(documents);
  for (const [id, expected] of [["expense-0", "08:45 am"], ["expense-1", "10:15 am"]]) {
    const row = flatten(tree).find((node) => node.key === id);
    assert.ok(row);
    assert.ok(textValues(row).includes(expected));
    assert.ok(!textValues(row).includes("05:30 pm"));
  }
});

test("Home groups by expense date and omits unavailable times, including historical records", async () => {
  const now = new Date();
  const dateAtNoon = (daysAgo) => {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, 12);
    return date.toISOString();
  };
  const docs = [
    { $id: "today", category: "Today item", amount: 1, date: dateAtNoon(0), $createdAt: "2026-11-10T03:15:00Z" },
    { $id: "yesterday", category: "Yesterday item", amount: 1, date: dateAtNoon(1), $createdAt: "2026-11-10T04:45:00Z" },
    { $id: "old", category: "Old item", amount: 1, date: dateAtNoon(5), $createdAt: "2024-01-02T05:43:00Z" },
    { $id: "missing", category: "No time", amount: 1, date: dateAtNoon(5) },
    { $id: "date-only", category: "Historical date only", amount: 1, date: "2024-01-02", $createdAt: "2024-01-02" },
  ];
  const tree = await renderHome(docs);
  const texts = textValues(tree);
  assert.ok(texts.includes("Today"));
  assert.ok(texts.includes("Yesterday"));
  assert.ok(texts.includes("11:13 am"));
  const missing = flatten(tree).find((node) => node.key === "missing");
  assert.deepEqual(textValues(missing), ["No time", "₹1"]);
  const dateOnly = flatten(tree).find((node) => node.key === "date-only");
  assert.deepEqual(textValues(dateOnly), ["Historical date only", "₹1"]);
  const labels = flatten(tree).filter((node) => node.type === "View" && (node.key === "Today" || node.key === "Yesterday"));
  assert.ok(textValues(labels.find((node) => node.key === "Today")).includes("Today item"));
  assert.ok(textValues(labels.find((node) => node.key === "Yesterday")).includes("Yesterday item"));
});

test("Appwrite retrieval preserves metadata and Home does not use context or expense date for time", () => {
  const appwrite = readFileSync(new URL("../lib/appwrite.ts", import.meta.url), "utf8");
  const home = readFileSync(new URL("../app/(tabs)/home.tsx", import.meta.url), "utf8");
  assert.match(appwrite, /documents\.map\(\(expense\) => \(\{\s*\.\.\.expense,/);
  assert.match(home, /setExpenses\(data\)/);
  assert.match(home, /formatRecentTransactionTime\(expense\.\$createdAt\)/);
  assert.match(home, /formatDateLabel\(expense\.date\)/);
});
