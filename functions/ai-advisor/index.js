import { Client, Databases, Query } from "appwrite";
import fetch from "node-fetch";

console.log("Function started");

const AI_ADVISOR_FALLBACK =
  "I'm having trouble right now, but hey \u2014 tracking expenses already puts you ahead of most people \u{1F604}";
const UNAUTHENTICATED_FALLBACK = "User not authenticated. Please log in again.";
const GEMINI_MODEL = "gemini-3-flash-preview";
const GEMINI_ENDPOINT =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const DEFAULT_DISPLAY_CURRENCY = "INR";
const DEFAULT_EXTRACTED_EXPENSE = JSON.stringify({
  category: "Others",
  amount: 0,
});
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
// Voice NLP extracts only category + amount.
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

const ADVISOR_SYSTEM_PROMPT = `
You are a friendly AI financial advisor.

- Respond conversationally to greetings (for example: hello, hi, hey).
- Maintain a slightly humorous and friendly tone.
- If the user asks about spending, budgets, or finance, provide helpful insights.
- Keep responses short, clear, and engaging.

Examples:

User: Hello
AI: Hey there! Ready to take control of your finances today?

User: How much did I spend?
AI: Here's a quick breakdown of your spending...
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

const extractReplyText = (data) => {
  const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  return typeof reply === "string" ? reply.trim() : "";
};

const callGemini = async ({ apiKey, prompt, systemPrompt }) => {
  const response = await fetch(`${GEMINI_ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ...(systemPrompt
        ? {
            systemInstruction: {
              parts: [{ text: systemPrompt }],
            },
          }
        : {}),
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

  return data;
};

const sanitizeJsonReply = (reply) =>
  reply
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

const buildVoiceExpenseReply = async ({ apiKey, transcript }) => {
  const extractionPrompt = `
Extract expense details from this sentence:
"${transcript}"

Return ONLY JSON:
{
  "category": "string",
  "amount": number
}

Rules:
- If category unclear -> "Others"
- If amount missing -> 0
- No explanation
`.trim();

  const data = await callGemini({
    apiKey,
    prompt: extractionPrompt,
  });

  const reply = extractReplyText(data);

  if (!reply) {
    return DEFAULT_EXTRACTED_EXPENSE;
  }

  const parsed = JSON.parse(sanitizeJsonReply(reply));
  const category =
    typeof parsed?.category === "string" && parsed.category.trim()
      ? parsed.category.trim()
      : "Others";
  const amount = roundAmount(parsed?.amount);

  return JSON.stringify({
    category,
    amount,
  });
};

const buildAdvisorReply = async ({ apiKey, currency, financialContext, message, log }) => {
  const { userId, budget, expenses } = financialContext;

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

  const expensesSection = formattedExpenses || "No expenses recorded yet.";

  const prompt = `
User preferred currency: ${currency}

IMPORTANT RULES:
- All values are already converted to ${currency}
- DO NOT use INR in your response
- ALWAYS use the correct currency symbol for ${currency}
- If the user is just greeting you, reply naturally and briefly.
- If the user is asking about finances, use the budget and expenses below when helpful.
- If no expenses are recorded yet, say that naturally and suggest a simple next step.
- Keep the reply short, clear, and engaging.

Budget: ${formattedBudget}

Expenses:
${expensesSection}

User Question:
${message}

Now respond to the user's message.
`.trim();

  log(`Generating advisor reply for user ${userId} in ${currency}`);

  const data = await callGemini({
    apiKey,
    prompt,
    systemPrompt: ADVISOR_SYSTEM_PROMPT,
  });

  return extractReplyText(data) || AI_ADVISOR_FALLBACK;
};

const shouldReturnStartupResponse = ({ req, body, jwt }) => {
  if (req?.method === "GET") {
    return true;
  }

  if (typeof body.mode === "string" && body.mode.trim().toLowerCase() === "health") {
    return true;
  }

  if (jwt) {
    return false;
  }

  const hasAiPayload =
    (typeof body.message === "string" && body.message.trim()) ||
    (typeof body.transcript === "string" && body.transcript.trim());

  return !hasAiPayload;
};

export default async ({ req, res, log, error }) => {
  log("Function started");

  try {
    const body = parseRequestBody(req);
    const jwt = getHeader(req, "x-appwrite-user-jwt").trim();

    if (shouldReturnStartupResponse({ req, body, jwt })) {
      return res.json({
        success: true,
        message: "Function working",
      });
    }

    if (!jwt) {
      return res.json({ reply: UNAUTHENTICATED_FALLBACK });
    }

    const apiKey = process.env.GEMINI_API_KEY?.trim();

    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is missing.");
    }

    const mode =
      typeof body.mode === "string" && body.mode.trim()
        ? body.mode.trim().toLowerCase()
        : "advisor";

    if (mode === "extract-expense") {
      const transcript =
        typeof body.message === "string" && body.message.trim()
          ? body.message.trim()
          : typeof body.transcript === "string" && body.transcript.trim()
            ? body.transcript.trim()
            : "";

      if (!transcript) {
        return res.json({ reply: DEFAULT_EXTRACTED_EXPENSE });
      }

      const reply = await buildVoiceExpenseReply({
        apiKey,
        transcript,
      });

      return res.json({ reply });
    }

    const financialContext = await getFinancialContext(req);

    if (!financialContext) {
      return res.json({ reply: UNAUTHENTICATED_FALLBACK });
    }

    const message =
      typeof body.message === "string" && body.message.trim()
        ? body.message.trim()
        : "Give one practical budgeting tip.";
    const currency = getDisplayCurrency(body.currency);

    const reply = await buildAdvisorReply({
      apiKey,
      currency,
      financialContext,
      message,
      log,
    });

    return res.json({ reply });
  } catch (err) {
    error(`Gemini error: ${err?.message || String(err)}`);
    return res.json({ reply: AI_ADVISOR_FALLBACK });
  }
};
