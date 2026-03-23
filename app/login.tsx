import { Link, router } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, Text, TextInput, View } from "react-native";
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
      <View className="mt-10 gap-4">
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

        <Pressable onPress={() => void handleSubmit()} className="rounded-lg bg-blue-600 py-3">
          <Text className="text-center font-semibold text-white">Sign In</Text>
        </Pressable>

        <Link href="/register" className="text-center text-blue-600">
          {"Don't have an account? Register"}
        </Link>
      </View>
    </SafeAreaView>
  );
}
