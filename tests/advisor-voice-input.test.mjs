import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const loadVoiceHelper = (
  transcribe = async (uri) => ({ transcript: `Transcript for ${uri}` })
) => {
  const source = readFileSync(new URL("../lib/advisorVoiceInput.ts", import.meta.url), "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const module = { exports: {} };
  const removedLocalFiles = [];
  const warnings = [];
  vm.runInNewContext(transpiled, {
    exports: module.exports,
    module,
    console: { warn: (...args) => warnings.push(args) },
    require: (name) => {
      if (name === "./voiceTranscription") {
        return { transcribeAudioUri: transcribe };
      }
      if (name === "expo-file-system") {
        return {
          File: class {
            constructor(uri) { this.uri = uri; }
            delete() { removedLocalFiles.push(this.uri); }
          },
        };
      }
      if (name === "./authSessionGuard") return {};
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  return { ...module.exports, removedLocalFiles, warnings };
};

const loadConfirmation = () => {
  const source = readFileSync(new URL("../lib/advisorVoiceConfirmation.ts", import.meta.url), "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(transpiled, {
    exports: module.exports,
    module,
    require: () => ({}),
  });
  return module.exports;
};

const loadAudioRecorderHook = (permissionGranted, onUnmountRecording) => {
  const source = readFileSync(new URL("../lib/useAudioRecorder.ts", import.meta.url), "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const state = [];
  const refs = [];
  const effects = [];
  let hookIndex = 0;
  const audioCalls = [];
  class Recording {
    async prepareToRecordAsync() { audioCalls.push("prepare"); }
    async startAsync() { audioCalls.push("start"); }
    async stopAndUnloadAsync() { audioCalls.push("stop"); }
    async getStatusAsync() { return { uri: "file:///voice-question.m4a" }; }
    getURI() { return "file:///voice-question.m4a"; }
  }
  const audio = {
    AndroidOutputFormat: { MPEG_4: "mpeg4" },
    AndroidAudioEncoder: { AAC: "aac" },
    IOSOutputFormat: { MPEG4AAC: "aac" },
    IOSAudioQuality: { HIGH: "high" },
    async requestPermissionsAsync() {
      audioCalls.push("permission");
      return { granted: permissionGranted };
    },
    async setAudioModeAsync(mode) { audioCalls.push(["mode", mode]); },
    Recording,
  };
  const react = {
    useState(initial) {
      const index = hookIndex++;
      state[index] ??= initial;
      return [state[index], (next) => {
        state[index] = typeof next === "function" ? next(state[index]) : next;
      }];
    },
    useRef(initial) {
      const index = hookIndex++;
      refs[index] ??= { current: initial };
      return refs[index];
    },
    useEffect(effect) {
      hookIndex++;
      effects.push(effect);
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(transpiled, {
    exports: module.exports,
    module,
    require: (name) => {
      if (name === "expo-av") return { Audio: audio };
      if (name === "react-native") return { Platform: { OS: "android" } };
      if (name === "react") return react;
      throw new Error(`Unexpected dependency: ${name}`);
    },
    setTimeout: (callback) => {
      callback();
      return 0;
    },
    clearTimeout() {},
  });
  const hook = module.exports.useAudioRecorder(onUnmountRecording);
  const cleanups = effects.map((effect) => effect()).filter((cleanup) => typeof cleanup === "function");
  return {
    hook,
    audioCalls,
    unmount: () => cleanups.forEach((cleanup) => cleanup()),
  };
};

test("advisor voice transcription returns text without submitting it and removes the local recording", async () => {
  const calls = [];
  const { transcribeAdvisorVoice } = loadVoiceHelper(async (uri) => {
    calls.push(["transcribe", uri]);
    return { transcript: "  How can I save more?  " };
  });
  const session = { userId: "user-a", sessionId: "session-a", generation: 1 };
  const transcript = await transcribeAdvisorVoice("recording-uri", session, {
    isSessionCurrent: async (identity) => identity === session,
    removeLocalRecording: (uri) => calls.push(["delete-local", uri]),
  });

  assert.equal(transcript, "How can I save more?");
  assert.deepEqual(calls, [
    ["transcribe", "recording-uri"],
    ["delete-local", "recording-uri"],
  ]);
  assert.doesNotMatch(
    readFileSync(new URL("../lib/advisorVoiceInput.ts", import.meta.url), "utf8"),
    /askFinancialAdvisor|submitMessage/
  );
});

test("advisor voice transcription skips stale sessions and rejects empty transcripts", async () => {
  let transcriptions = 0;
  const { transcribeAdvisorVoice } = loadVoiceHelper(async () => {
    transcriptions++;
    return { transcript: "hello" };
  });
  const session = { userId: "user-a", sessionId: "session-a", generation: 1 };
  const removed = [];
  const dependencies = {
    isSessionCurrent: async () => false,
    removeLocalRecording: (uri) => removed.push(uri),
  };
  assert.equal(
    await transcribeAdvisorVoice("recording-uri", session, dependencies),
    null
  );
  assert.equal(transcriptions, 0);
  assert.deepEqual(removed, ["recording-uri"]);

  const emptyTranscriptHelper = loadVoiceHelper(async () => {
    transcriptions++;
    return { transcript: "  " };
  }).transcribeAdvisorVoice;
  await assert.rejects(
    emptyTranscriptHelper("recording-uri", session, {
      ...dependencies,
      isSessionCurrent: async () => true,
    }),
    /No speech was detected/
  );
  assert.deepEqual(removed, ["recording-uri", "recording-uri"]);
});

test("advisor voice flow discards a transcript if the session changes during transcription", async () => {
  const { transcribeAdvisorVoice } = loadVoiceHelper(async () => ({
    transcript: "Private spoken question",
  }));
  const session = { userId: "user-a", sessionId: "session-a", generation: 1 };
  let checks = 0;
  let localCleanup = 0;
  const transcript = await transcribeAdvisorVoice("recording-uri", session, {
    isSessionCurrent: async () => ++checks === 1,
    removeLocalRecording: () => { localCleanup++; },
  });
  assert.equal(transcript, null);
  assert.equal(checks, 2);
  assert.equal(localCleanup, 1);
});

test("transcription failures clean the local recording and preserve the original error", async () => {
  const { transcribeAdvisorVoice, warnings } = loadVoiceHelper(async () => {
    throw new Error("Gnani unavailable");
  });
  let cleanupCalls = 0;
  await assert.rejects(
    transcribeAdvisorVoice("recording-uri", {
      userId: "user-a",
      sessionId: "session-a",
      generation: 1,
    }, {
      isSessionCurrent: async () => true,
      removeLocalRecording: () => {
        cleanupCalls++;
        throw new Error("Local deletion failed");
      },
    }),
    /Gnani unavailable/
  );
  assert.equal(cleanupCalls, 1);
  assert.equal(warnings.length, 1);
});

test("advisor voice state reducer models each processing and confirmation stage", () => {
  const {
    advisorVoiceReducer,
    initialAdvisorVoiceState,
  } = loadVoiceHelper();
  const stages = [
    ["recording", { type: "recording", elapsedMs: 1200 }],
    ["preparing", { type: "preparing" }],
    ["transcribing", { type: "transcribing" }],
    ["review", { type: "ready", transcript: "Recognized question" }],
    ["sending", { type: "sending" }],
    ["responding", { type: "responding" }],
  ];
  let state = initialAdvisorVoiceState;
  for (const [expectedStage, action] of stages) {
    state = advisorVoiceReducer(state, action);
    assert.equal(state.stage, expectedStage);
  }
  assert.equal(
    advisorVoiceReducer(state, { type: "reset" }).transcript,
    ""
  );
  assert.equal(
    advisorVoiceReducer(state, { type: "error", message: "Failed" }).stage,
    "idle"
  );
  const corrected = advisorVoiceReducer(
    advisorVoiceReducer(initialAdvisorVoiceState, {
      type: "ready",
      transcript: "Recognized question",
    }),
    { type: "transcriptChanged", transcript: "Corrected question" }
  );
  assert.equal(corrected.transcript, "Corrected question");
  assert.equal(corrected.stage, "review");
});

test("Send submits the corrected transcript exactly once through the supplied shared handler", async () => {
  const { createAdvisorVoiceConfirmation } = loadConfirmation();
  const session = { userId: "user-a", sessionId: "session-a", generation: 1 };
  const submitted = [];
  const confirmation = createAdvisorVoiceConfirmation(session, {
    isSessionCurrent: async (identity) => identity === session,
    submitMessage: async (message, identity) => submitted.push([message, identity]),
  });
  const [first, duplicate] = await Promise.all([
    confirmation.send("  Corrected question  "),
    confirmation.send("Corrected question"),
  ]);
  assert.equal(first, true);
  assert.equal(duplicate, false);
  assert.deepEqual(submitted, [["Corrected question", session]]);
});

test("Cancel and empty transcripts never submit; stale sessions are rejected", async () => {
  const { createAdvisorVoiceConfirmation } = loadConfirmation();
  const session = { userId: "user-a", sessionId: "session-a", generation: 1 };
  let submissions = 0;
  const dependencies = {
    isSessionCurrent: async () => true,
    submitMessage: async () => { submissions++; },
  };
  const cancelled = createAdvisorVoiceConfirmation(session, dependencies);
  cancelled.cancel();
  assert.equal(await cancelled.send("question"), false);

  const empty = createAdvisorVoiceConfirmation(session, dependencies);
  assert.equal(await empty.send(" \n "), false);

  const stale = createAdvisorVoiceConfirmation(session, {
    ...dependencies,
    isSessionCurrent: async () => false,
  });
  assert.equal(await stale.send("question"), false);
  assert.equal(submissions, 0);
});

test("advisor screen uses editable confirmation and the shared FinBot submit path", () => {
  const source = readFileSync(new URL("../app/advisor.tsx", import.meta.url), "utf8");
  assert.match(source, /useAudioRecorder\(/);
  assert.match(source, /startRecording\(\)/);
  assert.match(source, /stopRecording\(\)/);
  assert.match(source, /transcribeAdvisorVoice/);
  assert.match(
    readFileSync(new URL("../lib/advisorVoiceInput.ts", import.meta.url), "utf8"),
    /transcribeAudioUri\(audioUri\)/
  );
  assert.match(source, /value=\{voiceState\.transcript\}/);
  assert.match(source, /dispatchVoice\(\{ type: "transcriptChanged"/);
  assert.match(source, /Send Question/);
  assert.match(source, /handleCancelTranscript/);
  assert.match(source, /createAdvisorVoiceConfirmation\(session/);
  assert.match(source, /submitMessage\(message, true, identity\)/);
  assert.match(source, /voiceConfirmationRef\.current\.send\(message\)/);
  assert.match(source, /type: "sending"/);
  assert.match(source, /type: "responding"/);
  assert.match(source, /Preparing audio…/);
  assert.match(source, /Transcribing your question with Gnani…/);
  assert.match(source, /Your question is ready to review/);
  assert.match(source, /Sending your question to FinBot…/);
  assert.match(source, /FinBot is responding…/);
  assert.match(source, /isAdvisorFocusedRef\.current = false/);
  assert.match(source, /stopRecordingRef\.current\(\)/);
  assert.match(source, /MAX_ADVISOR_RECORDING_MS = 30_000/);
  assert.match(source, /voiceTimeoutRef\.current = setTimeout/);
  assert.match(source, /clearVoiceTimeout\(\)/);
  assert.match(source, /Recording was interrupted/);
  assert.match(source, /Microphone access is off/);
  assert.match(source, /allow microphone access in your device Settings/);
  assert.match(source, /isAuthSessionGenerationCurrent\(capturedSession\)/);
  assert.match(source, /deleteAdvisorVoiceRecording/);
  assert.match(source, /AccessibilityInfo\.isReduceMotionEnabled/);
  assert.match(source, /Animated\.loop/);
  assert.doesNotMatch(source, /requestExpenseExtractionReply|saveVoiceExpenseBatch/);
});

test("advisor recording uses the existing permission flow, stop/cancel cleanup, and a 30-second cap", () => {
  const screenSource = readFileSync(new URL("../app/advisor.tsx", import.meta.url), "utf8");
  const recorderSource = readFileSync(new URL("../lib/useAudioRecorder.ts", import.meta.url), "utf8");
  const start = recorderSource.indexOf("const startRecording = async");
  const permissionRequest = recorderSource.indexOf("Audio.requestPermissionsAsync()", start);
  const stop = recorderSource.indexOf("const stopRecording = async");
  assert.ok(start >= 0 && permissionRequest > start && permissionRequest < stop);
  assert.match(recorderSource, /if \(!permission\.granted\)/);
  assert.match(screenSource, /await startRecording\(\)/);
  assert.match(screenSource, /await stopRecording\(\)/);
  assert.match(screenSource, /handleCancelVoiceRecording/);
  assert.match(screenSource, /MAX_ADVISOR_RECORDING_MS = 30_000/);
  assert.match(screenSource, /setTimeout\(\(\) => \{\s*voiceStopHandlerRef\.current\(\)/);
  assert.match(screenSource, /setInterval\(\(\) => \{\s*const startedAt = recordingStartedAtRef\.current/);
  assert.match(screenSource, /clearInterval\(timer\)/);
  assert.match(screenSource, /clearVoiceTimeout\(\)/);
  assert.match(screenSource, /setOnRecordingStatusUpdate/);
  assert.match(screenSource, /removeLocalRecording\(audioUri\)/);
});

test("the existing recorder requests permission on start and stops a granted recording", async () => {
  const denied = loadAudioRecorderHook(false);
  assert.equal(denied.audioCalls.includes("permission"), false);
  await assert.rejects(denied.hook.startRecording(), /Microphone permission is required/);
  assert.equal(denied.audioCalls.filter((call) => call === "permission").length, 1);
  assert.equal(denied.audioCalls.includes("start"), false);

  const granted = loadAudioRecorderHook(true);
  await granted.hook.startRecording();
  assert.equal(granted.audioCalls.filter((call) => call === "permission").length, 1);
  assert.equal(granted.audioCalls.includes("start"), true);
  assert.equal(await granted.hook.stopRecording(), "file:///voice-question.m4a");
  assert.equal(granted.audioCalls.includes("stop"), true);
});

test("the recorder unmount cleanup stops and disposes an active FinBot recording", async () => {
  const disposed = [];
  const recorder = loadAudioRecorderHook(true, (uri) => disposed.push(uri));
  await recorder.hook.startRecording();
  recorder.unmount();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(recorder.audioCalls.includes("stop"), true);
  assert.deepEqual(disposed, ["file:///voice-question.m4a"]);
});
