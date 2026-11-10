import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import vm from "node:vm";
import { isValidMp3 } from "../functions/ai-advisor/mp3Validation.js";
import { invalidMp3Cases, metadataMp3Cases, silentMp3, taggedSilentMp3, validMp3Cases } from "./fixtures/ttsMp3Cases.mjs";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const createPlaybackModule = ({ initiallyLoaded = true, failWrite = false, failPlayer = false } = {}) => {
  const files = new Map();
  const players = [];
  const audioModes = [];

  class File {
    constructor(directory, name) {
      this.uri = `${directory.uri}/${name}`;
    }

    get exists() {
      return files.has(this.uri);
    }

    get size() {
      return files.get(this.uri)?.length ?? 0;
    }

    write(bytes) {
      if (failWrite) throw new Error("storage failure");
      files.set(this.uri, Uint8Array.from(bytes));
    }

    delete() {
      files.delete(this.uri);
    }
  }

  class Player {
    constructor(source, options) {
      this.source = source;
      this.options = options;
      this.listeners = new Set();
      this.playCount = 0;
      this.pauseCount = 0;
      this.removeCount = 0;
      this.seekCount = 0;
      this.isLoaded = initiallyLoaded;
      players.push(this);
    }

    addListener(_event, listener) {
      this.listeners.add(listener);
      return { remove: () => this.listeners.delete(listener) };
    }

    play() {
      this.playCount += 1;
      for (const listener of this.listeners) {
        listener({ isLoaded: true, playing: true, didJustFinish: false });
      }
    }

    pause() {
      this.pauseCount += 1;
    }

    remove() {
      this.removeCount += 1;
    }

    async seekTo(position) {
      this.seekCount += 1;
      assert.equal(position, 0);
    }

    finish() {
      for (const listener of this.listeners) {
        listener({ isLoaded: true, playing: false, didJustFinish: true });
      }
    }

    load() {
      this.isLoaded = true;
      for (const listener of this.listeners) {
        listener({ isLoaded: true, playing: false, didJustFinish: false });
      }
    }
  }

  const dependencies = {
    "expo-audio": {
      createAudioPlayer: (source, options) => {
        if (failPlayer) throw new Error("player failure");
        return new Player(source, options);
      },
      setAudioModeAsync: async (mode) => audioModes.push(mode),
    },
    "expo-file-system": {
      File,
      Paths: { cache: { uri: "file:///cache" } },
    },
    "./appwrite": { MAX_ADVISOR_SPEECH_AUDIO_BYTES: 512 * 1024 },
    "../functions/ai-advisor/mp3Validation": { isValidMp3 },
  };
  const source = readFileSync(
    new URL("../lib/advisorSpeechPlayback.ts", import.meta.url),
    "utf8"
  );
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
    require: (name) => {
      if (dependencies[name]) return dependencies[name];
      throw new Error(`Unexpected dependency: ${name}`);
    },
    console,
    setTimeout,
    clearTimeout,
  });
  return { ...module.exports, files, players, audioModes };
};

const makeAudio = (bytes = silentMp3) => ({
  audioBase64: Buffer.from(bytes).toString("base64"),
  mimeType: "audio/mpeg",
  byteLength: bytes.length,
});

test("decodes Base64 into MP3 bytes and rejects malformed or oversized data", () => {
  const playback = createPlaybackModule();
  assert.deepEqual(
    Array.from(playback.decodeAdvisorSpeechBase64("AQID")),
    [1, 2, 3]
  );
  assert.throws(() => playback.decodeAdvisorSpeechBase64("%%%="), /invalid audio data/);
  const oversized = Buffer.alloc(512 * 1024 + 1).toString("base64");
  assert.throws(() => playback.decodeAdvisorSpeechBase64(oversized), /too large/);
});

test("plays without any microphone permission API and uses a playback-only audio mode", async () => {
  const playback = createPlaybackModule();
  const controller = new playback.AdvisorSpeechPlayback();
  const states = [];
  await controller.play("message-a", "session-a", makeAudio(), (state) => states.push(state), () => true);

  assert.equal(playback.files.size, 1);
  assert.deepEqual(Array.from(playback.files.values())[0], new Uint8Array(silentMp3));
  assert.equal(playback.players.length, 1);
  assert.equal(playback.players[0].playCount, 1);
  assert.equal(playback.players[0].options.updateInterval, 300);
  assert.equal(playback.audioModes[0].allowsRecording, false);
  assert.equal(playback.audioModes[0].shouldPlayInBackground, false);
  assert.deepEqual(states, ["loading", "playing"]);
});

test("stop and replay reuse cached audio, and completion retains it for replay", async () => {
  const playback = createPlaybackModule();
  const controller = new playback.AdvisorSpeechPlayback();
  const states = [];
  const listener = (state) => states.push(state);
  await controller.play("message-a", "session-a", makeAudio(), listener, () => true);
  const firstPlayer = playback.players[0];
  controller.stop();
  assert.equal(firstPlayer.pauseCount, 1);
  assert.equal(firstPlayer.removeCount, 1);
  assert.equal(playback.files.size, 1);
  assert.ok(controller.hasCachedAudio("message-a", "session-a"));

  await controller.replay("message-a", "session-a", listener, () => true);
  assert.equal(playback.players.length, 2);
  assert.equal(playback.players[1].playCount, 1);
  playback.players[1].finish();
  assert.equal(playback.players[1].removeCount, 1);
  assert.equal(playback.files.size, 1);

  await controller.replay("message-a", "session-a", listener, () => true);
  assert.equal(playback.players.length, 3);
  assert.equal(playback.players[2].playCount, 1);
});

test("switching responses removes the previous player and cached file", async () => {
  const playback = createPlaybackModule();
  const controller = new playback.AdvisorSpeechPlayback();
  await controller.play("message-a", "session-a", makeAudio(), () => {}, () => true);
  const previousFile = [...playback.files.keys()][0];
  const previousPlayer = playback.players[0];

  await controller.play("message-b", "session-a", makeAudio(taggedSilentMp3), () => {}, () => true);
  assert.equal(playback.files.has(previousFile), false);
  assert.equal(playback.files.size, 1);
  assert.equal(previousPlayer.removeCount, 1);
  assert.ok(controller.hasCachedAudio("message-b", "session-a"));
  controller.clear();
  controller.clear();
  assert.equal(playback.files.size, 0);
  assert.equal(playback.players[1].removeCount, 1);
});

test("plays segments sequentially and replays from the first segment", async () => {
  const playback = createPlaybackModule();
  const controller = new playback.AdvisorSpeechPlayback();
  const states = [];
  await controller.play("message", "session", [makeAudio(), makeAudio(taggedSilentMp3)],
    (state) => states.push(state), () => true);
  assert.equal(playback.players.length, 1);
  playback.players[0].finish();
  assert.equal(playback.players.length, 2);
  assert.equal(playback.players[1].playCount, 1);
  playback.players[1].finish();
  assert.equal(states.at(-1), "finished");
  await controller.replay("message", "session", (state) => states.push(state), () => true);
  assert.equal(playback.players.length, 3);
  controller.clear();
  assert.equal(playback.files.size, 0);
});

test("waits for the player to load before starting playback", async () => {
  const playback = createPlaybackModule({ initiallyLoaded: false });
  const controller = new playback.AdvisorSpeechPlayback();
  await controller.play("m", "s", makeAudio(), () => {}, () => true);
  assert.equal(playback.players[0].playCount, 0);
  playback.players[0].load();
  assert.equal(playback.players[0].playCount, 1);
  controller.clear();
});

test("rejects non-MP3 decoded bytes", async () => {
  const playback = createPlaybackModule();
  const controller = new playback.AdvisorSpeechPlayback();
  await assert.rejects(controller.play("m", "s", makeAudio([1, 2, 3]), () => {}, () => true), /invalid MP3/);
  assert.equal(playback.files.size, 0);
});

test("validates complete MP3 frames and optional ID3 before playback", async () => {
  for (const valid of validMp3Cases) {
    const playback = createPlaybackModule();
    const controller = new playback.AdvisorSpeechPlayback();
    await controller.play("m", "s", makeAudio(valid), () => {}, () => true);
    assert.equal(playback.players.length, 1);
    controller.clear();
  }
  for (const [label, invalid] of invalidMp3Cases) {
    const playback = createPlaybackModule();
    const controller = new playback.AdvisorSpeechPlayback();
    await assert.rejects(controller.play("m", "s", makeAudio(invalid), () => {}, () => true),
      /invalid (MP3|audio)|too large/, label);
    assert.equal(playback.players.length, 0, label);
  }
});

test("accepts each ID3 variant and rejects truncated frames before playback", async () => {
  for (const [label, audio] of metadataMp3Cases) {
    const playback = createPlaybackModule();
    const controller = new playback.AdvisorSpeechPlayback();
    await controller.play("m", "s", makeAudio(audio), () => {}, () => true);
    assert.equal(playback.players.length, 1, label);
    controller.clear();
    await assert.rejects(
      controller.play("m", "s", makeAudio(audio.subarray(0, -1)), () => {}, () => true),
      /invalid MP3/, label
    );
    assert.equal(playback.players.length, 1, label);
  }
});

test("reports file writing and player initialization errors distinctly", async () => {
  const fileFailure = createPlaybackModule({ failWrite: true });
  const fileController = new fileFailure.AdvisorSpeechPlayback();
  await assert.rejects(fileController.play("m", "s", makeAudio(), () => {}, () => true),
    /write FinBot audio/);
  assert.equal(fileFailure.files.size, 0);

  const playerFailure = createPlaybackModule({ failPlayer: true });
  const playerController = new playerFailure.AdvisorSpeechPlayback();
  const errors = [];
  await playerController.play("m", "s", makeAudio(), (_state, error) => {
    if (error) errors.push(error);
  }, () => true);
  assert.match(errors[0], /initialize audio playback/);
  playerController.clear();
});

test("stale playback callbacks clear the player and temporary file", async () => {
  const playback = createPlaybackModule();
  const controller = new playback.AdvisorSpeechPlayback();
  let current = true;
  const states = [];
  await controller.play("message-a", "session-a", makeAudio(), (state) => states.push(state), () => current);
  current = false;
  playback.players[0].finish();
  assert.equal(playback.files.size, 0);
  assert.equal(playback.players[0].removeCount, 1);
  assert.equal(states.at(-1), "idle");
});

test("advisor UI gates speech to completed replies and cleans audio on blur and before recording", () => {
  const source = readFileSync(new URL("../app/advisor.tsx", import.meta.url), "utf8");
  assert.match(source, /!isUser && message\.text\.trim\(\) && !isStreaming/);
  assert.match(source, /voiceState\.stage !== "idle"/);
  assert.match(source, /requestAdvisorSpeech\(segment, session\)/);

  const blurIndex = source.indexOf("isAdvisorFocusedRef.current = false;");
  const blurCleanupIndex = source.indexOf("speechPlaybackRef.current.clear();", blurIndex);
  assert.ok(blurIndex >= 0);
  assert.ok(blurCleanupIndex > blurIndex);

  const voiceHandlerIndex = source.indexOf("const handleVoicePress = async () =>");
  const voiceCleanupIndex = source.indexOf("speechPlaybackRef.current.clear();", voiceHandlerIndex);
  const recordingStartIndex = source.indexOf("await startRecording();", voiceHandlerIndex);
  assert.ok(voiceCleanupIndex > voiceHandlerIndex);
  assert.ok(recordingStartIndex > voiceCleanupIndex);
  assert.equal(source.includes('mode: "extract-expense"'), false);
});
