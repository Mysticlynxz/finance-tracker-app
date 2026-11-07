import {
  Account,
  Client,
  ID,
  Permission,
  Query,
  Role,
  TablesDB,
} from "appwrite";

const DEFAULT_DATABASE_ID = "69a4e415003c658fe722";
const DEFAULT_TABLE_ID = "categoryBudgets";
const PAGE_SIZE = 100;
const CATEGORY_MAX_LENGTH = 128;

const readEnvironment = () => ({
  endpoint: process.env.APPWRITE_FUNCTION_API_ENDPOINT?.trim(),
  projectId: process.env.APPWRITE_FUNCTION_PROJECT_ID?.trim(),
  apiKey: process.env.APPWRITE_FUNCTION_API_KEY?.trim(),
  databaseId: process.env.APPWRITE_DATABASE_ID?.trim() || DEFAULT_DATABASE_ID,
  tableId: process.env.APPWRITE_CATEGORY_BUDGETS_TABLE_ID?.trim() || DEFAULT_TABLE_ID,
});

const getHeader = (req, headerName) => {
  const match = Object.entries(req?.headers ?? {})
    .find(([name]) => name.toLowerCase() === headerName.toLowerCase());
  return typeof match?.[1] === "string" ? match[1].trim() : "";
};

const parseBody = (req) => {
  const body = req?.bodyJson ?? req?.body ?? req?.bodyText ?? {};
  if (typeof body === "string") {
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      throw new HttpError(400, "invalid_json", "Request body must contain valid JSON.");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new HttpError(400, "invalid_body", "Request body must be a JSON object.");
    }
    return parsed;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "invalid_body", "Request body must be a JSON object.");
  }
  return body;
};

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const createClients = (env, jwt) => {
  if (!env.endpoint || !env.projectId || !env.apiKey) {
    throw new Error("Appwrite Function endpoint, project, or ephemeral API key is unavailable.");
  }
  const userClient = new Client()
    .setEndpoint(env.endpoint)
    .setProject(env.projectId)
    .setJWT(jwt);
  const privilegedClient = new Client()
    .setEndpoint(env.endpoint)
    .setProject(env.projectId)
    .setKey(env.apiKey);
  return {
    account: new Account(userClient),
    privilegedTables: new TablesDB(privilegedClient),
  };
};

const currentMonthId = (date) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}`;
};

const previousMonthId = (monthId) => {
  const [year, month] = monthId.split("-").map(Number);
  const previous = new Date(Date.UTC(year, month - 2, 1));
  return `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, "0")}`;
};

const normalizeCategory = (value) => {
  if (typeof value !== "string") {
    throw new HttpError(400, "invalid_category", "Category must be a non-empty string.");
  }
  const category = value.normalize("NFKC").trim();
  const categoryKey = category.toLocaleLowerCase("en-US");
  if (!category || category.length > CATEGORY_MAX_LENGTH) {
    throw new HttpError(400, "invalid_category", `Category must contain 1-${CATEGORY_MAX_LENGTH} characters.`);
  }
  return { category, categoryKey };
};

const validateAmount = (value) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new HttpError(400, "invalid_amount", "amountInINR must be a finite positive number.");
  }
  return value;
};

const validateCurrentMonth = (value, currentMonth) => {
  if (typeof value !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    throw new HttpError(400, "invalid_month", "monthId must use YYYY-MM format.");
  }
  if (value !== currentMonth) {
    throw new HttpError(400, "invalid_month", "Category budgets can only be changed for the current Asia/Kolkata month.");
  }
  return value;
};

const ownerPermissions = (userId) => [Permission.read(Role.user(userId))];
const isConflict = (error) => error?.code === 409 || error?.status === 409;
const isDeleted = (row) => Boolean(row.deletedAt);

const listRows = async ({ tables, env, queries }) => {
  const rows = [];
  let offset = 0;
  let total = 0;
  do {
    const response = await tables.listRows({
      databaseId: env.databaseId,
      tableId: env.tableId,
      queries: [...queries, Query.limit(PAGE_SIZE), Query.offset(offset)],
    });
    rows.push(...response.rows);
    total = response.total;
    if (response.rows.length === 0) break;
    offset += response.rows.length;
  } while (offset < total && offset > 0);
  return rows;
};

const findTuple = async ({ tables, env, userId, categoryKey, monthId }) => {
  const rows = await listRows({
    tables,
    env,
    queries: [
      Query.equal("userId", userId),
      Query.equal("categoryKey", categoryKey),
      Query.equal("monthId", monthId),
    ],
  });
  assertRowsOwned(rows, userId);
  return rows.find((row) => row.userId === userId && row.categoryKey === categoryKey && row.monthId === monthId) ?? null;
};

const assertOwned = (row, userId) => {
  if (!row || row.userId !== userId) {
    throw new HttpError(404, "not_found", "Category budget was not found.");
  }
};

const assertRowsOwned = (rows, userId) => {
  for (const row of rows) assertOwned(row, userId);
};

const createOrReactivate = async ({ tables, env, userId, category, categoryKey, monthId, amountInINR, setStage }) => {
  setStage("existing_row_lookup");
  const existing = await findTuple({ tables, env, userId, categoryKey, monthId });
  if (existing) {
    assertOwned(existing, userId);
    if (!isDeleted(existing)) {
      throw new HttpError(409, "duplicate_budget", "An active budget already exists for this category and month.");
    }
    setStage("row_reactivation");
    const row = await tables.updateRow({
      databaseId: env.databaseId,
      tableId: env.tableId,
      rowId: existing.$id,
      data: { category, amountInINR, deletedAt: null },
      permissions: ownerPermissions(userId),
    });
    assertOwned(row, userId);
    return { row, reactivated: true };
  }

  try {
    setStage("row_creation");
    const row = await tables.createRow({
      databaseId: env.databaseId,
      tableId: env.tableId,
      rowId: ID.unique(),
      data: { userId, category, categoryKey, amountInINR, monthId, deletedAt: null },
      permissions: ownerPermissions(userId),
    });
    assertOwned(row, userId);
    return { row, reactivated: false };
  } catch (error) {
    if (!isConflict(error)) throw error;
    const racedRow = await findTuple({ tables, env, userId, categoryKey, monthId });
    if (!racedRow) throw new HttpError(409, "duplicate_budget", "A category budget was created concurrently.");
    assertOwned(racedRow, userId);
    if (!isDeleted(racedRow)) {
      throw new HttpError(409, "duplicate_budget", "An active budget already exists for this category and month.");
    }
    const row = await tables.updateRow({
      databaseId: env.databaseId,
      tableId: env.tableId,
      rowId: racedRow.$id,
      data: { category, amountInINR, deletedAt: null },
      permissions: ownerPermissions(userId),
    });
    assertOwned(row, userId);
    return { row, reactivated: true };
  }
};

const runAction = async ({ body, userId, env, tables, now, setStage }) => {
  const monthId = currentMonthId(now());
  const ownerMonthQuery = [Query.equal("userId", userId), Query.equal("monthId", monthId)];

  switch (body.action) {
    case "list": {
      setStage("row_listing");
      const rows = await listRows({ tables, env, queries: ownerMonthQuery });
      assertRowsOwned(rows, userId);
      const ownedRows = rows.filter((row) => row.monthId === monthId && !isDeleted(row));
      return { monthId, budgets: ownedRows };
    }

    case "create": {
      setStage("request_validation");
      const { category, categoryKey } = normalizeCategory(body.category);
      const amountInINR = validateAmount(body.amountInINR);
      const requestedMonth = validateCurrentMonth(body.monthId, monthId);
      const result = await createOrReactivate({
        tables, env, userId, category, categoryKey, monthId: requestedMonth, amountInINR, setStage,
      });
      return { budget: result.row, reactivated: result.reactivated };
    }

    case "update": {
      setStage("row_ownership_lookup");
      const rowId = typeof body.rowId === "string" ? body.rowId.trim() : "";
      if (!rowId) throw new HttpError(400, "invalid_row_id", "rowId is required.");
      const amountInINR = validateAmount(body.amountInINR);
      const row = await tables.getRow({ databaseId: env.databaseId, tableId: env.tableId, rowId });
      assertOwned(row, userId);
      validateCurrentMonth(row.monthId, monthId);
      if (isDeleted(row)) throw new HttpError(404, "not_found", "Category budget was not found.");
      const data = { amountInINR };
      if (body.category !== undefined) {
        const normalized = normalizeCategory(body.category);
        if (normalized.categoryKey !== row.categoryKey) {
          const duplicate = await findTuple({
            tables, env, userId, categoryKey: normalized.categoryKey, monthId: row.monthId,
          });
          if (duplicate && duplicate.$id !== row.$id && !isDeleted(duplicate)) {
            throw new HttpError(409, "duplicate_budget", "An active budget already exists for this category and month.");
          }
          if (duplicate && duplicate.$id !== row.$id && isDeleted(duplicate)) {
            throw new HttpError(409, "category_has_tombstone", "This category has a deleted budget. Recreate it to reactivate its existing row.");
          }
        }
        data.category = normalized.category;
        data.categoryKey = normalized.categoryKey;
      }
      let updated;
      try {
        updated = await tables.updateRow({
          databaseId: env.databaseId,
          tableId: env.tableId,
          rowId,
          data,
          permissions: ownerPermissions(userId),
        });
      } catch (cause) {
        if (isConflict(cause)) {
          throw new HttpError(409, "duplicate_budget", "An active budget already exists for this category and month.");
        }
        throw cause;
      }
      assertOwned(updated, userId);
      return { budget: updated };
    }

    case "delete": {
      setStage("row_ownership_lookup");
      const rowId = typeof body.rowId === "string" ? body.rowId.trim() : "";
      if (!rowId) throw new HttpError(400, "invalid_row_id", "rowId is required.");
      const row = await tables.getRow({ databaseId: env.databaseId, tableId: env.tableId, rowId });
      assertOwned(row, userId);
      validateCurrentMonth(row.monthId, monthId);
      if (isDeleted(row)) return { deleted: true, alreadyDeleted: true };
      const updated = await tables.updateRow({
        databaseId: env.databaseId,
        tableId: env.tableId,
        rowId,
        data: { deletedAt: now().toISOString() },
        permissions: ownerPermissions(userId),
      });
      assertOwned(updated, userId);
      return { deleted: true, budget: updated };
    }

    case "carry-forward": {
      setStage("carry_forward_lookup");
      const targetMonthId = validateCurrentMonth(body.monthId, monthId);
      const sourceMonthId = previousMonthId(targetMonthId);
      const sourceRows = await listRows({
        tables,
        env,
        queries: [Query.equal("userId", userId), Query.equal("monthId", sourceMonthId)],
      });
      const destinationRows = await listRows({ tables, env, queries: ownerMonthQuery });
      assertRowsOwned(sourceRows, userId);
      assertRowsOwned(destinationRows, userId);
      const destinationByKey = new Map(
        destinationRows
          .filter((row) => row.monthId === targetMonthId)
          .map((row) => [row.categoryKey, row])
      );
      let carried = 0;
      let preserved = 0;
      for (const source of sourceRows) {
        assertOwned(source, userId);
        if (isDeleted(source)) continue;
        const destination = destinationByKey.get(source.categoryKey);
        // Active rows keep edits; tombstones prevent a retry from restoring a deletion.
        if (destination) {
          preserved += 1;
          continue;
        }
        try {
          const created = await tables.createRow({
            databaseId: env.databaseId,
            tableId: env.tableId,
            rowId: ID.unique(),
            data: {
              userId,
              category: source.category,
              categoryKey: source.categoryKey,
              amountInINR: validateAmount(source.amountInINR),
              monthId: targetMonthId,
              deletedAt: null,
            },
            permissions: ownerPermissions(userId),
          });
          assertOwned(created, userId);
          destinationByKey.set(created.categoryKey, created);
          carried += 1;
        } catch (error) {
          if (!isConflict(error)) throw error;
          const racedRow = await findTuple({
            tables, env, userId, categoryKey: source.categoryKey, monthId: targetMonthId,
          });
          if (!racedRow) throw new HttpError(409, "carry_forward_conflict", "A category budget changed during carry-forward.");
          assertOwned(racedRow, userId);
          destinationByKey.set(racedRow.categoryKey, racedRow);
          preserved += 1;
        }
      }
      return { monthId: targetMonthId, carried, preserved };
    }

    default:
      throw new HttpError(400, "invalid_action", "action must be list, create, update, delete, or carry-forward.");
  }
};

const safeErrorMessage = (cause, secretValues = []) => {
  let message = typeof cause?.message === "string" ? cause.message : "Unspecified error";
  for (const secret of secretValues) {
    if (secret !== undefined && secret !== null && String(secret).length > 0) {
      message = message.split(String(secret)).join("[redacted]");
    }
  }
  return message
    .replace(/Bearer\s+[^\s,;]+/gi, "Bearer [redacted]")
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted-token]")
    .replace(/(amountInINR|category|categoryKey|userId|rowId|monthId)\s*[:=]\s*[^,;\s]+/gi, "$1=[redacted]");
};

const getSafeActionName = (action) =>
  ["list", "create", "update", "delete", "carry-forward"].includes(action) ? action : "unknown";

export const createHandler = ({ env = readEnvironment(), createClientsOverride, now = () => new Date() } = {}) =>
  async ({ req, res, log = () => {}, error = () => {} }) => {
    let stage = "request_start";
    let jwt = "";
    let body;
    const diagnostic = (message, details = {}) => log(JSON.stringify({ component: "category-budgets", message, ...details }));
    const advanceStage = (nextStage) => {
      stage = nextStage;
      diagnostic("backend_stage", { stage });
    };
    try {
      diagnostic("execution_started", {
        method: typeof req?.method === "string" ? req.method : "unknown",
        headers: {
          userJwtPresent: Boolean(getHeader(req, "x-appwrite-user-jwt")),
          functionKeyPresent: Boolean(getHeader(req, "x-appwrite-key")),
          userIdHeaderPresent: Boolean(getHeader(req, "x-appwrite-user-id")),
        },
      });
      advanceStage("request_method_validation");
      if (req?.method && req.method.toUpperCase() !== "POST") {
        throw new HttpError(405, "method_not_allowed", "Use POST for category-budget actions.");
      }
      advanceStage("user_jwt_detection");
      jwt = getHeader(req, "x-appwrite-user-jwt");
      if (!jwt) throw new HttpError(401, "unauthenticated", "A valid Appwrite user session is required.");
      advanceStage("client_initialization");
      const clients = createClientsOverride
        ? createClientsOverride(env, jwt)
        : createClients(env, jwt);
      let account;
      advanceStage("account_verification");
      try {
        account = await clients.account.get();
      } catch {
        throw new HttpError(401, "unauthenticated", "The Appwrite user session is invalid or expired.");
      }
      if (!account?.$id) throw new HttpError(401, "unauthenticated", "The Appwrite user session is invalid.");
      diagnostic("account_verified", { verified: true });
      advanceStage("request_parsing");
      body = parseBody(req);
      diagnostic("action_received", { action: getSafeActionName(body.action) });
      advanceStage("action_dispatch");
      const result = await runAction({
        body,
        userId: account.$id,
        env,
        tables: clients.privilegedTables,
        now,
        setStage: advanceStage,
      });
      diagnostic("execution_completed", { action: getSafeActionName(body.action) });
      return res.json({ ok: true, ...result });
    } catch (cause) {
      const bodySecrets = body && typeof body === "object"
        ? [...Object.values(body), JSON.stringify(body)]
        : [];
      const safeDetails = {
        stage,
        name: typeof cause?.name === "string" ? cause.name : "Error",
        message: safeErrorMessage(cause, [jwt, env.apiKey, ...bodySecrets]),
        code: cause?.code ?? cause?.status ?? null,
        type: cause?.type ?? cause?.constructor?.name ?? null,
      };
      error(JSON.stringify({ component: "category-budgets", message: "execution_failed", ...safeDetails }));
      diagnostic("execution_failed", { stage, name: safeDetails.name });
      if (cause instanceof HttpError) return res.json({ ok: false, error: { code: cause.code, message: cause.message } }, cause.status);
      return res.json({ ok: false, error: { code: "internal_error", message: "Unable to process category budget request." } }, 500);
    }
  };

export default createHandler();
