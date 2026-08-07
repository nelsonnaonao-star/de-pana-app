import { SoundEvent, DEFAULT_SOUND, getSoundOption } from "../data/sounds";

const STORAGE_KEYS: Record<SoundEvent, string> = {
  message: "redon_sound_message",
  call: "redon_sound_call",
};

const lastAudioRef: { current: HTMLAudioElement | null } = { current: null };

export const getSoundId = (event: SoundEvent): string => {
  try {
    return localStorage.getItem(STORAGE_KEYS[event]) || DEFAULT_SOUND[event];
  } catch {
    return DEFAULT_SOUND[event];
  }
};

export const setSoundId = (event: SoundEvent, id: string): void => {
  try {
    localStorage.setItem(STORAGE_KEYS[event], id);
  } catch {
    // almacenamiento no disponible; se ignora
  }
};

export const getSound = (event: SoundEvent) => {
  return getSoundOption(event, getSoundId(event));
};

export const playSound = (event: SoundEvent, volume = 0.7): HTMLAudioElement | null => {
  const sound = getSound(event);
  if (!sound.file) return null;
  try {
    stopSound();
    const audio = new Audio(sound.file);
    audio.loop = !!sound.loop;
    audio.volume = volume;
    audio.play().catch(() => {});
    lastAudioRef.current = audio;
    return audio;
  } catch {
    return null;
  }
};

export const stopSound = (): void => {
  const last = lastAudioRef.current;
  if (last) {
    try {
      last.pause();
      last.currentTime = 0;
    } catch {}
    lastAudioRef.current = null;
  }
};