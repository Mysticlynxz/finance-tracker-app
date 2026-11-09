import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  ActivityIndicator,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ExpenseContext } from "../Context/ExpenseContext";
import { useAudioRecorder } from "../lib/useAudioRecorder";
import { createAdvisorVoiceConfirmation } from "../lib/advisorVoiceConfirmation";
import {
  advisorVoiceReducer,
  deleteAdvisorVoiceRecording,
  initialAdvisorVoiceState,
  transcribeAdvisorVoice,
} from "../lib/advisorVoiceInput";
import {
  AdvisorSessionChangedError,
  AI_ADVISOR_FALLBACK_RESPONSE,
  captureAuthSessionIdentity,
  isAuthSessionGenerationCurrent,
  isAuthSessionIdentityCurrent,
  askFinancialAdvisorWithStatus,
  getAdvisorHistoryForSession,
  requestAdvisorSpeech,
  sanitizeAdvisorConversationHistory,
  type AdvisorConversationMessage,
  updateAdvisorConversationHistory,
} from "../lib/appwrite";
import {
  AdvisorSpeechPlayback,
  type AdvisorSpeechPlaybackState,
} from "../lib/advisorSpeechPlayback";
import type { AuthSessionIdentity } from "../lib/authSessionGuard";

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
}

interface AdvisorSpeechUiState {
  key: string | null;
  state: AdvisorSpeechPlaybackState;
  error?: string;
}

const AI_NAME = "FinBot";
const ADVISOR_ICON = "brain";
const MAX_ADVISOR_RECORDING_MS = 30_000;
const ADVISOR_VOICE_STAGES = [
  "recording",
  "preparing",
  "transcribing",
  "review",
  "sending",
  "responding",
] as const;
const WELCOME_MESSAGE: ChatMessage = {
  role: "assistant",
  text: "Ask me about spending, budgets, or saving ideas. No judgment here\u2014just practical tips and the occasional money pun.",
};

const formatRecordingTime = (elapsedMs: number) => {
  const totalSeconds = Math.floor(elapsedMs / 1000);
  return `${String(Math.floor(totalSeconds / 60)).padStart(2, "0")}:${String(
    totalSeconds % 60
  ).padStart(2, "0")}`;
};

export const SUGGESTED_ADVISOR_QUESTIONS = [
  "Give me a practical saving tip.",
  "Help me understand my recent spending.",
  "How can I manage my monthly budget better?",
  "What spending habit should I improve?",
] as const;

const sameSession = (left: AuthSessionIdentity, right: AuthSessionIdentity) =>
  left.userId === right.userId &&
  left.sessionId === right.sessionId &&
  left.generation === right.generation;

export default function AdvisorScreen() {
  const { isDarkMode, currency } = useContext(ExpenseContext);
  const { recording, startRecording, stopRecording } = useAudioRecorder((audioUri) => {
    if (!audioUri) return;
    try {
      deleteAdvisorVoiceRecording(audioUri);
    } catch (error) {
      console.warn("[FinBot] Unable to remove the recording after leaving the screen.", error);
    }
  });
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME_MESSAGE]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isSessionVerified, setIsSessionVerified] = useState(false);
  const [isVoiceActionPending, setIsVoiceActionPending] = useState(false);
  const [voiceState, dispatchVoice] = useReducer(
    advisorVoiceReducer,
    initialAdvisorVoiceState
  );
  const [isReduceMotionEnabled, setIsReduceMotionEnabled] = useState(false);
  const flatListRef = useRef<FlatList<ChatMessage>>(null);
  const isMountedRef = useRef(true);
  const isSubmittingRef = useRef(false);
  const isVoiceActionRef = useRef(false);
  const isVoiceRecordingRef = useRef(false);
  const isTranscriptSubmittingRef = useRef(false);
  const voiceSessionRef = useRef<AuthSessionIdentity | null>(null);
  const speechPlaybackRef = useRef(new AdvisorSpeechPlayback());
  const speechSessionRef = useRef<AuthSessionIdentity | null>(null);
  const speechRequestIdRef = useRef(0);
  const isSpeechRequestPendingRef = useRef(false);
  const isSpeechSessionCheckPendingRef = useRef(false);
  const [speechUiState, setSpeechUiState] = useState<AdvisorSpeechUiState>({
    key: null,
    state: "idle",
  });
  const voiceConfirmationRef = useRef<ReturnType<typeof createAdvisorVoiceConfirmation> | null>(
    null
  );
  const voiceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recordingStartedAtRef = useRef<number | null>(null);
  const isAdvisorFocusedRef = useRef(false);
  const activeRecordingRef = useRef(recording);
  activeRecordingRef.current = recording;
  const stopRecordingRef = useRef(stopRecording);
  stopRecordingRef.current = stopRecording;
  const voiceStopHandlerRef = useRef<() => void>(() => undefined);
  const pulseAnimation = useRef(new Animated.Value(0)).current;
  const processingAnimation = useRef(new Animated.Value(0)).current;
  const isVoiceRecording = voiceState.stage === "recording";
  const isTranscribingVoice = voiceState.stage === "transcribing";
  const voiceError = voiceState.error;
  const conversationHistoryRef = useRef<AdvisorConversationMessage[]>([]);
  const conversationSessionRef = useRef<AuthSessionIdentity | null>(null);

  const clearVoiceTimeout = () => {
    if (voiceTimeoutRef.current) {
      clearTimeout(voiceTimeoutRef.current);
      voiceTimeoutRef.current = null;
    }
  };

  const removeLocalRecording = (audioUri: string | null) => {
    if (!audioUri) return;
    try {
      deleteAdvisorVoiceRecording(audioUri);
    } catch (error) {
      console.warn("[FinBot] Unable to remove a temporary voice recording.", error);
      throw error;
    }
  };

  const colors = useMemo(
    () =>
      isDarkMode
        ? {
            screen: "#020617",
            card: "#0f172a",
            border: "#334155",
            primary: "#f8fafc",
            secondary: "#94a3b8",
            userBubble: "#2563eb",
            assistantBubble: "#1e293b",
            disabledButton: "#1e40af",
          }
        : {
            screen: "#f8fafc",
            card: "#ffffff",
            border: "#e2e8f0",
            primary: "#0f172a",
            secondary: "#64748b",
            userBubble: "#2563eb",
            assistantBubble: "#e2e8f0",
            disabledButton: "#93c5fd",
          },
    [isDarkMode]
  );

  const scrollToBottom = (animated = true) => {
    flatListRef.current?.scrollToEnd({ animated });
  };

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      clearVoiceTimeout();
    };
  }, []);

  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (active) setIsReduceMotionEnabled(enabled);
      })
      .catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setIsReduceMotionEnabled
    );
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (voiceState.stage !== "recording") return;
    const timer = setInterval(() => {
      const startedAt = recordingStartedAtRef.current;
      if (startedAt !== null) {
        dispatchVoice({
          type: "tick",
          elapsedMs: Math.min(Date.now() - startedAt, MAX_ADVISOR_RECORDING_MS),
        });
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [voiceState.stage]);

  useEffect(() => {
    const isPulsing = voiceState.stage === "recording" && !isReduceMotionEnabled;
    pulseAnimation.stopAnimation();
    pulseAnimation.setValue(0);
    if (!isPulsing) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnimation, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnimation, {
          toValue: 0,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [isReduceMotionEnabled, pulseAnimation, voiceState.stage]);

  useEffect(() => {
    const isProcessing = ["preparing", "transcribing", "sending"].includes(
      voiceState.stage
    );
    processingAnimation.stopAnimation();
    processingAnimation.setValue(0);
    if (!isProcessing || isReduceMotionEnabled) return;
    const loop = Animated.loop(
      Animated.timing(processingAnimation, {
        toValue: 1,
        duration: 1100,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [isReduceMotionEnabled, processingAnimation, voiceState.stage]);

  useEffect(() => {
    if (!recording) return;
    recording.setOnRecordingStatusUpdate((status) => {
      if (
        (!status.isDoneRecording && !status.mediaServicesDidReset) ||
        !isVoiceRecordingRef.current
      ) {
        return;
      }
      isVoiceRecordingRef.current = false;
      isVoiceActionRef.current = true;
      clearVoiceTimeout();
      recordingStartedAtRef.current = null;
      voiceConfirmationRef.current?.cancel();
      voiceConfirmationRef.current = null;
      voiceSessionRef.current = null;
      setIsVoiceActionPending(true);
      const partialAudioUri = recording.getURI();
      dispatchVoice({
        type: "error",
        message: "Recording was interrupted. Please try recording your question again.",
      });
      void stopRecordingRef.current()
        .then((audioUri) => removeLocalRecording(audioUri ?? partialAudioUri))
        .catch((error) => {
          console.warn("[FinBot] Unable to finalize an interrupted recording.", error);
          try {
            removeLocalRecording(partialAudioUri);
          } catch (cleanupError) {
            console.warn("[FinBot] Unable to remove an interrupted recording.", cleanupError);
          }
        })
        .finally(() => {
          isVoiceActionRef.current = false;
          if (isMountedRef.current) setIsVoiceActionPending(false);
        });
    });
    return () => recording.setOnRecordingStatusUpdate(null);
  }, [recording]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      isAdvisorFocusedRef.current = true;
      setIsSessionVerified(false);

      void (async () => {
        let identity = await captureAuthSessionIdentity();
        if (
          identity &&
          (!(await isAuthSessionIdentityCurrent(identity)) ||
            !isAuthSessionGenerationCurrent(identity))
        ) {
          identity = null;
        }
        if (!active || !isMountedRef.current) return;
        const previousSpeechSession = speechSessionRef.current;
        if (
          !identity ||
          !previousSpeechSession ||
          !sameSession(previousSpeechSession, identity)
        ) {
          speechRequestIdRef.current += 1;
          isSpeechRequestPendingRef.current = false;
          try {
            speechPlaybackRef.current.clear();
          } catch (error) {
            console.warn("[FinBot] Unable to clean up cached speech audio.", error);
          }
          setSpeechUiState({ key: null, state: "idle" });
        }
        speechSessionRef.current = identity;
        const previousSession = conversationSessionRef.current;
        const history = getAdvisorHistoryForSession(
          conversationHistoryRef.current,
          previousSession,
          identity
        );
        if (history.length !== conversationHistoryRef.current.length) {
          conversationHistoryRef.current = history;
        }
        if (!identity || !previousSession || !sameSession(previousSession, identity)) {
          setMessages([WELCOME_MESSAGE]);
        }
        conversationSessionRef.current = identity;
        setIsSessionVerified(Boolean(identity));
      })();

      return () => {
        active = false;
        isAdvisorFocusedRef.current = false;
        setIsSessionVerified(false);
        clearVoiceTimeout();
        speechRequestIdRef.current += 1;
        isSpeechRequestPendingRef.current = false;
        speechSessionRef.current = null;
        try {
          speechPlaybackRef.current.clear();
        } catch (error) {
          console.warn("[FinBot] Unable to clean up speech audio after leaving the screen.", error);
        }
        if (isMountedRef.current) setSpeechUiState({ key: null, state: "idle" });
        recordingStartedAtRef.current = null;
        voiceSessionRef.current = null;
        if (isMountedRef.current) dispatchVoice({ type: "reset" });
        if (isVoiceRecordingRef.current) {
          isVoiceRecordingRef.current = false;
          isVoiceActionRef.current = true;
          const partialAudioUri = activeRecordingRef.current?.getURI() ?? null;
          void Promise.resolve()
            .then(async () => {
              if (!isMountedRef.current) return;
              removeLocalRecording(
                (await stopRecordingRef.current()) ?? partialAudioUri
              );
            })
            .catch((error) => {
              console.warn("[FinBot] Unable to clean up a recording after leaving the screen.", error);
              try {
                removeLocalRecording(partialAudioUri);
              } catch (cleanupError) {
                console.warn("[FinBot] Unable to remove a recording after leaving the screen.", cleanupError);
              }
            })
            .finally(() => {
              if (isMountedRef.current) isVoiceActionRef.current = false;
            });
        }
      };
    }, [])
  );

  useEffect(() => {
    if (!speechUiState.key || speechUiState.state === "idle") return;
    const identity = speechSessionRef.current;
    if (!identity) return;
    const sessionCheck = setInterval(() => {
      if (!isAdvisorFocusedRef.current || !isAuthSessionGenerationCurrent(identity)) {
        speechRequestIdRef.current += 1;
        isSpeechRequestPendingRef.current = false;
        try {
          speechPlaybackRef.current.clear();
        } catch (error) {
          console.warn("[FinBot] Unable to clean up speech audio after the session changed.", error);
        }
        setSpeechUiState({ key: null, state: "idle" });
        return;
      }
      if (isSpeechSessionCheckPendingRef.current) return;
      isSpeechSessionCheckPendingRef.current = true;
      void isAuthSessionIdentityCurrent(identity)
        .then((isCurrent) => {
          if (isCurrent || !isMountedRef.current) return;
          speechRequestIdRef.current += 1;
          isSpeechRequestPendingRef.current = false;
          try {
            speechPlaybackRef.current.clear();
          } catch (error) {
            console.warn("[FinBot] Unable to clean up speech audio after the session changed.", error);
          }
          setSpeechUiState({ key: null, state: "idle" });
        })
        .finally(() => {
          isSpeechSessionCheckPendingRef.current = false;
        });
    }, 1000);
    return () => clearInterval(sessionCheck);
  }, [speechUiState.key, speechUiState.state]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      scrollToBottom();
    });

    return () => cancelAnimationFrame(frame);
  }, [messages, isLoading, isStreaming]);

  const wait = (ms: number) =>
    new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });

  const streamText = async (fullText: string, session: AuthSessionIdentity) => {
    const words = fullText.trim().split(/\s+/).filter(Boolean);

    if (words.length === 0) {
      setMessages((current) => {
        if (current.length === 0) {
          return current;
        }

        const updated = [...current];
        const lastIndex = updated.length - 1;

        if (updated[lastIndex].role !== "assistant") {
          return current;
        }

        updated[lastIndex] = {
          ...updated[lastIndex],
          text: "",
        };

        return updated;
      });

      return;
    }

    let currentText = "";

    for (let index = 0; index < words.length; index += 1) {
      if (!isMountedRef.current || !isAuthSessionGenerationCurrent(session)) {
        return false;
      }

      currentText += `${words[index]} `;

      setMessages((current) => {
        if (current.length === 0) {
          return current;
        }

        const updated = [...current];
        const lastIndex = updated.length - 1;

        if (updated[lastIndex].role !== "assistant") {
          return current;
        }

        updated[lastIndex] = {
          ...updated[lastIndex],
          text: currentText.trim(),
        };

        return updated;
      });

      await wait(40);
    }
    return true;
  };

  const streamAssistantReply = async (fullText: string, session: AuthSessionIdentity) => {
    const safeText = fullText.trim() || AI_ADVISOR_FALLBACK_RESPONSE;

    setMessages((current) => [...current, { role: "assistant", text: "" }]);
    setIsStreaming(true);

    try {
      return await streamText(safeText, session);
    } finally {
      if (isMountedRef.current) {
        setIsStreaming(false);
      }
    }
  };

  const resetForSession = useCallback((session: AuthSessionIdentity | null) => {
    conversationHistoryRef.current = [];
    conversationSessionRef.current = session;
    setMessages([WELCOME_MESSAGE]);
  }, []);

  const submitMessage = async (
    message: string,
    fromVoice = false,
    expectedVoiceSession?: AuthSessionIdentity
  ) => {
    if (
      isLoading ||
      isStreaming ||
      isSubmittingRef.current ||
      !isSessionVerified ||
      (isVoiceActionRef.current && !fromVoice) ||
      (voiceState.stage !== "idle" && !fromVoice)
    ) {
      return;
    }

    const trimmedMessage = message.trim();

    if (!trimmedMessage) {
      return;
    }

    isSubmittingRef.current = true;
    setInput("");
    Keyboard.dismiss();
    setIsLoading(true);

    try {
      const session = await captureAuthSessionIdentity();
      if (!session) {
        resetForSession(null);
        setIsSessionVerified(false);
        if (fromVoice) dispatchVoice({ type: "reset" });
        return;
      }

      if (
        expectedVoiceSession &&
        (!isAdvisorFocusedRef.current || !sameSession(session, expectedVoiceSession))
      ) {
        resetForSession(session);
        setIsSessionVerified(true);
        dispatchVoice({ type: "reset" });
        return;
      }

      if (!conversationSessionRef.current || !sameSession(conversationSessionRef.current, session)) {
        resetForSession(session);
      }
      const previousHistory = sanitizeAdvisorConversationHistory(
        conversationHistoryRef.current,
        trimmedMessage
      );
      setMessages((current) => [...current, { role: "user", text: trimmedMessage }]);

      const result = await askFinancialAdvisorWithStatus(
        trimmedMessage,
        currency,
        previousHistory,
        session
      );
      if (!(await isAuthSessionIdentityCurrent(session))) {
        throw new AdvisorSessionChangedError();
      }
      if (fromVoice && !isAdvisorFocusedRef.current) {
        dispatchVoice({ type: "reset" });
        return;
      }
      conversationHistoryRef.current = updateAdvisorConversationHistory(
        conversationHistoryRef.current,
        trimmedMessage,
        result
      );
      setIsLoading(false);
      if (fromVoice && result.ok) {
        dispatchVoice({ type: "responding" });
      } else if (fromVoice) {
        dispatchVoice({ type: "reset" });
      }
      const streamed = await streamAssistantReply(result.reply, session);
      if (!streamed || !(await isAuthSessionIdentityCurrent(session))) {
        const currentSession = await captureAuthSessionIdentity();
        resetForSession(currentSession);
        setIsSessionVerified(Boolean(currentSession));
      }
      if (fromVoice) dispatchVoice({ type: "reset" });
    } catch (error) {
      const session = conversationSessionRef.current;
      if (
        error instanceof AdvisorSessionChangedError ||
        !session ||
        !(await isAuthSessionIdentityCurrent(session))
      ) {
        const currentSession = await captureAuthSessionIdentity();
        resetForSession(currentSession);
        setIsSessionVerified(Boolean(currentSession));
        if (fromVoice) dispatchVoice({ type: "reset" });
        return;
      }

      setIsLoading(false);
      if (fromVoice) dispatchVoice({ type: "reset" });
      const streamed = await streamAssistantReply(AI_ADVISOR_FALLBACK_RESPONSE, session);
      if (!streamed || !(await isAuthSessionIdentityCurrent(session))) {
        const currentSession = await captureAuthSessionIdentity();
        resetForSession(currentSession);
        setIsSessionVerified(Boolean(currentSession));
      }
    } finally {
      isSubmittingRef.current = false;
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  };

  const handleSend = () => submitMessage(input);

  const handleAdvisorSpeech = async (messageKey: string, text: string) => {
    if (
      !text.trim() ||
      isLoading ||
      isStreaming ||
      isSubmittingRef.current ||
      isVoiceActionRef.current ||
      isVoiceActionPending ||
      voiceState.stage !== "idle" ||
      !isAdvisorFocusedRef.current ||
      !isSessionVerified ||
      isSpeechRequestPendingRef.current
    ) return;

    const wasPlaying = speechUiState.key === messageKey && speechUiState.state === "playing";
    isSpeechRequestPendingRef.current = true;
    const requestId = ++speechRequestIdRef.current;
    setSpeechUiState({ key: messageKey, state: "loading" });
    const previousSpeechSession = speechSessionRef.current;
    const previousSessionKey = previousSpeechSession
      ? `${previousSpeechSession.userId}:${previousSpeechSession.sessionId}:${previousSpeechSession.generation}`
      : "";
    try {
      if (!speechPlaybackRef.current.hasCachedAudio(messageKey, previousSessionKey)) {
        speechPlaybackRef.current.clear();
      } else if (wasPlaying) {
        speechPlaybackRef.current.stop();
        setSpeechUiState({ key: messageKey, state: "stopped" });
      }
      const session = await captureAuthSessionIdentity();
      if (requestId !== speechRequestIdRef.current) return;
      if (
        !session ||
        !conversationSessionRef.current ||
        !sameSession(session, conversationSessionRef.current) ||
        !(await isAuthSessionIdentityCurrent(session))
      ) {
        speechPlaybackRef.current.clear();
        setSpeechUiState({ key: null, state: "idle" });
        return;
      }

      const sessionKey = `${session.userId}:${session.sessionId}:${session.generation}`;
      const listener = (state: AdvisorSpeechPlaybackState) => {
        if (
          requestId === speechRequestIdRef.current &&
          isMountedRef.current &&
          isAdvisorFocusedRef.current &&
          isAuthSessionGenerationCurrent(session)
        ) {
          setSpeechUiState({ key: messageKey, state });
        }
      };

      if (speechPlaybackRef.current.hasCachedAudio(messageKey, sessionKey)) {
        if (wasPlaying) {
          speechPlaybackRef.current.stop();
          setSpeechUiState({ key: messageKey, state: "stopped" });
        } else {
          await speechPlaybackRef.current.replay(
            messageKey,
            sessionKey,
            listener,
            () => isAuthSessionGenerationCurrent(session)
          );
        }
        return;
      }

      speechSessionRef.current = session;
      setSpeechUiState({ key: messageKey, state: "loading" });
      const audio = await requestAdvisorSpeech(text, session);
      if (requestId !== speechRequestIdRef.current) return;
      if (
        !isAdvisorFocusedRef.current ||
        !(await isAuthSessionIdentityCurrent(session))
      ) {
        speechPlaybackRef.current.clear();
        setSpeechUiState({ key: null, state: "idle" });
        return;
      }
      await speechPlaybackRef.current.play(
        messageKey,
        sessionKey,
        audio,
        listener,
        () => isAuthSessionGenerationCurrent(session)
      );
    } catch (error) {
      if (requestId !== speechRequestIdRef.current || !isMountedRef.current) return;
      if (error instanceof Error && error.name === "AdvisorSessionChangedError") {
        try {
          speechPlaybackRef.current.clear();
        } catch (cleanupError) {
          console.warn("[FinBot] Unable to clean up stale speech audio.", cleanupError);
        }
        setSpeechUiState({ key: null, state: "idle" });
        return;
      }
      try {
        speechPlaybackRef.current.clear();
      } catch (cleanupError) {
        console.warn("[FinBot] Unable to clean up failed speech playback.", cleanupError);
      }
      const message =
        error instanceof Error ? error.message : "Unable to generate spoken audio. Please try again.";
      setSpeechUiState({ key: messageKey, state: "idle", error: message });
    } finally {
      if (requestId === speechRequestIdRef.current) {
        isSpeechRequestPendingRef.current = false;
      }
    }
  };

  const refreshSessionAfterVoice = useCallback(async () => {
    let session = await captureAuthSessionIdentity();
    if (
      session &&
      (!(await isAuthSessionIdentityCurrent(session)) ||
        !isAuthSessionGenerationCurrent(session))
    ) {
      session = null;
    }
    resetForSession(session);
    setIsSessionVerified(Boolean(session));
  }, [resetForSession]);

  const handleStopVoiceRecording = async () => {
    if (!isVoiceRecordingRef.current || isVoiceActionRef.current) return;
    isVoiceActionRef.current = true;
    setIsVoiceActionPending(true);
    isVoiceRecordingRef.current = false;
    const partialAudioUri = recording?.getURI() ?? null;
    let localCleanupDelegated = false;
    const session = voiceSessionRef.current;
    dispatchVoice({ type: "preparing" });
    clearVoiceTimeout();
    recordingStartedAtRef.current = null;

    try {
      const audioUri = await stopRecording();
      if (!audioUri) throw new Error("No recording was saved. Please try again.");
      if (!session || !(await isAuthSessionIdentityCurrent(session))) {
        localCleanupDelegated = true;
        removeLocalRecording(audioUri);
        voiceConfirmationRef.current?.cancel();
        voiceConfirmationRef.current = null;
        voiceSessionRef.current = null;
        dispatchVoice({ type: "reset" });
        await refreshSessionAfterVoice();
        return;
      }

      dispatchVoice({ type: "transcribing" });
      localCleanupDelegated = true;
      const transcript = await transcribeAdvisorVoice(audioUri, session, {
        isSessionCurrent: async (identity) =>
          isAdvisorFocusedRef.current && isAuthSessionIdentityCurrent(identity),
        removeLocalRecording: deleteAdvisorVoiceRecording,
      });

      if (transcript === null) {
        voiceConfirmationRef.current?.cancel();
        voiceConfirmationRef.current = null;
        voiceSessionRef.current = null;
        dispatchVoice({ type: "reset" });
        if (isAdvisorFocusedRef.current) await refreshSessionAfterVoice();
        return;
      }
      if (!isAdvisorFocusedRef.current) {
        voiceConfirmationRef.current?.cancel();
        voiceConfirmationRef.current = null;
        voiceSessionRef.current = null;
        dispatchVoice({ type: "reset" });
        return;
      }
      voiceConfirmationRef.current = createAdvisorVoiceConfirmation(session, {
        isSessionCurrent: async (identity) =>
          isAdvisorFocusedRef.current && isAuthSessionIdentityCurrent(identity),
        submitMessage: (message, identity) =>
          submitMessage(message, true, identity),
      });
      dispatchVoice({ type: "ready", transcript: transcript.slice(0, 1000) });
    } catch (error) {
      if (!localCleanupDelegated) {
        try {
          removeLocalRecording(partialAudioUri);
        } catch (cleanupError) {
          console.warn("[FinBot] Unable to remove a failed voice recording.", cleanupError);
        }
      }
      if (
        isAdvisorFocusedRef.current &&
        session &&
        !(await isAuthSessionIdentityCurrent(session))
      ) {
        await refreshSessionAfterVoice();
        return;
      }
      if (!isAdvisorFocusedRef.current) {
        dispatchVoice({ type: "reset" });
        return;
      }
      dispatchVoice({
        type: "error",
        message:
          error instanceof Error ? error.message : "Unable to process the recording. Please retry.",
      });
    } finally {
      isVoiceActionRef.current = false;
      if (isMountedRef.current) setIsVoiceActionPending(false);
    }
  };

  voiceStopHandlerRef.current = () => {
    void handleStopVoiceRecording();
  };

  const handleCancelVoiceRecording = async () => {
    if (!isVoiceRecordingRef.current || isVoiceActionRef.current) return;
    isVoiceActionRef.current = true;
    isVoiceRecordingRef.current = false;
    const partialAudioUri = recording?.getURI() ?? null;
    let cleanupAttempted = false;
    voiceSessionRef.current = null;
    setIsVoiceActionPending(true);
    clearVoiceTimeout();
    recordingStartedAtRef.current = null;
    dispatchVoice({ type: "reset" });
    try {
      const audioUri = await stopRecording();
      cleanupAttempted = Boolean(audioUri);
      removeLocalRecording(audioUri);
    } catch (error) {
      if (!cleanupAttempted) {
        try {
          removeLocalRecording(partialAudioUri);
        } catch (cleanupError) {
          console.warn("[FinBot] Unable to remove a cancelled voice recording.", cleanupError);
        }
      }
      dispatchVoice({
        type: "error",
        message:
          error instanceof Error
            ? `Unable to cancel the recording: ${error.message}`
            : "Unable to cancel the recording. Please try again.",
      });
    } finally {
      isVoiceActionRef.current = false;
      if (isMountedRef.current) setIsVoiceActionPending(false);
    }
  };

  const handleCancelTranscript = () => {
    if (voiceState.stage !== "review" || isTranscriptSubmittingRef.current) return;
    voiceConfirmationRef.current?.cancel();
    voiceConfirmationRef.current = null;
    voiceSessionRef.current = null;
    dispatchVoice({ type: "reset" });
  };

  const handleSendTranscript = async () => {
    const message = voiceState.transcript.trim();
    const session = voiceSessionRef.current;
    if (
      voiceState.stage !== "review" ||
      !message ||
      !session ||
      !voiceConfirmationRef.current ||
      isTranscriptSubmittingRef.current
    ) {
      return;
    }
    isTranscriptSubmittingRef.current = true;
    setIsVoiceActionPending(true);
    dispatchVoice({ type: "sending" });
    try {
      if (
        !isAdvisorFocusedRef.current ||
        !(await isAuthSessionIdentityCurrent(session))
      ) {
        voiceSessionRef.current = null;
        dispatchVoice({ type: "reset" });
        await refreshSessionAfterVoice();
        return;
      }
      await voiceConfirmationRef.current.send(message);
    } finally {
      isTranscriptSubmittingRef.current = false;
      voiceConfirmationRef.current?.cancel();
      voiceConfirmationRef.current = null;
      voiceSessionRef.current = null;
      if (isMountedRef.current) {
        dispatchVoice({ type: "reset" });
        setIsVoiceActionPending(false);
      }
    }
  };

  useEffect(() => {
    if (voiceState.stage === "idle") return;
    const capturedSession = voiceSessionRef.current;
    if (!capturedSession) return;
    const sessionCheck = setInterval(() => {
      if (isAuthSessionGenerationCurrent(capturedSession)) return;
      clearVoiceTimeout();
      const wasRecording = isVoiceRecordingRef.current;
      isVoiceRecordingRef.current = false;
      voiceConfirmationRef.current?.cancel();
      voiceConfirmationRef.current = null;
      voiceSessionRef.current = null;
      recordingStartedAtRef.current = null;
      dispatchVoice({ type: "reset" });
      if (wasRecording) {
        isVoiceActionRef.current = true;
        setIsVoiceActionPending(true);
        const partialAudioUri = activeRecordingRef.current?.getURI() ?? null;
        void stopRecordingRef.current()
          .then((audioUri) => removeLocalRecording(audioUri ?? partialAudioUri))
          .catch((error) => {
            console.warn("[FinBot] Unable to clean up a recording after the session changed.", error);
            try {
              removeLocalRecording(partialAudioUri);
            } catch (cleanupError) {
              console.warn("[FinBot] Unable to remove a recording after the session changed.", cleanupError);
            }
          })
          .finally(() => {
            isVoiceActionRef.current = false;
            if (isMountedRef.current) setIsVoiceActionPending(false);
          });
      }
      void refreshSessionAfterVoice();
    }, 250);
    return () => clearInterval(sessionCheck);
  }, [refreshSessionAfterVoice, voiceState.stage]);

  const handleVoicePress = async () => {
    if (isVoiceRecordingRef.current) {
      voiceStopHandlerRef.current();
      return;
    }
    if (
      Platform.OS === "web" ||
      voiceState.stage !== "idle" ||
      isVoiceActionRef.current ||
      isLoading ||
      isStreaming ||
      isSubmittingRef.current ||
      !isSessionVerified
    ) return;

    isVoiceActionRef.current = true;
    setIsVoiceActionPending(true);
    speechRequestIdRef.current += 1;
    isSpeechRequestPendingRef.current = false;
    try {
      speechPlaybackRef.current.clear();
    } catch (error) {
      console.warn("[FinBot] Unable to stop speech before recording.", error);
    }
    setSpeechUiState({ key: null, state: "idle" });
    dispatchVoice({ type: "reset" });
    try {
      const session = await captureAuthSessionIdentity();
      if (!session || !(await isAuthSessionIdentityCurrent(session))) {
        await refreshSessionAfterVoice();
        return;
      }
      if (
        !conversationSessionRef.current ||
        !sameSession(conversationSessionRef.current, session)
      ) {
        resetForSession(session);
      }
      voiceSessionRef.current = session;
      await startRecording();
      if (
        !isAdvisorFocusedRef.current ||
        !(await isAuthSessionIdentityCurrent(session))
      ) {
        removeLocalRecording(await stopRecordingRef.current());
        voiceSessionRef.current = null;
        if (isAdvisorFocusedRef.current) await refreshSessionAfterVoice();
        return;
      }
      isVoiceRecordingRef.current = true;
      recordingStartedAtRef.current = Date.now();
      dispatchVoice({ type: "recording", elapsedMs: 0 });
      setIsVoiceActionPending(false);
      voiceTimeoutRef.current = setTimeout(() => {
        voiceStopHandlerRef.current();
      }, MAX_ADVISOR_RECORDING_MS);
    } catch (error) {
      voiceSessionRef.current = null;
      setIsVoiceActionPending(false);
      const message = error instanceof Error ? error.message : "";
      dispatchVoice({
        type: "error",
        message: message.includes("Microphone permission is required")
          ? "Microphone access is off. To ask FinBot by voice, allow microphone access in your device Settings under SpendWise permissions. You can still type your question."
          : message || "Unable to start recording. Please try again.",
      });
    } finally {
      isVoiceActionRef.current = false;
      if (isMountedRef.current) setIsVoiceActionPending(false);
    }
  };

  const canSend =
    Boolean(input.trim()) &&
    isSessionVerified &&
    !isLoading &&
    !isStreaming &&
    !isVoiceRecording &&
    voiceState.stage === "idle" &&
    !isVoiceActionPending &&
    !isTranscribingVoice &&
    !isSubmittingRef.current;
  const showSuggestions =
    isSessionVerified &&
    voiceState.stage === "idle" &&
    messages.length === 1 &&
    conversationHistoryRef.current.length === 0;
  const voiceStageIndex = ADVISOR_VOICE_STAGES.indexOf(
    voiceState.stage === "idle" ? "recording" : voiceState.stage
  );
  const voiceStageText: Record<(typeof ADVISOR_VOICE_STAGES)[number], string> = {
    recording: "Recording your question",
    preparing: "Preparing audio…",
    transcribing: "Transcribing your question with Gnani…",
    review: "Your question is ready to review",
    sending: "Sending your question to FinBot…",
    responding: "FinBot is responding…",
  };
  const isVoiceProcessing = ["preparing", "transcribing", "sending"].includes(
    voiceState.stage
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.screen }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View style={{ flex: 1 }}>
          <View
            className="flex-row items-center gap-3 border-b px-4 pb-3 pt-2"
            style={{ borderColor: colors.border }}
          >
            <Pressable
              onPress={() => router.back()}
              className="h-10 w-10 items-center justify-center rounded-full"
              style={{ backgroundColor: colors.card }}
              accessibilityRole="button"
              accessibilityLabel="Go back"
            >
              <Ionicons name="chevron-back" size={20} color={colors.primary} />
            </Pressable>

            <View
              className="items-center justify-center rounded-full"
              style={{
                backgroundColor: isDarkMode ? "#172554" : "#dbeafe",
                width: 44,
                height: 44,
              }}
            >
              <MaterialCommunityIcons
                name={ADVISOR_ICON}
                size={24}
                color="#3b82f6"
              />
            </View>

            <View>
              <Text className="text-lg font-bold" style={{ color: colors.primary }}>
                {AI_NAME}
              </Text>
              <Text className="text-sm" style={{ color: colors.secondary }}>
                AI Financial Advisor
              </Text>
            </View>
          </View>

          <View style={{ flex: 1 }}>
            <FlatList
              ref={flatListRef}
              data={isSessionVerified ? messages : []}
              keyExtractor={(_, index) => index.toString()}
              className="flex-1"
              style={{ flex: 1 }}
              contentContainerStyle={{
                paddingHorizontal: 12,
                paddingTop: 16,
                paddingBottom: 24,
              }}
              onContentSizeChange={() => {
                setTimeout(() => {
                  flatListRef.current?.scrollToEnd({ animated: true });
                }, 100);
              }}
              onLayout={() => scrollToBottom(false)}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              removeClippedSubviews={false}
              renderItem={({ item: message, index }) => {
                const isUser = message.role === "user";
                const speechKey = `${conversationSessionRef.current?.userId ?? ""}:${
                  conversationSessionRef.current?.sessionId ?? ""
                }:${conversationSessionRef.current?.generation ?? ""}:${index}:${message.text}`;
                const speechStatus =
                  speechUiState.key === speechKey ? speechUiState.state : "idle";
                const speechDisabled =
                  isLoading ||
                  isStreaming ||
                  isSubmittingRef.current ||
                  isVoiceActionPending ||
                  voiceState.stage !== "idle" ||
                  speechUiState.state === "loading";

                return (
                  <View
                    style={{
                      width: "100%",
                      alignItems: isUser ? "flex-end" : "flex-start",
                      paddingHorizontal: 12,
                    }}
                  >
                    <View
                      style={{
                        backgroundColor: isUser ? colors.userBubble : colors.assistantBubble,
                        padding: 12,
                        borderRadius: 12,
                        marginVertical: 4,
                        maxWidth: isUser ? "75%" : "80%",
                        minWidth: 0,
                        flexShrink: 1,
                        alignSelf: isUser ? "flex-end" : "flex-start",
                      }}
                    >
                      <Text
                        style={{
                          color: isUser ? "#ffffff" : colors.primary,
                          flexWrap: "wrap",
                          flexShrink: 1,
                          lineHeight: 20,
                        }}
                      >
                        {message.text}
                      </Text>
                      {!isUser && message.text.trim() && !isStreaming ? (
                        <View style={{ marginTop: 6 }}>
                          <Pressable
                            onPress={() => void handleAdvisorSpeech(speechKey, message.text)}
                            disabled={speechDisabled}
                            accessibilityRole="button"
                            accessibilityLabel={
                              speechStatus === "playing"
                                ? "Stop spoken response"
                                : speechStatus === "finished" || speechStatus === "stopped"
                                  ? "Replay spoken response"
                                  : "Play spoken response"
                            }
                            accessibilityState={{ disabled: speechDisabled }}
                            style={{
                              alignItems: "center",
                              alignSelf: "flex-start",
                              borderColor: colors.border,
                              borderRadius: 16,
                              borderWidth: 1,
                              flexDirection: "row",
                              minHeight: 44,
                              opacity: speechDisabled ? 0.55 : 1,
                              paddingHorizontal: 10,
                            }}
                          >
                            {speechStatus === "loading" ? (
                              <ActivityIndicator
                                size="small"
                                color={colors.userBubble}
                                style={{ marginRight: 6 }}
                              />
                            ) : (
                              <Ionicons
                                name={speechStatus === "playing" ? "stop" : "volume-high"}
                                size={16}
                                color={colors.userBubble}
                                style={{ marginRight: 6 }}
                              />
                            )}
                            <Text style={{ color: colors.primary, fontSize: 12 }}>
                              {speechStatus === "loading"
                                ? "Preparing audio…"
                                : speechStatus === "playing"
                                  ? "Stop"
                                  : speechStatus === "finished" || speechStatus === "stopped"
                                    ? "Replay"
                                    : "Listen"}
                            </Text>
                          </Pressable>
                          {speechUiState.key === speechKey && speechUiState.error ? (
                            <Text
                              accessibilityLiveRegion="polite"
                              style={{ color: "#dc2626", fontSize: 12, marginTop: 4 }}
                            >
                              {speechUiState.error}
                            </Text>
                          ) : null}
                        </View>
                      ) : null}
                    </View>
                  </View>
                );
              }}
              ListFooterComponent={
                <View>
                  {showSuggestions ? (
                    <View style={{ paddingHorizontal: 12, paddingTop: 16 }}>
                      <Text
                        style={{
                          color: colors.secondary,
                          fontSize: 13,
                          fontWeight: "600",
                          marginBottom: 10,
                        }}
                      >
                        Try asking
                      </Text>
                      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                        {SUGGESTED_ADVISOR_QUESTIONS.map((question) => (
                          <Pressable
                            key={question}
                            onPress={() => {
                              void submitMessage(question);
                            }}
                            disabled={isLoading || isStreaming || isSubmittingRef.current}
                            style={{
                              backgroundColor: colors.card,
                              borderColor: colors.border,
                              borderRadius: 18,
                              borderWidth: 1,
                              justifyContent: "center",
                              minHeight: 48,
                              paddingHorizontal: 12,
                              paddingVertical: 9,
                            }}
                            accessibilityRole="button"
                            accessibilityLabel={question}
                          >
                            <Text style={{ color: colors.primary, fontSize: 13 }}>
                              {question}
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                    </View>
                  ) : null}
                  {isLoading ? (
                    <View style={{ width: "100%", alignItems: "flex-start" }}>
                      <View style={{ padding: 10 }}>
                        <ActivityIndicator size="small" color={colors.secondary} />
                      </View>
                    </View>
                  ) : null}
                </View>
              }
            />
          </View>

          <View
            style={{
              padding: 12,
              borderTopWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.screen,
            }}
          >
            {voiceState.stage !== "idle" || voiceError ? (
              <View
                style={{
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  borderRadius: 16,
                  borderWidth: 1,
                  marginBottom: 10,
                  minHeight: 82,
                  padding: 12,
                }}
              >
                {voiceState.stage !== "idle" ? (
                  <>
                    <View
                      accessibilityLabel={`Voice question stage ${voiceStageIndex + 1} of 6`}
                      style={{
                        alignItems: "center",
                        flexDirection: "row",
                        justifyContent: "center",
                        marginBottom: 10,
                      }}
                    >
                      {ADVISOR_VOICE_STAGES.map((stage, index) => {
                        const isCurrent = stage === voiceState.stage;
                        const isComplete = index < voiceStageIndex;
                        return (
                          <View
                            key={stage}
                            style={{ alignItems: "center", flex: 1, flexDirection: "row" }}
                          >
                            <View
                              style={{
                                alignItems: "center",
                                backgroundColor: isCurrent
                                  ? colors.userBubble
                                  : isComplete
                                    ? isDarkMode ? "#1d4ed8" : "#bfdbfe"
                                    : colors.border,
                                borderRadius: 7,
                                height: 14,
                                justifyContent: "center",
                                width: 14,
                              }}
                            >
                              {isComplete ? (
                                <Ionicons name="checkmark" size={10} color="#ffffff" />
                              ) : null}
                            </View>
                            {index < ADVISOR_VOICE_STAGES.length - 1 ? (
                              <View
                                style={{
                                  backgroundColor: isComplete ? colors.userBubble : colors.border,
                                  flex: 1,
                                  height: 2,
                                }}
                              />
                            ) : null}
                          </View>
                        );
                      })}
                    </View>
                    <View style={{ alignItems: "center", flexDirection: "row", minHeight: 24 }}>
                      {isVoiceRecording ? (
                        <Animated.View
                          style={{
                            alignItems: "center",
                            height: 20,
                            justifyContent: "center",
                            marginRight: 8,
                            opacity: pulseAnimation.interpolate({
                              inputRange: [0, 1],
                              outputRange: [0.55, 1],
                            }),
                            transform: [{
                              scale: pulseAnimation.interpolate({
                                inputRange: [0, 1],
                                outputRange: [0.9, 1.12],
                              }),
                            }],
                            width: 20,
                          }}
                        >
                          <View
                            style={{
                              backgroundColor: "#dc2626",
                              borderRadius: 6,
                              height: 12,
                              width: 12,
                            }}
                          />
                        </Animated.View>
                      ) : isVoiceProcessing ? (
                        isReduceMotionEnabled ? (
                          <View
                            style={{
                              backgroundColor: colors.userBubble,
                              borderRadius: 8,
                              height: 12,
                              marginRight: 8,
                              width: 12,
                            }}
                          />
                        ) : (
                          <Animated.View
                            style={{
                              marginRight: 8,
                              transform: [{
                                rotate: processingAnimation.interpolate({
                                  inputRange: [0, 1],
                                  outputRange: ["0deg", "360deg"],
                                }),
                              }],
                            }}
                          >
                            <Ionicons name="sync" size={18} color={colors.userBubble} />
                          </Animated.View>
                        )
                      ) : (
                        <Ionicons
                          name={voiceState.stage === "responding" ? "chatbubble-ellipses" : "checkmark-circle"}
                          size={18}
                          color={colors.userBubble}
                          style={{ marginRight: 8 }}
                        />
                      )}
                      <Text
                        accessibilityLiveRegion="polite"
                        style={{
                          color: colors.primary,
                          flex: 1,
                          fontSize: 13,
                          fontWeight: "600",
                        }}
                      >
                        {voiceStageText[voiceState.stage]}
                      </Text>
                      {isVoiceRecording ? (
                        <Text
                          accessibilityLabel={`Recording time ${formatRecordingTime(voiceState.elapsedMs)} of 30 seconds`}
                          style={{
                            color: colors.secondary,
                            fontSize: 12,
                            fontVariant: ["tabular-nums"],
                            marginLeft: 8,
                          }}
                        >
                          {formatRecordingTime(voiceState.elapsedMs)} / 00:30
                        </Text>
                      ) : null}
                    </View>
                    {isVoiceRecording ? (
                      <>
                        <Text style={{ color: colors.secondary, fontSize: 12, marginTop: 4 }}>
                          Tap Stop to finish recording. Maximum 30 seconds.
                        </Text>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Cancel voice recording"
                          onPress={() => void handleCancelVoiceRecording()}
                          disabled={isVoiceActionPending}
                          style={{
                            alignItems: "center",
                            borderColor: colors.border,
                            borderRadius: 10,
                            borderWidth: 1,
                            justifyContent: "center",
                            marginTop: 8,
                            minHeight: 44,
                          }}
                        >
                          <Text style={{ color: colors.primary, fontWeight: "600" }}>Cancel recording</Text>
                        </Pressable>
                      </>
                    ) : null}
                    {voiceState.stage === "review" ? (
                      <View style={{ marginTop: 10 }}>
                        <Text style={{ color: colors.secondary, fontSize: 12, marginBottom: 6 }}>
                          This transcript has not been sent yet. Edit it before sending.
                        </Text>
                        <TextInput
                          accessibilityLabel="Edit recognized voice question"
                          value={voiceState.transcript}
                          onChangeText={(transcript) =>
                            dispatchVoice({ type: "transcriptChanged", transcript })
                          }
                          multiline
                          maxLength={1000}
                          textAlignVertical="top"
                          style={{
                            backgroundColor: colors.screen,
                            borderColor: colors.border,
                            borderRadius: 10,
                            borderWidth: 1,
                            color: colors.primary,
                            minHeight: 76,
                            padding: 10,
                          }}
                        />
                        <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Cancel recognized question"
                            onPress={handleCancelTranscript}
                            disabled={isVoiceActionPending}
                            style={{
                              alignItems: "center",
                              borderColor: colors.border,
                              borderRadius: 10,
                              borderWidth: 1,
                              flex: 1,
                              justifyContent: "center",
                              minHeight: 48,
                            }}
                          >
                            <Text style={{ color: colors.primary, fontWeight: "600" }}>Cancel</Text>
                          </Pressable>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Send question to FinBot"
                            onPress={() => void handleSendTranscript()}
                            disabled={!voiceState.transcript.trim() || isVoiceActionPending}
                            style={{
                              alignItems: "center",
                              backgroundColor:
                                voiceState.transcript.trim() && !isVoiceActionPending
                                  ? colors.userBubble
                                  : colors.disabledButton,
                              borderRadius: 10,
                              flex: 1,
                              justifyContent: "center",
                              minHeight: 48,
                              opacity:
                                voiceState.transcript.trim() && !isVoiceActionPending ? 1 : 0.6,
                            }}
                          >
                            <Text style={{ color: "#ffffff", fontWeight: "700" }}>Send Question</Text>
                          </Pressable>
                        </View>
                      </View>
                    ) : null}
                  </>
                ) : null}
                {voiceError ? (
                  <Text
                    accessibilityLiveRegion="polite"
                    style={{
                      color: "#dc2626",
                      fontSize: 12,
                      marginTop: voiceState.stage === "idle" ? 0 : 8,
                    }}
                  >
                    {voiceError}
                  </Text>
                ) : null}
              </View>
            ) : null}
            <View
              className="flex-row items-end rounded-2xl border px-3 py-2"
              style={{ borderColor: colors.border, backgroundColor: colors.card }}
            >
              <TextInput
                value={input}
                onChangeText={setInput}
                placeholder="Ask about your spending..."
                placeholderTextColor={colors.secondary}
                multiline
                maxLength={1000}
                editable={voiceState.stage === "idle" && !isLoading && !isStreaming}
                className="max-h-32 flex-1 py-2 text-base"
                style={{ color: colors.primary }}
              />

              <Pressable
                onPress={() => {
                  void handleVoicePress();
                }}
                disabled={
                  Platform.OS === "web" ||
                  isLoading ||
                  isStreaming ||
                  isVoiceActionPending ||
                  (voiceState.stage !== "idle" && !isVoiceRecording) ||
                  isSubmittingRef.current
                }
                className="ml-2 h-10 w-10 items-center justify-center rounded-full"
                style={{
                  backgroundColor: isVoiceRecording ? "#dc2626" : colors.card,
                  borderColor: colors.border,
                  borderWidth: 1,
                  opacity:
                    Platform.OS === "web" ||
                    isLoading ||
                    isStreaming ||
                    isVoiceActionPending ||
                    (voiceState.stage !== "idle" && !isVoiceRecording) ||
                    isSubmittingRef.current
                      ? 0.55
                      : 1,
                }}
                accessibilityRole="button"
                accessibilityLabel={isVoiceRecording ? "Stop voice question recording" : "Record a voice question"}
                accessibilityState={{ disabled: Platform.OS === "web" || isLoading || isStreaming || isVoiceActionPending || (voiceState.stage !== "idle" && !isVoiceRecording) }}
              >
                <Ionicons
                  name={isVoiceRecording ? "stop" : "mic"}
                  size={18}
                  color={isVoiceRecording ? "#ffffff" : colors.primary}
                />
              </Pressable>

              <Pressable
                onPress={() => {
                  void handleSend();
                }}
                disabled={!canSend}
                className="ml-2 h-10 w-10 items-center justify-center rounded-full"
                style={{
                  backgroundColor: canSend ? colors.userBubble : colors.disabledButton,
                }}
                accessibilityRole="button"
                accessibilityLabel="Send message"
              >
                <Ionicons name="send" size={18} color="#ffffff" />
              </Pressable>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
