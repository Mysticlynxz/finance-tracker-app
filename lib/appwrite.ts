import {
  Account,
  AppwriteException,
  Client,
  Databases,
  ExecutionMethod,
  Functions,
  ID,
  Models,
  Query,
} from "appwrite";

const APPWRITE_ENDPOINT = "https://cloud.appwrite.io/v1";
const APPWRITE_PROJECT_ID = "69a4662b001f58493387";
export const APPWRITE_DATABASE_ID = "69a4e415003c658fe722";
const APPWRITE_EXPENSES_COLLECTION_ID = "expenses";
const APPWRITE_BUDGETS_COLLECTION_ID = "budgets";
const APPWRITE_AI_ADVISOR_FUNCTION_ID ="69a76eab00275ef10835";
export const AI_ADVISOR_FALLBACK_RESPONSE =
  "I'm having trouble right now, but hey — tracking expenses already puts you ahead of most people 😄";
const AI_ADVISOR_UNAVAILABLE_MESSAGE = AI_ADVISOR_FALLBACK_RESPONSE;
const PROJECT_PAUSED_ERROR_TEXT = "Project is paused due to inactivity";
const PROJECT_PAUSED_RECOVERY_MESSAGE =
  "The backend is paused due to inactivity. Open Appwrite Console and restore this project, then try again.";

const client = new Client()
  .setEndpoint(APPWRITE_ENDPOINT)
  .setProject(APPWRITE_PROJECT_ID);

export const account = new Account(client);
export const databases = new Databases(client);
export const functions = new Functions(client);

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
}

export interface SetBudgetInput {
  amount: number;
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

const RESET_BATCH_SIZE = 100;

const parseNumericAmount = (value: unknown, fieldName: string) => {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    console.warn(`[Appwrite] Invalid numeric value for ${fieldName}:`, value);
    return 0;
  }

  return numericValue;
};

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

    return await databases.createDocument<ExpenseDocument>({
      databaseId: APPWRITE_DATABASE_ID,
      collectionId: APPWRITE_EXPENSES_COLLECTION_ID,
      documentId: ID.unique(),
      data: {
        amount: normalizedAmount,
        category: input.category,
        date: input.date,
        userId: user.$id,
      },
    });
  } catch (error) {
    const message = getErrorMessage(error);
    console.error("[Appwrite] createExpense failed:", message);
    throw new Error(message);
  }
};

export const getExpenses = async (): Promise<ExpenseDocument[]> => {
  try {
    const user = await getCurrentUser();

    const response = await databases.listDocuments<ExpenseDocument>({
      databaseId: APPWRITE_DATABASE_ID,
      collectionId: APPWRITE_EXPENSES_COLLECTION_ID,
      queries: [Query.equal("userId", user.$id)],
    });

    return response.documents.map((expense) => ({
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
): Promise<Models.Document> => {
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
    });
  } catch (error) {
    const message = getErrorMessage(error);
    console.error("[Appwrite] setBudget failed:", message);
    throw new Error(message);
  }
};

export const getBudget = async (): Promise<number | null> => {
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

    return parseNumericAmount(budget.amount, `budget:${budget.$id}`);
  } catch (error) {
    const message = getErrorMessage(error);
    console.error("[Appwrite] getBudget failed:", message);
    throw new Error(message);
  }
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

export const askFinancialAdvisor = async (
  message: string,
  currency?: string,
  exchangeRate?: number
): Promise<string> => {
  const trimmedMessage = message.trim();

  if (!trimmedMessage) {
    return AI_ADVISOR_UNAVAILABLE_MESSAGE;
  }

  const normalizedCurrency =
    typeof currency === "string" && currency.trim() ? currency.trim().toUpperCase() : "INR";
  const normalizedExchangeRate = Number(exchangeRate);

  try {
    const execution = await functions.createExecution({
      functionId: APPWRITE_AI_ADVISOR_FUNCTION_ID,
      body: JSON.stringify({
        message: trimmedMessage,
        currency: normalizedCurrency,
        exchangeRate:
          Number.isFinite(normalizedExchangeRate) && normalizedExchangeRate > 0
            ? normalizedExchangeRate
            : 1,
      }),
      async: false,
      method: ExecutionMethod.POST,
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!execution.responseBody) {
      return AI_ADVISOR_UNAVAILABLE_MESSAGE;
    }

    const parsedResponse = JSON.parse(execution.responseBody) as { reply?: unknown };

    const reply =
      typeof parsedResponse.reply === "string" ? parsedResponse.reply : "";

    if (!reply.trim()) {
      return AI_ADVISOR_UNAVAILABLE_MESSAGE;
    }

    return reply;
  } catch (error) {
    const message = getErrorMessage(error);
    console.error("[Appwrite] askFinancialAdvisor failed:", message);
    return AI_ADVISOR_UNAVAILABLE_MESSAGE;
  }
};
