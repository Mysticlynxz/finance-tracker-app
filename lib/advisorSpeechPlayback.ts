import {
  createAudioPlayer,
  setAudioModeAsync,
  type AudioPlayer,
  type AudioStatus,
} from "expo-audio";
import { File, Paths } from "expo-file-system";
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

type PlaybackListener = (state: AdvisorSpeechPlaybackState) => void;
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
  private audioFile: File | null = null;
  private messageKey: string | null = null;
  private sessionKey: string | null = null;
  private listener: PlaybackListener | null = null;
  private sessionIsCurrent: AudioSessionCheck | null = null;
  private operation = 0;

  hasCachedAudio(messageKey: string, sessionKey: string) {
    return Boolean(
      this.audioFile?.exists &&
        this.messageKey === messageKey &&
        this.sessionKey === sessionKey
    );
  }

  async play(
    messageKey: string,
    sessionKey: string,
    audio: AdvisorSpeechAudio,
    listener: PlaybackListener,
    sessionIsCurrent: AudioSessionCheck
  ) {
    if (audio.mimeType !== "audio/mpeg") {
      throw new Error("FinBot returned an unsupported audio format.");
    }
    const bytes = decodeAdvisorSpeechBase64(audio.audioBase64);
    if (bytes.byteLength !== audio.byteLength) {
      throw new Error("FinBot returned an invalid audio response.");
    }

    this.clear();
    const operation = ++this.operation;
    const file = new File(
      Paths.cache,
      `finbot-speech-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}.mp3`
    );
    try {
      file.write(bytes);
    } catch (error) {
      if (file.exists) file.delete();
      throw error;
    }

    listener("loading");
    try {
      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
        interruptionMode: "doNotMix",
        shouldPlayInBackground: false,
        shouldRouteThroughEarpiece: false,
      });
    } catch (error) {
      if (file.exists) file.delete();
      throw error;
    }
    if (operation !== this.operation || !sessionIsCurrent()) {
      if (file.exists) file.delete();
      return;
    }

    this.audioFile = file;
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
    if (this.player) {
      const player = this.player;
      await player.seekTo(0);
      if (operation !== this.operation || !sessionIsCurrent()) return false;
      listener("playing");
      player.play();
    } else {
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
    }
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
    const file = this.audioFile;
    this.audioFile = null;
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
      if (file?.exists) file.delete();
    } catch (error) {
      cleanupError ??= error;
    }
    if (cleanupError) throw cleanupError;
  }

  private createAndPlay(operation: number) {
    if (operation !== this.operation || !this.audioFile) return;
    const player = createAudioPlayer(this.audioFile.uri, { updateInterval: 300 });
    this.player = player;
    this.playerSubscription = player.addListener(
      "playbackStatusUpdate",
      (status: AudioStatus) => {
        if (operation !== this.operation) return;
        if (!this.sessionIsCurrent?.()) {
          this.clear();
          return;
        }
        if (status.didJustFinish) {
          this.listener?.("finished");
          this.disposePlayer();
        } else if (status.isLoaded && status.playing) {
          this.listener?.("playing");
        }
      }
    );
    player.play();
  }

  private disposePlayer() {
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
