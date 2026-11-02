import { DEFAULT_CATEGORY_NAMES } from "../constants/categories";
import { requestExpenseExtractionReply as requestExpenseExtractionReplyFromAppwrite } from "./appwrite";
import { getCategories } from "./categoryService";

export const OTHER_CATEGORY_NAME = "Other";

const EXTRACTION_FALLBACK = {
  category: OTHER_CATEGORY_NAME,
  amount: 0,
} as const;

const EMPTY_EXPENSES_REPLY = "[]";

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

const normalizeExpenseDate = (value: unknown): string | null => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const parsedDate = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsedDate.getTime()) && parsedDate.toISOString().slice(0, 10) === value
    ? value
    : null;
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
  date: string | null;
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

  if (!trimmedUserText) {
    const reply = EMPTY_EXPENSES_REPLY;
    const parsed: Record<string, unknown>[] = [];

    return {
      expenses: [],
      reply,
      parsed,
      validCategories,
    };
  }

  const reply = await requestExpenseExtractionReplyFromAppwrite({
    message: trimmedUserText,
    validCategories,
  });

  let parsed: unknown;

  try {
    parsed = JSON.parse(reply) as unknown;
  } catch {
    parsed = [];
  }

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
      date: normalizeExpenseDate(expense.date),
      rawCategory,
      parsed: expense,
    };
  });

  return {
    expenses,
    reply,
    parsed,
    validCategories,
  };
};
