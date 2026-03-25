import "./global.css";
import { type Href, Redirect, Stack, useSegments } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, LogBox, Text, View } from "react-native";
import { ExpenseProvider } from "../Context/ExpenseContext";
import { getCurrentUser } from "../lib/appwrite";

LogBox.ignoreLogs([
  "SafeAreaView has been deprecated and will be removed in a future release. Please use 'react-native-safe-area-context' instead.",
]);

type SessionState = "loading" | "authenticated" | "unauthenticated";

const LOGIN_ROUTE = "/login" as Href;
const HOME_ROUTE = "/home" as Href;
const ADVISOR_ROUTE_SEGMENT = "advisor";
const VOICE_INPUT_ROUTE_SEGMENT = "voice-input";

function SessionLoadingScreen() {
  return (
    <View className="flex-1 items-center justify-center bg-slate-100 px-6">
      <ActivityIndicator size="large" color="#2563eb" />
      <Text className="mt-4 text-base font-medium text-slate-600">Checking session...</Text>
    </View>
  );
}

export default function Layout() {
  const segments = useSegments();
  const [sessionState, setSessionState] = useState<SessionState>("loading");

  useEffect(() => {
    let isMounted = true;

    const checkSession = async () => {
      try {
        await getCurrentUser();
        if (isMounted) {
          setSessionState("authenticated");
        }
      } catch {
        if (isMounted) {
          setSessionState("unauthenticated");
        }
      }
    };

    void checkSession();

    return () => {
      isMounted = false;
    };
  }, []);

  const currentSegment = segments[0] as string | undefined;
  const isAuthRoute = currentSegment === "login" || currentSegment === "register";
  const isTabsRoute = currentSegment === "(tabs)";
  const isAdvisorRoute = currentSegment === ADVISOR_ROUTE_SEGMENT;
  const isVoiceInputRoute = currentSegment === VOICE_INPUT_ROUTE_SEGMENT;

  if (sessionState === "loading") {
    return (
      <ExpenseProvider>
        <SessionLoadingScreen />
      </ExpenseProvider>
    );
  }

  if (
    sessionState === "authenticated" &&
    !isTabsRoute &&
    !isAuthRoute &&
    !isAdvisorRoute &&
    !isVoiceInputRoute
  ) {
    return (
      <ExpenseProvider>
        <Redirect href={HOME_ROUTE} />
      </ExpenseProvider>
    );
  }

  if (sessionState === "unauthenticated" && !isAuthRoute && !isTabsRoute) {
    return (
      <ExpenseProvider>
        <Redirect href={LOGIN_ROUTE} />
      </ExpenseProvider>
    );
  }

  return (
    <ExpenseProvider>
      <Stack screenOptions={{ headerShown: false }} />
    </ExpenseProvider>
  );
}
