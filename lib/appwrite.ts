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
import { createAuthSessionGuard, type AuthSessionIdentity } from "./authSessionGuard";

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

const authSessionGuard = createAuthSessionGuard(async () => {
  const [user, session] = await Promise.all([
    account.get(),
    account.getSession({ sessionId: "current" }),
  ]);
  return { userId: user.$id, sessionId: session.$id };
});

export const beginAuthSessionTransition = () => authSessionGuard.beginTransition();
export const finishAuthSessionTransition = (transitionId: number) =>
  authSessionGuard.finishTransition(transitionId);
export const captureAuthSessionIdentity = () => authSessionGuard.capture();
export const isAuthSessionIdentityCurrent = (identity: AuthSessionIdentity) =>
  authSessionGuard.isCurrent(identity);
export const isAuthSessionGenerationCurrent = (identity: AuthSessionIdentity) =>
  authSessionGuard.isGenerationCurrent(identity);

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

export interface AuthSessionBoundaryChecks {
  isCurrent?: () => Promise<boolean>;
  isGenerationCurrent?: () => boolean;
}

const assertSessionBoundary = async (checks?: AuthSessionBoundaryChecks) => {
  if (checks?.isGenerationCurrent && !checks.isGenerationCurrent()) {
    throw new Error("Authentication session changed during notification evaluation.");
  }
  if (checks?.isCurrent && !(await checks.isCurrent())) {
    throw new Error("Authentication session changed during notification evaluation.");
  }
  if (checks?.isGenerationCurrent && !checks.isGenerationCurrent()) {
    throw new Error("Authentication session changed during notification evaluation.");
  }
};

const deleteUserDocumentsForUser = async (
  collectionId: string,
  userId: string,
  checks?: AuthSessionBoundaryChecks
): Promise<number> => {
  let deletedCount = 0;

  while (true) {
    await assertSessionBoundary(checks);
    const response = await databases.listDocuments({
      databaseId: APPWRITE_DATABASE_ID,
      collectionId,
      queries: [Query.equal("userId", userId), Query.limit(RESET_BATCH_SIZE)],
    });
    await assertSessionBoundary(checks);

    if (response.documents.length === 0) {
      break;
    }

    await assertSessionBoundary(checks);
    await Promise.all(
      response.documents.map((document) =>
        databases.deleteDocument({
          databaseId: APPWRITE_DATABASE_ID,
          collectionId,
          documentId: document.$id,
        })
      )
    );
    await assertSessionBoundary(checks);

    deletedCount += response.documents.length;
  }

  return deletedCount;
};

const deleteUserDocuments = async (collectionId: string): Promise<number> => {
  const user = await getCurrentUser();
  return deleteUserDocumentsForUser(collectionId, user.$id);
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
  const transitionId = beginAuthSessionTransition();
  try {
    return await account.createEmailPasswordSession({
      email,
      password,
    });
  } catch (error) {
    const message = getErrorMessage(error);
    console.error("[Appwrite] loginUser failed:", message);
    throw new Error(message);
  } finally {
    finishAuthSessionTransition(transitionId);
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
  const transitionId = beginAuthSessionTransition();
  try {
    await account.deleteSession({
      sessionId: "current",
    });
  } catch (error) {
    const message = getErrorMessage(error);
    console.error("[Appwrite] logoutUser failed:", message);
    throw new Error(message);
  } finally {
    finishAuthSessionTransition(transitionId);
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

const listExpensesForUser = async (
  userId: string,
  checks?: AuthSessionBoundaryChecks
): Promise<ExpenseDocument[]> => {
  try {
    const pageSize = 100;
    const documents: ExpenseDocument[] = [];
    let offset = 0;
    let total = 0;

    do {
      await assertSessionBoundary(checks);
      const response = await databases.listDocuments<ExpenseDocument>({
        databaseId: APPWRITE_DATABASE_ID,
        collectionId: APPWRITE_EXPENSES_COLLECTION_ID,
        queries: [
          Query.equal("userId", userId),
          Query.limit(pageSize),
          Query.offset(offset),
        ],
      });
      await assertSessionBoundary(checks);
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

export const getExpensesForUser = async (
  userId: string,
  checks?: AuthSessionBoundaryChecks
): Promise<ExpenseDocument[]> => {
  await assertSessionBoundary(checks);
  const user = await getCurrentUser();
  if (user.$id !== userId) {
    throw new Error("Authenticated user changed before expenses were loaded.");
  }
  await assertSessionBoundary(checks);
  return listExpensesForUser(userId, checks);
};

export const getExpenses = async (): Promise<ExpenseDocument[]> => {
  const user = await getCurrentUser();
  return listExpensesForUser(user.$id);
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

export const getBudgetRecordForUser = async (
  userId: string,
  checks?: AuthSessionBoundaryChecks
): Promise<UserBudgetRecord | null> => {
  try {
    await assertSessionBoundary(checks);
    const user = await getCurrentUser();
    if (user.$id !== userId) {
      throw new Error("Authenticated user changed before the budget was loaded.");
    }
    await assertSessionBoundary(checks);

    const budgets = await databases.listDocuments<BudgetDocument>({
      databaseId: APPWRITE_DATABASE_ID,
      collectionId: APPWRITE_BUDGETS_COLLECTION_ID,
      queries: [Query.equal("userId", userId)],
    });
    await assertSessionBoundary(checks);

    const budget = budgets.documents[0];

    if (!budget) {
      return null;
    }

    if (budget.userId !== userId) {
      throw new Error("Budget record owner does not match the requested user.");
    }

    return {
      amount: parseNumericAmount(budget.amount, `budget:${budget.$id}`),
      userId,
      documentId: budget.$id,
      createdAt: budget.$createdAt,
    };
  } catch (error) {
    const message = getErrorMessage(error);
    console.error("[Appwrite] getBudget failed:", message);
    throw new Error(message);
  }
};

export const getBudgetRecord = async (): Promise<UserBudgetRecord | null> => {
  const user = await getCurrentUser();
  return getBudgetRecordForUser(user.$id);
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

export const clearBudgetForUser = async (
  userId: string,
  checks?: AuthSessionBoundaryChecks
): Promise<number> => {
  try {
    await assertSessionBoundary(checks);
    const user = await getCurrentUser();
    if (user.$id !== userId) {
      throw new Error("Authenticated user changed before the budget was reset.");
    }
    await assertSessionBoundary(checks);
    return await deleteUserDocumentsForUser(APPWRITE_BUDGETS_COLLECTION_ID, userId, checks);
  } catch (error) {
    const message = getErrorMessage(error);
    console.error("[Appwrite] clearBudgetForUser failed:", message);
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

  if (execution.status !== "completed") {
    throw new Error("AI function execution did not complete.");
  }
  if (
    typeof execution.responseStatusCode === "number" &&
    (execution.responseStatusCode < 200 || execution.responseStatusCode >= 300)
  ) {
    throw new Error("AI function returned an unsuccessful response.");
  }
  if (!execution.responseBody) {
    throw new Error("Empty AI function response.");
  }

  const parsedResponse = JSON.parse(execution.responseBody) as {
    reply?: unknown;
    unavailable?: unknown;
  };
  if (parsedResponse.unavailable === true) {
    throw new Error("AI advisor is unavailable.");
  }
  const reply =
    typeof parsedResponse.reply === "string" ? parsedResponse.reply.trim() : "";

  if (!reply) {
    throw new Error("AI function returned an empty reply.");
  }

  return reply;
};

export interface AdvisorConversationMessage {
  role: "user" | "assistant";
  text: string;
}

export class AdvisorSessionChangedError extends Error {
  constructor() {
    super("Your session changed while FinBot was replying.");
    this.name = "AdvisorSessionChangedError";
  }
}

export const MAX_ADVISOR_SPEECH_AUDIO_BYTES = 512 * 1024;
const MAX_ADVISOR_SPEECH_TEXT_LENGTH = 500;
const MAX_ADVISOR_SPEECH_CHUNKS = 20;
const MAX_ADVISOR_SPEECH_BASE64_LENGTH =
  Math.ceil(MAX_ADVISOR_SPEECH_AUDIO_BYTES / 3) * 4;

export interface AdvisorSpeechAudio {
  audioBase64: string;
  mimeType: "audio/mpeg";
  byteLength: number;
}

const getBase64ByteLength = (value: string) => {
  if (
    !value ||
    value.length > MAX_ADVISOR_SPEECH_BASE64_LENGTH ||
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) {
    return null;
  }
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  const byteLength = (value.length / 4) * 3 - padding;
  return byteLength > 0 && byteLength <= MAX_ADVISOR_SPEECH_AUDIO_BYTES
    ? byteLength
    : null;
};

export type AdvisorResponseResult =
  | { ok: true; reply: string }
  | { ok: false; reply: string };

const ADVISOR_HISTORY_LIMIT = 6;
const ADVISOR_MESSAGE_MAX_LENGTH = 2000;

export const sanitizeAdvisorConversationHistory = (
  history: unknown,
  currentMessage = ""
): AdvisorConversationMessage[] => {
  if (!Array.isArray(history)) return [];

  const sanitized = history.flatMap((entry): AdvisorConversationMessage[] => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return [];
    }

    const candidate = entry as Record<string, unknown>;
    if (
      (candidate.role !== "user" && candidate.role !== "assistant") ||
      typeof candidate.text !== "string"
    ) return [];

    const text = candidate.text.trim();
    return text ? [{ role: candidate.role, text }] : [];
  });

  const last = sanitized[sanitized.length - 1];
  if (last?.role === "user" && last.text === currentMessage.trim()) {
    sanitized.pop();
  }

  return sanitized
    .slice(-ADVISOR_HISTORY_LIMIT)
    .map(({ role, text }) => ({ role, text: text.slice(0, ADVISOR_MESSAGE_MAX_LENGTH) }));
};

export const getAdvisorHistoryForSession = (
  history: AdvisorConversationMessage[],
  previousSession: AuthSessionIdentity | null,
  nextSession: AuthSessionIdentity | null
) => previousSession && nextSession && sameAdvisorSession(previousSession, nextSession)
  ? history
  : [];

export const updateAdvisorConversationHistory = (
  history: AdvisorConversationMessage[],
  question: string,
  result: AdvisorResponseResult
) => result.ok
  ? sanitizeAdvisorConversationHistory([
      ...history,
      { role: "user", text: question },
      { role: "assistant", text: result.reply },
    ])
  : history;

const sameAdvisorSession = (left: AuthSessionIdentity, right: AuthSessionIdentity) =>
  left.userId === right.userId &&
  left.sessionId === right.sessionId &&
  left.generation === right.generation;

export const splitAdvisorSpeechText = (text: string): string[] => {
  const spoken = text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^[ \t]*#{1,6}\s+/gm, "")
    .replace(/^[ \t]*[-*+]\s+/gm, "")
    .replace(/(\*\*|__|~~|`)/g, "")
    .trim();
  if (!spoken) throw new Error("There is no text to speak.");

  const chunks: string[] = [];
  let remaining = spoken;
  while (remaining.length > MAX_ADVISOR_SPEECH_TEXT_LENGTH) {
    const window = remaining.slice(0, MAX_ADVISOR_SPEECH_TEXT_LENGTH + 1);
    const sentenceEnd = [...window.matchAll(/[.!?।]\s+|\n+/g)]
      .map((match) => (match.index ?? 0) + match[0].length)
      .filter((index) => index <= MAX_ADVISOR_SPEECH_TEXT_LENGTH)
      .pop();
    const whitespace = window.slice(0, MAX_ADVISOR_SPEECH_TEXT_LENGTH + 1).search(/\s+\S*$/);
    const cut = sentenceEnd || whitespace;
    if (cut <= 0) {
      throw new Error("This response contains a passage too long to speak. Please ask for a shorter answer.");
    }
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trimStart();
    if (chunks.length >= MAX_ADVISOR_SPEECH_CHUNKS) {
      throw new Error("This response is too long to speak. Please ask for a shorter answer.");
    }
  }
  if (remaining.trim()) chunks.push(remaining.trim());
  return chunks;
};

export const requestAdvisorSpeech = async (
  text: string,
  expectedSession?: AuthSessionIdentity
): Promise<AdvisorSpeechAudio> => {
  const assistantText = text.trim();
  if (!assistantText) {
    throw new Error("There is no text to speak.");
  }
  if (assistantText.length > MAX_ADVISOR_SPEECH_TEXT_LENGTH) {
    throw new Error("This speech segment is too long.");
  }

  const sessionIdentity = await captureAuthSessionIdentity();
  if (
    !sessionIdentity ||
    (expectedSession && !sameAdvisorSession(sessionIdentity, expectedSession)) ||
    !(await isAuthSessionIdentityCurrent(sessionIdentity))
  ) {
    throw new AdvisorSessionChangedError();
  }

  const execution = await functions.createExecution({
    functionId: APPWRITE_AI_ADVISOR_FUNCTION_ID,
    body: JSON.stringify({ mode: "text-to-speech", text: assistantText }),
    async: false,
    method: ExecutionMethod.POST,
    headers: { "Content-Type": "application/json" },
  });
  if (execution.status !== "completed") {
    throw new Error("FinBot voice did not complete. Please try again.");
  }
  if (
    typeof execution.responseStatusCode !== "number" ||
    execution.responseStatusCode < 200 ||
    execution.responseStatusCode >= 300
  ) {
    let message = "FinBot voice is temporarily unavailable. Please try again.";
    try {
      if ((execution.responseBody || "").length > 2048) {
        throw new Error("Function error response is too large.");
      }
      const errorResponse = JSON.parse(execution.responseBody || "") as { error?: unknown };
      if (typeof errorResponse.error === "string" && errorResponse.error.trim()) {
        message = errorResponse.error.trim();
      }
    } catch {
      // Keep the generic message for non-JSON Function errors.
    }
    throw new Error(message);
  }

  if ((execution.responseBody || "").length > MAX_ADVISOR_SPEECH_BASE64_LENGTH + 512) {
    throw new Error("FinBot returned audio that is too large.");
  }
  let response: unknown;
  try {
    response = JSON.parse(execution.responseBody || "") as unknown;
  } catch {
    throw new Error("FinBot returned an invalid audio response.");
  }
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    throw new Error("FinBot returned an invalid audio response.");
  }
  const speechResponse = response as Record<string, unknown>;
  if (speechResponse.mimeType !== "audio/mpeg" || typeof speechResponse.audioBase64 !== "string") {
    console.warn("[FinBot TTS] Unexpected function response", {
      hasReply: typeof speechResponse.reply === "string",
      hasError: typeof speechResponse.error === "string",
      mimeType: typeof speechResponse.mimeType === "string" ? speechResponse.mimeType.slice(0, 80) : null,
      hasAudio: typeof speechResponse.audioBase64 === "string",
    });
    if (typeof speechResponse.reply === "string" && !speechResponse.audioBase64) {
      throw new Error("The deployed FinBot function did not return speech audio. Its TTS implementation may need deployment.");
    }
    throw new Error("FinBot returned an unexpected speech response. Check the function deployment and logs.");
  }

  const byteLength = getBase64ByteLength(speechResponse.audioBase64);
  if (
    byteLength === null ||
    !Number.isSafeInteger(speechResponse.byteLength) ||
    speechResponse.byteLength !== byteLength
  ) {
    throw new Error("FinBot returned an invalid audio response.");
  }
  if (
    !(await isAuthSessionIdentityCurrent(sessionIdentity)) ||
    (expectedSession && !sameAdvisorSession(sessionIdentity, expectedSession))
  ) {
    throw new AdvisorSessionChangedError();
  }

  return {
    audioBase64: speechResponse.audioBase64,
    mimeType: "audio/mpeg",
    byteLength,
  };
};

export const askFinancialAdvisorWithStatus = async (
  message: string,
  currency?: string,
  history: AdvisorConversationMessage[] = [],
  expectedSession?: AuthSessionIdentity
): Promise<AdvisorResponseResult> => {
  const trimmedMessage = message.trim();

  if (!trimmedMessage) {
    return { ok: false, reply: AI_ADVISOR_UNAVAILABLE_MESSAGE };
  }

  try {
    const sessionIdentity = await captureAuthSessionIdentity();
    if (
      !sessionIdentity ||
      (expectedSession && !sameAdvisorSession(sessionIdentity, expectedSession)) ||
      !(await isAuthSessionIdentityCurrent(sessionIdentity))
    ) {
      throw new AdvisorSessionChangedError();
    }
    const reply = await executeAiFunction({
      mode: "advisor",
      message: trimmedMessage,
      currency: normalizeCurrencyCode(currency),
      history: sanitizeAdvisorConversationHistory(history, trimmedMessage),
    });
    if (
      (expectedSession && !sameAdvisorSession(sessionIdentity, expectedSession)) ||
      !(await isAuthSessionIdentityCurrent(sessionIdentity))
    ) {
      throw new AdvisorSessionChangedError();
    }
    return { ok: true, reply };
  } catch (error) {
    if (error instanceof AdvisorSessionChangedError) throw error;
    const message = getErrorMessage(error);
    console.error("[Appwrite] askFinancialAdvisor failed:", message);
    return { ok: false, reply: AI_ADVISOR_UNAVAILABLE_MESSAGE };
  }
};

export const askFinancialAdvisor = async (
  message: string,
  currency?: string,
  history: AdvisorConversationMessage[] = [],
  expectedSession?: AuthSessionIdentity
): Promise<string> => (await askFinancialAdvisorWithStatus(
  message,
  currency,
  history,
  expectedSession
)).reply;

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
