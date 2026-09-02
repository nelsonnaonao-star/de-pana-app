import React, { createContext, useContext, useEffect, useState, useRef, useMemo, useCallback, ReactNode } from "react";
import { Network } from "@capacitor/network";
import { App as CapacitorApp } from "@capacitor/app";

import { supabase } from "../lib/supabase";
import { Profile, signOut as authSignOut } from "../services/auth";
import { Chat, getChats } from "../services/chats";
import { Contact, getContacts, addContact } from "../services/contacts";
import { Call, getCalls } from "../services/calls";
import { registerPushNotifications, unregisterPushNotifications } from "../services/pushNotifications";
import { setupCapacitorPush, unregisterCapacitorPush } from "../services/pushCapacitor";
import { chatRepo } from "../services/database/repositories/ChatRepository";
import { contactRepo } from "../services/database/repositories/ContactRepository";
import { db } from "../services/database/DatabaseService";
import toast from "react-hot-toast";
import { logger } from "../lib/logger";

const CACHE_PREFIX = "redon_cache_";
const cacheKey = (uid: string, name: string) => `${CACHE_PREFIX}${name}_${uid}`;

// Última lista de contactos conocida (no vacía), por usuario. Si un fetch falla,
// timeoutea o devuelve vacío (red caída/lenta o caché local perdida), se usa esto
// para que la lista JAMÁS quede en cero durante la sesión.
const lastKnownContacts = new Map<string, Contact[]>();

function loadCache<T>(key: string, fallback: T): T {
  try {
    const stored = localStorage.getItem(key);
    if (stored) return JSON.parse(stored) as T;
  } catch (e) {
    logger.warn("[SupabaseContext] loadCache failed", { error: e, key });
  }
  return fallback;
}

function saveCache<T>(key: string, data: T) {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (e) {
    logger.warn("[SupabaseContext] saveCache failed", { error: e, key });
  }
}

function clearUserCache(userId: string) {
  const prefix = `${CACHE_PREFIX}`;
  try {
    const keys = Object.keys(localStorage);
    for (const k of keys) {
      if (k.startsWith(prefix) && k.endsWith(`_${userId}`)) {
        localStorage.removeItem(k);
      }
    }
  } catch (e) {
    logger.warn("[SupabaseContext] clearUserCache failed", { error: e, userId });
  }
}

const LAST_USER_KEY = "redon_last_user";

function saveLastUser(userId: string) {
  try {
    localStorage.setItem(LAST_USER_KEY, JSON.stringify({ id: userId }));
    localStorage.setItem("redon_has_registered", "1");
  } catch (e) {
    logger.warn("[SupabaseContext] saveLastUser failed", { error: e, userId });
  }
}

function loadLastUser(): { id: string } | null {
  try {
    const raw = localStorage.getItem(LAST_USER_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.id === "string" && parsed.id.length >= 8) return parsed;
    }
  } catch (e) {
    logger.warn("[SupabaseContext] loadLastUser failed", { error: e });
  }
  return null;
}

function clearLastUser() {
  try {
    localStorage.removeItem(LAST_USER_KEY);
  } catch (e) {
    logger.warn("[SupabaseContext] clearLastUser failed", { error: e });
  }
}

function isPasswordRecoveryUrl(): boolean {
  try {
    const hash = window.location.hash || "";
    const query = window.location.search || "";
    return hash.includes("type=recovery") || query.includes("type=recovery");
  } catch {
    return false;
  }
}

function withTimeout<T>(promise: PromiseLike<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)),
  ]);
}

function debugLog(label: string, data?: any) {
  logger.debug(`[SUPABASE] ${label}`, data);
}

interface SupabaseContextType {
  user: any | null;
  profile: Profile | null;
  loading: boolean;
  chats: Chat[];
  contacts: Contact[];
  calls: Call[];
  passwordRecovery: boolean;
  completePasswordReset: (newPassword: string) => Promise<void>;
  refreshProfile: () => Promise<void>;
  refreshChats: () => Promise<void>;
  refreshContacts: (allowEmpty?: boolean) => Promise<void>;
  refreshCalls: () => Promise<void>;
  removeChatFromContext: (chatId: string) => void;
  logout: () => Promise<void>;
}

const SupabaseContext = createContext<SupabaseContextType | undefined>(undefined);

export function SupabaseProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<any | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [chats, setChats] = useState<Chat[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [calls, setCalls] = useState<Call[]>([]);
  const [passwordRecovery, setPasswordRecovery] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadedUserId = useRef<string | null>(null);
  const loadingUserDataRef = useRef(false);
  const presenceChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const presenceChannelConnectedRef = useRef(false);
  const profilesChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const participantsChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  // Reconexión de canales globales tras corte de red (patrón chats.ts):
  // backoff exponencial + jitter, tope 10 intentos, timers cancelables.
  const globalChannelsRetryRef = useRef<{
    presence: { attempt: number; timer: ReturnType<typeof setTimeout> | null };
    profiles: { attempt: number; timer: ReturnType<typeof setTimeout> | null };
    participants: { attempt: number; timer: ReturnType<typeof setTimeout> | null };
  }>({
    presence: { attempt: 0, timer: null },
    profiles: { attempt: 0, timer: null },
    participants: { attempt: 0, timer: null },
  });

  const cancelGlobalChannelRetries = () => {
    for (const key of ["presence", "profiles", "participants"] as const) {
      const st = globalChannelsRetryRef.current[key];
      st.attempt = 0;
      if (st.timer) {
        clearTimeout(st.timer);
        st.timer = null;
      }
    }
  };
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const discoveryPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chatsRef = useRef<Chat[]>([]);
  const contactsRef = useRef<Contact[]>([]);
  const cleanupListenersRef = useRef<(() => void) | null>(null);
  
  // Presence debounce refs (3-5s debounce to avoid flapping)
  const presenceDebounceRef = useRef<{ onlineTimer?: ReturnType<typeof setTimeout>; offlineTimer?: ReturnType<typeof setTimeout>; pendingStatus?: "online" | "offline" }>({
    onlineTimer: undefined,
    offlineTimer: undefined,
    pendingStatus: undefined,
  });
  const DEBOUNCE_MS = 4000; // 4s debounce for presence flapping

  // Heartbeat helper: writes to both profiles.status AND user_presence
  // (user_presence is checked server-side by pg_cron every 60s to
  // detect stale online users who died without logout).
  const heartbeatWrite = (uid: string) => {
    const now = new Date().toISOString();
    supabase.from("profiles").update({ status: "online" }).eq("id", uid).then(() => {}).catch(() => {});
    supabase.from("user_presence").upsert(
      { user_id: uid, last_seen: now, status: "online" },
      { onConflict: "user_id" }
    ).then(() => {}).catch(() => {});
  };

  // Debounced presence update to avoid flapping on micro network cuts / tab switches
  const updatePresenceDebounced = async (userId: string, status: "online" | "offline") => {
    const ref = presenceDebounceRef.current;
    // Clear opposite timer
    if (status === "online") {
      if (ref.offlineTimer) {
        clearTimeout(ref.offlineTimer);
        ref.offlineTimer = undefined;
      }
      if (!ref.onlineTimer) {
        ref.onlineTimer = setTimeout(async () => {
          try {
            await supabase.from("profiles").update({ status: "online" }).eq("id", userId);
            supabase.from("user_presence").upsert(
              { user_id: userId, last_seen: new Date().toISOString(), status: "online" },
              { onConflict: "user_id" }
            ).then(() => {}).catch(() => {});
            logger.debug("[Presence] Online status confirmed", { userId });
          } catch {}
          ref.onlineTimer = undefined;
          ref.pendingStatus = undefined;
        }, DEBOUNCE_MS);
      }
      ref.pendingStatus = "online";
    } else {
      if (ref.onlineTimer) {
        clearTimeout(ref.onlineTimer);
        ref.onlineTimer = undefined;
      }
      if (!ref.offlineTimer) {
        ref.offlineTimer = setTimeout(async () => {
          try {
            await supabase.from("profiles").update({ status: "offline" }).eq("id", userId);
            supabase.from("user_presence").upsert(
              { user_id: userId, last_seen: new Date().toISOString(), status: "offline" },
              { onConflict: "user_id" }
            ).then(() => {}).catch(() => {});
            logger.debug("[Presence] Offline status confirmed", { userId });
          } catch {}
          ref.offlineTimer = undefined;
          ref.pendingStatus = undefined;
        }, DEBOUNCE_MS);
      }
      ref.pendingStatus = "offline";
    }
  };

  // Flush any pending presence update immediately (used on logout/unmount)
  const flushPresence = async (userId: string) => {
    const ref = presenceDebounceRef.current;
    if (ref.onlineTimer) {
      clearTimeout(ref.onlineTimer);
      ref.onlineTimer = undefined;
    }
    if (ref.offlineTimer) {
      clearTimeout(ref.offlineTimer);
      ref.offlineTimer = undefined;
    }
    if (ref.pendingStatus) {
      try {
        await supabase.from("profiles").update({ status: ref.pendingStatus }).eq("id", userId);
        supabase.from("user_presence").upsert(
          { user_id: userId, last_seen: new Date().toISOString(), status: ref.pendingStatus },
          { onConflict: "user_id" }
        ).then(() => {}).catch(() => {});
        logger.debug("[Presence] Flushed pending status", { userId, status: ref.pendingStatus });
      } catch {}
      ref.pendingStatus = undefined;
    }
  };

  // Keep chatsRef in sync with chats state (used by discovery poll)
  useEffect(() => { chatsRef.current = chats; }, [chats]);
  useEffect(() => { contactsRef.current = contacts; }, [contacts]);

  useEffect(() => {
    // Eager local pre-load (NO network): if we know the last user, paint their
    // cached data immediately instead of waiting for the session round-trip.
    if (!loadedUserId.current && !isPasswordRecoveryUrl()) {
      const cachedLastUser = loadLastUser();
      if (cachedLastUser?.id) {
        logger.info("[SUPABASE] Eager cache pre-load for last user", { userId: cachedLastUser.id.slice(0, 8) });
        setUser({ id: cachedLastUser.id });
        loadUserData(cachedLastUser.id);
        // Red de seguridad: si la lectura eager corrió antes de que SQLite
        // estuviera listo y el estado quedó sin contactos, rehidratar una vez
        // que la BD terminó de inicializar (offline incluido).
        db.whenReady(4000).then(async () => {
          const uid = loadedUserId.current;
          if (!uid || uid !== cachedLastUser.id) return;
          if (contactsRef.current.length > 0) return;
          try {
            const fresh = await contactRepo.getContacts(uid);
            if (loadedUserId.current !== uid || contactsRef.current.length > 0 || fresh.length === 0) return;
            setContacts(fresh);
            lastKnownContacts.set(uid, fresh);
          } catch (e) {
            logger.warn("[SUPABASE] post-db contacts heal failed", { error: e });
          }
        });
      }
    }

    // Restauración de sesión con timeout + catch: con el teléfono sin señal y un
    // token vencido, getSession() puede no resolver (validación contra la red).
    // Si no resuelve en 4s, se cae al modo offline para que la app NUNCA quede
    // en una pantalla en blanco durante el arranque.
    const restoreWithoutSession = () => {
      const lastUser = loadLastUser();
      if (lastUser?.id) {
        logger.info("[SUPABASE] No session — restoring offline mode for last user", { userId: lastUser.id.slice(0, 8) });
        setUser({ id: lastUser.id });
        if (!loadedUserId.current) {
          loadUserData(lastUser.id);
        } else {
          setLoading(false);
        }
      } else {
        setLoading(false); // First-time / real sign-out: show login
      }
    };

    const sessionTimeout = new Promise<{ timeout: true }>((resolve) =>
      setTimeout(() => resolve({ timeout: true }), 4000)
    );

    Promise.race([supabase.auth.getSession(), sessionTimeout])
      .then((result: any) => {
        const timedOut = !!result?.timeout;
        const session = timedOut ? null : result?.data?.session;
        const error = timedOut ? new Error("session restore timeout") : result?.error;
        logger.info("[SUPABASE] Session on mount", { hasSession: !!session, error, timedOut });
        if (session?.user) {
          // Coming from a password-recovery email link: don't enter the app,
          // show the "set new password" screen instead.
          if (isPasswordRecoveryUrl()) {
            logger.info("[SUPABASE] Recovery token detected — showing password reset screen");
            setPasswordRecovery(true);
            setUser(session.user);
            setLoading(false);
            return;
          }
          saveLastUser(session.user.id);
          if (loadedUserId.current && loadedUserId.current !== session.user.id) {
            // Account switched while the app was closed: drop the eager cached
            // state so the correct user loads below.
            logger.info("[SUPABASE] Session is a different user — reloading for", { userId: session.user.id.slice(0, 8) });
            loadedUserId.current = null;
            setProfile(null);
            setChats([]);
            setContacts([]);
            setCalls([]);
          }
          setUser(session.user);
          if (!loadedUserId.current) {
            loadUserData(session.user.id);
          } else {
            setLoading(false);
          }
        } else {
          // No session (offline, timeout or expired). If we know a last user,
          // enter in offline mode with cached data instead of the login screen.
          restoreWithoutSession();
        }
      })
      .catch((err) => {
        logger.warn("[SUPABASE] getSession failed — offline fallback", { error: err });
        restoreWithoutSession();
      });

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      const userId = session?.user?.id;
      logger.info("[AUTH]", { event, userId: userId ? userId.slice(0, 8) + "..." : "null" });

      switch (event) {
        case "PASSWORD_RECOVERY":
          logger.info("[AUTH] PASSWORD_RECOVERY — showing password reset screen");
          setPasswordRecovery(true);
          if (userId) {
            setUser(session.user);
            setLoading(false);
          }
          break;

        case "SIGNED_IN":
          if (isPasswordRecoveryUrl()) {
            logger.info("[AUTH] SIGNED_IN during recovery — showing password reset screen");
            setPasswordRecovery(true);
            setUser(session.user);
            setLoading(false);
            break;
          }
          if (userId && !loadedUserId.current) {
            saveLastUser(userId);
            setUser(session.user);
            loadUserData(userId);
          }
          break;

        case "SIGNED_OUT": {
          // Distinguish a manual logout (which clears LAST_USER_KEY first) from
          // an automatic sign-out caused by network/refresh failure. In the
          // latter case, restore offline mode with cached data instead of
          // sending the user to the login screen.
          const lastUser = loadLastUser();
          if (lastUser?.id) {
            logger.info("[SUPABASE] SIGNED_OUT without manual logout — restoring offline mode", { userId: lastUser.id.slice(0, 8) });
            loadedUserId.current = null;
            setUser({ id: lastUser.id });
            loadUserData(lastUser.id);
            break;
          }
          loadedUserId.current = null;
          setUser(null);
          setProfile(null);
          setChats([]);
          setContacts([]);
          setCalls([]);
          setLoading(false);
          if (userId) clearUserCache(userId);
          break;
        }

        case "TOKEN_REFRESHED":
          if (userId && session) {
            saveLastUser(userId);
            setUser(session.user);
          }
          break;

        case "INITIAL_SESSION":
          if (userId && !loadedUserId.current) {
            saveLastUser(userId);
            setUser(session.user);
            loadUserData(userId);
          }
          break;

        default:
          break;
      }
    });

    // Watchdog de arranque: pase lo que pase (getSession colgado, caché lenta,
    // excepción no capturada), la app sale de "loading" en ≤4.5s en vez de
    // quedarse en una pantalla en blanco. setLoading(false) es idempotente: si
    // la sesión/caché ya pintó antes, este disparo no tiene efecto.
    const bootWatchdog = setTimeout(() => setLoading(false), 4500);

    // Listener para sesión irrecuperable: cuando authFetch detecta que
    // refreshSession() lanzó excepción (token muerto de verdad), dispara este
    // CustomEvent. Solo limpiamos el user state — NO borramos caché/contactos/
    // chats para que al volver a loguearse todo esté intacto.
    const handleSessionUnrecoverable = () => {
      logger.info("[AUTH] session-unrecoverable received — clearing session, keeping local cache");
      toast.error("Tu sesión expiró. Inicia sesión de nuevo.", { duration: 5000 });
      loadedUserId.current = null;
      clearLastUser();
      setUser(null);
      setProfile(null);
      setLoading(false);
    };
    window.addEventListener("session-unrecoverable", handleSessionUnrecoverable);

    return () => {
      clearTimeout(bootWatchdog);
      window.removeEventListener("session-unrecoverable", handleSessionUnrecoverable);
      listener?.subscription?.unsubscribe();
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      if (discoveryPollRef.current) clearInterval(discoveryPollRef.current);
      cancelGlobalChannelRetries();
      if (profilesChannelRef.current) supabase.removeChannel(profilesChannelRef.current);
      if (participantsChannelRef.current) supabase.removeChannel(participantsChannelRef.current);
      presenceChannelRef.current?.untrack();
      cleanupListenersRef.current?.();
    };
  }, []);

  // Self-heal: si tras una carga la lista de contactos quedó vacía pero el
  // usuario sí tiene chats 1:1 (p. ej. tras instalar un nuevo APK la caché
  // local y/o la copia de contactos desaparecieron), re-provisiona cada
  // interlocutor como contacto para que la lista nunca quede en "No tienes".
  const healContactsRef = useRef<Set<string>>(new Set());
  const healContactsFromChats = async (uid: string, chats: Chat[]) => {
    const partners = new Map<string, { name: string; avatar: string }>();
    for (const c of chats) {
      if (c.is_group || !c.profile_id || !c.admin_id) continue;
      const partnerId = c.profile_id === uid ? c.admin_id : c.profile_id;
      if (!partnerId || partnerId === uid) continue;
      partners.set(partnerId, { name: c.name || "", avatar: c.avatar || "" });
    }
    const pending = [...partners.entries()].filter(([pid]) => !healContactsRef.current.has(pid));
    if (pending.length === 0) return 0;
    for (const [pid, meta] of pending) {
      healContactsRef.current.add(pid);
      try {
        await addContact(uid, pid, meta.name, meta.avatar);
      } catch (e) {
        logger.warn("[SUPABASE] healContact failed", { error: e, pid });
      }
    }
    const fresh = await getContacts(uid);
    if (loadedUserId.current === uid) {
      setContacts(fresh);
      contactRepo.saveContacts(uid, fresh);
    }
    return pending.length;
  };

  async function loadUserData(userId: string) {
    if (loadedUserId.current === userId) return;
    loadedUserId.current = userId;
    loadingUserDataRef.current = true;
    debugLog("loadUserData start", { userId });

    // Load cached data immediately for instant UI (scoped to userId)
    const cachedProfile = loadCache<Profile | null>(cacheKey(userId, "profile"), null);
    const [cachedChats, cachedContacts] = await Promise.all([
      chatRepo.getChats(userId).catch((e) => {
        logger.warn("[SUPABASE] chat cache read failed", { error: e });
        return [] as Chat[];
      }),
      contactRepo.getContacts(userId).catch((e) => {
        logger.warn("[SUPABASE] contact cache read failed", { error: e });
        return [] as Contact[];
      }),
    ]);
    const cachedCalls = loadCache<Call[]>(cacheKey(userId, "calls"), []);
    
    // Account switched while loading: bail out so the eager cached state of an
    // old user never overwrites the correct user's data.
    if (loadedUserId.current !== userId) {
      loadingUserDataRef.current = false;
      return;
    }

    debugLog("cache loaded", { 
      hasProfile: !!cachedProfile, 
      chatsCount: cachedChats.length, 
      contactsCount: cachedContacts.length,
      callsCount: cachedCalls.length
    });

    setProfile(cachedProfile);
    setChats(cachedChats);
    setContacts(cachedContacts);
    setCalls(cachedCalls);
    setLoading(false); // Show cached data immediately

    try {
      const TIMEOUT_MS = 8000; // Increased from 3s to 8s for slow networks
      debugLog("fetching fresh data", { timeout: TIMEOUT_MS });
      
      const [profilesResult, chatsResult, contactsResult, callsResult] = await Promise.allSettled([
        withTimeout(supabase.from("profiles").select("*").eq("id", userId).single(), 8000),
        withTimeout(getChats(userId), TIMEOUT_MS),
        withTimeout(getContacts(userId), TIMEOUT_MS),
        withTimeout(getCalls(userId), TIMEOUT_MS),
      ]);

      debugLog("fetch results", {
        profile: profilesResult.status,
        chats: chatsResult.status,
        contacts: contactsResult.status,
        calls: callsResult.status,
      });

      // Account switched while the network fetch was in flight — discard
      // stale results so they never overwrite the correct user's data.
      if (loadedUserId.current !== userId) {
        loadingUserDataRef.current = false;
        return;
      }

      const hasProfileError = profilesResult.status === "fulfilled" && profilesResult.value?.error;
      if (hasProfileError) {
        debugLog("Profile fetch error", { message: profilesResult.value.error.message, code: profilesResult.value.error.code, details: profilesResult.value.error.details, hint: profilesResult.value.error.hint });
      }
      const newProfile = profilesResult.status === "fulfilled" && profilesResult.value?.data ? (profilesResult.value.data as Profile) : cachedProfile;
      const newChats = chatsResult.status === "fulfilled" ? chatsResult.value || [] : cachedChats;
      let newContacts = contactsResult.status === "fulfilled" ? contactsResult.value || [] : cachedContacts;
      const newCalls = callsResult.status === "fulfilled" ? callsResult.value || [] : cachedCalls;

      // Contactos: si el fetch devolvió vacío (red caída/lenta o caché local
      // perdida tras reinstalar el APK), se conserva la última lista buena para
      // que no "desaparezcan" los contactos ni se persista un vacío como caché.
      if (newContacts.length === 0) {
        const lastGood = lastKnownContacts.get(userId);
        if (lastGood && lastGood.length > 0) newContacts = lastGood;
      }
      if (newContacts.length > 0) lastKnownContacts.set(userId, newContacts);

      debugLog("setting fresh data", {
        profile: !!newProfile,
        chatsCount: newChats.length,
        contactsCount: newContacts.length,
        callsCount: newCalls.length,
      });

      const chatsWipeGuard = newChats.length === 0 && cachedChats.length > 0;
      const contactsWipeGuard = newContacts.length === 0 && cachedContacts.length > 0;
      const callsWipeGuard = newCalls.length === 0 && cachedCalls.length > 0;

      // El servidor no trae `messages`; para que nada desaparezca del chat
      // (enviado o pendiente), se conservan los mensajes locales del caché.
      const enrichedChats = chatsWipeGuard
        ? cachedChats
        : newChats.map((fresh) => {
            const prev = cachedChats.find((p) => p.id === fresh.id) as (Chat & { messages?: unknown[] }) | undefined;
            if (Array.isArray(prev?.messages) && prev.messages.length > 0) {
              return { ...fresh, messages: prev.messages };
            }
            return fresh;
          });

      setProfile(newProfile);
      if (!chatsWipeGuard) setChats(enrichedChats);
      if (!contactsWipeGuard) setContacts(newContacts);
      if (!callsWipeGuard) setCalls(newCalls);

      // Si la lista de contactos quedó vacía (caché perdida tras instalar un
      // APK nuevo) pero hay chats 1:1, regístralos automáticamente como
      // contactos para no tener que guardarlos a mano.
      if (!contactsWipeGuard && newContacts.length === 0 && newChats.length > 0) {
        healContactsFromChats(userId, newChats)
          .then((added) => {
            if (added > 0) debugLog("self-healed contacts from chats", { added });
          })
          .catch((err) => logger.error("[SUPABASE] heal contacts failed", { error: err }));
      }

      // Update cache with fresh data (avoid persisting a transient empty result over a healthy cache)
      saveCache(cacheKey(userId, "profile"), newProfile);
      if (!chatsWipeGuard) chatRepo.saveChats(userId, enrichedChats);
      if (!contactsWipeGuard) contactRepo.saveContacts(userId, newContacts);
      if (!callsWipeGuard) saveCache(cacheKey(userId, "calls"), newCalls);
      
      loadingUserDataRef.current = false;
      debugLog("loadUserData complete");
    } catch (err) {
      loadingUserDataRef.current = false;
      debugLog("loadUserData error", err);
    }

    registerPushNotifications(userId).catch(err => logger.error("[SupabaseContext] registerPushNotifications failed", { error: err }));
    setupCapacitorPush(userId).catch(err => logger.error("[SupabaseContext] setupCapacitorPush failed", { error: err }));

    // Clean up any existing presence channel for this user before creating a new one
    if (presenceChannelRef.current) {
      supabase.removeChannel(presenceChannelRef.current);
      presenceChannelRef.current = null;
      presenceChannelConnectedRef.current = false;
    }

    // Reconexión de canales globales (mismo patrón que chats.ts):
    // backoff exponencial + jitter, tope 10 intentos.
    const GLOBAL_MAX_RECONNECT_ATTEMPTS = 10;
    const GLOBAL_BASE_RECONNECT_DELAY = 1000;
    const GLOBAL_MAX_RECONNECT_DELAY = 30000;

    const scheduleGlobalReconnect = (
      key: "presence" | "profiles" | "participants",
      status: string,
      recreate: () => void
    ) => {
      const st = globalChannelsRetryRef.current[key];
      if (st.attempt >= GLOBAL_MAX_RECONNECT_ATTEMPTS) {
        logger.error("[SUPABASE] Global realtime channel max reconnect attempts reached", { key, userId });
        return;
      }
      st.attempt++;
      const delay = Math.min(GLOBAL_BASE_RECONNECT_DELAY * Math.pow(2, st.attempt - 1), GLOBAL_MAX_RECONNECT_DELAY);
      const jitter = Math.random() * 1000;
      logger.warn("[SUPABASE] Global realtime channel issue, scheduling reconnect", { key, status, userId, attempt: st.attempt, delay: Math.round(delay + jitter) });
      if (st.timer) clearTimeout(st.timer);
      st.timer = setTimeout(() => {
        st.timer = null;
        recreate();
      }, delay + jitter);
    };

    const globalRetrySuccess = (key: "presence" | "profiles" | "participants") => {
      const st = globalChannelsRetryRef.current[key];
      st.attempt = 0;
      if (st.timer) {
        clearTimeout(st.timer);
        st.timer = null;
      }
    };

    // Set online status and track presence
    const createPresenceChannel = () => {
      if (presenceChannelRef.current) {
        supabase.removeChannel(presenceChannelRef.current);
        presenceChannelRef.current = null;
      }
      const channel = supabase.channel(`presence-global-${userId}`, {
        config: { broadcast: { ack: false, self: false } },
      });
      channel.on("presence", { event: "sync" }, () => {
        const state = channel.presenceState();
        const isOnline = Object.keys(state).length > 0;
        if (!isOnline) {
          updatePresenceDebounced(userId, "offline");
        }
      });
      channel.on("presence", { event: "join" }, () => {
        updatePresenceDebounced(userId, "online");
      });
      channel.on("presence", { event: "leave" }, () => {
        updatePresenceDebounced(userId, "offline");
      });
      channel.subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({ user_id: userId, online_at: new Date().toISOString() });
          presenceChannelConnectedRef.current = true;
          globalRetrySuccess("presence");
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          presenceChannelConnectedRef.current = false;
          scheduleGlobalReconnect("presence", status, createPresenceChannel);
        }
      });
      presenceChannelRef.current = channel;
    };
    supabase.from("profiles").update({ status: "online" }).eq("id", userId).then(() => {}).catch(() => {});
    supabase.from("user_presence").upsert(
      { user_id: userId, last_seen: new Date().toISOString(), status: "online" },
      { onConflict: "user_id" }
    ).then(() => {}).catch(() => {});
    createPresenceChannel();

    // Heartbeat: re-set status online every 30s
    if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    heartbeatRef.current = setInterval(() => {
      if (userId && presenceChannelConnectedRef.current) {
        heartbeatWrite(userId);
      }
    }, 30000);

    // Realtime subscription on profiles to update chat list online status
    const createProfilesChannel = () => {
      if (profilesChannelRef.current) {
        supabase.removeChannel(profilesChannelRef.current);
        profilesChannelRef.current = null;
      }
      const profilesChannel = supabase.channel(`profiles-online-${userId}`);
      profilesChannel.on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "profiles" },
        (payload) => {
          const updated = payload.new as { id: string; status: string };
          setChats((prev) =>
            prev.map((c) => {
              if (c.is_group) return c;
              const partnerId = c.profile_id === userId ? c.admin_id : c.profile_id;
              if (partnerId === updated.id) {
                return { ...c, is_online: updated.status === "online" };
              }
              return c;
            })
          );
        }
      );
      profilesChannel.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          globalRetrySuccess("profiles");
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          scheduleGlobalReconnect("profiles", status, createProfilesChannel);
        }
      });
      profilesChannelRef.current = profilesChannel;
    };
    createProfilesChannel();

    // Subscribe to chat_participants to detect when user is added to a group
    const createParticipantsChannel = () => {
      if (participantsChannelRef.current) {
        supabase.removeChannel(participantsChannelRef.current);
        participantsChannelRef.current = null;
      }
      const participantsChannel = supabase.channel(`chat-participants-${userId}`);
      participantsChannel.on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_participants", filter: `profile_id=eq.${userId}` },
        async (payload: any) => {
          logger.info("🔥 REALTIME chat_participants INSERT received", { payload });
          const chatId = payload.new?.chat_id;
          if (!chatId) {
            logger.warn("[SUPABASE] chat_participants INSERT event missing chat_id", { payload });
            return;
          }
          logger.info("[SUPABASE] New chat_participant for chat", { chatId });
          try {
            const { data: chatData, error: chatError } = await supabase
              .from("chats")
              .select("*")
              .eq("id", chatId)
              .single();
            if (chatError) {
              logger.error("[SUPABASE] Failed to fetch new chat (RLS?)", { error: chatError });
              return;
            }
            if (!chatData) {
              logger.warn("[SUPABASE] New chat not found", { chatId });
              return;
            }
            logger.info("[SUPABASE] Fetched new chat data", { chatData });

            // Update React state (prepend to chat list)
            setChats(prev => {
              if (prev.some(c => c.id === chatId)) {
                logger.info("[SUPABASE] Chat already in list, skipping", { chatId });
                return prev;
              }
              logger.info("[SUPABASE] Prepending chat to list", { chatId });
              // ═══════════════ TEMPORAL LOG — ELIMINAR DESPUÉS ═══════════════
              console.log("[NAME RESOLUTION - PARTICIPANT INSERT]", JSON.stringify({
                chatId: (chatData as any).id,
                rawChatName: (chatData as any).name,
                profileId: (chatData as any).profile_id,
                adminId: (chatData as any).admin_id,
              }));
              // ═══════════════ FIN TEMPORAL LOG ═══════════════
              return [chatData as Chat, ...prev];
            });

            // Persist to SQLite so the chat survives app restarts
            try {
              const existingChats = await chatRepo.getChats(userId);
              if (!existingChats.some(c => c.id === chatId)) {
                await chatRepo.saveChats(userId, [chatData as Chat, ...existingChats]);
                logger.info("[SUPABASE] Saved new chat to SQLite", { chatId });
              }
            } catch (sqliteErr) {
              logger.warn("[SUPABASE] Failed to persist new chat to SQLite", { error: sqliteErr });
            }

            const groupName = (chatData as any).name || "Grupo";
            const isCreator = (chatData as any).admin_id === userId || (chatData as any).profile_id === userId;
            if (!isCreator) {
              toast.success(`Te agregaron al grupo "${groupName}"`);
            }
          } catch (e) {
            logger.error("[SUPABASE] Error processing chat_participants event", { error: e });
          }
        }
      );
      participantsChannel.subscribe((status: string) => {
        logger.info("[SUPABASE] chat_participants channel status", { status, userId });
        if (status === "SUBSCRIBED") {
          logger.info("[SUPABASE] chat_participants SUBSCRIBED — listening for new groups.");
          globalRetrySuccess("participants");
        } else if (status === "CHANNEL_ERROR") {
          logger.error("[SUPABASE] CHANNEL_ERROR on chat_participants — Realtime may not be enabled for this table in Supabase dashboard, or RLS is blocking.");
          scheduleGlobalReconnect("participants", status, createParticipantsChannel);
        } else if (status === "TIMED_OUT") {
          logger.error("[SUPABASE] TIMED_OUT on chat_participants — network issue or server unreachable.");
          scheduleGlobalReconnect("participants", status, createParticipantsChannel);
        } else if (status === "CLOSED") {
          logger.warn("[SUPABASE] chat_participants channel CLOSED, will not receive events.");
          scheduleGlobalReconnect("participants", status, createParticipantsChannel);
        }
      });
      participantsChannelRef.current = participantsChannel;
    };
    createParticipantsChannel();

    // beforeunload: set offline on tab/browser close
    const handleBeforeUnload = () => {
      presenceChannelRef.current?.untrack();
      if (userId) {
        flushPresence(userId);
      }
    };

    // visibilitychange: toggle online/offline when app goes to background (debounced)
    const handleVisibility = () => {
      if (!userId) return;
      if (document.hidden) {
        presenceChannelRef.current?.untrack();
        if (heartbeatRef.current) clearInterval(heartbeatRef.current);
        updatePresenceDebounced(userId, "offline");
      } else {
        updatePresenceDebounced(userId, "online");
        presenceChannelRef.current?.track({ user_id: userId, online_at: new Date().toISOString() });
        if (!heartbeatRef.current) {
          heartbeatRef.current = setInterval(() => {
            if (!presenceChannelConnectedRef.current) return;
            heartbeatWrite(userId);
          }, 30000);
        }
        // Refresh chats when user returns to the tab
        getChats(userId).then(fresh => {
          if (!fresh) return;
          // ═══════════════ TEMPORAL LOG — ELIMINAR DESPUÉS ═══════════════
          for (const fc of fresh) {
            if (!fc.is_group) {
              const prevChat = chatsRef.current.find(c => c.id === fc.id);
              console.log("[NAME RESOLUTION - VISIBILITY CHANGE]", JSON.stringify({
                chatId: fc.id,
                freshName: fc.name,
                previousName: prevChat?.name || null,
                profileId: fc.profile_id,
                adminId: fc.admin_id,
                nameChanged: prevChat && prevChat.name !== fc.name,
              }));
            }
          }
          // ═══════════════ FIN TEMPORAL LOG ═══════════════
          setChats(prev => {
            const merged = new Map<string, Chat>();
            for (const c of fresh) merged.set(c.id, c);
            for (const c of prev) if (!merged.has(c.id)) merged.set(c.id, c);
            return Array.from(merged.values());
          });
        });
        // Refresh contacts too: resuelve avatar/nombre desde profiles, así una
        // foto de perfil que el contacto actualizó se refleja al volver a la app.
        refreshContacts().catch(() => {});
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("visibilitychange", handleVisibility);

    // Auto-refresh al volver el internet: sin salir de la app, perfil/chats/
    // contactos se actualizan solos. Debounce corto para no martillar el
    // servidor si la señal "flapa" online/offline seguido.
    let onlineRefreshTimer: ReturnType<typeof setTimeout> | null = null;
    const handleOnline = () => {
      if (!userId) return;
      if (onlineRefreshTimer) clearTimeout(onlineRefreshTimer);
      onlineRefreshTimer = setTimeout(() => {
        logger.info("[SUPABASE] Online — refreshing profile/chats/contacts");
        refreshProfile();
        refreshChats();
        refreshContacts();
      }, 800);
    };
    window.addEventListener("online", handleOnline);

    // En Android el evento `window.online` del WebView no siempre se dispara al
    // recuperar la red. El plugin de Capacitor sí detecta el cambio de forma
    // fiable: al reconectar, hacemos el mismo refresco (fotos/nombres de los
    // chats se re-resuelven desde profiles).
    let capNetworkHandler: { remove: () => Promise<void> } | null = null;
    Network.addListener("networkStatusChange", (status) => {
      if (status.connected) handleOnline();
    })
      .then((handle) => {
        capNetworkHandler = handle;
      })
      .catch((e) => {
        logger.warn("[SUPABASE] Network.addListener failed", { error: e });
      });

    // Fallback: poll for new chats every 60s (catches anything Realtime misses).
    // Pausado en background (appStateChange); al volver a foreground se reinicia
    // y corre una pasada inmediata para no esperar hasta 60s.
    const runDiscoveryPoll = async () => {
      try {
        const fresh = await getChats(userId);
        if (!fresh || fresh.length === 0) return;
        const knownIds = new Set(chatsRef.current.map(c => c.id));
        const newChats = fresh.filter(c => !knownIds.has(c.id));
        if (newChats.length === 0) return;
        logger.info("[SUPABASE] Poll found new chat(s)", { chatIds: newChats.map(c => c.id) });
        setChats(prev => {
          const existing = new Set(prev.map(c => c.id));
          const toAdd = newChats.filter(c => !existing.has(c.id));
          if (toAdd.length === 0) return prev;
          return [...toAdd, ...prev];
        });
      } catch (e) {
        logger.warn("[SUPABASE] Discovery poll error", { error: e });
      }
    };
    const startDiscoveryPoll = () => {
      if (discoveryPollRef.current) clearInterval(discoveryPollRef.current);
      discoveryPollRef.current = setInterval(runDiscoveryPoll, 60000);
    };
    startDiscoveryPoll();

    let capAppStateHandler: { remove: () => Promise<void> } | null = null;
    CapacitorApp.addListener("appStateChange", ({ isActive }) => {
      // ── Presence: background/foreground nativo de Capacitor ──
      // En Android, visibilitychange y beforeunload NO son confiables.
      // Este listener es la fuente PRIMARIA de presencia en móvil.
      if (!userId) return;
      if (!isActive) {
        // BACKGROUND / CIERRE: marcar offline INMEDIATO (sin debounce)
        if (heartbeatRef.current) { clearInterval(heartbeatRef.current); heartbeatRef.current = null; }
        presenceChannelRef.current?.untrack();
        presenceChannelConnectedRef.current = false;
        supabase.from("profiles").update({ status: "offline" }).eq("id", userId).then(() => {
          logger.info("[Presence] Background → offline (immediate)");
        }).catch(() => {});
        supabase.from("user_presence").upsert(
          { user_id: userId, last_seen: new Date().toISOString(), status: "offline" },
          { onConflict: "user_id" }
        ).then(() => {}).catch(() => {});
      } else {
        // FOREGROUND: marcar online + reconectar presence channel + heartbeat
        supabase.from("profiles").update({ status: "online" }).eq("id", userId).then(() => {
          logger.info("[Presence] Foreground → online (immediate)");
        }).catch(() => {});
        supabase.from("user_presence").upsert(
          { user_id: userId, last_seen: new Date().toISOString(), status: "online" },
          { onConflict: "user_id" }
        ).then(() => {}).catch(() => {});
        if (presenceChannelRef.current && presenceChannelConnectedRef.current) {
          presenceChannelRef.current.track({ user_id: userId, online_at: new Date().toISOString() }).catch(() => {});
        } else {
          createPresenceChannel();
        }
        if (!heartbeatRef.current) {
          heartbeatRef.current = setInterval(() => {
            if (userId && presenceChannelConnectedRef.current) {
              heartbeatWrite(userId);
            }
          }, 30000);
        }
        // Refrescar lista de chats para actualizar estados visuales
        getChats(userId).then(fresh => {
          if (!fresh || fresh.length === 0) return;
          setChats(prev => {
            const merged = new Map<string, Chat>();
            for (const c of fresh) merged.set(c.id, c);
            for (const c of prev) if (!merged.has(c.id)) merged.set(c.id, c);
            return Array.from(merged.values());
          });
        }).catch(() => {});
      }

      // ── Discovery poll: pausar en background, reanudar en foreground ──
      if (isActive) {
        startDiscoveryPoll();
        runDiscoveryPoll();
      } else {
        if (discoveryPollRef.current) {
          clearInterval(discoveryPollRef.current);
          discoveryPollRef.current = null;
        }
      }
    })
      .then((handle) => {
        capAppStateHandler = handle as unknown as { remove: () => Promise<void> };
      })
      .catch((e) => {
        logger.warn("[SUPABASE] App.addListener failed", { error: e });
      });

    // Store cleanup for use in logout/unmount
    if (cleanupListenersRef.current) cleanupListenersRef.current();
    cleanupListenersRef.current = () => {
      if (onlineRefreshTimer) clearTimeout(onlineRefreshTimer);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("online", handleOnline);
      if (capAppStateHandler) {
        capAppStateHandler.remove();
        capAppStateHandler = null;
      }
      if (capNetworkHandler) {
        capNetworkHandler.remove();
        capNetworkHandler = null;
      }
    };
  }

  const refreshProfile = async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();
    if (!error && data) {
      setProfile(data as Profile);
      saveCache(cacheKey(user.id, "profile"), data as Profile);
    }
  };

const refreshChats = async () => {
    if (!user) return;
    const ch = await getChats(user.id);
    // ═══════════════ TEMPORAL LOG — ELIMINAR DESPUÉS ═══════════════
    console.log("[NAME RESOLUTION - REFRESHCHATS]", JSON.stringify({
      trigger: new Error().stack?.split("\n")[2]?.trim()?.slice(0, 80) || "unknown",
      chatsReturned: ch.length,
      chatNames: ch.filter(c => !c.is_group).map(c => ({ id: c.id, name: c.name, profile_id: c.profile_id, admin_id: c.admin_id })),
    }));
    // ═══════════════ FIN TEMPORAL LOG ═══════════════
    const withMessages = ch.map((fresh) => {
      const prev = chatsRef.current.find((p) => p.id === fresh.id) as (Chat & { messages?: unknown[] }) | undefined;
      if (Array.isArray(prev?.messages) && prev.messages.length > 0) {
        return { ...fresh, messages: prev.messages };
      }
      return fresh;
    });
    setChats(withMessages);
    chatRepo.saveChats(user.id, withMessages);
  };

  const removeChatFromContext = useCallback((chatId: string) => {
    setChats(prev => prev.filter(c => c.id !== chatId));
    if (user) {
      chatRepo.getChats(user.id).then(cached => {
        chatRepo.saveChats(user.id, cached.filter(c => c.id !== chatId));
      }).catch(() => {});
    }
  }, [user]);

  const refreshContacts = async (allowEmpty = false) => {
    if (!user) return;
    let cont = await getContacts(user.id);
    // ante un fetch vacío puntual (red inestable) se conserva la última lista buena
    if (cont.length === 0 && !allowEmpty) {
      const lastGood = lastKnownContacts.get(user.id);
      if (lastGood && lastGood.length > 0) cont = lastGood;
    }
    const wipeGuard = !allowEmpty && cont.length === 0 && contactsRef.current.length > 0;
    if (wipeGuard) {
      logger.warn("[SUPABASE] refreshContacts returned empty — keeping cached contacts");
      return;
    }
    setContacts(cont);
    if (cont.length > 0) lastKnownContacts.set(user.id, cont);
    contactRepo.saveContacts(user.id, cont);
  };

  const refreshCalls = async () => {
    if (!user) return;
    const cl = await getCalls(user.id);
    setCalls(cl);
    saveCache(cacheKey(user.id, "calls"), cl);
  };

  const completePasswordReset = async (newPassword: string) => {
    const uid = user?.id;
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw error;
    setPasswordRecovery(false);
    setLoading(false);
    clearLastUser();
    await authSignOut();
    loadedUserId.current = null;
    setUser(null);
    setProfile(null);
    setChats([]);
    setContacts([]);
    setCalls([]);
    if (uid) clearUserCache(uid);
  };

  const logout = async () => {
    // Manual logout: clear the remembered user so SIGNED_OUT goes to login screen
    clearLastUser();
    // Clean up heartbeat, discovery poll, channels, presence channel, event listeners
    if (heartbeatRef.current) { clearInterval(heartbeatRef.current); heartbeatRef.current = null; }
    if (discoveryPollRef.current) { clearInterval(discoveryPollRef.current); discoveryPollRef.current = null; }
    cancelGlobalChannelRetries();
    if (profilesChannelRef.current) { supabase.removeChannel(profilesChannelRef.current); profilesChannelRef.current = null; }
    if (participantsChannelRef.current) { supabase.removeChannel(participantsChannelRef.current); participantsChannelRef.current = null; }
    presenceChannelRef.current?.untrack();
    presenceChannelRef.current?.unsubscribe();
    presenceChannelRef.current = null;
    presenceChannelConnectedRef.current = false;
    cleanupListenersRef.current?.();
    cleanupListenersRef.current = null;
    if (user) {
      flushPresence(user.id);
    }
    await unregisterPushNotifications();
    await unregisterCapacitorPush();
    await authSignOut();
    if (user) {
      clearUserCache(user.id);
      await Promise.all([
        chatRepo.clearChats(user.id),
        contactRepo.clearContacts(user.id),
      ]);
    }
    loadedUserId.current = null;
    setUser(null);
    setProfile(null);
    setChats([]);
    setContacts([]);
    setCalls([]);
  };

  const contextValue = useMemo(() => ({
    user,
    profile,
    loading,
    chats,
    contacts,
    calls,
    passwordRecovery,
    completePasswordReset,
    refreshProfile,
    refreshChats,
    refreshContacts,
    refreshCalls,
    removeChatFromContext,
    logout,
  }), [user, profile, loading, chats, contacts, calls, passwordRecovery, completePasswordReset, refreshProfile, refreshChats, refreshContacts, refreshCalls, removeChatFromContext, logout]);

  return (
    <SupabaseContext.Provider
      value={contextValue}
    >
      {children}
    </SupabaseContext.Provider>
  );
}

export function useSupabase() {
  const context = useContext(SupabaseContext);
  if (!context) {
    throw new Error("useSupabase must be used within a SupabaseProvider");
  }
  return context;
}
