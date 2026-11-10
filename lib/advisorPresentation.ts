import type { AdvisorVoiceStage } from "./advisorVoiceInput";

interface SpeechAvailability {
  role: "user" | "assistant";
  text: string;
  isStreaming: boolean;
  isLoading: boolean;
  isSubmitting: boolean;
  isSessionVerified: boolean;
  isVoiceActionPending: boolean;
  voiceStage: AdvisorVoiceStage;
  isSpeechLoading: boolean;
}

export const canPlayAdvisorSpeech = (state: SpeechAvailability): boolean =>
  state.role === "assistant" &&
  Boolean(state.text.trim()) &&
  !state.isStreaming &&
  !state.isLoading &&
  !state.isSubmitting &&
  state.isSessionVerified &&
  !state.isVoiceActionPending &&
  state.voiceStage === "idle" &&
  !state.isSpeechLoading;

export const formatAdvisorDisplayText = (text: string): string =>
  text
    .replace(/\[([^\]\n]+)\]\([^)]+\)/g, "$1")
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, "")
    .replace(/^([ \t]*)[-*+][ \t]+(?=\S)/gm, "$1• ")
    .replace(/^([ \t]*)(\d+)\)[ \t]+/gm, "$1$2. ")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/(^|[\s([{'"“‘:])__(?=\S)([^_\n]*?\S)__(?=$|[\s.,!?;:)\]}'"”’])/gm, "$1$2")
    .replace(/~~(?=\S)([^~\n]*?\S)~~/g, "$1")
    .replace(/(^|[\s([{'"“‘:])\*(?=\S)([^*\n]*?\S)\*(?=$|[\s.,!?;:)\]}'"”’])/gm, "$1$2")
    .replace(/(^|[\s([{'"“‘:])_(?=\S)([^_\n]*?\S)_(?=$|[\s.,!?;:)\]}'"”’])/gm, "$1$2")
    .replace(/`([^`\n]+)`/g, "$1");
