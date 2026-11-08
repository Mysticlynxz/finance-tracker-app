import { ExecutionMethod } from "appwrite";

export type FunctionResponse = { ok?: boolean; error?: { message?: string; code?: string } };
type FunctionsClient = {
  createExecution: (params: {
    functionId: string;
    body: string;
    async: boolean;
    method: ExecutionMethod;
  }) => Promise<{
    status: string;
    responseBody: string;
    responseStatusCode: number;
  }>;
};

export const executeCategoryBudgetRequest = async (
  functionsClient: FunctionsClient,
  functionId: string,
  payload: Record<string, unknown>
) => {
  // Appwrite forwards the session of this authenticated shared client automatically.
  const execution = await functionsClient.createExecution({
    functionId,
    body: JSON.stringify(payload),
    async: false,
    method: ExecutionMethod.POST,
  });

  if (execution.status !== "completed" || !execution.responseBody) {
    throw new Error("Category budget request did not complete. Please try again.");
  }
  let response: FunctionResponse;
  try {
    response = JSON.parse(execution.responseBody) as FunctionResponse;
  } catch {
    throw new Error("Category budget service returned an invalid response.");
  }
  if (execution.responseStatusCode >= 400 || response.ok !== true) {
    throw new Error(response.error?.message || "Unable to manage category budgets.");
  }
  return response;
};
