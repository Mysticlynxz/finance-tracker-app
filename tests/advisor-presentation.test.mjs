import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const source = readFileSync(new URL("../lib/advisorPresentation.ts", import.meta.url), "utf8");
const module = { exports: {} };
vm.runInNewContext(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { module, exports: module.exports });
const { canPlayAdvisorSpeech, formatAdvisorDisplayText } = module.exports;

const ready = {
  role: "assistant", text: "Hello", isStreaming: false, isLoading: false,
  isSubmitting: false, isSessionVerified: true, isVoiceActionPending: false,
  voiceStage: "idle", isSpeechLoading: false,
};

test("completed English and Malayalam assistant replies are speakable", () => {
  assert.equal(canPlayAdvisorSpeech(ready), true);
  assert.equal(canPlayAdvisorSpeech({ ...ready, text: "നിങ്ങളുടെ ബജറ്റ് ശ്രദ്ധിക്കുക." }), true);
  assert.equal(canPlayAdvisorSpeech({ ...ready, text: "A suggested question's response." }), true);
});

test("speech is unavailable for incomplete, unauthenticated, busy, and recording states", () => {
  for (const change of [
    { role: "user" }, { text: " \n " }, { isStreaming: true },
    { isLoading: true }, { isSubmitting: true }, { isSessionVerified: false },
    { isVoiceActionPending: true }, { voiceStage: "recording" },
    { voiceStage: "review" }, { isSpeechLoading: true },
  ]) {
    assert.equal(canPlayAdvisorSpeech({ ...ready, ...change }), false, JSON.stringify(change));
  }
});

test("display formatting preserves Malayalam, line breaks and numbered recommendations", () => {
  const text = "## ഉപദേശം\n1. **ചെലവ് കുറയ്ക്കുക**\n2. Save `₹200`.\n[Details](https://example.test)";
  assert.equal(formatAdvisorDisplayText(text),
    "ഉപദേശം\n1. ചെലവ് കുറയ്ക്കുക\n2. Save ₹200.\nDetails");
  assert.equal(formatAdvisorDisplayText("Food * costs 2"), "Food * costs 2");
});

test("cleans common Markdown while preserving financial data and ordinary underscores", () => {
  const text = [
    "# Budget",
    "- *Food*: ₹1,234.50",
    "* _Groceries_ + ₹200.00",
    "+ ~~Old total~~ ₹2,000",
    "1) **Save** 20% for emergency_fund.",
    "2. Keep account_id, x_y_z and a__b__c unchanged.",
    "- ₹250.00",
    "+ 20% growth",
    "വരുമാനം _കൂടുതൽ_ ആക്കുക; *ചെലവ്* കുറയ്ക്കുക.",
    "~~പഴയ ബജറ്റ്~~ ₹500",
    "[Read more](https://example.test/a_b)",
  ].join("\n");
  assert.equal(formatAdvisorDisplayText(text), [
    "Budget",
    "• Food: ₹1,234.50",
    "• Groceries + ₹200.00",
    "• Old total ₹2,000",
    "1. Save 20% for emergency_fund.",
    "2. Keep account_id, x_y_z and a__b__c unchanged.",
    "• ₹250.00",
    "• 20% growth",
    "വരുമാനം കൂടുതൽ ആക്കുക; ചെലവ് കുറയ്ക്കുക.",
    "പഴയ ബജറ്റ് ₹500",
    "Read more",
  ].join("\n"));
});

test("formats financial bullets without changing negative amounts or numbered lists", () => {
  const text = [
    "- ₹250 for groceries",
    "* 20% savings",
    "+ ₹4,500 gym membership",
    "- -₹250.50 refund",
    "* -20% change",
    "+ - ₹30 adjustment",
    "-₹500",
    "-20%",
    "1. ₹1,000",
    "2) -₹200",
    "- ₹500 ഭക്ഷണം",
    "* 15% സേവിംഗ്സ്",
    "+ -₹75 ചെലവ്",
    "English and മലയാളം: -₹10",
  ].join("\n");
  assert.equal(formatAdvisorDisplayText(text), [
    "• ₹250 for groceries",
    "• 20% savings",
    "• ₹4,500 gym membership",
    "• -₹250.50 refund",
    "• -20% change",
    "• - ₹30 adjustment",
    "-₹500",
    "-20%",
    "1. ₹1,000",
    "2. -₹200",
    "• ₹500 ഭക്ഷണം",
    "• 15% സേവിംഗ്സ്",
    "• -₹75 ചെലവ്",
    "English and മലയാളം: -₹10",
  ].join("\n"));
});

test("screen uses reactive submission state, preserves streaming whitespace and constrains bubbles", () => {
  const screen = readFileSync(new URL("../app/advisor.tsx", import.meta.url), "utf8");
  assert.match(screen, /setIsSubmitting\(true\)/);
  assert.match(screen, /isSubmittingRef\.current = false;\s*if \(isMountedRef\.current\) \{\s*setIsSubmitting\(false\)/);
  assert.match(screen, /canPlayAdvisorSpeech\(\{/);
  assert.match(screen, /fullText\.trim\(\)\.match\(\/\\S\+\\s\*\/g\)/);
  assert.match(screen, /formatAdvisorDisplayText\(message\.text\)/);
  assert.match(screen, /width: isUser \? undefined : "88%"/);
  assert.match(screen, /minHeight: 44,\s*minWidth: 100,\s*maxWidth: "100%"/);
  assert.match(screen, /onPress=\{\(\) => void handleAdvisorSpeech\(speechKey, message\.text\)\}/);
  assert.match(screen, /void submitMessage\(question\)/);
});
