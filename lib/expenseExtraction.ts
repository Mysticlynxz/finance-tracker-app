import { DEFAULT_CATEGORY_NAMES } from "../constants/categories";
import { requestExpenseExtractionReply as requestExpenseExtractionReplyFromAppwrite } from "./appwrite";
import { getCategories } from "./categoryService";

export const OTHER_CATEGORY_NAME = "Other";
const GEMINI_MODEL = "gemini-2.0-flash";
const GEMINI_GENERATE_CONTENT_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

const EXTRACTION_FALLBACK = {
  category: OTHER_CATEGORY_NAME,
  amount: 0,
} as const;

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

const buildGeminiExpensePrompt = (transcribedText: string) => `Extract expense details from this sentence:

"${transcribedText}"

Return ONLY valid JSON:
{
  "category": "string",
  "amount": number
}

Rules:
- Category should be a single word (Food, Travel, etc.)
- Amount must be a number
- If missing -> amount = 0
- If unclear -> category = "Other"
- No explanation, only JSON`;

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

export interface ExpenseExtractionResult {
  amount: number;
  category: string;
  rawCategory: string;
  reply: string;
  parsed: Record<string, unknown>;
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
    const reply = JSON.stringify(EXTRACTION_FALLBACK);
    const parsed = { ...EXTRACTION_FALLBACK };

    console.log("Gemini raw:", reply);
    console.log("Parsed:", parsed);
    console.log("Final:", {
      matchedCategory: EXTRACTION_FALLBACK.category,
      amount: EXTRACTION_FALLBACK.amount,
    });

    return {
      amount: EXTRACTION_FALLBACK.amount,
      category: EXTRACTION_FALLBACK.category,
      rawCategory: EXTRACTION_FALLBACK.category,
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

  let parsed: Record<string, unknown>;

  try {
    parsed = JSON.parse(reply) as Record<string, unknown>;
  } catch {
    parsed = { ...EXTRACTION_FALLBACK };
  }

  console.log("Parsed:", parsed);

  const rawCategory =
    typeof parsed.category === "string" && parsed.category.trim()
      ? parsed.category.trim()
      : EXTRACTION_FALLBACK.category;
  const amount = Number(parsed.amount) || 0;
  const matchedCategory = matchExpenseCategory(rawCategory, validCategories);

  console.log("Final:", { matchedCategory, amount });

  return {
    amount,
    category: matchedCategory,
    rawCategory,
    reply,
    parsed,
    validCategories,
  };
};
