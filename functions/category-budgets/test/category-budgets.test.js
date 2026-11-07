import assert from "node:assert/strict";
import { test } from "node:test";
import { createHandler } from "../index.js";

const env = {
  endpoint: "https://appwrite.test/v1",
  projectId: "project-test",
  apiKey: "ephemeral-test-key",
  databaseId: "database-test",
  tableId: "categoryBudgets",
};

const queryParts = (queries = []) => queries.map((query) => JSON.parse(query));

const makeStore = (initialRows = []) => {
  const rows = new Map(initialRows.map((row) => [row.$id, structuredClone(row)]));
  let nextId = 0;
  const tables = {
    async listRows({ queries = [] }) {
      const parsed = queryParts(queries);
      const offset = parsed.find((part) => part.method === "offset")?.values?.[0] ?? 0;
      const limit = parsed.find((part) => part.method === "limit")?.values?.[0] ?? 25;
      const filters = parsed.filter((part) => part.method === "equal");
      const matches = [...rows.values()].filter((row) => filters.every((filter) =>
        filter.values.some((value) => row[filter.attribute] === value)
      ));
      return { rows: matches.slice(offset, offset + limit), total: matches.length };
    },
    async getRow({ rowId }) {
      const row = rows.get(rowId);
      if (!row) throw Object.assign(new Error("Not found"), { code: 404 });
      return structuredClone(row);
    },
    async createRow({ rowId, data, permissions }) {
      const duplicate = [...rows.values()].some((row) =>
        row.userId === data.userId &&
        row.categoryKey === data.categoryKey &&
        row.monthId === data.monthId
      );
      if (duplicate) throw Object.assign(new Error("Unique conflict"), { code: 409 });
      const row = {
        $id: rowId || `row-${++nextId}`,
        ...structuredClone(data),
        $permissions: permissions,
      };
      rows.set(row.$id, row);
      return structuredClone(row);
    },
    async updateRow({ rowId, data, permissions }) {
      const current = rows.get(rowId);
      if (!current) throw Object.assign(new Error("Not found"), { code: 404 });
      const row = { ...current, ...structuredClone(data), $permissions: permissions ?? current.$permissions };
      rows.set(rowId, row);
      return structuredClone(row);
    },
    async deleteRow({ rowId }) {
      rows.delete(rowId);
      return {};
    },
  };
  return { rows, tables };
};

const invoke = async (body, {
  userId = "user-a",
  jwt = "valid-jwt",
  rows = [],
  now = new Date("2027-01-15T12:00:00.000Z"),
  accountError,
  tableError,
  method = "POST",
} = {}) => {
  const store = makeStore(rows);
  if (tableError) store.tables.listRows = async () => { throw tableError; };
  const handler = createHandler({
    env,
    now: () => new Date(now),
    createClientsOverride: () => ({
      account: { get: async () => {
        if (accountError) throw accountError;
        return { $id: userId };
      } },
      privilegedTables: store.tables,
    }),
  });
  let response;
  const errors = [];
  const logs = [];
  await handler({
    req: {
      method,
      headers: jwt ? { "x-appwrite-user-jwt": jwt } : {},
      body: JSON.stringify(body),
    },
    res: { json(payload, status = 200) { response = { payload, status }; return response; } },
    error: (message) => errors.push(message),
    log: (message) => logs.push(message),
  });
  return { ...response, rows: store.rows, errors, logs };
};

const activeRow = (overrides = {}) => ({
  $id: "row-existing",
  userId: "user-a",
  category: "Food",
  categoryKey: "food",
  monthId: "2027-01",
  amountInINR: 1000,
  deletedAt: null,
  $permissions: ['read("user:user-a")'],
  ...overrides,
});

test("rejects missing, invalid, and expired user JWTs", async () => {
  const missing = await invoke({ action: "list" }, { jwt: "" });
  assert.equal(missing.status, 401);
  const invalid = await invoke({ action: "list" }, { accountError: new Error("invalid jwt") });
  assert.equal(invalid.status, 401);
});

test("rejects unsupported methods and malformed requests", async () => {
  assert.equal((await invoke({}, { method: "GET" })).status, 405);
  const malformed = await invoke("not-json");
  assert.equal(malformed.status, 400);
  assert.equal(malformed.payload.error.code, "invalid_body");
});

test("lists only active rows owned by the authenticated user for the current month", async () => {
  const result = await invoke({ action: "list", userId: "attacker" }, {
    rows: [activeRow(), activeRow({ $id: "other", userId: "user-b", categoryKey: "travel" }), activeRow({ $id: "deleted", categoryKey: "bills", deletedAt: "2027-01-02T00:00:00.000Z" }), activeRow({ $id: "old", categoryKey: "old", monthId: "2026-12" })],
  });
  assert.equal(result.status, 200);
  assert.deepEqual(result.payload.budgets.map((row) => row.$id), ["row-existing"]);
  assert.equal(result.payload.monthId, "2027-01");
});

test("creates a normalized INR budget with read permission only for the verified owner", async () => {
  const result = await invoke({
    action: "create", category: "  FOOD  ", amountInINR: 1200, monthId: "2027-01", userId: "user-b",
  });
  assert.equal(result.status, 200);
  const row = result.payload.budget;
  assert.equal(row.userId, "user-a");
  assert.equal(row.category, "FOOD");
  assert.equal(row.categoryKey, "food");
  assert.equal(row.amountInINR, 1200);
  assert.deepEqual(row.$permissions, ['read("user:user-a")']);
});

test("rejects invalid amounts, categories, and non-current month writes", async () => {
  for (const amountInINR of [true, null, "10", 0, -1, Infinity, NaN]) {
    const result = await invoke({ action: "create", category: "Food", amountInINR, monthId: "2027-01" });
    assert.equal(result.status, 400, `amount ${String(amountInINR)}`);
  }
  for (const category of ["", "   ", null, {}, "x".repeat(129)]) {
    const result = await invoke({ action: "create", category, amountInINR: 100, monthId: "2027-01" });
    assert.equal(result.status, 400, `category ${String(category)}`);
  }
  assert.equal((await invoke({ action: "create", category: "Food", amountInINR: 100, monthId: "2026-12" })).status, 400);
});

test("rejects duplicate active category/month budgets", async () => {
  const result = await invoke({ action: "create", category: " food ", amountInINR: 200, monthId: "2027-01" }, { rows: [activeRow()] });
  assert.equal(result.status, 409);
});

test("simultaneous creates are resolved by the unique tuple conflict", async () => {
  const store = makeStore();
  const handler = createHandler({
    env,
    now: () => new Date("2027-01-15T00:00:00Z"),
    createClientsOverride: () => ({ account: { get: async () => ({ $id: "user-a" }) }, privilegedTables: store.tables }),
  });
  const request = () => handler({
    req: { method: "POST", headers: { "x-appwrite-user-jwt": "jwt" }, body: JSON.stringify({ action: "create", category: "Food", amountInINR: 100, monthId: "2027-01" }) },
    res: { json: (payload, status = 200) => ({ payload, status }) },
  });
  const responses = await Promise.all([request(), request()]);
  assert.equal([...store.rows.values()].length, 1);
  assert.deepEqual(responses.map(({ status }) => status).sort(), [200, 409]);
});

test("updates only an owned active current-month row", async () => {
  const updated = await invoke({ action: "update", rowId: "row-existing", amountInINR: 1500 }, { rows: [activeRow()] });
  assert.equal(updated.status, 200);
  assert.equal(updated.payload.budget.amountInINR, 1500);
  const foreign = await invoke({ action: "update", rowId: "row-existing", amountInINR: 1500 }, { userId: "user-b", rows: [activeRow()] });
  assert.equal(foreign.status, 404);
  const oldMonth = await invoke({ action: "update", rowId: "row-existing", amountInINR: 1500 }, { rows: [activeRow({ monthId: "2026-12" })] });
  assert.equal(oldMonth.status, 400);
});

test("updates category identity safely and rejects duplicate active categories", async () => {
  const changed = await invoke({ action: "update", rowId: "row-existing", amountInINR: 1500, category: " Transport " }, {
    rows: [activeRow()],
  });
  assert.equal(changed.status, 200);
  assert.equal(changed.payload.budget.category, "Transport");
  assert.equal(changed.payload.budget.categoryKey, "transport");

  const duplicate = await invoke({ action: "update", rowId: "row-existing", amountInINR: 1500, category: "Bills" }, {
    rows: [activeRow(), activeRow({ $id: "bills", category: "Bills", categoryKey: "bills" })],
  });
  assert.equal(duplicate.status, 409);
});

test("soft-deletes owned rows and reactivates the same row on recreation", async () => {
  const deleted = await invoke({ action: "delete", rowId: "row-existing" }, { rows: [activeRow()] });
  assert.equal(deleted.status, 200);
  assert.ok(deleted.payload.budget.deletedAt);
  assert.equal(deleted.rows.size, 1);
  const reactivated = await invoke({ action: "create", category: " food ", amountInINR: 250, monthId: "2027-01" }, {
    rows: [activeRow({ deletedAt: "2027-01-05T00:00:00.000Z" })],
  });
  assert.equal(reactivated.status, 200);
  assert.equal(reactivated.payload.reactivated, true);
  assert.equal(reactivated.payload.budget.$id, "row-existing");
  assert.equal(reactivated.payload.budget.deletedAt, null);
  assert.equal(reactivated.payload.budget.amountInINR, 250);
  assert.equal(reactivated.rows.size, 1);
});

test("carry-forward copies active budgets and preserves destination edits and tombstones idempotently", async () => {
  const store = makeStore([
    activeRow({ $id: "food-dec", monthId: "2026-12", amountInINR: 1000 }),
    activeRow({ $id: "bills-dec", monthId: "2026-12", category: "Bills", categoryKey: "bills", amountInINR: 500 }),
    activeRow({ $id: "deleted-dec", monthId: "2026-12", category: "Travel", categoryKey: "travel", deletedAt: "2026-12-20T00:00:00Z" }),
    activeRow({ $id: "food-jan", monthId: "2027-01", amountInINR: 1250 }),
    activeRow({ $id: "bills-tombstone", monthId: "2027-01", category: "Bills", categoryKey: "bills", deletedAt: "2027-01-02T00:00:00Z" }),
  ]);
  const handler = createHandler({
    env,
    now: () => new Date("2027-01-15T00:00:00Z"),
    createClientsOverride: () => ({ account: { get: async () => ({ $id: "user-a" }) }, privilegedTables: store.tables }),
  });
  const call = async () => handler({
    req: { method: "POST", headers: { "x-appwrite-user-jwt": "jwt" }, body: JSON.stringify({ action: "carry-forward", monthId: "2027-01" }) },
    res: { json: (payload, status = 200) => ({ payload, status }) },
  });
  const first = await call();
  assert.equal(first.payload.carried, 0);
  assert.equal(first.payload.preserved, 2);
  assert.equal(store.rows.get("food-jan").amountInINR, 1250);
  assert.ok(store.rows.get("bills-tombstone").deletedAt);
  assert.equal([...store.rows.values()].filter((row) => row.monthId === "2027-01").length, 2);
  const retry = await call();
  assert.equal(retry.payload.carried, 0);
  assert.equal(retry.payload.preserved, 2);
  assert.equal([...store.rows.values()].filter((row) => row.monthId === "2027-01").length, 2);
});

test("December to January carry-forward reads December and creates January rows", async () => {
  const result = await invoke({ action: "carry-forward", monthId: "2027-01" }, {
    rows: [activeRow({ $id: "dec-food", monthId: "2026-12" })],
  });
  assert.equal(result.status, 200);
  assert.equal(result.payload.monthId, "2027-01");
  assert.equal(result.payload.carried, 1);
  const january = [...result.rows.values()].find((row) => row.monthId === "2027-01");
  assert.equal(january.categoryKey, "food");
  assert.equal(january.amountInINR, 1000);
});

test("unknown actions and missing row identifiers are rejected", async () => {
  assert.equal((await invoke({ action: "erase-all" })).status, 400);
  assert.equal((await invoke({ action: "delete" })).status, 400);
});

test("diagnostics capture failure stage and safe error details without logging secrets or request data", async () => {
  const requestBody = {
    action: "create",
    category: "HiddenFood",
    amountInINR: 98765,
    monthId: "2027-01",
  };
  const serializedBody = JSON.stringify(requestBody);
  const result = await invoke(requestBody, {
    tableError: Object.assign(new Error(`failed ${serializedBody} jwt=valid-jwt key=ephemeral-test-key`), {
      code: 503,
      type: "service_unavailable",
    }),
  });
  assert.equal(result.status, 500);
  assert.equal(result.payload.error.message, "Unable to process category budget request.");
  assert.ok(result.logs.some((entry) => entry.includes('"action":"create"')));
  assert.ok(result.logs.some((entry) => entry.includes('"verified":true')));
  assert.ok(result.logs.some((entry) => entry.includes('"userJwtPresent":true')));

  const failureLog = JSON.parse(result.errors[0]);
  assert.equal(failureLog.stage, "existing_row_lookup");
  assert.equal(failureLog.name, "Error");
  assert.equal(failureLog.code, 503);
  assert.equal(failureLog.type, "service_unavailable");
  const allLogs = [...result.logs, ...result.errors].join("\n");
  for (const secret of ["valid-jwt", "ephemeral-test-key", "HiddenFood", "98765", serializedBody]) {
    assert.equal(allLogs.includes(secret), false, `must not log ${secret}`);
  }
});
