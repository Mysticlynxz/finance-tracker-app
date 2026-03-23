import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useContext, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ExpenseContext } from "../Context/ExpenseContext";
import { askFinancialAdvisor } from "../lib/appwrite";

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
}

export default function AdvisorScreen() {
  const { isDarkMode, currency, exchangeRates } = useContext(ExpenseContext);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      text: "Hi. Ask me about spending, budget planning, or saving strategies.",
    },
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const scrollViewRef = useRef<ScrollView>(null);

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

  const scrollToBottom = () => {
    scrollViewRef.current?.scrollToEnd({ animated: true });
  };

  const handleSend = async () => {
    if (isLoading) {
      return;
    }

    const trimmedMessage = input.trim();

    if (!trimmedMessage) {
      return;
    }

    setInput("");
    Keyboard.dismiss();
    setMessages((current) => [...current, { role: "user", text: trimmedMessage }]);
    setIsLoading(true);

    try {
      const reply = await askFinancialAdvisor(
        trimmedMessage,
        currency,
        exchangeRates[currency] ?? 1
      );
      setMessages((current) => [...current, { role: "assistant", text: reply }]);
    } catch (error) {
      const fallbackMessage =
        error instanceof Error && error.message
          ? error.message
          : "Unable to fetch advice right now.";

      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          text: `Sorry, I couldn't respond right now. ${fallbackMessage}`,
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const canSend = Boolean(input.trim()) && !isLoading;

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: colors.screen }}>
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
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

          <View>
            <Text className="text-lg font-bold" style={{ color: colors.primary }}>
              AI Financial Advisor
            </Text>
            <Text className="text-sm" style={{ color: colors.secondary }}>
              Personalized spending guidance
            </Text>
          </View>
        </View>

        <ScrollView
          ref={scrollViewRef}
          className="flex-1 px-4"
          contentContainerStyle={{ gap: 10, paddingBottom: 20, paddingTop: 16 }}
          onContentSizeChange={scrollToBottom}
          onLayout={scrollToBottom}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {messages.map((message, index) => {
            const isUser = message.role === "user";

            return (
              <View
                key={`${message.role}-${index}`}
                className={`max-w-[82%] rounded-2xl px-4 py-3 ${isUser ? "self-end" : "self-start"}`}
                style={{
                  backgroundColor: isUser ? colors.userBubble : colors.assistantBubble,
                }}
              >
                <Text
                  className="text-base leading-6"
                  style={{ color: isUser ? "#ffffff" : colors.primary }}
                >
                  {message.text}
                </Text>
              </View>
            );
          })}

          {isLoading && (
            <View
              className="max-w-[82%] self-start rounded-2xl px-4 py-3"
              style={{ backgroundColor: colors.assistantBubble }}
            >
              <View className="flex-row items-center gap-2">
                <ActivityIndicator size="small" color={colors.secondary} />
                <Text className="text-sm" style={{ color: colors.secondary }}>
                  Thinking...
                </Text>
              </View>
            </View>
          )}
        </ScrollView>

        <View
          className="border-t px-4 pb-4 pt-3"
          style={{ borderColor: colors.border, backgroundColor: colors.screen }}
        >
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
              className="max-h-32 flex-1 py-2 text-base"
              style={{ color: colors.primary }}
            />

            <Pressable
              onPress={() => void handleSend()}
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
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
