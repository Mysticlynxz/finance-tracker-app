import { Audio } from "expo-av";
import { useEffect, useRef, useState } from "react";

export function useAudioRecorder() {
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [audioUri, setAudioUri] = useState<string | null>(null);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const startPromiseRef = useRef<Promise<void> | null>(null);
  const isStoppingRef = useRef(false);

  useEffect(() => {
    recordingRef.current = recording;
  }, [recording]);

  useEffect(() => {
    return () => {
      const activeRecording = recordingRef.current;

      if (activeRecording) {
        void activeRecording.stopAndUnloadAsync().catch(() => undefined);
      }

      void Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
      }).catch(() => undefined);
    };
  }, []);

  const startRecording = async () => {
    console.log("[AudioRecorder] startRecording called");

    if (isStoppingRef.current) {
      console.log("[AudioRecorder] Ignoring start; stop is in progress");
      return;
    }

    if (recordingRef.current) {
      console.log("[AudioRecorder] Ignoring start; recording already exists");
      return;
    }

    if (startPromiseRef.current) {
      console.log("[AudioRecorder] Waiting for existing start operation");
      await startPromiseRef.current;
      return;
    }

    const startPromise = (async () => {
      try {
        const permission = await Audio.requestPermissionsAsync();
        console.log("[AudioRecorder] Microphone permission:", permission.status);

        if (permission.status !== "granted") {
          console.log("Microphone permission was not granted.");
          return;
        }

        await Audio.setAudioModeAsync({
          allowsRecordingIOS: true,
          playsInSilentModeIOS: true,
        });

        const { recording: newRecording } = await Audio.Recording.createAsync(
          Audio.RecordingOptionsPresets.HIGH_QUALITY
        );

        const status = await newRecording.getStatusAsync();
        console.log("[AudioRecorder] Recording started. canRecord:", status.canRecord);

        recordingRef.current = newRecording;
        setAudioUri(null);
        setRecording(newRecording);
      } catch (error) {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
        }).catch(() => undefined);
        console.error("[AudioRecorder] Failed to start recording.", error);
      }
    })();

    startPromiseRef.current = startPromise;
    await startPromise;
    startPromiseRef.current = null;
  };

  const stopRecording = async (): Promise<string | null> => {
    console.log("[AudioRecorder] stopRecording called");

    if (isStoppingRef.current) {
      console.log("[AudioRecorder] Ignoring stop; already stopping");
      return null;
    }

    isStoppingRef.current = true;

    try {
      if (!recordingRef.current && startPromiseRef.current) {
        console.log("[AudioRecorder] Waiting for start to complete before stop");
        await startPromiseRef.current;
      }

      const activeRecording = recordingRef.current;

      if (!activeRecording) {
        console.log("[AudioRecorder] No active recording to stop");
        return null;
      }

      const statusBeforeStop = await activeRecording.getStatusAsync();
      console.log("[AudioRecorder] Status before stop:", statusBeforeStop);

      await activeRecording.stopAndUnloadAsync();
      console.log("[AudioRecorder] stopAndUnloadAsync completed");

      const statusAfterStop = await activeRecording.getStatusAsync();
      console.log("[AudioRecorder] Status after stop:", statusAfterStop);

      // IMPORTANT: read URI before clearing recording references.
      const uri = activeRecording.getURI();
      console.log("[AudioRecorder] URI from recording:", uri);

      recordingRef.current = null;
      setRecording(null);
      setAudioUri(uri ?? null);

      return uri ?? null;
    } catch (error) {
      console.error("[AudioRecorder] Failed to stop recording.", error);
      return null;
    } finally {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      }).catch(() => undefined);
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
