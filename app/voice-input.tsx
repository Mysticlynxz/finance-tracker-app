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
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ExpenseContext } from "../Context/ExpenseContext";
import { createExpense } from "../lib/appwrite";
import { transcribeAudioUriWithAssemblyAI } from "../lib/assemblyAi";
import { extractExpenseFromUserText } from "../lib/expenseExtraction";
import { useAudioRecorder } from "../lib/useAudioRecorder";

interface DetectedExpense {
  amount: number;
  matchedCategory: string;
}

export default function VoiceInputScreen() {
  const { isDarkMode } = useContext(ExpenseContext);
  const { recording, startRecording, stopRecording } = useAudioRecorder();
  const [detectedExpenses, setDetectedExpenses] = useState<DetectedExpense[]>([]);
  const [isSavingExpense, setIsSavingExpense] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const micScale = useRef(new Animated.Value(1)).current;

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

  const sendToSpeechAPI = async (uri: string) => {
    console.log("ENTERED API FUNCTION");
    const transcribedText = await transcribeAudioUriWithAssemblyAI(uri);

    console.log("Transcribed text:", transcribedText);

    const { expenses } = await extractExpenseFromUserText(transcribedText);
    const validExpenses = expenses
      .filter((expense) => Number.isFinite(expense.amount) && expense.amount > 0)
      .map(({ amount, category }) => ({
        amount,
        matchedCategory: category,
      }));

    if (validExpenses.length === 0) {
      Alert.alert("No expenses found", "No valid expenses were detected in that recording.");
      setDetectedExpenses([]);
      return;
    }

    setDetectedExpenses(validExpenses);
  };

  const handleConfirmExpense = async () => {
    if (detectedExpenses.length === 0 || isSavingExpense) {
      return;
    }

    setIsSavingExpense(true);

    try {
      for (const { amount, matchedCategory } of detectedExpenses) {
        await createExpense({
          amount,
          category: matchedCategory,
          date: new Date().toISOString(),
        });

        console.log("Saved:", { amount, matchedCategory });
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
    console.log("[VoiceInput] handleStop called");
    setIsRecording(false);
    setIsProcessing(true);

    let uri: string | null = null;
    try {
      uri = await stopRecording();
    } catch (error) {
      console.error("[VoiceInput] stopRecording threw:", error);
    }

    console.log("[VoiceInput] stopRecording returned URI:", uri);

    if (!uri) {
      console.log("No audio URI found");
      setIsProcessing(false);
      return;
    }

    console.log("Recording complete:", uri);

    try {
      await sendToSpeechAPI(uri);
    } catch (error) {
      console.error("Processing error:", error);
    } finally {
      setIsProcessing(false);
    }
  };

  const handlePressIn = async () => {
    if (isProcessing || isSavingExpense) {
      return;
    }

    setIsRecording(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    await startRecording();
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

  const formatDetectedAmount = (amount: number) =>
    Number.isInteger(amount) ? amount.toString() : amount.toFixed(2);

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: colors.screen }}>
      <View className="flex-1 px-6 py-8">
        <View className="mb-6 flex-row items-center justify-between">
          <View className="flex-1 pr-4">
            <Text className="text-3xl font-extrabold" style={{ color: colors.primary }}>
              Voice input
            </Text>
            <Text className="mt-1 text-sm" style={{ color: colors.secondary }}>
              Press and hold the microphone to record. Release to process your expense.
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
                void handleStop();
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
              Recording...
            </Text>
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
              {detectedExpenses.length === 1 ? "Detected Expense:" : "Detected Expenses:"}
            </Text>

            <ScrollView
              className="mt-5"
              showsVerticalScrollIndicator={false}
              style={{ maxHeight: 280 }}
            >
              {detectedExpenses.map((expense, index) => (
                <View
                  key={`${expense.matchedCategory}-${expense.amount}-${index}`}
                  className="mb-3 rounded-2xl border p-4"
                  style={{
                    backgroundColor: isDarkMode ? "#111827" : "#eff6ff",
                    borderColor: colors.border,
                  }}
                >
                  <Text className="text-sm" style={{ color: colors.secondary }}>
                    Category:{" "}
                    <Text className="font-semibold" style={{ color: colors.primary }}>
                      {expense.matchedCategory}
                    </Text>
                  </Text>
                  <Text className="mt-2 text-sm" style={{ color: colors.secondary }}>
                    Amount:{" "}
                    <Text className="font-semibold" style={{ color: colors.primary }}>
                      ₹{formatDetectedAmount(expense.amount)}
                    </Text>
                  </Text>
                </View>
              ))}
            </ScrollView>

            <Text className="text-sm" style={{ color: colors.secondary }}>
              {detectedExpenses.length === 1
                ? "Confirm to save this expense."
                : `Confirm to save ${detectedExpenses.length} expenses.`}
            </Text>

            <Pressable
              onPress={() => {
                void handleConfirmExpense();
              }}
              disabled={isSavingExpense}
              className="mt-5 items-center rounded-2xl px-6 py-4"
              style={{ backgroundColor: colors.accent, opacity: isSavingExpense ? 0.7 : 1 }}
            >
              <Text className="text-base font-semibold text-white">
                {isSavingExpense ? "Saving..." : "Confirm"}
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
