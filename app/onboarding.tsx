import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function Onboarding() {
  return (
    <SafeAreaView className="flex-1 bg-amber-50 px-6 py-8">
      <View className="flex-1 justify-center">
        <Text className="text-4xl font-extrabold text-slate-900">Welcome</Text>
        <Text className="mt-3 text-base leading-6 text-slate-600">
          Set a budget, track expenses, and understand where your money goes.
        </Text>

        <View className="mt-8 gap-3 rounded-2xl border border-slate-200 bg-white p-4">
          <View className="flex-row items-center gap-3">
            <Ionicons name="wallet-outline" size={20} color="#7c3aed" />
            <Text className="text-slate-700">Create your monthly budget</Text>
          </View>
          <View className="flex-row items-center gap-3">
            <Ionicons name="add-circle-outline" size={20} color="#2563eb" />
            <Text className="text-slate-700">Add expenses instantly</Text>
          </View>
          <View className="flex-row items-center gap-3">
            <Ionicons name="bar-chart-outline" size={20} color="#059669" />
            <Text className="text-slate-700">View smart category reports</Text>
          </View>
        </View>

        <Pressable
          onPress={() => router.push("/home")}
          className="mt-8 items-center rounded-xl bg-slate-900 py-4"
        >
          <View className="flex-row items-center gap-2">
            <Text className="text-base font-semibold text-white">Continue</Text>
            <Ionicons name="arrow-forward" size={18} color="#ffffff" />
          </View>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
