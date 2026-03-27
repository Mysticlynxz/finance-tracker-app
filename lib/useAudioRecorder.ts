import { Audio } from "expo-av";
import { useEffect, useRef, useState } from "react";

export function useAudioRecorder() {
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [audioUri, setAudioUri] = useState<string | null>(null);
  const recordingRef = useRef<Audio.Recording | null>(null);

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
    if (recordingRef.current) {
      return;
    }

    try {
      const permission = await Audio.requestPermissionsAsync();

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

      recordingRef.current = newRecording;
      setAudioUri(null);
      setRecording(newRecording);
    } catch (error) {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
      }).catch(() => undefined);
      console.error("Failed to start recording.", error);
    }
  };

  const stopRecording = async (): Promise<string | null> => {
    const activeRecording = recordingRef.current;

    if (!activeRecording) {
      return null;
    }

    try {
      await activeRecording.stopAndUnloadAsync();

      const uri = activeRecording.getURI();

      recordingRef.current = null;
      setRecording(null);
      setAudioUri(uri ?? null);

      console.log("Audio URI:", uri);

      return uri ?? null;
    } catch (error) {
      console.error("Failed to stop recording.", error);
      return null;
    } finally {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      }).catch(() => undefined);
    }
  };

  return {
    recording,
    audioUri,
    startRecording,
    stopRecording,
  };
}
