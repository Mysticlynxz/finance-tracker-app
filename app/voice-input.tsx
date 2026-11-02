import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useContext, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Modal,
  Pressable,
  Platform,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ExpenseContext } from "../Context/ExpenseContext";
import { createExpense } from "../lib/appwrite";
import { extractExpenseFromUserText } from "../lib/expenseExtraction";
import { useAudioRecorder } from "../lib/useAudioRecorder";
import { transcribeAudioUri } from "../lib/voiceTranscription";

const MAX_RECORDING_DURATION_MS = 30_000;

interface DetectedExpense {
  amount: string;
  category: string;
  date: string;
}

const getLocalDateInput = () => {
  const date = new Date();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
};

const isValidDateInput = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
};

const toExpenseTimestamp = (dateInput: string) => {
  const [year, month, day] = dateInput.split("-").map(Number);
  return new Date(year, month - 1, day, 12).toISOString();
};

const formatDuration = (seconds: number) =>
  `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

export default function VoiceInputScreen() {
  const { isDarkMode, currency, convertToINR } = useContext(ExpenseContext);
  const { recording, startRecording, stopRecording } = useAudioRecorder();
  const [detectedExpenses, setDetectedExpenses] = useState<DetectedExpense[]>([]);
  const [isSavingExpense, setIsSavingExpense] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [processingError, setProcessingError] = useState("");
  const [lastRecordingUri, setLastRecordingUri] = useState<string | null>(null);
  const [recordingDurationSeconds, setRecordingDurationSeconds] = useState(0);
  const micScale = useRef(new Animated.Value(1)).current;
  const maxDurationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingStartedAtRef = useRef<number | null>(null);
  const isProcessingRef = useRef(false);
  const stoppedAtMaxDurationRef = useRef(false);
  const isPressHeldRef = useRef(false);

  useEffect(() => {
    Animated.spring(micScale, {
      toValue: isRecording ? 1.08 : 1,
      friction: 6,
      tension: 120,
      useNativeDriver: true,
    }).start();
  }, [isRecording, micScale]);

  useEffect(() => {
    if (!recording) {
      setIsRecording(false);
    }
  }, [recording]);

  useEffect(
    () => () => {
      if (maxDurationTimeoutRef.current) {
        clearTimeout(maxDurationTimeoutRef.current);
      }
      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current);
      }
    },
    []
  );

  const sendToSpeechAPI = async (uri: string) => {
    const { transcript: transcribedText } = await transcribeAudioUri(uri);
    setTranscript(transcribedText);
    if (!transcribedText) {
      throw new Error("No speech was detected. Record a clear 15–20 second clip and retry.");
    }

    const { expenses } = await extractExpenseFromUserText(transcribedText);
    const validExpenses = expenses
      .filter((expense) => Number.isFinite(expense.amount) && expense.amount > 0)
      .map(({ amount, category, date }) => ({
        amount: String(amount),
        category,
        date: date ?? getLocalDateInput(),
      }));

    if (validExpenses.length === 0) {
      setDetectedExpenses([]);
      setProcessingError("No valid expense was detected. Retry or record the expense again.");
      return;
    }

    setDetectedExpenses(validExpenses);
    setProcessingError("");
  };

  const handleConfirmExpense = async () => {
    if (
      detectedExpenses.length === 0 ||
      isSavingExpense ||
      detectedExpenses.some(
        ({ amount, category, date }) =>
          !Number.isFinite(Number(amount)) ||
          Number(amount) <= 0 ||
          !category.trim() ||
          !isValidDateInput(date)
      )
    ) {
      return;
    }

    setIsSavingExpense(true);

    try {
      for (const { amount, category, date } of detectedExpenses) {
        const amountInINR = convertToINR(Number(amount));
        if (!Number.isFinite(amountInINR) || amountInINR <= 0) {
          throw new Error("Expense amount could not be converted to INR.");
        }

        await createExpense({
          amount: amountInINR,
          category: category.trim(),
          date: toExpenseTimestamp(date),
        });

        console.log("Saved voice expense:", { category: category.trim() });
      }

      setDetectedExpenses([]);
      router.replace("/home");
    } catch (error) {
      console.error("[Voice Input] Save failed:", error);
      Alert.alert("Save failed", "Unable to save expense. Please try again.");
    } finally {
      setIsSavingExpense(false);
    }
  };

  const handleCancelConfirmation = () => {
    if (isSavingExpense) {
      return;
    }

    setDetectedExpenses([]);
  };

  const handleStop = async () => {
    if (isProcessingRef.current) {
      return;
    }

    isPressHeldRef.current = false;
    isProcessingRef.current = true;
    if (maxDurationTimeoutRef.current) {
      clearTimeout(maxDurationTimeoutRef.current);
      maxDurationTimeoutRef.current = null;
    }
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }

    setIsRecording(false);
    setIsProcessing(true);

    try {
      const uri = await stopRecording();
      if (uri) {
        setLastRecordingUri(uri);
        await sendToSpeechAPI(uri);
      } else {
        setProcessingError("No recording was saved. Please try recording again.");
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to process the recording.";
      setProcessingError(message);
    } finally {
      recordingStartedAtRef.current = null;
      setIsProcessing(false);
      isProcessingRef.current = false;
    }
  };

  const handleRetry = async () => {
    if (!lastRecordingUri || isProcessingRef.current || isSavingExpense) {
      return;
    }

    isProcessingRef.current = true;
    setIsProcessing(true);
    setProcessingError("");
    try {
      await sendToSpeechAPI(lastRecordingUri);
    } catch (error) {
      setProcessingError(
        error instanceof Error ? error.message : "Unable to process the recording. Please retry."
      );
    } finally {
      setIsProcessing(false);
      isProcessingRef.current = false;
    }
  };

  const handlePressIn = async () => {
    if (isProcessingRef.current || isSavingExpense) {
      return;
    }

    stoppedAtMaxDurationRef.current = false;
    setProcessingError("");
    setTranscript("");
    isPressHeldRef.current = true;
    setIsRecording(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    try {
      await startRecording();
      setLastRecordingUri(null);
      if (isPressHeldRef.current) {
        recordingStartedAtRef.current = Date.now();
        setRecordingDurationSeconds(0);
        durationIntervalRef.current = setInterval(() => {
          if (recordingStartedAtRef.current !== null) {
            setRecordingDurationSeconds(
              Math.floor((Date.now() - recordingStartedAtRef.current) / 1000)
            );
          }
        }, 1_000);
        maxDurationTimeoutRef.current = setTimeout(() => {
          stoppedAtMaxDurationRef.current = true;
          void handleStop();
        }, MAX_RECORDING_DURATION_MS);
      } else {
        void handleStop();
      }
    } catch (error) {
      isPressHeldRef.current = false;
      setIsRecording(false);
      if (maxDurationTimeoutRef.current) {
        clearTimeout(maxDurationTimeoutRef.current);
        maxDurationTimeoutRef.current = null;
      }
      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current);
        durationIntervalRef.current = null;
      }
      const message =
        error instanceof Error ? error.message : "Unable to start recording. Please try again.";
      Alert.alert("Microphone unavailable", message);
    }
  };

  const updateDetectedExpense = (
    index: number,
    field: keyof DetectedExpense,
    value: string
  ) => {
    setDetectedExpenses((expenses) =>
      expenses.map((expense, expenseIndex) =>
        expenseIndex === index ? { ...expense, [field]: value } : expense
      )
    );
  };

  const colors = isDarkMode
    ? {
        screen: "#020617",
        card: "#0f172a",
        border: "#334155",
        primary: "#f8fafc",
        secondary: "#94a3b8",
        accent: "#10b981",
      }
    : {
        screen: "#f8fafc",
        card: "#ffffff",
        border: "#dbeafe",
        primary: "#0f172a",
        secondary: "#475569",
        accent: "#059669",
      };

  if (Platform.OS === "web") {
    return (
      <SafeAreaView className="flex-1" style={{ backgroundColor: colors.screen }}>
        <View className="flex-1 items-center justify-center px-6">
          <View
            className="w-full max-w-md items-center rounded-[28px] border p-8"
            style={{ backgroundColor: colors.card, borderColor: colors.border }}
          >
            <Ionicons name="phone-portrait-outline" size={40} color={colors.accent} />
            <Text className="mt-5 text-center text-2xl font-extrabold" style={{ color: colors.primary }}>
              Voice capture is mobile-only
            </Text>
            <Text className="mt-3 text-center text-base" style={{ color: colors.secondary }}>
              Voice expense capture is supported in the SpendWise mobile app on Android and iOS.
            </Text>
            <Pressable
              onPress={() => router.replace("/home")}
              className="mt-6 items-center rounded-2xl px-6 py-4"
              style={{ backgroundColor: colors.accent }}
            >
              <Text className="text-base font-semibold text-white">Back to home</Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: colors.screen }}>
      <View className="flex-1 px-6 py-8">
        <View className="mb-6 flex-row items-center justify-between">
          <View className="flex-1 pr-4">
            <Text className="text-3xl font-extrabold" style={{ color: colors.primary }}>
              Voice input
            </Text>
            <Text className="mt-1 text-sm" style={{ color: colors.secondary }}>
              Press and hold to record, then release. Keep clips to 15–20 seconds (30 seconds max).
            </Text>
          </View>

          <Pressable
            onPress={() => router.replace("/home")}
            className="h-11 w-11 items-center justify-center rounded-full"
            style={{ backgroundColor: colors.card }}
          >
            <Ionicons name="close" size={20} color={colors.primary} />
          </Pressable>
        </View>

        <View
          className="flex-1 items-center justify-center rounded-[28px] border px-6"
          style={{ backgroundColor: colors.card, borderColor: colors.border }}
        >
          <View
            className="mb-5 h-20 w-20 items-center justify-center rounded-full"
            style={{
              backgroundColor: isRecording ? "#fee2e2" : isDarkMode ? "#052e2b" : "#d1fae5",
            }}
          >
            <Ionicons
              name={isRecording ? "radio-button-on" : "mic"}
              size={30}
              color={isRecording ? "#dc2626" : colors.accent}
            />
          </View>

          <Text className="text-center text-2xl font-bold" style={{ color: colors.primary }}>
            {isProcessing
              ? "Processing your expense"
              : isRecording
                ? "Recording in progress"
                : "Ready to record"}
          </Text>
          <Text
            className="mt-3 text-center text-base"
            style={{ color: colors.secondary, lineHeight: 24 }}
          >
            {isProcessing
              ? "Speech-to-text and expense extraction are in progress."
              : isRecording
                ? "Release the microphone to stop recording and process your expense."
                : "Press and hold the microphone button to start recording."}
          </Text>

          <Animated.View
            className="mt-8"
            style={{
              transform: [{ scale: micScale }],
            }}
          >
            <Pressable
              onPressIn={() => {
                void handlePressIn();
              }}
              onPressOut={() => {
                if (!stoppedAtMaxDurationRef.current) {
                  void handleStop();
                }
              }}
              disabled={isProcessing || isSavingExpense}
              className="items-center justify-center rounded-full"
              style={{
                width: 80,
                height: 80,
                borderRadius: 40,
                backgroundColor: isRecording ? "red" : "#3b82f6",
                opacity: isProcessing || isSavingExpense ? 0.6 : 1,
              }}
            >
              <Ionicons name="mic" size={28} color="#ffffff" />
            </Pressable>
          </Animated.View>

          {isRecording && (
            <Text className="mt-3 text-base font-semibold" style={{ color: "#dc2626" }}>
              Recording {formatDuration(recordingDurationSeconds)} / 00:30
            </Text>
          )}

          {!!processingError && (
            <View className="mt-5 w-full items-center">
              <Text className="text-center text-sm" style={{ color: "#dc2626" }}>
                {processingError}
              </Text>
              {!!transcript && (
                <Text className="mt-2 text-center text-sm" style={{ color: colors.secondary }}>
                  Transcript: {transcript}
                </Text>
              )}
              {!!lastRecordingUri && (
                <Pressable
                  onPress={() => void handleRetry()}
                  disabled={isProcessing}
                  className="mt-3 rounded-xl px-5 py-3"
                  style={{ backgroundColor: colors.accent, opacity: isProcessing ? 0.6 : 1 }}
                >
                  <Text className="font-semibold text-white">Retry this recording</Text>
                </Pressable>
              )}
            </View>
          )}

          <Pressable
            onPress={() => router.replace("/home")}
            className="mt-5 items-center rounded-2xl px-6 py-4"
            style={{ backgroundColor: isDarkMode ? "#1e293b" : "#e2e8f0" }}
          >
            <Text className="text-base font-semibold" style={{ color: colors.primary }}>
              Back to home
            </Text>
          </Pressable>
        </View>
      </View>

      {isProcessing && (
        <View
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0,0,0,0.4)",
            justifyContent: "center",
            alignItems: "center",
            zIndex: 999,
          }}
        >
          <ActivityIndicator size="large" color="#fff" />
        </View>
      )}

      <Modal
        visible={detectedExpenses.length > 0}
        animationType="fade"
        transparent
        onRequestClose={handleCancelConfirmation}
      >
        <View
          className="flex-1 items-center justify-center px-6"
          style={{ backgroundColor: "rgba(15, 23, 42, 0.45)" }}
        >
          <View
            className="w-full max-w-sm rounded-3xl border p-6"
            style={{
              backgroundColor: colors.card,
              borderColor: colors.border,
            }}
          >
            <Text className="text-xl font-bold" style={{ color: colors.primary }}>
              {detectedExpenses.length === 1 ? "Review detected expense" : "Review detected expenses"}
            </Text>
            <Text className="mt-2 text-sm" style={{ color: colors.secondary }}>
              Check and correct these details before saving.
            </Text>

            {!!transcript && (
              <View
                className="mt-4 rounded-xl p-3"
                style={{ backgroundColor: isDarkMode ? "#111827" : "#f1f5f9" }}
              >
                <Text className="text-xs font-semibold" style={{ color: colors.secondary }}>
                  Transcript
                </Text>
                <Text className="mt-1 text-sm" style={{ color: colors.primary }}>
                  {transcript}
                </Text>
              </View>
            )}

            <ScrollView
              className="mt-5"
              showsVerticalScrollIndicator={false}
              style={{ maxHeight: 360 }}
            >
              {detectedExpenses.map((expense, index) => (
                <View
                  key={`voice-expense-${index}`}
                  className="mb-3 rounded-2xl border p-4"
                  style={{
                    backgroundColor: isDarkMode ? "#111827" : "#eff6ff",
                    borderColor: colors.border,
                  }}
                >
                  <Text className="mb-1 text-xs font-medium" style={{ color: colors.secondary }}>
                    Amount ({currency})
                  </Text>
                  <TextInput
                    value={expense.amount}
                    onChangeText={(value) => updateDetectedExpense(index, "amount", value)}
                    keyboardType="decimal-pad"
                    accessibilityLabel={`Expense ${index + 1} amount`}
                    className="rounded-lg border px-3 py-2"
                    style={{
                      color: colors.primary,
                      backgroundColor: isDarkMode ? "#1e293b" : "#ffffff",
                      borderColor: colors.border,
                    }}
                  />
                  <Text className="mb-1 mt-3 text-xs font-medium" style={{ color: colors.secondary }}>
                    Category
                  </Text>
                  <TextInput
                    value={expense.category}
                    onChangeText={(value) => updateDetectedExpense(index, "category", value)}
                    accessibilityLabel={`Expense ${index + 1} category`}
                    className="rounded-lg border px-3 py-2"
                    style={{
                      color: colors.primary,
                      backgroundColor: isDarkMode ? "#1e293b" : "#ffffff",
                      borderColor: colors.border,
                    }}
                  />
                  <Text className="mb-1 mt-3 text-xs font-medium" style={{ color: colors.secondary }}>
                    Date (YYYY-MM-DD)
                  </Text>
                  <TextInput
                    value={expense.date}
                    onChangeText={(value) => updateDetectedExpense(index, "date", value)}
                    placeholder="YYYY-MM-DD"
                    accessibilityLabel={`Expense ${index + 1} date`}
                    className="rounded-lg border px-3 py-2"
                    style={{
                      color: colors.primary,
                      backgroundColor: isDarkMode ? "#1e293b" : "#ffffff",
                      borderColor: colors.border,
                    }}
                  />
                </View>
              ))}
            </ScrollView>

            <Text className="text-xs" style={{ color: colors.secondary }}>
              Amount must be positive and date must be a real YYYY-MM-DD date.
            </Text>

            <Pressable
              onPress={() => {
                void handleConfirmExpense();
              }}
              disabled={
                isSavingExpense ||
                detectedExpenses.some(
                  ({ amount, category, date }) =>
                    !Number.isFinite(Number(amount)) ||
                    Number(amount) <= 0 ||
                    !category.trim() ||
                    !isValidDateInput(date)
                )
              }
              className="mt-5 items-center rounded-2xl px-6 py-4"
              style={{
                backgroundColor: colors.accent,
                opacity:
                  isSavingExpense ||
                  detectedExpenses.some(
                    ({ amount, category, date }) =>
                      !Number.isFinite(Number(amount)) ||
                      Number(amount) <= 0 ||
                      !category.trim() ||
                      !isValidDateInput(date)
                  )
                    ? 0.5
                    : 1,
              }}
            >
              <Text className="text-base font-semibold text-white">
                {isSavingExpense ? "Saving..." : "Confirm and save"}
              </Text>
            </Pressable>

            <Pressable
              onPress={handleCancelConfirmation}
              disabled={isSavingExpense}
              className="mt-3 items-center rounded-2xl px-6 py-4"
              style={{
                backgroundColor: isDarkMode ? "#1e293b" : "#e2e8f0",
                opacity: isSavingExpense ? 0.7 : 1,
              }}
            >
              <Text className="text-base font-semibold" style={{ color: colors.primary }}>
                Cancel
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
