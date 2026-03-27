import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useContext } from "react";
import { Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ExpenseContext } from "../Context/ExpenseContext";
import { useAudioRecorder } from "../lib/useAudioRecorder";

export default function VoiceInputScreen() {
  const { isDarkMode } = useContext(ExpenseContext);
  const { recording, audioUri, startRecording, stopRecording } = useAudioRecorder();

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

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: colors.screen }}>
      <View className="flex-1 px-6 py-8">
        <View className="mb-6 flex-row items-center justify-between">
          <View className="flex-1 pr-4">
            <Text className="text-3xl font-extrabold" style={{ color: colors.primary }}>
              Voice input
            </Text>
            <Text className="mt-1 text-sm" style={{ color: colors.secondary }}>
              Record audio and capture the saved file URI.
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
            style={{ backgroundColor: recording ? "#fee2e2" : isDarkMode ? "#052e2b" : "#d1fae5" }}
          >
            <Ionicons
              name={recording ? "radio-button-on" : "mic"}
              size={30}
              color={recording ? "#dc2626" : colors.accent}
            />
          </View>

          <Text className="text-center text-2xl font-bold" style={{ color: colors.primary }}>
            {recording ? "Recording in progress" : "Ready to record"}
          </Text>
          <Text
            className="mt-3 text-center text-base"
            style={{ color: colors.secondary, lineHeight: 24 }}
          >
            {recording
              ? "Tap stop to finish recording and save the audio file."
              : "Tap start to request microphone access and begin recording."}
          </Text>

          <Pressable
            onPress={() => {
              if (recording) {
                void stopRecording();
                return;
              }

              void startRecording();
            }}
            className="mt-8 min-w-[220px] items-center rounded-2xl px-6 py-4"
            style={{ backgroundColor: recording ? "#dc2626" : colors.accent }}
          >
            <Text className="text-base font-semibold text-white">
              {recording ? "Stop recording" : "Start recording"}
            </Text>
          </Pressable>

          <View
            className="mt-5 w-full rounded-2xl border p-4"
            style={{ borderColor: colors.border, backgroundColor: isDarkMode ? "#111827" : "#eff6ff" }}
          >
            <Text className="text-sm font-semibold" style={{ color: colors.primary }}>
              Recorded file URI
            </Text>
            <Text
              selectable
              className="mt-2 text-sm"
              style={{ color: audioUri ? colors.primary : colors.secondary, lineHeight: 22 }}
            >
              {audioUri ?? "No recording saved yet."}
            </Text>
          </View>

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
    </SafeAreaView>
  );
}
