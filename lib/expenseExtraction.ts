import { DEFAULT_CATEGORY_NAMES } from "../constants/categories";
import { requestExpenseExtractionReply as requestExpenseExtractionReplyFromAppwrite } from "./appwrite";
import { getCategories } from "./categoryService";

export const OTHER_CATEGORY_NAME = "Other";
const GEMINI_MODEL = "gemini-2.5-pro";
const GEMINI_GENERATE_CONTENT_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const EXTRACTION_FALLBACK = {
  category: OTHER_CATEGORY_NAME,
  amount: 0,
} as const;

const EMPTY_EXPENSES_REPLY = "[]";

interface GeminiContentPart {
  text?: string;
}

interface GeminiCandidate {
  content?: {
    parts?: GeminiContentPart[];
  };
}

interface GeminiGenerateContentResponse {
  candidates?: GeminiCandidate[];
  error?: {
    message?: string;
  };
}

const getGeminiApiKey = () =>
  process.env.EXPO_PUBLIC_GEMINI_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim() || "";

const buildGeminiExpensePrompt = (transcribedText: string) => `Extract ALL expenses from the following sentence.

Return ONLY valid JSON array.

Each item must have:
- amount (number)
- category (string)

Example:
Input: I spent 200 on food and 500 on travel

Output:
[
  { "amount": 200, "category": "Food" },
  { "amount": 500, "category": "Travel" }
]

If category is unclear, use "Other".

Now process:
${transcribedText}`;

const parseGeminiResponse = async (
  response: Response
): Promise<GeminiGenerateContentResponse> => {
  const responseText = await response.text();

  if (!responseText.trim()) {
    return {};
  }

  try {
    return JSON.parse(responseText) as GeminiGenerateContentResponse;
  } catch {
    throw new Error(
      responseText.trim() || `Gemini returned an invalid response with status ${response.status}.`
    );
  }
};

const extractReplyTextFromGemini = (data: GeminiGenerateContentResponse) =>
  data.candidates?.[0]?.content?.parts
    ?.map((part) => part.text?.trim() || "")
    .join("")
    .trim() || "";

const requestGeminiExpenseExtractionReply = async (
  transcribedText: string
): Promise<string> => {
  const apiKey = getGeminiApiKey();

  if (!apiKey) {
    throw new Error("Missing EXPO_PUBLIC_GEMINI_API_KEY.");
  }

  const response = await fetch(`${GEMINI_GENERATE_CONTENT_URL}?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            {
              text: buildGeminiExpensePrompt(transcribedText),
            },
          ],
        },
      ],
      generationConfig: {
        response_mime_type: "application/json",
        response_schema: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              category: {
                type: "STRING",
              },
              amount: {
                type: "NUMBER",
              },
            },
            required: ["category", "amount"],
          },
        },
      },
    }),
  });

  const data = await parseGeminiResponse(response);

  if (!response.ok) {
    throw new Error(
      data.error?.message?.trim() || response.statusText || "Gemini expense extraction failed."
    );
  }

  const reply = extractReplyTextFromGemini(data);

  if (!reply) {
    throw new Error("Gemini returned an empty reply.");
  }

  return reply;
};

const canonicalizeCategoryName = (category: string) => {
  const trimmedCategory = category.trim();

  if (!trimmedCategory) {
    return "";
  }

  return normalizeExpenseText(trimmedCategory) === "others"
    ? OTHER_CATEGORY_NAME
    : trimmedCategory;
};

export const normalizeExpenseText = (text: string) => text.trim().toLowerCase();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const normalizeParsedExpenses = (parsed: unknown): Record<string, unknown>[] => {
  if (Array.isArray(parsed)) {
    return parsed.filter(isRecord);
  }

  if (isRecord(parsed)) {
    return [parsed];
  }

  return [];
};

export const buildValidExpenseCategories = (userCategories: string[] = []) => {
  const uniqueCategories: string[] = [];
  const seenCategories = new Set<string>();

  [...DEFAULT_CATEGORY_NAMES, ...userCategories].forEach((category) => {
    const canonicalCategory = canonicalizeCategoryName(category);

    if (!canonicalCategory) {
      return;
    }

    const normalizedCategory = normalizeExpenseText(canonicalCategory);

    if (seenCategories.has(normalizedCategory)) {
      return;
    }

    seenCategories.add(normalizedCategory);
    uniqueCategories.push(canonicalCategory);
  });

  return uniqueCategories;
};

export const findMatchingExpenseCategory = (
  rawCategory: string,
  validCategories: string[]
) => {
  const normalizedRawCategory = normalizeExpenseText(canonicalizeCategoryName(rawCategory));

  if (!normalizedRawCategory) {
    return undefined;
  }

  return validCategories.find(
    (category) =>
      normalizeExpenseText(canonicalizeCategoryName(category)) === normalizedRawCategory
  );
};

export const matchExpenseCategory = (rawCategory: string, validCategories: string[]) =>
  findMatchingExpenseCategory(rawCategory, validCategories) ?? OTHER_CATEGORY_NAME;

export const loadValidExpenseCategories = async (): Promise<string[]> => {
  try {
    const userCategories = await getCategories();
    return buildValidExpenseCategories(userCategories.map((category) => category.name));
  } catch (error) {
    console.error("[Expense Extraction] Failed to load categories:", error);
    return buildValidExpenseCategories();
  }
};

export interface ExtractedExpense {
  amount: number;
  category: string;
  rawCategory: string;
  parsed: Record<string, unknown>;
}

export interface ExpenseExtractionResult {
  expenses: ExtractedExpense[];
  reply: string;
  parsed: unknown;
  validCategories: string[];
}

export const extractExpenseFromUserText = async (
  userText: string,
  categories?: string[]
): Promise<ExpenseExtractionResult> => {
  const trimmedUserText = userText.trim();
  const validCategories =
    categories && categories.length > 0
      ? buildValidExpenseCategories(categories)
      : await loadValidExpenseCategories();

  console.log("User text:", trimmedUserText);

  if (!trimmedUserText) {
    const reply = EMPTY_EXPENSES_REPLY;
    const parsed: Record<string, unknown>[] = [];

    console.log("Gemini raw:", reply);
    console.log("Parsed:", parsed);
    console.log("Final:", []);

    return {
      expenses: [],
      reply,
      parsed,
      validCategories,
    };
  }

  let reply = JSON.stringify(EXTRACTION_FALLBACK);
  try {
    reply = await requestGeminiExpenseExtractionReply(trimmedUserText);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Gemini expense extraction failed.";
    console.error("[Expense Extraction] Gemini request failed:", errorMessage);

    reply = await requestExpenseExtractionReplyFromAppwrite({
      message: trimmedUserText,
      validCategories,
    });
  }

  console.log("Gemini raw:", reply);

  let parsed: unknown;

  try {
    parsed = JSON.parse(reply) as unknown;
  } catch {
    parsed = [];
  }

  console.log("Parsed:", parsed);

  const expenses = normalizeParsedExpenses(parsed).map((expense) => {
    const rawCategory =
      typeof expense.category === "string" && expense.category.trim()
        ? expense.category.trim()
        : EXTRACTION_FALLBACK.category;
    const amount = Number(expense.amount) || 0;
    const matchedCategory = matchExpenseCategory(rawCategory, validCategories);

    return {
      amount,
      category: matchedCategory,
      rawCategory,
      parsed: expense,
    };
  });

  console.log(
    "Final:",
    expenses.map(({ category, amount }) => ({
      matchedCategory: category,
      amount,
    }))
  );

  return {
    expenses,
    reply,
    parsed,
    validCategories,
  };
};
