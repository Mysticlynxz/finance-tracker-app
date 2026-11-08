import {
  Account,
  AppwriteException,
  Client,
  Databases,
  ExecutionMethod,
  Functions,
  ID,
  Models,
  Permission,
  Query,
  Role,
  Storage,
} from "appwrite";
import { normalizeCurrencyCode } from "../constants/currency";

export const APPWRITE_ENDPOINT =
  process.env.EXPO_PUBLIC_APPWRITE_ENDPOINT?.trim() || "https://fra.cloud.appwrite.io/v1";
export const APPWRITE_PROJECT_ID =
  process.env.EXPO_PUBLIC_APPWRITE_PROJECT_ID?.trim() || "69a4662b001f58493387";
export const APPWRITE_DATABASE_ID =
  process.env.EXPO_PUBLIC_APPWRITE_DATABASE_ID?.trim() || "69a4e415003c658fe722";
export const VOICE_RECORDINGS_BUCKET_ID = "spendwise-voice-recordings";
const APPWRITE_EXPENSES_COLLECTION_ID =
  process.env.EXPO_PUBLIC_APPWRITE_EXPENSES_COLLECTION_ID?.trim() || "expenses";
const APPWRITE_BUDGETS_COLLECTION_ID =
  process.env.EXPO_PUBLIC_APPWRITE_BUDGETS_COLLECTION_ID?.trim() || "budgets";
export const APPWRITE_AI_ADVISOR_FUNCTION_ID =
  process.env.EXPO_PUBLIC_APPWRITE_AI_ADVISOR_FUNCTION_ID?.trim() || "69a76eab00275ef10835";
export const AI_ADVISOR_FALLBACK_RESPONSE =
  "I'm having trouble right now, but hey — tracking expenses already puts you ahead of most people 😄";
const AI_ADVISOR_UNAVAILABLE_MESSAGE = AI_ADVISOR_FALLBACK_RESPONSE;
const DEFAULT_EXPENSE_EXTRACTION_REPLY = JSON.stringify({
  category: "Other",
  amount: 0,
});
const PROJECT_PAUSED_ERROR_TEXT = "Project is paused due to inactivity";
const PROJECT_PAUSED_RECOVERY_MESSAGE =
  "The backend is paused due to inactivity. Open Appwrite Console and restore this project, then try again.";

const client = new Client()
  .setEndpoint(APPWRITE_ENDPOINT)
  .setProject(APPWRITE_PROJECT_ID);

export const account = new Account(client);
export const databases = new Databases(client);
export const functions = new Functions(client);
export const storage = new Storage(client);

export const getErrorMessage = (error: unknown) => {
  if (error instanceof AppwriteException || error instanceof Error) {
    if (error.message.includes(PROJECT_PAUSED_ERROR_TEXT)) {
      return PROJECT_PAUSED_RECOVERY_MESSAGE;
    }

    return error.message;
  }

  return "An unexpected error occurred.";
};

export interface RegisterUserInput {
  email: string;
  password: string;
  name: string;
}

export interface LoginUserInput {
  email: string;
  password: string;
}

export interface CreateExpenseInput {
  amount: number;
  category: string;
  date: string;
  /**
   * Optional stable document ID for idempotent retries.
   * When provided, createExpense will reuse this ID so that a retry after
   * a network timeout does not create a duplicate document.
   */
  documentId?: string;
}

export interface SetBudgetInput {
  amount: number;
}

export interface ExpenseExtractionAiInput {
  message: string;
  validCategories: string[];
}

export interface ExpenseDocument extends Models.Document {
  amount: number;
  category: string;
  date: string;
  userId: string;
}

export interface BudgetDocument extends Models.Document {
  amount: number;
  userId: string;
}

export interface UserBudgetRecord {
  amount: number;
  userId: string;
  documentId: string;
  createdAt: string;
}

// IMPORTANT:
// Always store raw currency values ONLY in INR.
// Never convert or scale before writing anything except selected currency -> INR.
// Convert only for UI display and AI responses.

const RESET_BATCH_SIZE = 100;

const parseNumericAmount = (value: unknown, fieldName: string) => {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    console.warn(`[Appwrite] Invalid numeric value for ${fieldName}:`, value);
    return 0;
  }

  return numericValue;
};

const buildUserDocumentPermissions = (userId: string) => [
  Permission.read(Role.user(userId)),
  Permission.update(Role.user(userId)),
  Permission.delete(Role.user(userId)),
];

const deleteUserDocuments = async (collectionId: string): Promise<number> => {
  const user = await getCurrentUser();
  let deletedCount = 0;

  while (true) {
    const response = await databases.listDocuments({
      databaseId: APPWRITE_DATABASE_ID,
      collectionId,
      queries: [Query.equal("userId", user.$id), Query.limit(RESET_BATCH_SIZE)],
    });

    if (response.documents.length === 0) {
      break;
    }

    await Promise.all(
      response.documents.map((document) =>
        databases.deleteDocument({
          databaseId: APPWRITE_DATABASE_ID,
          collectionId,
          documentId: document.$id,
        })
      )
    );

    deletedCount += response.documents.length;
  }

  return deletedCount;
};

export const registerUser = async ({
  email,
  password,
  name,
}: RegisterUserInput): Promise<Models.User<Models.Preferences>> => {
  try {
    return await account.create({
      userId: ID.unique(),
      email,
      password,
      name,
    });
  } catch (error) {
    const message = getErrorMessage(error);
    console.error("[Appwrite] registerUser failed:", message);
    throw new Error(message);
  }
};

export const loginUser = async ({
  email,
  password,
}: LoginUserInput): Promise<Models.Session> => {
  try {
    return await account.createEmailPasswordSession({
      email,
      password,
    });
  } catch (error) {
    const message = getErrorMessage(error);
    console.error("[Appwrite] loginUser failed:", message);
    throw new Error(message);
  }
};

export const getCurrentUser = async (): Promise<Models.User<Models.Preferences>> => {
  try {
    return await account.get();
  } catch (error) {
    const message = getErrorMessage(error);
    throw new Error(message);
  }
};

export const logoutUser = async (): Promise<void> => {
  try {
    await account.deleteSession({
      sessionId: "current",
    });
  } catch (error) {
    const message = getErrorMessage(error);
    console.error("[Appwrite] logoutUser failed:", message);
    throw new Error(message);
  }
};

export const createExpense = async (
  input: CreateExpenseInput
): Promise<ExpenseDocument> => {
  try {
    const user = await getCurrentUser();
    const normalizedAmount = Number(input.amount);

    if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
      throw new Error("Expense amount must be a valid number greater than 0.");
    }

    const documentId = input.documentId ?? ID.unique();

    try {
      return await databases.createDocument<ExpenseDocument>({
        databaseId: APPWRITE_DATABASE_ID,
        collectionId: APPWRITE_EXPENSES_COLLECTION_ID,
        documentId,
        data: {
          amount: normalizedAmount,
          category: input.category,
          date: input.date,
          userId: user.$id,
        },
        permissions: buildUserDocumentPermissions(user.$id),
      });
    } catch (createError) {
      // If the document already exists (e.g. retry after a timeout), retrieve it
      // and verify it belongs to the current user with expected data.
      const errorMessage = getErrorMessage(createError);

      // Only an HTTP conflict can represent an existing stable document ID.
      if (!(createError instanceof AppwriteException) || createError.code !== 409) {
        throw createError;
      }

      {
        try {
          const existing = await databases.getDocument<ExpenseDocument>({
            databaseId: APPWRITE_DATABASE_ID,
            collectionId: APPWRITE_EXPENSES_COLLECTION_ID,
            documentId,
          });

          // Verify ownership — never trust an arbitrary conflict.
          if (existing.userId !== user.$id) {
            throw new Error(
              "Expense document conflict: document belongs to a different user."
            );
          }

          // Verify the data matches what we intended to create.
          // Compare at the application's two-decimal storage precision.
          const existingAmount = Number(existing.amount);
          if (!Number.isFinite(existingAmount) || Math.round(existingAmount * 100) !== Math.round(normalizedAmount * 100) || existing.category !== input.category || existing.date !== input.date) {
            throw new Error(
              "Expense document conflict: existing document data does not match expected values."
            );
          }

          console.log("[Appwrite] createExpense retrieved existing document on retry:", existing.$id);
          return existing;
        } catch (retrieveError) {
          if (retrieveError instanceof Error && retrieveError.message.startsWith("Expense document conflict:")) {
            throw retrieveError;
          }
          // If retrieval or verification fails, throw the original error.
          console.error("[Appwrite] Failed to retrieve existing expense document:", retrieveError);
          throw new Error(errorMessage);
        }
      }

      // Not a conflict — rethrow the original error.
      throw new Error(errorMessage);
    }
  } catch (error) {
    const message = getErrorMessage(error);
    console.error("[Appwrite] createExpense failed:", message);
    throw new Error(message);
  }
};

export const getExpenses = async (): Promise<ExpenseDocument[]> => {
  try {
    const user = await getCurrentUser();
    const pageSize = 100;
    const documents: ExpenseDocument[] = [];
    let offset = 0;
    let total = 0;

    do {
      const response = await databases.listDocuments<ExpenseDocument>({
        databaseId: APPWRITE_DATABASE_ID,
        collectionId: APPWRITE_EXPENSES_COLLECTION_ID,
        queries: [
          Query.equal("userId", user.$id),
          Query.limit(pageSize),
          Query.offset(offset),
        ],
      });
      documents.push(...response.documents);
      total = response.total;
      offset += response.documents.length;
    } while (offset < total && offset > 0);

    return documents.map((expense) => ({
      ...expense,
      amount: parseNumericAmount(expense.amount, `expense:${expense.$id}`),
    }));
  } catch (error) {
    console.error("getExpenses failed", error);
    throw error;
  }
};

export const clearExpenses = async (): Promise<number> => {
  try {
    return await deleteUserDocuments(APPWRITE_EXPENSES_COLLECTION_ID);
  } catch (error) {
    const message = getErrorMessage(error);
    console.error("[Appwrite] clearExpenses failed:", message);
    throw new Error(message);
  }
};

export const setBudget = async (
  input: SetBudgetInput
): Promise<BudgetDocument> => {
  try {
    const user = await getCurrentUser();
    const normalizedAmount = Number(input.amount);

    if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
      throw new Error("Budget amount must be a valid number greater than 0.");
    }

    const existingBudgets = await databases.listDocuments<BudgetDocument>({
      databaseId: APPWRITE_DATABASE_ID,
      collectionId: APPWRITE_BUDGETS_COLLECTION_ID,
      queries: [Query.equal("userId", user.$id)],
    });

    const existingBudget = existingBudgets.documents[0];

    if (existingBudget) {
      return await databases.updateDocument<BudgetDocument>({
        databaseId: APPWRITE_DATABASE_ID,
        collectionId: APPWRITE_BUDGETS_COLLECTION_ID,
        documentId: existingBudget.$id,
        data: {
          amount: normalizedAmount,
          userId: user.$id,
        },
        permissions: buildUserDocumentPermissions(user.$id),
      });
    }

    return await databases.createDocument<BudgetDocument>({
      databaseId: APPWRITE_DATABASE_ID,
      collectionId: APPWRITE_BUDGETS_COLLECTION_ID,
      documentId: ID.unique(),
      data: {
        amount: normalizedAmount,
        userId: user.$id,
      },
      permissions: buildUserDocumentPermissions(user.$id),
    });
  } catch (error) {
    const message = getErrorMessage(error);
    console.error("[Appwrite] setBudget failed:", message);
    throw new Error(message);
  }
};

export const getBudgetRecord = async (): Promise<UserBudgetRecord | null> => {
  try {
    const user = await getCurrentUser();

    const budgets = await databases.listDocuments<BudgetDocument>({
      databaseId: APPWRITE_DATABASE_ID,
      collectionId: APPWRITE_BUDGETS_COLLECTION_ID,
      queries: [Query.equal("userId", user.$id)],
    });

    const budget = budgets.documents[0];

    if (!budget) {
      return null;
    }

    if (budget.userId !== user.$id) {
      throw new Error("Budget record owner does not match the authenticated user.");
    }

    return {
      amount: parseNumericAmount(budget.amount, `budget:${budget.$id}`),
      userId: user.$id,
      documentId: budget.$id,
      createdAt: budget.$createdAt,
    };
  } catch (error) {
    const message = getErrorMessage(error);
    console.error("[Appwrite] getBudget failed:", message);
    throw new Error(message);
  }
};

export const getBudget = async (): Promise<number | null> => {
  const budget = await getBudgetRecord();
  return budget?.amount ?? null;
};

export const clearBudget = async (): Promise<number> => {
  try {
    return await deleteUserDocuments(APPWRITE_BUDGETS_COLLECTION_ID);
  } catch (error) {
    const message = getErrorMessage(error);
    console.error("[Appwrite] clearBudget failed:", message);
    throw new Error(message);
  }
};

export const resetAllData = async (): Promise<void> => {
  try {
    await clearExpenses();
    await clearBudget();
  } catch (error) {
    const message = getErrorMessage(error);
    console.error("[Appwrite] resetAllData failed:", message);
    throw new Error(message);
  }
};

const executeAiFunction = async (payload: Record<string, unknown>) => {
  const execution = await functions.createExecution({
    functionId: APPWRITE_AI_ADVISOR_FUNCTION_ID,
    body: JSON.stringify(payload),
    async: false,
    method: ExecutionMethod.POST,
    headers: {
      "Content-Type": "application/json",
    },
  });

  if (!execution.responseBody) {
    throw new Error("Empty AI function response.");
  }

  const parsedResponse = JSON.parse(execution.responseBody) as { reply?: unknown };
  const reply =
    typeof parsedResponse.reply === "string" ? parsedResponse.reply.trim() : "";

  if (!reply) {
    throw new Error("AI function returned an empty reply.");
  }

  return reply;
};

export const askFinancialAdvisor = async (message: string, currency?: string): Promise<string> => {
  const trimmedMessage = message.trim();

  if (!trimmedMessage) {
    return AI_ADVISOR_UNAVAILABLE_MESSAGE;
  }

  try {
    return await executeAiFunction({
      mode: "advisor",
      message: trimmedMessage,
      currency: normalizeCurrencyCode(currency),
    });
  } catch (error) {
    const message = getErrorMessage(error);
    console.error("[Appwrite] askFinancialAdvisor failed:", message);
    return AI_ADVISOR_UNAVAILABLE_MESSAGE;
  }
};

export const requestExpenseExtractionReply = async ({
  message,
  validCategories,
}: ExpenseExtractionAiInput): Promise<string> => {
  const trimmedMessage = message.trim();

  if (!trimmedMessage) {
    return DEFAULT_EXPENSE_EXTRACTION_REPLY;
  }

  try {
    return await executeAiFunction({
      mode: "extract-expense",
      message: trimmedMessage,
      validCategories,
    });
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    console.error("[Appwrite] requestExpenseExtractionReply failed:", errorMessage);
    throw new Error("Expense extraction service is unavailable. Please retry.");
  }
};
