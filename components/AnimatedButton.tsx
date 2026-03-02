import { Audio, type AVPlaybackSource } from "expo-av";
import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  Animated,
  type GestureResponderEvent,
  Pressable,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";

interface AnimatedButtonProps extends Omit<PressableProps, "onPress"> {
  onPress?: () => void | Promise<void>;
  soundSource?: AVPlaybackSource;
  containerStyle?: StyleProp<ViewStyle>;
}

export default function AnimatedButton({
  onPress,
  onPressIn,
  onPressOut,
  disabled,
  soundSource,
  containerStyle,
  ...pressableProps
}: AnimatedButtonProps) {
  const scale = useRef(new Animated.Value(1)).current;
  const clickSoundRef = useRef<Audio.Sound | null>(null);

  const animatedContainerStyle = useMemo(
    () => [{ transform: [{ scale }] }, containerStyle],
    [containerStyle, scale]
  );

  const animateTo = useCallback(
    (toValue: number) => {
      Animated.spring(scale, {
        toValue,
        useNativeDriver: true,
        speed: 32,
        bounciness: 0,
      }).start();
    },
    [scale]
  );

  const loadSound = useCallback(async () => {
    if (!soundSource) {
      return null;
    }

    if (clickSoundRef.current) {
      return clickSoundRef.current;
    }

    const { sound } = await Audio.Sound.createAsync(soundSource, {
      shouldPlay: false,
      volume: 0.6,
    });
    clickSoundRef.current = sound;
    return sound;
  }, [soundSource]);

  const playClickSound = useCallback(async () => {
    try {
      const sound = await loadSound();
      if (!sound) {
        return;
      }
      await sound.replayAsync();
    } catch {
      // Fail silently to avoid blocking button behavior on audio issues.
    }
  }, [loadSound]);

  useEffect(() => {
    return () => {
      const unload = async () => {
        if (clickSoundRef.current) {
          try {
            await clickSoundRef.current.unloadAsync();
          } catch {
            // Ignore unload failures during teardown.
          } finally {
            clickSoundRef.current = null;
          }
        }
      };

      void unload();
    };
  }, []);

  const handlePressIn = useCallback(
    (event: GestureResponderEvent) => {
      if (!disabled) {
        animateTo(0.97);
      }
      onPressIn?.(event);
    },
    [animateTo, disabled, onPressIn]
  );

  const handlePressOut = useCallback(
    (event: GestureResponderEvent) => {
      animateTo(1);
      onPressOut?.(event);
    },
    [animateTo, onPressOut]
  );

  const handlePress = useCallback(async () => {
    if (disabled) {
      return;
    }

    void playClickSound();

    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {
      // Haptics may be unavailable on some devices/emulators.
    }

    await onPress?.();
  }, [disabled, onPress, playClickSound]);

  return (
    <Animated.View style={animatedContainerStyle}>
      <Pressable
        {...pressableProps}
        disabled={disabled}
        onPress={() => {
          void handlePress();
        }}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
      />
    </Animated.View>
  );
}
