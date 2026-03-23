import { Client, Databases, Query } from "appwrite";
import fetch from "node-fetch";

const NO_RESPONSE_FALLBACK =
  "Try reducing unnecessary expenses and tracking your daily spending.";
const ERROR_FALLBACK =
  "Track your expenses daily and avoid unnecessary purchases to improve savings.";
const UNAUTHENTICATED_FALLBACK = "User not authenticated. Please log in again.";
const GEMINI_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";
const RUPEE_SYMBOL = "\u20B9";
const APPWRITE_ENDPOINT =
  process.env.APPWRITE_ENDPOINT?.trim() ||
  process.env.APPWRITE_FUNCTION_API_ENDPOINT?.trim() ||
  "";
const APPWRITE_PROJECT_ID =
  process.env.APPWRITE_PROJECT_ID?.trim() ||
  process.env.APPWRITE_FUNCTION_PROJECT_ID?.trim() ||
  "";
const APPWRITE_DATABASE_ID =
  process.env.APPWRITE_DATABASE_ID?.trim() || "69a4e415003c658fe722";
const APPWRITE_EXPENSES_COLLECTION_ID =
  process.env.APPWRITE_EXPENSES_COLLECTION_ID?.trim() || "expenses";
const APPWRITE_BUDGETS_COLLECTION_ID =
  process.env.APPWRITE_BUDGETS_COLLECTION_ID?.trim() || "budgets";
const RECENT_EXPENSE_LIMIT = 8;

const parseRequestBody = (req) => {
  const rawBody = req?.body ?? req?.bodyText ?? req?.bodyJson ?? {};

  if (typeof rawBody === "string") {
    try {
      return JSON.parse(rawBody);
    } catch {
      return {};
    }
  }

  if (rawBody && typeof rawBody === "object") {
    return rawBody;
  }

  return {};
};

const getHeader = (req, headerName) => {
  const headers = req?.headers ?? {};
  const normalizedHeaderName = headerName.toLowerCase();

  if (typeof headers[headerName] === "string") {
    return headers[headerName];
  }

  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === normalizedHeaderName) {
      return typeof value === "string" ? value : "";
    }
  }

  return "";
};

const formatAmount = (value) => {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return "0";
  }

  return Number.isInteger(numericValue)
    ? numericValue.toString()
    : numericValue.toFixed(2);
};

const createAppwriteClient = (req) => {
  const jwt = getHeader(req, "x-appwrite-user-jwt").trim();

  if (!jwt) {
    return null;
  }

  if (!APPWRITE_ENDPOINT) {
    throw new Error("APPWRITE_ENDPOINT is missing.");
  }

  if (!APPWRITE_PROJECT_ID) {
    throw new Error("APPWRITE_PROJECT_ID is missing.");
  }

  return new Client()
    .setEndpoint(APPWRITE_ENDPOINT)
    .setProject(APPWRITE_PROJECT_ID)
    .setJWT(jwt);
};

const getFinancialContext = async (req, log) => {
  const jwt = getHeader(req, "x-appwrite-user-jwt").trim();

  if (!jwt) {
    return null;
  }

  const userId = getHeader(req, "x-appwrite-user-id").trim();

  if (!userId) {
    throw new Error("x-appwrite-user-id header is missing.");
  }

  log("JWT: " + jwt);

  const client = createAppwriteClient(req);

  if (!client) {
    return null;
  }

  const databases = new Databases(client);

  const [expenseResponse, budgetResponse] = await Promise.all([
    databases.listDocuments({
      databaseId: APPWRITE_DATABASE_ID,
      collectionId: APPWRITE_EXPENSES_COLLECTION_ID,
      queries: [
        Query.equal("userId", userId),
        Query.orderDesc("$createdAt"),
        Query.limit(RECENT_EXPENSE_LIMIT),
      ],
    }),
    databases.listDocuments({
      databaseId: APPWRITE_DATABASE_ID,
      collectionId: APPWRITE_BUDGETS_COLLECTION_ID,
      queries: [Query.equal("userId", userId), Query.limit(1)],
    }),
  ]);

  const expenses = expenseResponse.documents.map((expense) => ({
    category:
      typeof expense.category === "string" && expense.category.trim()
        ? expense.category.trim()
        : "Others",
    amount: Number.isFinite(Number(expense.amount)) ? Number(expense.amount) : 0,
  }));

  const budgetDocument = budgetResponse.documents[0] ?? null;
  const budget =
    budgetDocument && Number.isFinite(Number(budgetDocument.amount))
      ? Number(budgetDocument.amount)
      : null;

  log("Fetched expenses: " + JSON.stringify(expenses));
  log("Fetched budget: " + JSON.stringify(budget));

  if (!expenses || expenses.length === 0) {
    log("No expenses found");
  }

  return {
    userId,
    budget,
    expenses,
  };
};

export default async ({ req, res, log, error }) => {
  try {
    const jwt = getHeader(req, "x-appwrite-user-jwt").trim();

    if (!jwt) {
      return res.json({
        reply: UNAUTHENTICATED_FALLBACK,
      });
    }

    const body = parseRequestBody(req);
    const message =
      typeof body.message === "string" && body.message.trim()
        ? body.message.trim()
        : "Give one practical budgeting tip.";
    const apiKey = process.env.GEMINI_API_KEY?.trim();

    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is missing.");
    }

    const financialContext = await getFinancialContext(req, log);

    if (!financialContext) {
      return res.json({
        reply: UNAUTHENTICATED_FALLBACK,
      });
    }

    const { userId, budget, expenses } = financialContext;
    const expenseLines =
      expenses.length > 0
        ? expenses
            .map(
              (expense) =>
                `${expense.category}: ${RUPEE_SYMBOL}${formatAmount(expense.amount)}`
            )
            .join("\n")
        : "No recent expenses found.";
    const budgetLine =
      budget === null ? "Not set" : `${RUPEE_SYMBOL}${formatAmount(budget)}`;
    const prompt = `
You are a smart financial advisor inside a budgeting app.

User Budget: ${budgetLine}

Recent Expenses:
${expenseLines}

User Question: ${message}

Give short, practical, personalized financial advice based on the user's spending.
`.trim();

    log("Generating advice for user: " + userId);
    log("Final prompt: " + prompt);

    const response = await fetch(`${GEMINI_ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: prompt }],
          },
        ],
      }),
    });

    const rawResponse = await response.text();
    let data = {};

    try {
      data = rawResponse ? JSON.parse(rawResponse) : {};
    } catch {
      throw new Error("Failed to parse Gemini response JSON: " + rawResponse);
    }

    log("Gemini response: " + JSON.stringify(data));

    if (!response.ok) {
      throw new Error(`Gemini API error (${response.status}): ${JSON.stringify(data)}`);
    }

    let reply = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!reply || typeof reply !== "string" || !reply.trim()) {
      reply = NO_RESPONSE_FALLBACK;
    }

    return res.json({ reply: reply.trim() });
  } catch (err) {
    error("Gemini error: " + (err?.message || String(err)));

    return res.json({
      reply: ERROR_FALLBACK,
    });
  }
};
