import { DEFAULT_CATEGORY_NAMES } from "../constants/categories";
import { requestExpenseExtractionReply } from "./appwrite";
import { getCategories } from "./categoryService";

export const OTHER_CATEGORY_NAME = "Other";

const EXTRACTION_FALLBACK = {
  category: OTHER_CATEGORY_NAME,
  amount: 0,
} as const;

const sanitizeJsonReply = (reply: string) =>
  reply
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

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
  parsed: Record<string, unknown> | null;
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
    console.log("AI reply:", "");
    console.log("Parsed:", null);
    console.log("Final:", {
      matchedCategory: EXTRACTION_FALLBACK.category,
      amount: EXTRACTION_FALLBACK.amount,
    });

    return {
      amount: EXTRACTION_FALLBACK.amount,
      category: EXTRACTION_FALLBACK.category,
      rawCategory: EXTRACTION_FALLBACK.category,
      reply: "",
      parsed: null,
      validCategories,
    };
  }

  const reply = await requestExpenseExtractionReply({
    message: trimmedUserText,
    validCategories,
  });

  console.log("AI reply:", reply);

  let parsed: Record<string, unknown> | null = null;

  try {
    parsed = JSON.parse(sanitizeJsonReply(reply)) as Record<string, unknown>;
  } catch (error) {
    console.error("JSON parse error:", error);
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
      parsed: null,
      validCategories,
    };
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
