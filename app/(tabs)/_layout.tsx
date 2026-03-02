import { Ionicons } from "@expo/vector-icons";
import {
  MaterialTopTabNavigationEventMap,
  MaterialTopTabNavigationOptions,
  createMaterialTopTabNavigator,
} from "@react-navigation/material-top-tabs";
import { ParamListBase, TabNavigationState } from "@react-navigation/native";
import { type Href, Redirect, withLayoutContext } from "expo-router";
import { useContext, useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ExpenseContext } from "../../Context/ExpenseContext";
import { getCurrentUser } from "../../lib/appwrite";

type TabsSessionState = "loading" | "authorized" | "unauthorized";
const LOGIN_ROUTE = "/login" as Href;
const { Navigator } = createMaterialTopTabNavigator();

const Tabs = withLayoutContext<
  MaterialTopTabNavigationOptions,
  typeof Navigator,
  TabNavigationState<ParamListBase>,
  MaterialTopTabNavigationEventMap
>(Navigator);

export default function TabsLayout() {
  const { isDarkMode } = useContext(ExpenseContext);
  const insets = useSafeAreaInsets();
  const [sessionState, setSessionState] = useState<TabsSessionState>("loading");

  useEffect(() => {
    let isMounted = true;

    const verifySession = async () => {
      try {
        await getCurrentUser();
        if (isMounted) {
          setSessionState("authorized");
        }
      } catch {
        if (isMounted) {
          setSessionState("unauthorized");
        }
      }
    };

    void verifySession();

    return () => {
      isMounted = false;
    };
  }, []);

  if (sessionState === "loading") {
    return (
      <View
        className="flex-1 items-center justify-center"
        style={{ backgroundColor: isDarkMode ? "#020617" : "#f8fafc" }}
      >
        <ActivityIndicator size="large" color={isDarkMode ? "#60a5fa" : "#1d4ed8"} />
      </View>
    );
  }

  if (sessionState === "unauthorized") {
    return <Redirect href={LOGIN_ROUTE} />;
  }

  return (
    <Tabs
      tabBarPosition="bottom"
      screenOptions={({ route }) => ({
        swipeEnabled: true,
        animationEnabled: true,
        tabBarActiveTintColor: isDarkMode ? "#60a5fa" : "#1d4ed8",
        tabBarInactiveTintColor: isDarkMode ? "#94a3b8" : "#64748b",
        tabBarStyle: {
          height: 68 + insets.bottom,
          paddingTop: 8,
          paddingBottom: Math.max(10, insets.bottom),
          borderTopWidth: 1,
          borderTopColor: isDarkMode ? "#334155" : "#e2e8f0",
          backgroundColor: isDarkMode ? "#0f172a" : "#ffffff",
        },
        tabBarItemStyle: {
          minHeight: 52,
          justifyContent: "center",
        },
        tabBarIconStyle: {
          marginBottom: 2,
        },
        tabBarIndicatorStyle: {
          backgroundColor: "transparent",
          height: 0,
        },
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: "700",
        },
        tabBarShowIcon: true,
        tabBarIcon: ({ color, focused }) => {
          let iconName: keyof typeof Ionicons.glyphMap = "home-outline";

          if (route.name === "home") {
            iconName = focused ? "home" : "home-outline";
          } else if (route.name === "add-expense") {
            iconName = focused ? "add-circle" : "add-circle-outline";
          } else if (route.name === "reports") {
            iconName = focused ? "bar-chart" : "bar-chart-outline";
          } else if (route.name === "budget") {
            iconName = focused ? "wallet" : "wallet-outline";
          } else if (route.name === "settings") {
            iconName = focused ? "settings" : "settings-outline";
          }

          return <Ionicons name={iconName} size={20} color={color} />;
        },
      })}
    >
      <Tabs.Screen name="home" options={{ title: "Home" }} />
      <Tabs.Screen name="add-expense" options={{ title: "Add" }} />
      <Tabs.Screen name="reports" options={{ title: "Reports" }} />
      <Tabs.Screen name="budget" options={{ title: "Budget" }} />
      <Tabs.Screen name="settings" options={{ title: "Settings" }} />
    </Tabs>
  );
}
