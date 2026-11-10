import { Link, router } from "expo-router";
import { useState } from "react";
import { Alert, Image, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { loginUser } from "../lib/appwrite";

export default function LoginScreen() {
  const [form, setForm] = useState({
    email: "",
    password: "",
  });

  const handleSubmit = async () => {
    try {
      await loginUser({
        email: form.email.trim(),
        password: form.password,
      });

      router.replace("/home");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to sign in. Please try again.";

      Alert.alert("Login failed", message);
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
        <Text className="text-2xl font-bold text-slate-900">Login</Text>

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

        <Pressable onPress={() => void handleSubmit()} className="rounded-lg py-3" style={{ backgroundColor: "#101D35" }}>
          <Text className="text-center font-semibold text-white">Sign In</Text>
        </Pressable>

        <Link href="/register" className="text-center" style={{ color: "#168F83", fontSize: 19, fontWeight: "700", textDecorationLine: "underline" }}>
          {"Don't have an account? Register"}
        </Link>
      </ScrollView>
    </SafeAreaView>
  );
}
