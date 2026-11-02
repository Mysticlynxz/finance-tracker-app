import { AppwriteException, ExecutionMethod, ID } from "appwrite";
import Constants from "expo-constants";
import { File as ExpoFile } from "expo-file-system";
import { Platform } from "react-native";
import {
  Account as ReactNativeAccount,
  Client as ReactNativeClient,
  Permission,
  Role,
  Storage as ReactNativeStorage,
} from "react-native-appwrite";
import {
  APPWRITE_AI_ADVISOR_FUNCTION_ID,
  APPWRITE_ENDPOINT,
  APPWRITE_PROJECT_ID,
  VOICE_RECORDINGS_BUCKET_ID,
  functions,
  getCurrentUser,
  storage,
} from "./appwrite";

const MAX_RECORDING_BYTES = 5 * 1024 * 1024;

const redactDiagnosticText = (value: string): string =>
  value
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .replace(
      /\b(api[_-]?key|token|secret|password|jwt)\b(\s*[:=]\s*)["']?[^,\s;"']+/gi,
      "$1$2[REDACTED]"
    );

const getSafeEndpoint = (): string => {
  try {
    const endpoint = new URL(APPWRITE_ENDPOINT);
    return `${endpoint.protocol}//${endpoint.host}${endpoint.pathname}`;
  } catch {
    return "invalid endpoint URL";
  }
};

const getUriFileExtension = (uri: string): string => {
  const uriPath = uri.split(/[?#]/, 1)[0];
  const filename = uriPath.slice(uriPath.lastIndexOf("/") + 1);
  return filename.includes(".")
    ? filename.split(".").pop()?.toLowerCase() ?? "unknown"
    : "unknown";
};

const getSafeResponseDetails = (response: string): Record<string, unknown> => {
  const text = redactDiagnosticText(response).slice(0, 1000);
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { format: "non_object_json" };
    }

    const details: Record<string, unknown> = {};
    for (const key of ["message", "code", "type", "version"] as const) {
      const value = (parsed as Record<string, unknown>)[key];
      if (typeof value === "string") {
        details[key] = redactDiagnosticText(value);
      } else if (typeof value === "number") {
        details[key] = value;
      }
    }
    return details;
  } catch {
    return { format: "non_json_or_invalid_json" };
  }
};

const logVoiceUploadFailure = (
  stage: string,
  error: unknown,
  metadata: Record<string, unknown> = {}
): void => {
  const errorRecord =
    error && typeof error === "object" ? (error as Record<string, unknown>) : undefined;
  const response =
    typeof errorRecord?.response === "string" ? errorRecord.response : undefined;
  const responseDetails = response ? getSafeResponseDetails(response) : undefined;
  const details =
    responseDetails && typeof responseDetails === "object" ? responseDetails : undefined;
  const status =
    typeof errorRecord?.code === "number"
      ? errorRecord.code
      : typeof errorRecord?.status === "number"
        ? errorRecord.status
        : undefined;

  console.error("[Voice Upload] Voice upload pipeline failed", {
    stage,
    ...metadata,
    failureKind: status === undefined ? "no_http_response" : "appwrite_http_rejection",
    endpoint: getSafeEndpoint(),
    projectId: APPWRITE_PROJECT_ID,
    bucketId: VOICE_RECORDINGS_BUCKET_ID,
    errorName:
      typeof errorRecord?.name === "string"
        ? errorRecord.name
        : "UnknownError",
    message:
      error instanceof Error ? redactDiagnosticText(error.message) : "Non-Error value thrown",
    httpStatus: status,
    appwriteErrorType:
      typeof errorRecord?.type === "string" ? errorRecord.type : details?.type,
    appwriteErrorCode: typeof details?.code === "number" ? details.code : undefined,
    response: responseDetails,
  });
};

export interface VoiceTranscriptionResponse {
  transcript: string;
  detected_language_code?: string;
}

export const uploadVoiceRecording = async (audioUri: string): Promise<string> => {
  if (Platform.OS === "web") {
    throw new Error("Voice expense capture is supported in the SpendWise mobile app.");
  }

  const uri = audioUri.trim();
  if (!uri) {
    throw new Error("Audio recording URI is required.");
  }

  let audioFile: ExpoFile;
  try {
    audioFile = new ExpoFile(uri);
  } catch (error) {
    logVoiceUploadFailure("inspect_recording_file", error);
    throw error;
  }
  const fileSize = audioFile.size;
  if (!audioFile.exists || fileSize <= 0 || fileSize > MAX_RECORDING_BYTES) {
    throw new Error("Recording is empty or exceeds the 5 MB upload limit.");
  }
  let user: Awaited<ReturnType<typeof getCurrentUser>>;
  try {
    user = await getCurrentUser();
  } catch (error) {
    logVoiceUploadFailure("get_current_user", error);
    throw error;
  }
  const nativeClient = new ReactNativeClient()
    .setEndpoint(APPWRITE_ENDPOINT)
    .setProject(APPWRITE_PROJECT_ID);
  const platformIdentifier =
    Platform.OS === "android"
      ? Constants.expoConfig?.android?.package
      : Constants.expoConfig?.ios?.bundleIdentifier;
  if (!platformIdentifier) {
    throw new Error("Appwrite mobile platform identifier is not configured.");
  }
  nativeClient.setPlatform(platformIdentifier);
  const nativeAccount = new ReactNativeAccount(nativeClient);
  let nativeUser: Awaited<ReturnType<ReactNativeAccount["get"]>>;
  try {
    nativeUser = await nativeAccount.get();
  } catch (error) {
    logVoiceUploadFailure("verify_native_session", error);
    const errorRecord =
      error && typeof error === "object" ? (error as Record<string, unknown>) : undefined;
    if (errorRecord?.code === 401) {
      throw new Error("Your Appwrite session is missing or expired. Sign in again and retry.");
    }
    throw error;
  }
  if (nativeUser.$id !== user.$id) {
    throw new Error(
      "The native Appwrite session does not match the signed-in user. Sign out and back in before uploading."
    );
  }

  const nativeStorage = new ReactNativeStorage(nativeClient);
  const fileName = `voice-${ID.unique()}.m4a`;
  const mimeType = "audio/mp4";
  const recordingFormatConfigured =
    Platform.OS === "android"
      ? "MPEG-4 container with AAC audio (configured)"
      : "MPEG-4 AAC audio (configured)";
  const uploadMetadata = {
    fileName,
    recordingUriExtension: getUriFileExtension(audioFile.uri),
    mimeType,
    sizeBytes: fileSize,
    recordingFormatConfigured,
  };
  console.info("[Voice Upload] Uploading audio recording", uploadMetadata);
  let uploadedFile;
  try {
    uploadedFile = await nativeStorage.createFile({
      bucketId: VOICE_RECORDINGS_BUCKET_ID,
      fileId: ID.unique(),
      file: {
        name: fileName,
        type: mimeType,
        size: fileSize,
        uri: audioFile.uri,
      },
      permissions: [
        Permission.read(Role.user(nativeUser.$id)),
        Permission.delete(Role.user(nativeUser.$id)),
      ],
    });
  } catch (error) {
    logVoiceUploadFailure("storage.createFile", error, uploadMetadata);
    throw error;
  }

  console.info("[Voice Upload] Audio recording uploaded", {
    ...uploadMetadata,
    appwriteMimeType: uploadedFile.mimeType,
  });
  return uploadedFile.$id;
};

export const transcribeVoiceRecording = async (
  fileId: string
): Promise<VoiceTranscriptionResponse> => {
  const execution = await functions.createExecution({
    functionId: APPWRITE_AI_ADVISOR_FUNCTION_ID,
    body: JSON.stringify({
      mode: "transcribe-voice",
      fileId,
      bucketId: VOICE_RECORDINGS_BUCKET_ID,
    }),
    async: false,
    method: ExecutionMethod.POST,
    headers: {
      "Content-Type": "application/json",
    },
  });

  if (execution.status !== "completed" || !execution.responseBody) {
    throw new Error("Voice transcription did not complete successfully.");
  }

  let response: {
    transcript?: unknown;
    detected_language_code?: unknown;
    error?: unknown;
  };
  try {
    response = JSON.parse(execution.responseBody) as typeof response;
  } catch {
    throw new Error("Voice transcription returned an invalid response.");
  }

  if (typeof response.transcript === "string") {
    return {
      transcript: response.transcript.trim(),
      ...(typeof response.detected_language_code === "string"
        ? { detected_language_code: response.detected_language_code }
        : {}),
    };
  }

  if (typeof response.error === "string") {
    throw new Error(response.error);
  }

  throw new Error("Voice transcription returned no transcript.");
};

export const deleteVoiceRecording = async (fileId: string): Promise<void> => {
  try {
    await storage.deleteFile({
      bucketId: VOICE_RECORDINGS_BUCKET_ID,
      fileId,
    });
  } catch (error) {
    if (error instanceof AppwriteException && error.code === 404) {
      return;
    }

    throw error;
  }
};

export const transcribeAudioUri = async (
  audioUri: string
): Promise<VoiceTranscriptionResponse> => {
  const fileId = await uploadVoiceRecording(audioUri);
  let transcriptionFailed = false;

  try {
    return await transcribeVoiceRecording(fileId);
  } catch (error) {
    transcriptionFailed = true;
    throw error;
  } finally {
    try {
      await deleteVoiceRecording(fileId);
    } catch (cleanupError) {
      logVoiceUploadFailure("storage.client_cleanup", cleanupError);
      if (!transcriptionFailed) {
        throw cleanupError;
      }
    }
  }
};
