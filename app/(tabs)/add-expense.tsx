import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useContext, useState } from "react";
import { ExpenseContext } from "../../Context/ExpenseContext";
import { router } from "expo-router";
import { Alert, Pressable, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { createExpense } from "../../lib/appwrite";

export default function AddExpense() {
  const { isDarkMode, currency, addExpense } = useContext(ExpenseContext);
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("");
  const colors = isDarkMode
    ? {
        screen: "#020617",
        card: "#0f172a",
        border: "#334155",
        input: "#1e293b",
        chip: "#1e3a8a",
        primary: "#f8fafc",
        secondary: "#94a3b8",
        placeholder: "#64748b",
      }
    : {
        screen: "#f8fafc",
        card: "#ffffff",
        border: "#e2e8f0",
        input: "#f8fafc",
        chip: "#dbeafe",
        primary: "#0f172a",
        secondary: "#475569",
        placeholder: "#94a3b8",
      };

  const handleSave = async () => {
    const parsedAmount = Number.parseFloat(amount);
    const parsedCategory = category.trim();

    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      Alert.alert("Invalid amount", "Please enter a valid amount greater than 0.");
      return;
    }

    if (!parsedCategory) {
      Alert.alert("Missing category", "Please enter a category for this expense.");
      return;
    }

    try {
      const result = await createExpense({
        amount: parsedAmount,
        category: parsedCategory,
        date: new Date().toISOString(),
      });
      void result;

      addExpense(parsedAmount, parsedCategory);
      router.push("/home");
    } catch (error) {
      console.error(error);
      Alert.alert("Save failed", "Unable to save expense. Please try again.");
    }
  };

  return (
    <SafeAreaView className="flex-1 px-6 py-4" style={{ backgroundColor: colors.screen }}>
      <View className="mb-6 flex-row items-center gap-3">
        <View
          className="h-11 w-11 items-center justify-center rounded-full"
          style={{ backgroundColor: colors.chip }}
        >
          <Ionicons name="receipt-outline" size={22} color="#1d4ed8" />
        </View>
        <View>
          <Text className="text-2xl font-bold" style={{ color: colors.primary }}>
            Add Expense
          </Text>
          <Text style={{ color: colors.secondary }}>
            Record what you spent today in {currency}.
          </Text>
        </View>
      </View>

      <View
        className="rounded-2xl border p-4"
        style={{ backgroundColor: colors.card, borderColor: colors.border }}
      >
        <Text className="mb-2 text-sm font-semibold" style={{ color: colors.secondary }}>
          Amount ({currency})
        </Text>
        <View
          className="mb-4 flex-row items-center rounded-xl border px-3"
          style={{ backgroundColor: colors.input, borderColor: colors.border }}
        >
          <MaterialCommunityIcons name="cash" size={20} color={colors.secondary} />
          <TextInput
            placeholder="0.00"
            keyboardType="decimal-pad"
            value={amount}
            onChangeText={setAmount}
            className="flex-1 px-3 py-3 text-base"
            style={{ color: colors.primary }}
            placeholderTextColor={colors.placeholder}
          />
        </View>

        <Text className="mb-2 text-sm font-semibold" style={{ color: colors.secondary }}>
          Category
        </Text>
        <View
          className="mb-2 flex-row items-center rounded-xl border px-3"
          style={{ backgroundColor: colors.input, borderColor: colors.border }}
        >
          <Ionicons name="pricetag-outline" size={20} color={colors.secondary} />
          <TextInput
            placeholder="Food, Transport, Shopping..."
            value={category}
            onChangeText={setCategory}
            className="flex-1 px-3 py-3 text-base"
            style={{ color: colors.primary }}
            placeholderTextColor={colors.placeholder}
          />
        </View>
      </View>

      <View className="mt-6 gap-3">
        <Pressable
          onPress={handleSave}
          className="items-center rounded-xl bg-blue-600 py-4"
        >
          <View className="flex-row items-center gap-2">
            <Ionicons name="save-outline" size={20} color="#ffffff" />
            <Text className="text-base font-semibold text-white">Save Expense</Text>
          </View>
        </Pressable>

        <Pressable
          onPress={() => router.push("/home")}
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
