import {
  createAudioPlayer,
  setAudioModeAsync,
  type AudioPlayer,
  type AudioStatus,
} from "expo-audio";
import { File, Paths } from "expo-file-system";
import { isValidMp3 } from "../functions/ai-advisor/mp3Validation";
import {
  MAX_ADVISOR_SPEECH_AUDIO_BYTES,
  type AdvisorSpeechAudio,
} from "./appwrite";

export type AdvisorSpeechPlaybackState =
  | "loading"
  | "playing"
  | "stopped"
  | "finished"
  | "idle";

type PlaybackListener = (state: AdvisorSpeechPlaybackState, error?: string) => void;
type AudioSessionCheck = () => boolean;

const BASE64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const MAX_BASE64_LENGTH = Math.ceil(MAX_ADVISOR_SPEECH_AUDIO_BYTES / 3) * 4;

export const decodeAdvisorSpeechBase64 = (value: string): Uint8Array => {
  if (
    !value ||
    value.length > MAX_BASE64_LENGTH ||
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) {
    throw new Error("FinBot returned invalid audio data.");
  }
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  const byteLength = (value.length / 4) * 3 - padding;
  if (byteLength <= 0 || byteLength > MAX_ADVISOR_SPEECH_AUDIO_BYTES) {
    throw new Error("FinBot returned audio that is too large.");
  }

  const bytes = new Uint8Array(byteLength);
  let outputIndex = 0;
  for (let index = 0; index < value.length; index += 4) {
    const first = BASE64_ALPHABET.indexOf(value[index]);
    const second = BASE64_ALPHABET.indexOf(value[index + 1]);
    const third = value[index + 2] === "=" ? 0 : BASE64_ALPHABET.indexOf(value[index + 2]);
    const fourth = value[index + 3] === "=" ? 0 : BASE64_ALPHABET.indexOf(value[index + 3]);
    const chunk = (first << 18) | (second << 12) | (third << 6) | fourth;
    if (outputIndex < byteLength) bytes[outputIndex++] = (chunk >> 16) & 0xff;
    if (outputIndex < byteLength) bytes[outputIndex++] = (chunk >> 8) & 0xff;
    if (outputIndex < byteLength) bytes[outputIndex++] = chunk & 0xff;
  }
  return bytes;
};

export class AdvisorSpeechPlayback {
  private player: AudioPlayer | null = null;
  private playerSubscription: { remove: () => void } | null = null;
  private audioFiles: File[] = [];
  private audioIndex = 0;
  private loadTimer: ReturnType<typeof setTimeout> | null = null;
  private messageKey: string | null = null;
  private sessionKey: string | null = null;
  private listener: PlaybackListener | null = null;
  private sessionIsCurrent: AudioSessionCheck | null = null;
  private operation = 0;

  hasCachedAudio(messageKey: string, sessionKey: string) {
    return Boolean(
      this.audioFiles.length > 0 &&
        this.audioFiles.every((file) => file.exists) &&
        this.messageKey === messageKey &&
        this.sessionKey === sessionKey
    );
  }

  async play(
    messageKey: string,
    sessionKey: string,
    audio: AdvisorSpeechAudio | AdvisorSpeechAudio[],
    listener: PlaybackListener,
    sessionIsCurrent: AudioSessionCheck
  ) {
    this.clear();
    const operation = ++this.operation;
    const files: File[] = [];
    try {
      const segments = Array.isArray(audio) ? audio : [audio];
      if (!segments.length) throw new Error("FinBot returned no audio.");
      for (const segment of segments) {
        if (segment.mimeType !== "audio/mpeg") {
          throw new Error("FinBot returned an unsupported audio format.");
        }
        const bytes = decodeAdvisorSpeechBase64(segment.audioBase64);
        if (bytes.byteLength !== segment.byteLength) {
          throw new Error("FinBot returned an invalid audio response.");
        }
        if (!isValidMp3(bytes)) throw new Error("FinBot returned invalid MP3 audio.");
        const file = new File(
          Paths.cache,
          `finbot-speech-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}.mp3`
        );
        files.push(file);
        try {
          file.write(bytes);
          if (!file.exists || file.size !== bytes.byteLength) throw new Error("Incomplete file");
        } catch {
          throw new Error("Unable to write FinBot audio to device storage.");
        }
      }
    } catch (error) {
      for (const file of files) if (file.exists) file.delete();
      throw error;
    }

    listener("loading");
    try {
      try {
        await setAudioModeAsync({
          allowsRecording: false,
          playsInSilentMode: true,
          interruptionMode: "doNotMix",
          shouldPlayInBackground: false,
          shouldRouteThroughEarpiece: false,
        });
      } catch {
        throw new Error("Unable to initialize the audio session.");
      }
    } catch {
      for (const file of files) if (file.exists) file.delete();
      throw new Error("Unable to initialize the audio session.");
    }
    if (operation !== this.operation || !sessionIsCurrent()) {
      for (const file of files) if (file.exists) file.delete();
      return;
    }

    this.audioFiles = files;
    this.audioIndex = 0;
    this.messageKey = messageKey;
    this.sessionKey = sessionKey;
    this.listener = listener;
    this.sessionIsCurrent = sessionIsCurrent;
    this.createAndPlay(operation);
  }

  async replay(
    messageKey: string,
    sessionKey: string,
    listener: PlaybackListener,
    sessionIsCurrent: AudioSessionCheck
  ) {
    if (!this.hasCachedAudio(messageKey, sessionKey)) return false;
    if (!sessionIsCurrent()) {
      this.clear();
      return false;
    }

    this.listener = listener;
    this.sessionIsCurrent = sessionIsCurrent;
    const operation = ++this.operation;
    this.disposePlayer();
    this.audioIndex = 0;
    listener("loading");
    await setAudioModeAsync({
      allowsRecording: false,
      playsInSilentMode: true,
      interruptionMode: "doNotMix",
      shouldPlayInBackground: false,
      shouldRouteThroughEarpiece: false,
    });
    if (operation !== this.operation || !sessionIsCurrent()) return false;
    this.createAndPlay(operation);
    return true;
  }

  stop() {
    this.operation += 1;
    this.disposePlayer();
    this.listener?.("stopped");
  }

  clear() {
    this.operation += 1;
    let cleanupError: unknown;
    try {
      this.disposePlayer();
    } catch (error) {
      cleanupError = error;
    }
    const files = this.audioFiles;
    this.audioFiles = [];
    this.audioIndex = 0;
    this.messageKey = null;
    this.sessionKey = null;
    this.sessionIsCurrent = null;
    try {
      this.listener?.("idle");
    } catch (error) {
      cleanupError ??= error;
    }
    this.listener = null;
    try {
      for (const file of files) if (file.exists) file.delete();
    } catch (error) {
      cleanupError ??= error;
    }
    if (cleanupError) throw cleanupError;
  }

  private createAndPlay(operation: number) {
    const file = this.audioFiles[this.audioIndex];
    if (operation !== this.operation || !file) return;
    let player: AudioPlayer;
    try {
      player = createAudioPlayer(file.uri, { updateInterval: 300 });
    } catch {
      this.listener?.("idle", "Unable to initialize audio playback.");
      return;
    }
    this.player = player;
    let started = false;
    const start = () => {
      if (started || operation !== this.operation) return;
      started = true;
      if (this.loadTimer) clearTimeout(this.loadTimer);
      this.loadTimer = setTimeout(() => {
        if (operation !== this.operation) return;
        this.disposePlayer();
        this.listener?.("idle", "Audio playback did not start.");
      }, 15_000);
      try {
        player.play();
      } catch {
        this.disposePlayer();
        this.listener?.("idle", "Unable to start audio playback.");
      }
    };
    this.playerSubscription = player.addListener(
      "playbackStatusUpdate",
      (status: AudioStatus) => {
        if (operation !== this.operation) return;
        if (!this.sessionIsCurrent?.()) {
          this.clear();
          return;
        }
        if (status.didJustFinish) {
          this.disposePlayer();
          this.audioIndex += 1;
          if (this.audioIndex < this.audioFiles.length) {
            this.listener?.("loading");
            this.createAndPlay(operation);
          } else {
            this.listener?.("finished");
          }
        } else if (status.isLoaded && !started) {
          start();
        } else if (status.isLoaded && status.playing) {
          if (this.loadTimer) clearTimeout(this.loadTimer);
          this.loadTimer = null;
          this.listener?.("playing");
        }
      }
    );
    this.loadTimer = setTimeout(() => {
      if (operation !== this.operation || started) return;
      this.disposePlayer();
      this.listener?.("idle", "Audio playback could not be loaded.");
    }, 15_000);
    if (player.isLoaded) start();
  }

  private disposePlayer() {
    if (this.loadTimer) clearTimeout(this.loadTimer);
    this.loadTimer = null;
    let cleanupError: unknown;
    try {
      this.playerSubscription?.remove();
    } catch (error) {
      cleanupError = error;
    }
    this.playerSubscription = null;
    const player = this.player;
    this.player = null;
    if (!player) {
      if (cleanupError) throw cleanupError;
      return;
    }
    try {
      player.pause();
    } catch (error) {
      cleanupError ??= error;
    }
    try {
      player.remove();
    } catch (error) {
      cleanupError ??= error;
    }
    if (cleanupError) throw cleanupError;
  }
}
