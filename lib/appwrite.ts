import { Account, AppwriteException, Client, Databases, ID, Models, Query } from "appwrite";

const APPWRITE_ENDPOINT = "https://cloud.appwrite.io/v1";
const APPWRITE_PROJECT_ID = "69a4662b001f58493387";
const APPWRITE_DATABASE_ID = "69a4e415003c658fe722";
const APPWRITE_EXPENSES_COLLECTION_ID = "expenses";
const APPWRITE_BUDGETS_COLLECTION_ID = "budgets";

const client = new Client()
  .setEndpoint(APPWRITE_ENDPOINT)
  .setProject(APPWRITE_PROJECT_ID);

export const account = new Account(client);
export const databases = new Databases(client);

const getErrorMessage = (error: unknown) => {
  if (error instanceof AppwriteException) {
    return error.message;
  }

  if (error instanceof Error) {
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
    console.error("[Appwrite] getCurrentUser failed:", message);
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

    return await databases.createDocument<ExpenseDocument>({
      databaseId: APPWRITE_DATABASE_ID,
      collectionId: APPWRITE_EXPENSES_COLLECTION_ID,
      documentId: ID.unique(),
      data: {
        amount: input.amount,
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

    return response.documents;
  } catch (error) {
    console.error("getExpenses failed", error);
    throw error;
  }
};

export const setBudget = async (
  input: SetBudgetInput
): Promise<Models.Document> => {
  try {
    const user = await getCurrentUser();

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
          amount: input.amount,
          userId: user.$id,
        },
      });
    }

    return await databases.createDocument<BudgetDocument>({
      databaseId: APPWRITE_DATABASE_ID,
      collectionId: APPWRITE_BUDGETS_COLLECTION_ID,
      documentId: ID.unique(),
      data: {
        amount: input.amount,
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

    return budget.amount;
  } catch (error) {
    const message = getErrorMessage(error);
    console.error("[Appwrite] getBudget failed:", message);
    throw new Error(message);
  }
};
