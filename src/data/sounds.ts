export type SoundEvent = "message" | "call";

export interface SoundOption {
  id: string;
  name: string;
  file: string;
  loop?: boolean;
}

export const SOUND_LIBRARY: Record<SoundEvent, SoundOption[]> = {
  message: [
    { id: "clasica", name: "Predeterminada", file: "/sounds/notificacion.mp3" },
    { id: "noti1", name: "Gotas", file: "/sounds/noti1.mp3" },
    { id: "noti2", name: "Campana", file: "/sounds/noti2.mp3" },
    { id: "noti3", name: "Digital", file: "/sounds/noti3.mp3" },
    { id: "noti4", name: "Suave", file: "/sounds/noti4.mp3" },
    { id: "noti5", name: "Alerta", file: "/sounds/noti5.mp3" },
    { id: "noti6", name: "Pop", file: "/sounds/noti6.mp3" },
  ],
  call: [
    { id: "ring1", name: "Predeterminada", file: "/sounds/ringtone.mp3", loop: true },
    { id: "ring2", name: "Clásica", file: "/sounds/ring1.mp3", loop: true },
    { id: "ring3", name: "Digital", file: "/sounds/ring2.mp3", loop: true },
  ],
};

export const DEFAULT_SOUND: Record<SoundEvent, string> = {
  message: "clasica",
  call: "ring1",
};

export const getSoundOption = (event: SoundEvent, id: string): SoundOption => {
  return SOUND_LIBRARY[event].find(o => o.id === id) || SOUND_LIBRARY[event][0];
};
