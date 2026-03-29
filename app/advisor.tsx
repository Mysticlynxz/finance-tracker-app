import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import {
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
import {
  AI_ADVISOR_FALLBACK_RESPONSE,
  askFinancialAdvisor,
} from "../lib/appwrite";

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
}

const AI_NAME = "FinBot";
const ADVISOR_ICON_OPTIONS = [
  "robot-outline",
  "brain",
  "chart-line",
  "wallet-outline",
] as const;

export default function AdvisorScreen() {
  const { isDarkMode, currency } = useContext(ExpenseContext);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      text:
        "Ask me about spending, budgets, or saving moves. I'll respond in your selected currency and only slightly judge that snack budget \u{1F604}",
    },
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [selectedAdvisorIcon, setSelectedAdvisorIcon] =
    useState<(typeof ADVISOR_ICON_OPTIONS)[number]>("chart-line");
  const flatListRef = useRef<FlatList<ChatMessage>>(null);
  const isMountedRef = useRef(true);

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
    return () => {
      isMountedRef.current = false;
    };
  }, []);

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

  const streamText = async (fullText: string) => {
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
      if (!isMountedRef.current) {
        return;
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
  };

  const streamAssistantReply = async (fullText: string) => {
    const safeText = fullText.trim() || AI_ADVISOR_FALLBACK_RESPONSE;

    setMessages((current) => [...current, { role: "assistant", text: "" }]);
    setIsStreaming(true);

    try {
      await streamText(safeText);
    } finally {
      if (isMountedRef.current) {
        setIsStreaming(false);
      }
    }
  };

  const handleSend = async () => {
    if (isLoading || isStreaming) {
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
      const reply = await askFinancialAdvisor(trimmedMessage, currency);
      setIsLoading(false);
      await streamAssistantReply(reply);
    } catch (error) {
      setIsLoading(false);
      await streamAssistantReply(
        error instanceof Error && error.message.trim()
          ? error.message
          : AI_ADVISOR_FALLBACK_RESPONSE
      );
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  };

  const canSend = Boolean(input.trim()) && !isLoading && !isStreaming;

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
                name={selectedAdvisorIcon}
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

          <View
            className="border-b px-4 py-3"
            style={{ borderColor: colors.border, backgroundColor: colors.card }}
          >
            <Text className="text-xs font-semibold uppercase" style={{ color: colors.secondary }}>
              Icon Preview
            </Text>
            <Text className="mt-1 text-xs" style={{ color: colors.secondary }}>
              Tap an option to preview the advisor logo before finalizing it.
            </Text>

            <View className="mt-3 flex-row flex-wrap gap-2">
              {ADVISOR_ICON_OPTIONS.map((iconName) => {
                const isSelected = iconName === selectedAdvisorIcon;

                return (
                  <Pressable
                    key={iconName}
                    onPress={() => setSelectedAdvisorIcon(iconName)}
                    className="rounded-full border px-3 py-2"
                    style={{
                      backgroundColor: isSelected
                        ? isDarkMode
                          ? "#172554"
                          : "#dbeafe"
                        : colors.screen,
                      borderColor: isSelected ? "#3b82f6" : colors.border,
                    }}
                  >
                    <MaterialCommunityIcons
                      name={iconName}
                      size={28}
                      color="#3b82f6"
                    />
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={{ flex: 1 }}>
            <FlatList
              ref={flatListRef}
              data={messages}
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
              renderItem={({ item: message }) => {
                const isUser = message.role === "user";

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
                        backgroundColor: isUser ? "#3b82f6" : "#e5e7eb",
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
                          color: isUser ? "white" : "black",
                          flexWrap: "wrap",
                          flexShrink: 1,
                          lineHeight: 20,
                        }}
                      >
                        {message.text}
                      </Text>
                    </View>
                  </View>
                );
              }}
              ListFooterComponent={
                isLoading ? (
                  <View
                    style={{
                      width: "100%",
                      alignItems: "flex-start",
                    }}
                  >
                    <View style={{ padding: 10 }}>
                      <ActivityIndicator size="small" color="#888" />
                    </View>
                  </View>
                ) : null
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
