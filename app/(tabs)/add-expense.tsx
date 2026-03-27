import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useContext, useEffect, useRef, useState } from "react";
import {
  Alert,
  Modal,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ExpenseContext } from "../../Context/ExpenseContext";
import { DEFAULT_CATEGORIES, type CategoryOption } from "../../constants/categories";
import { createCategory, getCategories } from "../../lib/categoryService";
import { createExpense } from "../../lib/appwrite";

const mapCategoryDocument = (category: { name: string; icon: string }): CategoryOption => ({
  name: category.name,
  icon: category.icon,
});

export default function AddExpense() {
  const { isDarkMode, currency, addExpense, convertToINR } = useContext(ExpenseContext);
  const [customCategories, setCustomCategories] = useState<CategoryOption[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<CategoryOption | null>(null);
  const [amount, setAmount] = useState("");
  const [customCategoryName, setCustomCategoryName] = useState("");
  const [isExpenseModalVisible, setIsExpenseModalVisible] = useState(false);
  const [isCustomCategoryModalVisible, setIsCustomCategoryModalVisible] = useState(false);
  const [isSavingExpense, setIsSavingExpense] = useState(false);
  const [isSavingCategory, setIsSavingCategory] = useState(false);
  const isSubmittingExpenseRef = useRef(false);

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
        tile: "#111827",
        tileBorder: "#1e293b",
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
        tile: "#f8fafc",
        tileBorder: "#dbeafe",
      };

  const allCategories = [...DEFAULT_CATEGORIES, ...customCategories];

  useEffect(() => {
    let isActive = true;

    const loadCategories = async () => {
      try {
        const data = await getCategories();

        if (isActive) {
          setCustomCategories(data.map(mapCategoryDocument));
        }
      } catch (error) {
        console.error("Failed to load custom categories", error);
      }
    };

    void loadCategories();

    return () => {
      isActive = false;
    };
  }, []);

  const openExpenseModal = (category: CategoryOption) => {
    setSelectedCategory(category);
    setAmount("");
    setIsExpenseModalVisible(true);
  };

  const closeExpenseModal = () => {
    setAmount("");
    setSelectedCategory(null);
    setIsExpenseModalVisible(false);
  };

  const closeCustomCategoryModal = () => {
    setCustomCategoryName("");
    setIsCustomCategoryModalVisible(false);
  };

  const handleAddExpense = async () => {
    if (!selectedCategory) {
      Alert.alert("Missing category", "Please choose a category first.");
      return;
    }

    if (isSubmittingExpenseRef.current) {
      console.warn("[Expenses] Duplicate add expense tap ignored.");
      return;
    }

    const parsedAmount = Number(amount);

    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      Alert.alert("Invalid amount", "Please enter a valid amount greater than 0.");
      return;
    }

    isSubmittingExpenseRef.current = true;
    setIsSavingExpense(true);

    try {
      const date = new Date().toISOString();
      const amountInINR = convertToINR(parsedAmount);

      if (!Number.isFinite(amountInINR) || amountInINR <= 0) {
        throw new Error("Expense amount could not be converted to INR.");
      }

      await createExpense({
        amount: Number(amountInINR),
        category: selectedCategory.name,
        date,
      });

      addExpense(amountInINR, selectedCategory.name);
      closeExpenseModal();
      router.replace("/home");
    } catch (error) {
      console.error(error);
      Alert.alert("Save failed", "Unable to save expense. Please try again.");
    } finally {
      isSubmittingExpenseRef.current = false;
      setIsSavingExpense(false);
    }
  };

  const handleCreateCategory = async () => {
    const trimmedName = customCategoryName.trim();

    if (!trimmedName) {
      Alert.alert("Missing name", "Please enter a category name.");
      return;
    }

    const normalizedName = trimmedName.toLowerCase();
    const alreadyExists = allCategories.some(
      (category) => category.name.trim().toLowerCase() === normalizedName
    );

    if (alreadyExists) {
      Alert.alert("Category exists", "Choose a different category name.");
      return;
    }

    setIsSavingCategory(true);

    try {
      const createdCategory = await createCategory(trimmedName);

      setCustomCategories((currentCategories) =>
        [...currentCategories, mapCategoryDocument(createdCategory)].sort((a, b) =>
          a.name.localeCompare(b.name)
        )
      );
      closeCustomCategoryModal();
    } catch (error) {
      console.error(error);
      Alert.alert("Save failed", "Unable to create category. Please try again.");
    } finally {
      setIsSavingCategory(false);
    }
  };

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: colors.screen }}>
      <ScrollView
        className="flex-1 px-6 py-4"
        contentContainerStyle={{ paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}
      >
        <View className="mb-6 flex-row items-center gap-3">
          <View
            className="h-11 w-11 items-center justify-center rounded-full"
            style={{ backgroundColor: colors.chip }}
          >
            <Ionicons name="grid-outline" size={22} color="#1d4ed8" />
          </View>
          <View className="flex-1">
            <Text className="text-2xl font-bold" style={{ color: colors.primary }}>
              Add Expense
            </Text>
            <Text style={{ color: colors.secondary }}>
              Pick a category and record what you spent in {currency}.
            </Text>
          </View>
        </View>

        <View
          className="rounded-2xl border p-4"
          style={{ backgroundColor: colors.card, borderColor: colors.border }}
        >
          <Text className="mb-1 text-lg font-bold" style={{ color: colors.primary }}>
            Expense Categories
          </Text>
          <Text className="mb-4 text-sm" style={{ color: colors.secondary }}>
            Tap a category to enter the amount.
          </Text>

          <View className="flex-row flex-wrap justify-between">
            {allCategories.map((category) => (
              <TouchableOpacity
                key={`${category.name}-${category.icon}`}
                activeOpacity={0.85}
                onPress={() => openExpenseModal(category)}
                className="mb-3 items-center rounded-2xl border px-3 py-4"
                style={{
                  width: "31.5%",
                  backgroundColor: colors.tile,
                  borderColor: colors.tileBorder,
                }}
              >
                <Text className="mb-2 text-3xl">{category.icon}</Text>
                <Text
                  className="text-center text-sm font-semibold"
                  numberOfLines={2}
                  style={{ color: colors.primary }}
                >
                  {category.name}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => setIsCustomCategoryModalVisible(true)}
          className="mt-6 flex-row items-center justify-center rounded-xl bg-blue-600 py-4"
        >
          <Ionicons name="add-circle-outline" size={20} color="#ffffff" />
          <Text className="ml-2 text-base font-semibold text-white">Add Custom Category</Text>
        </TouchableOpacity>

        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => router.replace("/home")}
          className="mt-3 items-center rounded-xl border py-4"
          style={{ backgroundColor: colors.card, borderColor: colors.border }}
        >
          <Text className="text-base font-semibold" style={{ color: colors.secondary }}>
            Cancel
          </Text>
        </TouchableOpacity>
      </ScrollView>

      <TouchableOpacity
        activeOpacity={0.9}
        onPress={() => {
          void Haptics.selectionAsync();
          Alert.alert("Voice feature will be available soon");
        }}
        className="absolute bottom-8 right-6 h-16 w-16 items-center justify-center rounded-full bg-emerald-600"
        style={{
          shadowColor: "#0f172a",
          shadowOffset: { width: 0, height: 10 },
          shadowOpacity: 0.2,
          shadowRadius: 16,
          elevation: 8,
        }}
      >
        <Ionicons name="mic" size={24} color="#ffffff" />
      </TouchableOpacity>

      <Modal
        visible={isExpenseModalVisible}
        animationType="fade"
        transparent
        onRequestClose={closeExpenseModal}
      >
        <View
          className="flex-1 items-center justify-center px-6"
          style={{ backgroundColor: "rgba(15, 23, 42, 0.45)" }}
        >
          <View className="w-full max-w-sm rounded-3xl bg-white p-6">
            <Text className="text-center text-4xl">{selectedCategory?.icon}</Text>
            <Text className="mt-3 text-center text-2xl font-bold text-slate-900">
              {selectedCategory?.name}
            </Text>
            <Text className="mt-1 text-center text-sm text-slate-500">
              Enter the expense amount in {currency}.
            </Text>

            <Text className="mt-5 mb-2 text-sm font-semibold text-slate-600">
              Amount ({currency})
            </Text>
            <TextInput
              placeholder="0.00"
              keyboardType="decimal-pad"
              value={amount}
              onChangeText={setAmount}
              className="rounded-2xl border px-4 py-4 text-base text-slate-900"
              style={{ borderColor: "#cbd5e1", backgroundColor: "#f8fafc" }}
              placeholderTextColor="#94a3b8"
            />

            <TouchableOpacity
              activeOpacity={0.85}
              onPress={handleAddExpense}
              disabled={isSavingExpense}
              className="mt-5 items-center rounded-2xl bg-blue-600 py-4"
              style={{ opacity: isSavingExpense ? 0.7 : 1 }}
            >
              <Text className="text-base font-semibold text-white">
                {isSavingExpense ? "Saving..." : "Add Expense"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              activeOpacity={0.85}
              onPress={closeExpenseModal}
              className="mt-3 items-center rounded-2xl border py-4"
              style={{ borderColor: "#cbd5e1" }}
            >
              <Text className="text-base font-semibold text-slate-600">Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal
        visible={isCustomCategoryModalVisible}
        animationType="fade"
        transparent
        onRequestClose={closeCustomCategoryModal}
      >
        <View
          className="flex-1 items-center justify-center px-6"
          style={{ backgroundColor: "rgba(15, 23, 42, 0.45)" }}
        >
          <View className="w-full max-w-sm rounded-3xl bg-white p-6">
            <Text className="text-center text-2xl font-bold text-slate-900">
              Add Custom Category
            </Text>
            <Text className="mt-1 text-center text-sm text-slate-500">
              A letter icon will be generated automatically.
            </Text>

            <Text className="mt-5 mb-2 text-sm font-semibold text-slate-600">
              Category Name
            </Text>
            <TextInput
              placeholder="Gym, Pets, Gifts..."
              value={customCategoryName}
              onChangeText={setCustomCategoryName}
              autoCapitalize="words"
              className="rounded-2xl border px-4 py-4 text-base text-slate-900"
              style={{ borderColor: "#cbd5e1", backgroundColor: "#f8fafc" }}
              placeholderTextColor="#94a3b8"
            />

            <TouchableOpacity
              activeOpacity={0.85}
              onPress={handleCreateCategory}
              disabled={isSavingCategory}
              className="mt-5 items-center rounded-2xl bg-blue-600 py-4"
              style={{ opacity: isSavingCategory ? 0.7 : 1 }}
            >
              <Text className="text-base font-semibold text-white">
                {isSavingCategory ? "Saving..." : "Create Category"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              activeOpacity={0.85}
              onPress={closeCustomCategoryModal}
              className="mt-3 items-center rounded-2xl border py-4"
              style={{ borderColor: "#cbd5e1" }}
            >
              <Text className="text-base font-semibold text-slate-600">Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
