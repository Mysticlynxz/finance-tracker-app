import { AppwriteException, ExecutionMethod, ID, Permission, Role } from "appwrite";
import { Platform } from "react-native";
import {
  APPWRITE_AI_ADVISOR_FUNCTION_ID,
  VOICE_RECORDINGS_BUCKET_ID,
  functions,
  getCurrentUser,
  storage,
} from "./appwrite";

const MAX_RECORDING_BYTES = 5 * 1024 * 1024;

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

  const response = await fetch(uri);
  if (!response.ok) {
    throw new Error("Unable to read the recorded audio.");
  }

  const audioBlob = await response.blob();
  if (audioBlob.size <= 0 || audioBlob.size > MAX_RECORDING_BYTES) {
    throw new Error("Recording is empty or exceeds the 5 MB upload limit.");
  }
  const user = await getCurrentUser();
  const file = new File([audioBlob], `voice-${ID.unique()}.m4a`, { type: "audio/mp4" });
  const uploadedFile = await storage.createFile({
    bucketId: VOICE_RECORDINGS_BUCKET_ID,
    fileId: ID.unique(),
    file,
    permissions: [
      Permission.read(Role.user(user.$id)),
      Permission.delete(Role.user(user.$id)),
    ],
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

  try {
    return await transcribeVoiceRecording(fileId);
  } finally {
    await deleteVoiceRecording(fileId);
  }
};
