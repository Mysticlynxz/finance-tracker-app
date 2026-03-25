import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useCallback, useContext, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { ExpenseContext } from "../../Context/ExpenseContext";
import { router } from "expo-router";
import { Alert, Pressable, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { getBudget, setBudget } from "../../lib/appwrite";

export default function Budget() {
  const {
    setBudget: setBudgetLocal,
    isDarkMode,
    currency,
    formatAmount,
    convertToINR,
  } =
    useContext(ExpenseContext);
  const [value, setValue] = useState("");
  const [currentBudget, setCurrentBudget] = useState<number>(0);

  useFocusEffect(
    useCallback(() => {
      let isActive = true;

      const loadBudget = async () => {
        try {
          const budgetFromDb = await getBudget();

          if (isActive) {
            setCurrentBudget(budgetFromDb ?? 0);
          }
        } catch (error) {
          console.error("Failed to load budget", error);
        }
      };

      void loadBudget();

      return () => {
        isActive = false;
      };
    }, [])
  );
  const colors = isDarkMode
    ? {
        screen: "#020617",
        card: "#0f172a",
        border: "#334155",
        input: "#1e293b",
        chip: "#312e81",
        primary: "#f8fafc",
        secondary: "#94a3b8",
        placeholder: "#64748b",
      }
    : {
        screen: "#f8fafc",
        card: "#ffffff",
        border: "#e2e8f0",
        input: "#f8fafc",
        chip: "#ede9fe",
        primary: "#0f172a",
        secondary: "#475569",
        placeholder: "#94a3b8",
      };

  const handleSave = async () => {
    const parsedBudget = Number(value);
    if (!Number.isFinite(parsedBudget) || parsedBudget <= 0) {
      Alert.alert("Invalid budget", "Please enter a valid budget greater than 0.");
      return;
    }

    try {
      const budgetInINR = convertToINR(parsedBudget);

      if (!Number.isFinite(budgetInINR) || budgetInINR <= 0) {
        throw new Error("Budget amount could not be converted to INR.");
      }

      await setBudget({ amount: Number(budgetInINR) });
      setBudgetLocal(budgetInINR);
      setCurrentBudget(budgetInINR);
      router.replace("/home");
    } catch (error) {
      console.error("Failed to save budget", error);
      Alert.alert("Error", "Unable to save budget.");
    }
  };

  return (
    <SafeAreaView className="flex-1 px-6 py-4" style={{ backgroundColor: colors.screen }}>
      <View className="mb-6 flex-row items-center gap-3">
        <View
          className="h-11 w-11 items-center justify-center rounded-full"
          style={{ backgroundColor: colors.chip }}
        >
          <Ionicons name="wallet-outline" size={22} color="#7c3aed" />
        </View>
        <View>
          <Text className="text-2xl font-bold" style={{ color: colors.primary }}>
            Set Budget
          </Text>
          <Text style={{ color: colors.secondary }}>
            Define your monthly spending limit in {currency}.
          </Text>
        </View>
      </View>

      <View
        className="rounded-2xl border p-4"
        style={{ backgroundColor: colors.card, borderColor: colors.border }}
      >
        <Text className="mb-2 text-xs" style={{ color: colors.secondary }}>
          Current Budget: {formatAmount(currentBudget)}
        </Text>
        <Text className="mb-2 text-sm font-semibold" style={{ color: colors.secondary }}>
          Monthly Budget Amount ({currency})
        </Text>
        <View
          className="flex-row items-center rounded-xl border px-3"
          style={{ backgroundColor: colors.input, borderColor: colors.border }}
        >
          <MaterialCommunityIcons name="cash-multiple" size={20} color={colors.secondary} />
          <TextInput
            placeholder="0.00"
            keyboardType="decimal-pad"
            value={value}
            onChangeText={setValue}
            className="flex-1 px-3 py-3 text-base"
            style={{ color: colors.primary }}
            placeholderTextColor={colors.placeholder}
          />
        </View>
      </View>

      <View className="mt-6 gap-3">
        <Pressable
          onPress={handleSave}
          className="items-center rounded-xl bg-violet-600 py-4"
        >
          <View className="flex-row items-center gap-2">
            <Ionicons name="checkmark-circle-outline" size={20} color="#ffffff" />
            <Text className="text-base font-semibold text-white">Save Budget</Text>
          </View>
        </Pressable>

        <Pressable
          onPress={() => router.replace("/home")}
          className="items-center rounded-xl border py-4"
          style={{ backgroundColor: colors.card, borderColor: colors.border }}
        >
          <Text className="text-base font-semibold" style={{ color: colors.secondary }}>
            Cancel
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
