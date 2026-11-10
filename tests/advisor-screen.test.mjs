import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const compile = (path, dependencies, globals = {}) => {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, {
    module, exports: module.exports,
    require: (name) => {
      if (name in dependencies) return dependencies[name];
      throw new Error(`Unexpected dependency ${name}`);
    },
    console, ...globals,
  });
  return module.exports;
};

const flush = () => new Promise((resolve) => setImmediate(resolve));

function createScreen(reply, { denyMicrophone = false } = {}) {
  const states = [];
  const refs = [];
  let index = 0;
  let focus;
  let resolveAnswer;
  const timers = [];
  const requests = [];
  let microphoneRequests = 0;
  const identity = { userId: "user", sessionId: "session", generation: 1 };
  const react = {
    useState(initial) {
      const i = index++;
      if (!(i in states)) states[i] = typeof initial === "function" ? initial() : initial;
      return [states[i], (value) => { states[i] = typeof value === "function" ? value(states[i]) : value; }];
    },
    useRef(initial) {
      const i = index++;
      if (!(i in refs)) refs[i] = { current: initial };
      return refs[i];
    },
    useReducer(reducer, initial) {
      const i = index++;
      if (!(i in states)) states[i] = initial;
      return [states[i], (action) => { states[i] = reducer(states[i], action); }];
    },
    useContext: () => ({ isDarkMode: false, currency: "INR" }),
    useMemo: (factory) => { index++; return factory(); },
    useCallback: (callback) => { index++; return callback; },
    useEffect: () => { index++; },
  };
  const jsx = (type, props) => ({ type, props: props ?? {} });
  const animation = { start() {}, stop() {}, reset() {} };
  const animatedValue = class { setValue() {} interpolate() { return 0; } stopAnimation() {} };
  const native = {
    AccessibilityInfo: {}, Animated: { Value: animatedValue, View: "AnimatedView",
      spring: () => animation, timing: () => animation, sequence: () => animation, loop: () => animation },
    Easing: { linear: () => 0, inOut: () => () => 0, ease: () => 0 },
    ActivityIndicator: "ActivityIndicator", FlatList: "FlatList", Keyboard: { dismiss() {} },
    KeyboardAvoidingView: "KeyboardAvoidingView", Platform: { OS: "android" },
    Pressable: "Pressable", Text: "Text", TextInput: "TextInput", View: "View",
  };
  const presentation = compile("../lib/advisorPresentation.ts", {});
  const dependencies = {
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    react,
    "react-native": native,
    "@expo/vector-icons": { Ionicons: "Ionicons", MaterialCommunityIcons: "MaterialCommunityIcons" },
    "expo-router": { router: { back() {} }, useFocusEffect: (callback) => { focus ??= callback; } },
    "react-native-safe-area-context": { SafeAreaView: "SafeAreaView" },
    "../Context/ExpenseContext": { ExpenseContext: {} },
    "../lib/advisorPresentation": presentation,
    "../lib/useAudioRecorder": { useAudioRecorder: () => ({
      recording: null,
      startRecording: async () => {
        microphoneRequests++;
        if (denyMicrophone) throw new Error("Microphone permission is required");
      },
      stopRecording: async () => null,
    }) },
    "../lib/advisorVoiceConfirmation": {},
    "../lib/advisorVoiceInput": {
      initialAdvisorVoiceState: { stage: "idle", transcript: "", error: "", elapsedMs: 0 },
      advisorVoiceReducer: (state, action) => {
        if (action.type === "reset") return { ...state, stage: "idle", error: "" };
        if (action.type === "error") return { ...state, stage: "idle", error: action.message };
        return state;
      },
    },
    "../lib/appwrite": {
      AI_ADVISOR_FALLBACK_RESPONSE: "Unavailable",
      AdvisorSessionChangedError: class extends Error {},
      captureAuthSessionIdentity: async () => identity,
      isAuthSessionIdentityCurrent: async () => true,
      isAuthSessionGenerationCurrent: () => true,
      getAdvisorHistoryForSession: (history) => history,
      sanitizeAdvisorConversationHistory: (history) => history,
      updateAdvisorConversationHistory: (history) => history,
      askFinancialAdvisorWithStatus: () => new Promise((resolve) => { resolveAnswer = () => resolve({ ok: true, reply }); }),
      splitAdvisorSpeechText: (text) => [text],
      requestAdvisorSpeech: async (text) => { requests.push(text); return {}; },
    },
    "../lib/advisorSpeechPlayback": {
      AdvisorSpeechPlayback: class {
        clear() {} stop() {} hasCachedAudio() { return false; }
        async play(_message, _session, _audio, listener) { listener("playing"); }
      },
    },
  };
  const { default: Screen } = compile("../app/advisor.tsx", dependencies, {
    Error,
    setTimeout: (callback) => { timers.push(callback); return timers.length; },
    clearTimeout() {}, setInterval() {}, clearInterval() {},
    requestAnimationFrame() {}, cancelAnimationFrame() {},
  });
  const render = () => { index = 0; return Screen(); };
  return {
    render,
    focus: async () => { focus(); await flush(); },
    resolveAnswer: () => resolveAnswer(),
    finishTimers: async () => {
      for (let i = 0; i < 100; i++) {
        if (timers.length) timers.shift()();
        await flush();
        if (!timers.length && i > 5) break;
      }
    },
    requests,
    microphoneRequests: () => microphoneRequests,
  };
}

function find(node, predicate) {
  if (!node || typeof node !== "object") return null;
  if (predicate(node)) return node;
  for (const child of [].concat(node.props?.children ?? [])) {
    const found = find(child, predicate);
    if (found) return found;
  }
  return null;
}

test("suggested questions and typed replies become listenable after streaming", async () => {
  for (const [reply, useSuggestion] of [
    ["Your food budget is on track.\n\n1. **Plan meals.**", true],
    ["നിങ്ങളുടെ ചെലവ് നിയന്ത്രണത്തിലാണ്.", false],
  ]) {
    const screen = createScreen(reply);
    screen.render();
    await screen.focus();
    let tree = screen.render();
    let list = find(tree, (node) => node.type === "FlatList");
    if (useSuggestion) {
      const suggestion = find(list.props.ListFooterComponent, (node) =>
        node.type === "Pressable" && node.props.onPress);
      assert.ok(suggestion);
      suggestion.props.onPress();
    } else {
      const input = find(tree, (node) => node.type === "TextInput" && node.props.placeholder === "Ask about your spending...");
      input.props.onChangeText("ചെലവുകൾ എങ്ങനെ?");
      tree = screen.render();
      const send = find(tree, (node) => node.props?.accessibilityLabel === "Send message");
      assert.equal(send.props.disabled, false);
      send.props.onPress();
    }
    await flush();
    screen.resolveAnswer();
    await flush();
    tree = screen.render();
    list = find(tree, (node) => node.type === "FlatList");
    const streaming = list.props.data.at(-1);
    const streamingBubble = list.props.renderItem({ item: streaming, index: list.props.data.length - 1 });
    assert.equal(find(streamingBubble, (node) => node.props?.accessibilityLabel === "Play spoken response"), null);
    await screen.finishTimers();
    tree = screen.render();
    list = find(tree, (node) => node.type === "FlatList");
    const message = list.props.data.at(-1);
    assert.equal(message.text, reply);
    const bubble = list.props.renderItem({ item: message, index: list.props.data.length - 1 });
    const listen = find(bubble, (node) => node.props?.accessibilityLabel === "Play spoken response");
    assert.ok(listen);
    assert.equal(listen.props.disabled, false);
    listen.props.onPress();
    await flush();
    assert.equal(screen.requests[0], reply);
  }
});

test("Listen remains available when voice permission is denied on microphone press", async () => {
  const screen = createScreen("unused", { denyMicrophone: true });
  screen.render();
  await screen.focus();
  let tree = screen.render();
  assert.equal(screen.microphoneRequests(), 0);
  const microphone = find(tree, (node) => node.props?.accessibilityLabel === "Record a voice question");
  microphone.props.onPress();
  await flush();
  assert.equal(screen.microphoneRequests(), 1);
  tree = screen.render();
  assert.ok(find(tree, (node) =>
    node.type === "Text" && typeof node.props.children === "string" &&
    node.props.children.includes("Microphone access is off")));
  const list = find(tree, (node) => node.type === "FlatList");
  const bubble = list.props.renderItem({ item: list.props.data[0], index: 0 });
  const listen = find(bubble, (node) => node.props?.accessibilityLabel === "Play spoken response");
  assert.equal(listen.props.disabled, false);
  listen.props.onPress();
  await flush();
  assert.equal(screen.requests.length, 1);
  assert.equal(screen.microphoneRequests(), 1);
});
