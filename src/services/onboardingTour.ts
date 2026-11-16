import { Preferences } from "@capacitor/preferences";

const TOUR_DONE_KEY = "wepa_onboarding_tour_v1_done";
const TOUR_START_EVENT = "wepa:start-tour";
const TOUR_CLOSE_EVENT = "wepa:close-tour";
const TOUR_OPEN_SELECTOR = '[data-wepa-tour="open"]';

export async function isOnboardingTourDone(): Promise<boolean> {
  try {
    const { value } = await Preferences.get({ key: TOUR_DONE_KEY });
    if (value === "1") return true;
  } catch {
    // Preferences no está disponible en web: se usa localStorage como respaldo.
  }
  try {
    return localStorage.getItem(TOUR_DONE_KEY) === "1";
  } catch {
    return false;
  }
}

export async function markOnboardingTourDone(): Promise<void> {
  try {
    localStorage.setItem(TOUR_DONE_KEY, "1");
  } catch {
    // Almacenamiento no disponible.
  }
  try {
    await Preferences.set({ key: TOUR_DONE_KEY, value: "1" });
  } catch {
    // Sin Preferences nativo se conserva el respaldo web.
  }
}

export function requestOnboardingTour(): void {
  try {
    window.dispatchEvent(new Event(TOUR_START_EVENT));
  } catch {
    // Entorno sin window.
  }
}

export function onOnboardingTourRequested(handler: () => void): () => void {
  window.addEventListener(TOUR_START_EVENT, handler);
  return () => window.removeEventListener(TOUR_START_EVENT, handler);
}

export function requestOnboardingTourClose(): void {
  try {
    window.dispatchEvent(new Event(TOUR_CLOSE_EVENT));
  } catch {
    // Entorno sin window.
  }
}

export function onOnboardingTourCloseRequested(handler: () => void): () => void {
  window.addEventListener(TOUR_CLOSE_EVENT, handler);
  return () => window.removeEventListener(TOUR_CLOSE_EVENT, handler);
}

export function isOnboardingTourOpen(): boolean {
  try {
    return !!document.querySelector(TOUR_OPEN_SELECTOR);
  } catch {
    return false;
  }
}
