export type SoundEvent = "message" | "call";

export interface SoundOption {
  id: string;
  name: string;
  file: string;
  loop?: boolean;
}

export const SOUND_LIBRARY: Record<SoundEvent, SoundOption[]> = {
  message: [
    { id: "clasica", name: "Clásica", file: "/sounds/notificacion.mp3" },
    { id: "noti1", name: "Notificación 1", file: "/sounds/noti1.mp3" },
    { id: "noti2", name: "Notificación 2", file: "/sounds/noti2.mp3" },
    { id: "noti3", name: "Notificación 3", file: "/sounds/noti3.mp3" },
    { id: "noti4", name: "Notificación 4", file: "/sounds/noti4.mp3" },
    { id: "noti5", name: "Notificación 5", file: "/sounds/noti5.mp3" },
    { id: "noti6", name: "Notificación 6", file: "/sounds/noti6.mp3" },
  ],
  call: [
    { id: "ring1", name: "Llamada 1", file: "/sounds/ringtone.mp3", loop: true },
    { id: "ring2", name: "Llamada 2", file: "/sounds/ring1.mp3", loop: true },
    { id: "ring3", name: "Llamada 3", file: "/sounds/ring2.mp3", loop: true },
  ],
};

export const DEFAULT_SOUND: Record<SoundEvent, string> = {
  message: "clasica",
  call: "ring1",
};

export const getSoundOption = (event: SoundEvent, id: string): SoundOption => {
  return SOUND_LIBRARY[event].find(o => o.id === id) || SOUND_LIBRARY[event][0];
};
