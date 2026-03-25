import { Client, Databases, Query } from "appwrite";
import fetch from "node-fetch";

const FRIENDLY_FALLBACK =
  "I'm having trouble right now, but hey \u2014 tracking expenses already puts you ahead of most people \u{1F604}";
const NO_EXPENSES_FALLBACK =
  "Add some expenses first \u2014 your wallet is still a mystery \u{1F604}";
const UNAUTHENTICATED_FALLBACK = "User not authenticated. Please log in again.";
const GEMINI_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";
const DEFAULT_DISPLAY_CURRENCY = "INR";
const RECENT_EXPENSE_LIMIT = 8;

// DATABASE RULE:
// Always store raw INR values ONLY.
// Never convert before saving.
//
// UI RULE:
// Convert currency ONLY for display.
//
// AI RULE:
// Always respond in the selected currency.
const currencyConfig = {
  INR: { symbol: "\u20B9", rate: 1 },
  USD: { symbol: "$", rate: 83 },
  EUR: { symbol: "\u20AC", rate: 90 },
  GBP: { symbol: "\u00A3", rate: 105 },
  JPY: { symbol: "\u00A5", rate: 0.55 },
  CNY: { symbol: "\u00A5", rate: 11.5 },
  AUD: { symbol: "A$", rate: 55 },
  CAD: { symbol: "C$", rate: 60 },
  CHF: { symbol: "CHF", rate: 92 },
  SGD: { symbol: "S$", rate: 62 },
  AED: { symbol: "\u062F.\u0625", rate: 22.5 },
  SAR: { symbol: "\uFDFC", rate: 22 },
};

const SYSTEM_PROMPT = `
You are a smart and slightly humorous financial advisor inside a budgeting app.
Give short, practical, and personalized advice based on the user's expenses and budget.
Use light humor occasionally, but keep it friendly and useful.

Response style rules:
- Always reply as a markdown bullet list with 3 to 5 bullet points maximum.
- Keep each bullet short, practical, and tied to the user's budget or spending categories.
- Add only light humor when it fits, for example "Your wallet is crying \u{1F605}" or "That coffee habit is expensive \u{1F440}".
- Do not overdo jokes, sarcasm, or emojis.
`.trim();

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

const parseRequestBody = (req) => {
  if (typeof req?.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }

  const rawBody = req?.body ?? req?.bodyText ?? req?.bodyJson ?? {};

  if (typeof rawBody === "string") {
    try {
      return JSON.parse(rawBody);
    } catch {
      return {};
    }
  }

  return rawBody && typeof rawBody === "object" ? rawBody : {};
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

const getDisplayCurrency = (value) => {
  const normalized =
    typeof value === "string" ? value.trim().toUpperCase() : DEFAULT_DISPLAY_CURRENCY;

  if (Object.prototype.hasOwnProperty.call(currencyConfig, normalized)) {
    return normalized;
  }

  return DEFAULT_DISPLAY_CURRENCY;
};

const getCurrencySettings = (currency) => currencyConfig[getDisplayCurrency(currency)];

const sanitizeAmount = (value) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : 0;
};

const roundAmount = (value) => Math.round(sanitizeAmount(value) * 100) / 100;

function convertFromINR(amount, currency) {
  const numericAmount = sanitizeAmount(amount);
  const config = getCurrencySettings(currency);

  if (!Number.isFinite(config.rate) || config.rate <= 0) {
    return roundAmount(numericAmount);
  }

  return roundAmount(numericAmount / config.rate);
}

function formatCurrency(amount, currency) {
  const config = getCurrencySettings(currency);
  const safeAmount = roundAmount(amount);

  return `${config.symbol}${safeAmount.toFixed(2)}`;
}

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

const getFinancialContext = async (req) => {
  const jwt = getHeader(req, "x-appwrite-user-jwt").trim();

  if (!jwt) {
    return null;
  }

  const userId = getHeader(req, "x-appwrite-user-id").trim();

  if (!userId) {
    throw new Error("x-appwrite-user-id header is missing.");
  }

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
    amount: sanitizeAmount(expense.amount),
  }));

  const budgetDocument = budgetResponse.documents[0] ?? null;
  const budget = budgetDocument ? sanitizeAmount(budgetDocument.amount) : null;

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
      return res.json({ reply: UNAUTHENTICATED_FALLBACK });
    }

    const body = parseRequestBody(req);
    const message =
      typeof body.message === "string" && body.message.trim()
        ? body.message.trim()
        : "Give one practical budgeting tip.";
    const currency = getDisplayCurrency(body.currency);
    const apiKey = process.env.GEMINI_API_KEY?.trim();

    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is missing.");
    }

    const financialContext = await getFinancialContext(req);

    if (!financialContext) {
      return res.json({ reply: UNAUTHENTICATED_FALLBACK });
    }

    const { userId, budget, expenses } = financialContext;

    if (!expenses || expenses.length === 0) {
      return res.json({ reply: NO_EXPENSES_FALLBACK });
    }

    const formattedExpenses = expenses
      .map((expense) => {
        const convertedAmount = convertFromINR(expense.amount, currency);
        return `${expense.category}: ${formatCurrency(convertedAmount, currency)}`;
      })
      .join("\n");

    const formattedBudget =
      budget === null
        ? "Not set"
        : formatCurrency(convertFromINR(budget, currency), currency);

    const prompt = `
You are a smart and slightly humorous financial advisor inside a budgeting app.

User preferred currency: ${currency}

IMPORTANT RULES:
- All values are already converted to ${currency}
- DO NOT use INR in your response
- ALWAYS use the correct currency symbol for ${currency}
- Keep responses short and practical in 3 to 5 bullet points
- Add light friendly humor occasionally

Budget: ${formattedBudget}

Expenses:
${formattedExpenses}

User Question:
${message}

Give personalized financial advice based on the data.
`.trim();

    log(`Generating advice for user ${userId} in ${currency}`);

    const response = await fetch(`${GEMINI_ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: SYSTEM_PROMPT }],
        },
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
      throw new Error(`Failed to parse Gemini response JSON: ${rawResponse}`);
    }

    if (!response.ok) {
      throw new Error(`Gemini API error (${response.status}): ${JSON.stringify(data)}`);
    }

    const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!reply || typeof reply !== "string" || !reply.trim()) {
      return res.json({ reply: FRIENDLY_FALLBACK });
    }

    return res.json({ reply: reply.trim() });
  } catch (err) {
    error(`Gemini error: ${err?.message || String(err)}`);
    return res.json({ reply: FRIENDLY_FALLBACK });
  }
};
