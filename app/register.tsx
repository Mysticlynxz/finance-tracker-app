import { router } from "expo-router";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
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
      console.error(error);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white px-6 py-8">
      <View className="mt-10 gap-4">
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

        <Pressable onPress={() => void handleRegister()} className="rounded-lg bg-blue-600 py-3">
          <Text className="text-center font-semibold text-white">Register</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
