import { router } from "expo-router";
import { useState } from "react";
import { Alert, Image, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { registerUser } from "../lib/appwrite";

export default function RegisterScreen() {
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
  });

  const handleRegister = async () => {
    try {
      await registerUser({
        name: form.name.trim(),
        email: form.email.trim(),
        password: form.password,
      });

      router.replace("/login");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to register. Please try again.";

      Alert.alert("Registration failed", message);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white px-6 py-8">
      <ScrollView className="mt-10" contentContainerStyle={{ gap: 16 }} keyboardShouldPersistTaps="handled">
        <View className="items-center">
          <Image
            source={require("../assets/branding/vittiqo-kolam-v-transparent.png")}
            style={{ width: 100, height: 100 }}
            resizeMode="contain"
            accessible={false}
          />
          <Text className="text-2xl font-bold" style={{ color: "#101D35" }} accessibilityRole="header">
            VITTIQO
          </Text>
          <Text className="text-center text-sm" style={{ color: "#101D35" }}>
            Your money. Your language. Your intelligence.
          </Text>
          <View accessibilityElementsHidden importantForAccessibility="no" style={{ width: 32, height: 3, marginTop: 8, backgroundColor: "#E6A52E" }} />
        </View>
        <Text className="text-2xl font-bold text-slate-900">Register</Text>

        <TextInput
          className="rounded-lg border border-slate-300 px-4 py-3 text-slate-900"
          placeholder="Name"
          value={form.name}
          onChangeText={(name) => setForm((prev) => ({ ...prev, name }))}
          autoCapitalize="words"
        />

        <TextInput
          className="rounded-lg border border-slate-300 px-4 py-3 text-slate-900"
          placeholder="Email"
          value={form.email}
          onChangeText={(email) => setForm((prev) => ({ ...prev, email }))}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
        />

        <TextInput
          className="rounded-lg border border-slate-300 px-4 py-3 text-slate-900"
          placeholder="Password"
          value={form.password}
          onChangeText={(password) => setForm((prev) => ({ ...prev, password }))}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
        />

        <Pressable onPress={() => void handleRegister()} className="rounded-lg py-3" style={{ backgroundColor: "#101D35" }}>
          <Text className="text-center font-semibold text-white">Register</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
