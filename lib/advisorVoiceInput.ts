import { transcribeAudioUri } from "./voiceTranscription";
import { File as ExpoFile } from "expo-file-system";
import type { AuthSessionIdentity } from "./authSessionGuard";

export type AdvisorVoiceStage =
  | "idle"
  | "recording"
  | "preparing"
  | "transcribing"
  | "review"
  | "sending"
  | "responding";

export interface AdvisorVoiceState {
  stage: AdvisorVoiceStage;
  transcript: string;
  elapsedMs: number;
  error: string;
}

export type AdvisorVoiceAction =
  | { type: "recording"; elapsedMs?: number }
  | { type: "tick"; elapsedMs: number }
  | { type: "preparing" }
  | { type: "transcribing" }
  | { type: "ready"; transcript: string }
  | { type: "transcriptChanged"; transcript: string }
  | { type: "sending" }
  | { type: "responding" }
  | { type: "error"; message: string }
  | { type: "reset" };

export const initialAdvisorVoiceState: AdvisorVoiceState = {
  stage: "idle",
  transcript: "",
  elapsedMs: 0,
  error: "",
};

export const advisorVoiceReducer = (
  state: AdvisorVoiceState,
  action: AdvisorVoiceAction
): AdvisorVoiceState => {
  switch (action.type) {
    case "recording":
      return { ...initialAdvisorVoiceState, stage: "recording", elapsedMs: action.elapsedMs ?? 0 };
    case "tick":
      return state.stage === "recording"
        ? { ...state, elapsedMs: action.elapsedMs }
        : state;
    case "preparing":
      return { ...initialAdvisorVoiceState, stage: "preparing" };
    case "transcribing":
      return { ...initialAdvisorVoiceState, stage: "transcribing" };
    case "ready":
      return { ...initialAdvisorVoiceState, stage: "review", transcript: action.transcript };
    case "transcriptChanged":
      return state.stage === "review"
        ? { ...state, transcript: action.transcript }
        : state;
    case "sending":
      return { ...state, stage: "sending", error: "" };
    case "responding":
      return { ...state, stage: "responding" };
    case "error":
      return { ...initialAdvisorVoiceState, error: action.message };
    case "reset":
      return initialAdvisorVoiceState;
  }
};

export const deleteAdvisorVoiceRecording = (audioUri: string): void => {
  new ExpoFile(audioUri).delete();
};

export interface AdvisorVoiceTranscriptionDependencies {
  isSessionCurrent: (session: AuthSessionIdentity) => Promise<boolean>;
  removeLocalRecording: (audioUri: string) => void;
}

export const transcribeAdvisorVoice = async (
  audioUri: string,
  session: AuthSessionIdentity,
  dependencies: AdvisorVoiceTranscriptionDependencies
): Promise<string | null> => {
  let transcriptionFailed = false;
  try {
    if (!(await dependencies.isSessionCurrent(session))) return null;

    const { transcript } = await transcribeAudioUri(audioUri);
    if (!(await dependencies.isSessionCurrent(session))) return null;

    const message = transcript.trim();
    if (!message) {
      throw new Error("No speech was detected. Please try recording your question again.");
    }

    return message;
  } catch (error) {
    transcriptionFailed = true;
    throw error;
  } finally {
    try {
      dependencies.removeLocalRecording(audioUri);
    } catch (cleanupError) {
      if (!transcriptionFailed) throw cleanupError;
      console.warn("[FinBot] Failed to remove the local recording after transcription failed.");
    }
  }
};
