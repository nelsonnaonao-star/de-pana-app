import { SoundEvent, DEFAULT_SOUND, getSoundOption } from "../data/sounds";
import { Preferences } from "@capacitor/preferences";
import { Capacitor } from "@capacitor/core";
import { logger } from "../lib/logger";

const STORAGE_KEYS: Record<SoundEvent, string> = {
  message: "redon_sound_message",
  call: "redon_sound_call",
};

const activeAudiosRef: { current: Set<HTMLAudioElement> } = { current: new Set() };

export const getSoundId = (event: SoundEvent): string => {
  try {
    return localStorage.getItem(STORAGE_KEYS[event]) || DEFAULT_SOUND[event];
  } catch (e) {
    logger.warn("[SoundService] getSoundId localStorage failed", { error: e });
    return DEFAULT_SOUND[event];
  }
};

export const setSoundId = (event: SoundEvent, id: string): void => {
  try {
    localStorage.setItem(STORAGE_KEYS[event], id);
  } catch (e) {
    logger.warn("[SoundService] setSoundId localStorage failed", { error: e });
  }
  if (Capacitor.isNativePlatform()) {
    try {
      Preferences.set({ key: STORAGE_KEYS[event], value: id }).catch((e) => {
        logger.warn("[SoundService] Preferences.set failed", { error: e });
      });
    } catch (e) {
      logger.warn("[SoundService] Preferences.set outer failed", { error: e });
    }
  }
};

export const getSound = (event: SoundEvent) => {
  return getSoundOption(event, getSoundId(event));
};

// Reproduce el archivo específico de una opción (para vista previa en el selector).
// Acepta también un path directo de archivo por compatibilidad.
export const playSoundOption = (event: SoundEvent, id: string, volume = 0.7): HTMLAudioElement | null => {
  const sound = getSoundOption(event, id);
  if (!sound.file) return null;
  try {
    stopSound();
    const audio = new Audio(sound.file);
    audio.loop = !!sound.loop;
    audio.volume = volume;
    audio.play().catch((e) => {
      logger.warn("[SoundService] playSoundOption audio.play failed", { error: e });
    });
    activeAudiosRef.current.add(audio);
    return audio;
  } catch (e) {
    logger.error("[SoundService] playSoundOption failed", { error: e });
    return null;
  }
};

export const playSound = (event: SoundEvent, volume = 0.7): HTMLAudioElement | null => {
  const sound = getSound(event);
  if (!sound.file) return null;
  try {
    stopSound();
    const audio = new Audio(sound.file);
    audio.loop = !!sound.loop;
    audio.volume = volume;
    audio.play().catch((e) => {
      logger.warn("[SoundService] playSound audio.play failed", { error: e });
    });
    activeAudiosRef.current.add(audio);
    return audio;
  } catch (e) {
    logger.error("[SoundService] playSound failed", { error: e });
    return null;
  }
};

export const stopSound = (): void => {
  for (const audio of activeAudiosRef.current) {
    try {
      audio.pause();
      audio.currentTime = 0;
    } catch (e) {
      logger.warn("[SoundService] stopSound audio pause failed", { error: e });
    }
  }
  activeAudiosRef.current.clear();
};

// Sincroniza la selección guardada en el almacenamiento nativo (Android SharedPreferences)
export const syncSoundPrefsFromNative = async (): Promise<void> => {
  if (!Capacitor.isNativePlatform()) return;
  try {
    for (const event of (["message", "call"] as SoundEvent[])) {
      const stored = await Preferences.get({ key: STORAGE_KEYS[event] });
      if (stored?.value) {
        try { localStorage.setItem(STORAGE_KEYS[event], stored.value); } catch (e) {
          logger.warn("[SoundService] syncSoundPrefsFromNative localStorage failed", { error: e });
        }
      }
    }
  } catch (e) {
    logger.warn("[SoundService] syncSoundPrefsFromNative failed", { error: e });
  }
};