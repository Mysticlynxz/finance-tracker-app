import { Audio } from "expo-av";
import { Platform } from "react-native";
import { useEffect, useRef, useState } from "react";

export function useAudioRecorder(onUnmountRecording?: (audioUri: string | null) => void) {
  const MIN_RECORDING_MS = 600;
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [audioUri, setAudioUri] = useState<string | null>(null);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const startPromiseRef = useRef<Promise<void> | null>(null);
  const isStoppingRef = useRef(false);
  const recordingStartedAtRef = useRef<number | null>(null);
  const onUnmountRecordingRef = useRef(onUnmountRecording);
  onUnmountRecordingRef.current = onUnmountRecording;

  useEffect(() => {
    recordingRef.current = recording;
  }, [recording]);

  useEffect(() => {
    return () => {
      const activeRecording = recordingRef.current;

      if (activeRecording && !isStoppingRef.current) {
        isStoppingRef.current = true;
        const audioUri = activeRecording.getURI();
        void activeRecording
          .stopAndUnloadAsync()
          .catch(() => undefined)
          .finally(() => {
            isStoppingRef.current = false;
            if (!audioUri) return;
            try {
              onUnmountRecordingRef.current?.(audioUri);
            } catch (error) {
              console.warn("[Voice Recorder] Unable to remove the unmounted recording.", error);
            }
          });
      }

      if (Platform.OS !== "web") {
        void Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
        }).catch(() => undefined);
      }
    };
  }, []);

  const startRecording = async () => {
    if (Platform.OS === "web") {
      throw new Error("Voice expense capture is supported in the SpendWise mobile app.");
    }

    if (isStoppingRef.current) {
      throw new Error("Please wait for the current recording to finish.");
    }

    if (recordingRef.current) {
      throw new Error("A recording is already in progress.");
    }

    if (startPromiseRef.current) {
      await startPromiseRef.current;
      return;
    }

    const startPromise = (async () => {
      let newRecording: Audio.Recording | null = null;
      try {
        const permission = await Audio.requestPermissionsAsync();
        if (!permission.granted) {
          throw new Error(
            "Microphone permission is required to record an expense. Allow microphone access in your device settings and try again."
          );
        }

        await Audio.setAudioModeAsync({
          allowsRecordingIOS: true,
          playsInSilentModeIOS: true,
        });

        newRecording = new Audio.Recording();
        await newRecording.prepareToRecordAsync({
          android: {
            extension: ".m4a",
            outputFormat: Audio.AndroidOutputFormat.MPEG_4,
            audioEncoder: Audio.AndroidAudioEncoder.AAC,
            sampleRate: 44100,
            numberOfChannels: 1,
            bitRate: 128000,
          },
          ios: {
            extension: ".m4a",
            outputFormat: Audio.IOSOutputFormat.MPEG4AAC,
            audioQuality: Audio.IOSAudioQuality.HIGH,
            sampleRate: 44100,
            numberOfChannels: 1,
            bitRate: 128000,
            linearPCMBitDepth: 16,
            linearPCMIsBigEndian: false,
            linearPCMIsFloat: false,
          },
          web: {},
          isMeteringEnabled: false,
        });
        await newRecording.startAsync();

        recordingStartedAtRef.current = Date.now();
        recordingRef.current = newRecording;
        setAudioUri(null);
        setRecording(newRecording);
      } catch (error) {
        if (newRecording) {
          await newRecording.stopAndUnloadAsync().catch(() => undefined);
        }
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          playsInSilentModeIOS: true,
        }).catch(() => undefined);
        throw error instanceof Error
          ? new Error(`Unable to start recording: ${error.message}`)
          : new Error("Unable to start recording. Check microphone permission and try again.");
      }
    })();

    startPromiseRef.current = startPromise;
    try {
      await startPromise;
    } finally {
      if (startPromiseRef.current === startPromise) {
        startPromiseRef.current = null;
      }
    }
  };

  const stopRecording = async (): Promise<string | null> => {
    if (isStoppingRef.current) {
      return null;
    }

    isStoppingRef.current = true;
    let activeRecording: Audio.Recording | null = null;

    try {
      if (!recordingRef.current && startPromiseRef.current) {
        await startPromiseRef.current.catch(() => undefined);
      }

      activeRecording = recordingRef.current;

      if (!activeRecording) {
        return null;
      }

      const startedAt = recordingStartedAtRef.current;
      if (startedAt) {
        const elapsed = Date.now() - startedAt;
        if (elapsed < MIN_RECORDING_MS) {
          const waitMs = MIN_RECORDING_MS - elapsed;
          await new Promise((resolve) => setTimeout(resolve, waitMs));
        }
      }

      try {
        await activeRecording.stopAndUnloadAsync();
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 250));
        await activeRecording.stopAndUnloadAsync();
      }

      const statusAfterStop = await activeRecording.getStatusAsync();
      const uri = activeRecording.getURI() ?? ("uri" in statusAfterStop ? statusAfterStop.uri ?? null : null);
      if (!uri) {
        throw new Error("The recording finished, but no audio file was created.");
      }

      recordingRef.current = null;
      recordingStartedAtRef.current = null;
      setRecording(null);
      setAudioUri(uri ?? null);

      return uri ?? null;
    } catch (error) {
      if (activeRecording) {
        await activeRecording.stopAndUnloadAsync().catch(() => undefined);
      }
      recordingRef.current = null;
      setRecording(null);
      throw error instanceof Error
        ? new Error(`Unable to finish recording: ${error.message}`)
        : new Error("Unable to finish recording. Please try again.");
    } finally {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      }).catch(() => undefined);
      recordingStartedAtRef.current = null;
      isStoppingRef.current = false;
      startPromiseRef.current = null;
    }
  };

  return {
    recording,
    audioUri,
    startRecording,
    stopRecording,
  };
}
