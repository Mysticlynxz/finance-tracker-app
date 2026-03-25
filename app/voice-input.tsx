import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useFocusEffect } from "@react-navigation/native";
import { router } from "expo-router";
import {
  ExpoSpeechRecognitionModule,
  type ExpoSpeechRecognitionErrorEvent,
  type ExpoSpeechRecognitionResultEvent,
  useSpeechRecognitionEvent,
} from "expo-speech-recognition";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Animated,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ExpenseContext } from "../Context/ExpenseContext";
import { DEFAULT_CATEGORIES } from "../constants/categories";
import { formatCurrencyAmount } from "../constants/currency";
import { getCategories } from "../lib/categoryService";
import { createExpense, extractExpenseFromSpeech } from "../lib/appwrite";

type DetectedExpense = {
  amount: number;
  category: string;
};

const FALLBACK_VOICE_ERROR =
  "Couldn't understand that expense. Please try again.";

const toTitleCase = (value: string) =>
  value
    .trim()
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");

export default function VoiceInputScreen() {
  const { isDarkMode, currency, addExpense, convertToINR } = useContext(ExpenseContext);
  const [spokenText, setSpokenText] = useState("");
  const [speechError, setSpeechError] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [detectedExpense, setDetectedExpense] = useState<DetectedExpense | null>(null);
  const [editableCategory, setEditableCategory] = useState("Others");
  const [editableAmount, setEditableAmount] = useState("");
  const [isEditingDetectedExpense, setIsEditingDetectedExpense] = useState(false);
  const [categoryNames, setCategoryNames] = useState<string[]>(
    DEFAULT_CATEGORIES.map((category) => category.name)
  );
  const finalTranscriptRef = useRef("");
  const hasStartedListeningRef = useRef(false);
  const waveValues = useRef(
    Array.from({ length: 5 }, (_, index) => new Animated.Value(index === 2 ? 0.9 : 0.45))
  ).current;
  const waveAnimationsRef = useRef<Animated.CompositeAnimation[]>([]);
  const categoryInputRef = useRef<TextInput>(null);

  const colors = useMemo(
    () =>
      isDarkMode
        ? {
            screen: "#020617",
            card: "#0f172a",
            border: "#334155",
            primary: "#f8fafc",
            secondary: "#94a3b8",
            subdued: "#1e293b",
            accent: "#10b981",
            accentSoft: "#064e3b",
            danger: "#ef4444",
            input: "#111827",
          }
        : {
            screen: "#f8fafc",
            card: "#ffffff",
            border: "#dbeafe",
            primary: "#0f172a",
            secondary: "#475569",
            subdued: "#e2e8f0",
            accent: "#059669",
            accentSoft: "#d1fae5",
            danger: "#dc2626",
            input: "#f8fafc",
          },
    [isDarkMode]
  );

  const normalizeDetectedCategory = useCallback(
    (rawCategory: string) => {
      const trimmedCategory = rawCategory.trim();

      if (!trimmedCategory) {
        return "Others";
      }

      const matchingCategory = categoryNames.find(
        (categoryName) => categoryName.toLowerCase() === trimmedCategory.toLowerCase()
      );

      return matchingCategory ?? toTitleCase(trimmedCategory);
    },
    [categoryNames]
  );

  const resetDetectionState = useCallback(() => {
    setDetectedExpense(null);
    setEditableCategory("Others");
    setEditableAmount("");
    setIsEditingDetectedExpense(false);
  }, []);

  const stopWaveAnimation = useCallback(() => {
    waveAnimationsRef.current.forEach((animation) => animation.stop());
    waveAnimationsRef.current = [];
    waveValues.forEach((value, index) => {
      value.stopAnimation(() => {
        value.setValue(index === 2 ? 0.9 : 0.45);
      });
    });
  }, [waveValues]);

  const startWaveAnimation = useCallback(() => {
    stopWaveAnimation();

    waveAnimationsRef.current = waveValues.map((value, index) => {
      const maxScale = index === 2 ? 1.45 : 1.1 + index * 0.08;
      return Animated.loop(
        Animated.sequence([
          Animated.delay(index * 90),
          Animated.timing(value, {
            toValue: maxScale,
            duration: 240,
            useNativeDriver: true,
          }),
          Animated.timing(value, {
            toValue: index === 2 ? 0.9 : 0.45,
            duration: 240,
            useNativeDriver: true,
          }),
        ])
      );
    });

    waveAnimationsRef.current.forEach((animation) => animation.start());
  }, [stopWaveAnimation, waveValues]);

  const stopListening = useCallback(async () => {
    if (!isListening) {
      return;
    }

    setIsStopping(true);

    try {
      ExpoSpeechRecognitionModule.stop();
      await Haptics.selectionAsync();
    } catch {
      setSpeechError("Couldn't stop listening cleanly. Try again.");
      setIsListening(false);
      stopWaveAnimation();
    }
  }, [isListening, stopWaveAnimation]);

  const startListening = useCallback(async () => {
    try {
      setSpeechError("");
      setIsStopping(false);
      resetDetectionState();
      finalTranscriptRef.current = "";
      setSpokenText("");

      if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
        setSpeechError(
          "Speech recognition is unavailable on this device. Test this feature on a real device."
        );
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        return;
      }

      const permissionResult = await ExpoSpeechRecognitionModule.requestPermissionsAsync();

      if (!permissionResult.granted) {
        setSpeechError(
          "Microphone and speech recognition permissions are required for voice expense entry."
        );
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        return;
      }

      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      ExpoSpeechRecognitionModule.start({
        lang: "en-IN",
        interimResults: true,
        continuous: true,
        maxAlternatives: 1,
        contextualStrings: categoryNames,
        volumeChangeEventOptions: {
          enabled: true,
          intervalMillis: 120,
        },
      });
    } catch (error) {
      const message =
        error instanceof Error && error.message.trim()
          ? error.message
          : "Couldn't start voice recognition. Please try again on a real device.";

      setSpeechError(message);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  }, [categoryNames, resetDetectionState]);

  useSpeechRecognitionEvent("start", () => {
    setIsListening(true);
    setIsStopping(false);
    setSpeechError("");
    startWaveAnimation();
  });

  useSpeechRecognitionEvent("end", () => {
    setIsListening(false);
    setIsStopping(false);
    stopWaveAnimation();
  });

  useSpeechRecognitionEvent("result", (event: ExpoSpeechRecognitionResultEvent) => {
    const transcript = event.results[0]?.transcript?.trim() ?? "";

    if (!transcript) {
      return;
    }

    if (event.isFinal) {
      finalTranscriptRef.current = [finalTranscriptRef.current, transcript]
        .filter(Boolean)
        .join(" ")
        .trim();
      setSpokenText(finalTranscriptRef.current);
      return;
    }

    setSpokenText([finalTranscriptRef.current, transcript].filter(Boolean).join(" ").trim());
  });

  useSpeechRecognitionEvent("error", (event: ExpoSpeechRecognitionErrorEvent) => {
    setIsListening(false);
    setIsStopping(false);
    stopWaveAnimation();
    setSpeechError(event.message || FALLBACK_VOICE_ERROR);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  });

  useSpeechRecognitionEvent("nomatch", () => {
    setSpeechError("I couldn't catch that. Try speaking again.");
  });

  useFocusEffect(
    useCallback(() => {
      let isActive = true;

      const loadCategories = async () => {
        try {
          const customCategories = await getCategories();

          if (!isActive) {
            return;
          }

          const mergedCategories = [
            ...DEFAULT_CATEGORIES.map((category) => category.name),
            ...customCategories.map((category) => category.name),
          ];

          setCategoryNames(Array.from(new Set(mergedCategories)));
        } catch (error) {
          console.error("Failed to load voice categories", error);
        }
      };

      void loadCategories();

      return () => {
        isActive = false;
      };
    }, [])
  );

  useEffect(() => {
    if (!hasStartedListeningRef.current) {
      hasStartedListeningRef.current = true;
      void startListening();
    }

    return () => {
      ExpoSpeechRecognitionModule.abort();
      stopWaveAnimation();
    };
  }, [startListening, stopWaveAnimation]);

  const handleConfirm = async () => {
    const trimmedTranscript = spokenText.trim();

    if (!trimmedTranscript) {
      Alert.alert("Nothing detected", "Say the expense first, then confirm.");
      return;
    }

    setIsProcessing(true);
    setSpeechError("");

    try {
      const parsed = await extractExpenseFromSpeech(trimmedTranscript);
      const amount = Number(parsed.amount);
      const category = normalizeDetectedCategory(parsed.category);

      if (!amount || amount <= 0) {
        Alert.alert("Couldn't detect amount", "Try again.");
        return;
      }

      setDetectedExpense({ category, amount });
      setEditableCategory(category);
      setEditableAmount(amount.toFixed(2));
      setIsEditingDetectedExpense(false);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      const message =
        error instanceof Error && error.message.trim()
          ? error.message
          : FALLBACK_VOICE_ERROR;
      setSpeechError(message);
      Alert.alert("Voice parsing failed", message);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSaveDetectedExpense = async () => {
    const parsedAmount = Number(editableAmount);
    const normalizedCategory = editableCategory.trim() || "Others";

    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      Alert.alert("Invalid amount", "Couldn't detect amount. Try again.");
      return;
    }

    const amountInINR = convertToINR(parsedAmount);

    if (!Number.isFinite(amountInINR) || amountInINR <= 0) {
      Alert.alert("Save failed", "Couldn't convert the detected amount to INR.");
      return;
    }

    setIsSaving(true);

    try {
      await createExpense({
        amount: Number(amountInINR),
        category: normalizeDetectedCategory(normalizedCategory),
        date: new Date().toISOString(),
      });

      addExpense(amountInINR, normalizeDetectedCategory(normalizedCategory));
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace("/home");
    } catch (error) {
      const message =
        error instanceof Error && error.message.trim()
          ? error.message
          : "Unable to save the detected expense right now.";
      Alert.alert("Save failed", message);
    } finally {
      setIsSaving(false);
    }
  };

  const confirmDisabled =
    !spokenText.trim() || isListening || isProcessing || isSaving || Boolean(detectedExpense);

  const showDetectionCard = Boolean(detectedExpense);

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: colors.screen }}>
      <ScrollView
        className="flex-1 px-6 py-4"
        contentContainerStyle={{ paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="mb-6 flex-row items-center justify-between">
          <View className="flex-1 pr-4">
            <Text className="text-3xl font-extrabold" style={{ color: colors.primary }}>
              Speak your expense
            </Text>
            <Text className="mt-1 text-sm" style={{ color: colors.secondary }}>
              Voice input listens live, then Gemini extracts only category and amount.
            </Text>
          </View>

          <Pressable
            onPress={() => {
              ExpoSpeechRecognitionModule.abort();
              router.back();
            }}
            className="h-11 w-11 items-center justify-center rounded-full"
            style={{ backgroundColor: colors.card }}
          >
            <Ionicons name="close" size={20} color={colors.primary} />
          </Pressable>
        </View>

        <View
          className="mb-5 rounded-[28px] border px-5 py-6"
          style={{ backgroundColor: colors.card, borderColor: colors.border }}
        >
          <View className="items-center">
            <View
              className="mb-5 h-24 w-24 items-center justify-center rounded-full"
              style={{ backgroundColor: isListening ? colors.accentSoft : colors.subdued }}
            >
              <Ionicons
                name={isListening ? "mic" : "mic-off"}
                size={34}
                color={isListening ? colors.accent : colors.secondary}
              />
            </View>

            <View className="mb-5 h-16 flex-row items-end justify-center gap-2">
              {waveValues.map((value, index) => (
                <Animated.View
                  key={`wave-${index}`}
                  style={{
                    width: 10,
                    height: 48,
                    borderRadius: 999,
                    backgroundColor: index === 2 ? colors.accent : colors.secondary,
                    opacity: index === 2 ? 1 : 0.8,
                    transform: [{ scaleY: value }],
                  }}
                />
              ))}
            </View>

            <View
              className="mb-4 rounded-full px-3 py-1.5"
              style={{ backgroundColor: isListening ? colors.accentSoft : colors.subdued }}
            >
              <Text className="text-xs font-semibold uppercase" style={{ color: colors.secondary }}>
                {isListening ? "Listening..." : "Ready to confirm"}
              </Text>
            </View>

            <Text
              className="min-h-[72px] text-center text-base"
              style={{ color: colors.primary, lineHeight: 24 }}
            >
              {spokenText || "Listening..."}
            </Text>

            {speechError ? (
              <Text className="mt-4 text-center text-sm" style={{ color: colors.danger }}>
                {speechError}
              </Text>
            ) : null}
          </View>
        </View>

        {!showDetectionCard ? (
          <View className="mb-5 gap-3">
            <View className="flex-row gap-3">
              <Pressable
                onPress={() => {
                  if (isListening) {
                    void stopListening();
                    return;
                  }

                  void startListening();
                }}
                disabled={isProcessing || isSaving || isStopping}
                className="flex-1 items-center rounded-2xl py-4"
                style={{
                  backgroundColor: isListening ? colors.danger : colors.accent,
                  opacity: isProcessing || isSaving || isStopping ? 0.7 : 1,
                }}
              >
                <Text className="text-base font-semibold text-white">
                  {isListening ? (isStopping ? "Stopping..." : "Stop") : "Restart"}
                </Text>
              </Pressable>

              <Pressable
                onPress={() => void handleConfirm()}
                disabled={confirmDisabled}
                className="flex-1 items-center rounded-2xl py-4"
                style={{
                  backgroundColor: confirmDisabled ? colors.subdued : "#2563eb",
                }}
              >
                <Text
                  className="text-base font-semibold"
                  style={{ color: confirmDisabled ? colors.secondary : "#ffffff" }}
                >
                  {isProcessing ? "Detecting..." : "Confirm"}
                </Text>
              </Pressable>
            </View>

            <Pressable
              onPress={() => {
                ExpoSpeechRecognitionModule.abort();
                router.back();
              }}
              className="items-center rounded-2xl border py-4"
              style={{ borderColor: colors.border, backgroundColor: colors.card }}
            >
              <Text className="text-base font-semibold" style={{ color: colors.secondary }}>
                Cancel
              </Text>
            </Pressable>
          </View>
        ) : null}

        {showDetectionCard ? (
          <View
            className="rounded-[28px] border px-5 py-6"
            style={{ backgroundColor: colors.card, borderColor: colors.border }}
          >
            <Text className="text-xs font-semibold uppercase" style={{ color: colors.secondary }}>
              Detected Expense
            </Text>

            {!isEditingDetectedExpense ? (
              <View className="mt-4 gap-3">
                <View
                  className="rounded-2xl px-4 py-4"
                  style={{ backgroundColor: colors.subdued }}
                >
                  <Text className="text-xs uppercase" style={{ color: colors.secondary }}>
                    Category
                  </Text>
                  <Text className="mt-1 text-xl font-bold" style={{ color: colors.primary }}>
                    {editableCategory}
                  </Text>
                </View>

                <View
                  className="rounded-2xl px-4 py-4"
                  style={{ backgroundColor: colors.subdued }}
                >
                  <Text className="text-xs uppercase" style={{ color: colors.secondary }}>
                    Amount
                  </Text>
                  <Text className="mt-1 text-xl font-bold" style={{ color: colors.primary }}>
                    {formatCurrencyAmount(Number(editableAmount), currency)}
                  </Text>
                </View>
              </View>
            ) : (
              <View className="mt-4 gap-3">
                <View>
                  <Text className="mb-2 text-sm font-semibold" style={{ color: colors.secondary }}>
                    Category
                  </Text>
                  <TextInput
                    ref={categoryInputRef}
                    value={editableCategory}
                    onChangeText={setEditableCategory}
                    autoCapitalize="words"
                    className="rounded-2xl border px-4 py-4 text-base"
                    style={{
                      color: colors.primary,
                      borderColor: colors.border,
                      backgroundColor: colors.input,
                    }}
                    placeholder="Others"
                    placeholderTextColor={colors.secondary}
                  />
                </View>

                <View>
                  <Text className="mb-2 text-sm font-semibold" style={{ color: colors.secondary }}>
                    Amount ({currency})
                  </Text>
                  <TextInput
                    value={editableAmount}
                    onChangeText={setEditableAmount}
                    keyboardType="decimal-pad"
                    className="rounded-2xl border px-4 py-4 text-base"
                    style={{
                      color: colors.primary,
                      borderColor: colors.border,
                      backgroundColor: colors.input,
                    }}
                    placeholder="0.00"
                    placeholderTextColor={colors.secondary}
                  />
                </View>
              </View>
            )}

            <View className="mt-5 gap-3">
              <Pressable
                onPress={() => void handleSaveDetectedExpense()}
                disabled={isSaving}
                className="items-center rounded-2xl bg-emerald-600 py-4"
                style={isSaving ? { opacity: 0.75 } : undefined}
              >
                <Text className="text-base font-semibold text-white">
                  {isSaving ? "Saving..." : "Save"}
                </Text>
              </Pressable>

              <Pressable
                onPress={() => {
                  setIsEditingDetectedExpense(true);
                  requestAnimationFrame(() => categoryInputRef.current?.focus());
                }}
                className="items-center rounded-2xl border py-4"
                style={{ borderColor: colors.border, backgroundColor: colors.subdued }}
              >
                <Text className="text-base font-semibold" style={{ color: colors.primary }}>
                  Edit
                </Text>
              </Pressable>

              <Pressable
                onPress={() => {
                  ExpoSpeechRecognitionModule.abort();
                  router.back();
                }}
                className="items-center rounded-2xl border py-4"
                style={{ borderColor: colors.border, backgroundColor: colors.card }}
              >
                <Text className="text-base font-semibold" style={{ color: colors.secondary }}>
                  Cancel
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
