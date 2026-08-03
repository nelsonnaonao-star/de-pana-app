import React, { createContext, useContext, useEffect, useState, useRef, ReactNode } from "react";

declare global {
  interface Window {
    __debugChats: () => Promise<void>;
    __startAutoDebug: () => void;
    __stopAutoDebug: () => void;
    __autoDebugInterval: ReturnType<typeof setInterval> | null;
  }
}
import { supabase } from "../lib/supabase";
import { Profile, signOut as authSignOut } from "../services/auth";
import { Chat, getChats } from "../services/chats";
import { Contact, getContacts } from "../services/contacts";
import { Call, getCalls } from "../services/calls";
import { registerPushNotifications, unregisterPushNotifications } from "../services/pushNotifications";
import { setupCapacitorPush, unregisterCapacitorPush } from "../services/pushCapacitor";
import { chatRepo } from "../services/database/repositories/ChatRepository";
import { contactRepo } from "../services/database/repositories/ContactRepository";
import toast from "react-hot-toast";

const CACHE_PREFIX = "redon_cache_";
const cacheKey = (uid: string, name: string) => `${CACHE_PREFIX}${name}_${uid}`;

function loadCache<T>(key: string, fallback: T): T {
  try {
    const stored = localStorage.getItem(key);
    if (stored) return JSON.parse(stored) as T;
  } catch {}
  return fallback;
}

function saveCache<T>(key: string, data: T) {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch {}
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
  } catch {}
}

const LAST_USER_KEY = "redon_last_user";

function saveLastUser(userId: string) {
  try {
    localStorage.setItem(LAST_USER_KEY, JSON.stringify({ id: userId }));
  } catch {}
}

function loadLastUser(): { id: string } | null {
  try {
    const raw = localStorage.getItem(LAST_USER_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.id === "string" && parsed.id.length >= 8) return parsed;
    }
  } catch {}
  return null;
}

function clearLastUser() {
  try {
    localStorage.removeItem(LAST_USER_KEY);
  } catch {}
}

function withTimeout<T>(promise: PromiseLike<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)),
  ]);
}

function debugLog(label: string, data?: any) {
  console.log(`[SUPABASE] ${label}:`, data);
}

interface SupabaseContextType {
  user: any | null;
  profile: Profile | null;
  loading: boolean;
  chats: Chat[];
  contacts: Contact[];
  calls: Call[];
  refreshProfile: () => Promise<void>;
  refreshChats: () => Promise<void>;
  refreshContacts: () => Promise<void>;
  refreshCalls: () => Promise<void>;
  logout: () => Promise<void>;
}

const SupabaseContext = createContext<SupabaseContextType | undefined>(undefined);

export function SupabaseProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<any | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [chats, setChats] = useState<Chat[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [calls, setCalls] = useState<Call[]>([]);
  const [loading, setLoading] = useState(true);

  const loadedUserId = useRef<string | null>(null);
  const loadingUserDataRef = useRef(false);
  const presenceChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const profilesChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const participantsChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const discoveryPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chatsRef = useRef<Chat[]>([]);
  const cleanupListenersRef = useRef<(() => void) | null>(null);

  // Keep chatsRef in sync with chats state (used by discovery poll)
  useEffect(() => { chatsRef.current = chats; }, [chats]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session }, error }) => {
      console.log("[SUPABASE] Session on mount:", session ? "EXISTS" : "NULL", "Error:", error);
      if (session?.user) {
        saveLastUser(session.user.id);
        setUser(session.user);
        if (!loadedUserId.current) {
          loadUserData(session.user.id);
        }
      } else {
        // No session (offline or expired). If we know a last user, enter in
        // offline mode with cached data instead of forcing the login screen.
        const lastUser = loadLastUser();
        if (lastUser?.id) {
          console.log("[SUPABASE] No session — restoring offline mode for last user:", lastUser.id.slice(0, 8));
          setUser({ id: lastUser.id });
          if (!loadedUserId.current) {
            loadUserData(lastUser.id);
          } else {
            setLoading(false);
          }
        } else {
          setLoading(false); // First-time / real sign-out: show login
        }
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      const userId = session?.user?.id;
      console.log("[AUTH]", event, userId ? userId.slice(0, 8) + "..." : "null");

      switch (event) {
        case "SIGNED_IN":
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
            console.log("[SUPABASE] SIGNED_OUT without manual logout — restoring offline mode:", lastUser.id.slice(0, 8));
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

    return () => {
      listener?.subscription?.unsubscribe();
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      if (discoveryPollRef.current) clearInterval(discoveryPollRef.current);
      if (profilesChannelRef.current) supabase.removeChannel(profilesChannelRef.current);
      if (participantsChannelRef.current) supabase.removeChannel(participantsChannelRef.current);
      presenceChannelRef.current?.untrack();
      cleanupListenersRef.current?.();
    };
  }, []);

  async function loadUserData(userId: string) {
    if (loadedUserId.current === userId) return;
    loadedUserId.current = userId;
    loadingUserDataRef.current = true;
    debugLog("loadUserData start", { userId });

    // Load cached data immediately for instant UI (scoped to userId)
    const cachedProfile = loadCache<Profile | null>(cacheKey(userId, "profile"), null);
    const [cachedChats, cachedContacts] = await Promise.all([
      chatRepo.getChats(userId),
      contactRepo.getContacts(userId),
    ]);
    const cachedCalls = loadCache<Call[]>(cacheKey(userId, "calls"), []);
    
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

      const hasProfileError = profilesResult.status === "fulfilled" && profilesResult.value?.error;
      if (hasProfileError) {
        debugLog("Profile fetch error", { message: profilesResult.value.error.message, code: profilesResult.value.error.code, details: profilesResult.value.error.details, hint: profilesResult.value.error.hint });
      }
      const newProfile = profilesResult.status === "fulfilled" && profilesResult.value?.data ? (profilesResult.value.data as Profile) : cachedProfile;
      const newChats = chatsResult.status === "fulfilled" ? chatsResult.value || [] : cachedChats;
      const newContacts = contactsResult.status === "fulfilled" ? contactsResult.value || [] : cachedContacts;
      const newCalls = callsResult.status === "fulfilled" ? callsResult.value || [] : cachedCalls;

      debugLog("setting fresh data", {
        profile: !!newProfile,
        chatsCount: newChats.length,
        contactsCount: newContacts.length,
        callsCount: newCalls.length,
      });

      setProfile(newProfile);
      setChats(newChats);
      setContacts(newContacts);
      setCalls(newCalls);

      // Update cache with fresh data (always save, even if empty, to overwrite stale data)
      saveCache(cacheKey(userId, "profile"), newProfile);
      chatRepo.saveChats(userId, newChats);
      contactRepo.saveContacts(userId, newContacts);
      saveCache(cacheKey(userId, "calls"), newCalls);
      
      loadingUserDataRef.current = false;
      debugLog("loadUserData complete");
    } catch (err) {
      loadingUserDataRef.current = false;
      debugLog("loadUserData error", err);
    }

    registerPushNotifications(userId).catch(err => console.error("[SupabaseContext] registerPushNotifications failed:", err));
    setupCapacitorPush(userId).catch(err => console.error("[SupabaseContext] setupCapacitorPush failed:", err));

    // Clean up any existing presence channel for this user before creating a new one
    if (presenceChannelRef.current) {
      supabase.removeChannel(presenceChannelRef.current);
      presenceChannelRef.current = null;
    }

    // Set online status and track presence
    supabase.from("profiles").update({ status: "online" }).eq("id", userId).then(() => {
      if (presenceChannelRef.current) return; // already set up by another call
      const channel = supabase.channel(`presence-global-${userId}`, {
        config: { broadcast: { ack: false, self: false } },
      });
      channel.on("presence", { event: "sync" }, () => {
        const state = channel.presenceState();
        const isOnline = Object.keys(state).length > 0;
        if (!isOnline) {
          supabase.from("profiles").update({ status: "offline" }).eq("id", userId);
        }
      });
      channel.on("presence", { event: "join" }, () => {
        supabase.from("profiles").update({ status: "online" }).eq("id", userId);
      });
      channel.on("presence", { event: "leave" }, () => {
        supabase.from("profiles").update({ status: "offline" }).eq("id", userId);
      });
      channel.subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({ user_id: userId, online_at: new Date().toISOString() });
        }
      });
      presenceChannelRef.current = channel;
    });

    // Heartbeat: re-set status online every 30s
    if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    heartbeatRef.current = setInterval(() => {
      if (userId) {
        supabase.from("profiles").update({ status: "online" }).eq("id", userId).then(() => {});
      }
    }, 30000);

    // Realtime subscription on profiles to update chat list online status
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
    profilesChannel.subscribe();
    profilesChannelRef.current = profilesChannel;

    // Subscribe to chat_participants to detect when user is added to a group
    if (participantsChannelRef.current) {
      supabase.removeChannel(participantsChannelRef.current);
    }
    const participantsChannel = supabase.channel(`chat-participants-${userId}`);
    participantsChannel.on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "chat_participants", filter: `profile_id=eq.${userId}` },
      async (payload: any) => {
        console.log("🔥 REALTIME chat_participants INSERT received:", payload);
        const chatId = payload.new?.chat_id;
        if (!chatId) {
          console.warn("[SUPABASE] chat_participants INSERT event missing chat_id", payload);
          return;
        }
        console.log("[SUPABASE] New chat_participant for chat:", chatId);
        try {
          const { data: chatData, error: chatError } = await supabase
            .from("chats")
            .select("*")
            .eq("id", chatId)
            .single();
          if (chatError) {
            console.error("[SUPABASE] Failed to fetch new chat (RLS?):", chatError);
            return;
          }
          if (!chatData) {
            console.warn("[SUPABASE] New chat not found:", chatId);
            return;
          }
          console.log("[SUPABASE] Fetched new chat data:", chatData);

          // Update React state (prepend to chat list)
          setChats(prev => {
            if (prev.some(c => c.id === chatId)) {
              console.log("[SUPABASE] Chat already in list, skipping:", chatId);
              return prev;
            }
            console.log("[SUPABASE] Prepending chat to list:", chatId);
            return [chatData as Chat, ...prev];
          });

          // Persist to SQLite so the chat survives app restarts
          try {
            const existingChats = await chatRepo.getChats(userId);
            if (!existingChats.some(c => c.id === chatId)) {
              await chatRepo.saveChats(userId, [chatData as Chat, ...existingChats]);
              console.log("[SUPABASE] Saved new chat to SQLite:", chatId);
            }
          } catch (sqliteErr) {
            console.warn("[SUPABASE] Failed to persist new chat to SQLite:", sqliteErr);
          }

          const groupName = (chatData as any).name || "Grupo";
          const isCreator = (chatData as any).admin_id === userId || (chatData as any).profile_id === userId;
          if (!isCreator) {
            toast.success(`Te agregaron al grupo "${groupName}"`);
          }
        } catch (e) {
          console.error("[SUPABASE] Error processing chat_participants event:", e);
        }
      }
    );
    participantsChannel.subscribe((status: string) => {
      console.log("[SUPABASE] chat_participants channel status:", status, "for user:", userId);
      if (status === "CHANNEL_ERROR") {
        console.error("[SUPABASE] ❌ CHANNEL_ERROR on chat_participants — Realtime may not be enabled for this table in Supabase dashboard, or RLS is blocking.");
      } else if (status === "TIMED_OUT") {
        console.error("[SUPABASE] ❌ TIMED_OUT on chat_participants — network issue or server unreachable.");
      } else if (status === "CLOSED") {
        console.warn("[SUPABASE] chat_participants channel CLOSED, will not receive events.");
      } else if (status === "SUBSCRIBED") {
        console.log("[SUPABASE] ✅ chat_participants SUBSCRIBED — listening for new groups.");
      }
    });
    participantsChannelRef.current = participantsChannel;

    // beforeunload: set offline on tab/browser close
    const handleBeforeUnload = () => {
      presenceChannelRef.current?.untrack();
      if (userId) {
        supabase.from("profiles").update({ status: "offline" }).eq("id", userId).then(() => {});
      }
    };

    // visibilitychange: toggle online/offline when app goes to background
    const handleVisibility = () => {
      if (!userId) return;
      if (document.hidden) {
        presenceChannelRef.current?.untrack();
        if (heartbeatRef.current) clearInterval(heartbeatRef.current);
        supabase.from("profiles").update({ status: "offline" }).eq("id", userId).then(() => {});
      } else {
        supabase.from("profiles").update({ status: "online" }).eq("id", userId).then(() => {});
        presenceChannelRef.current?.track({ user_id: userId, online_at: new Date().toISOString() });
        if (!heartbeatRef.current) {
          heartbeatRef.current = setInterval(() => {
            supabase.from("profiles").update({ status: "online" }).eq("id", userId).then(() => {});
          }, 30000);
        }
        // Refresh chats when user returns to the tab
        getChats(userId).then(fresh => {
          if (!fresh) return;
          setChats(prev => {
            const merged = new Map<string, Chat>();
            for (const c of fresh) merged.set(c.id, c);
            for (const c of prev) if (!merged.has(c.id)) merged.set(c.id, c);
            return Array.from(merged.values());
          });
        });
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("visibilitychange", handleVisibility);

    // Fallback: poll for new chats every 6s (catches anything Realtime misses)
    if (discoveryPollRef.current) clearInterval(discoveryPollRef.current);
    discoveryPollRef.current = setInterval(async () => {
      try {
        const fresh = await getChats(userId);
        if (!fresh || fresh.length === 0) return;
        const knownIds = new Set(chatsRef.current.map(c => c.id));
        const newChats = fresh.filter(c => !knownIds.has(c.id));
        if (newChats.length === 0) return;
        console.log("[SUPABASE] Poll found new chat(s):", newChats.map(c => c.id));
        setChats(prev => {
          const existing = new Set(prev.map(c => c.id));
          const toAdd = newChats.filter(c => !existing.has(c.id));
          if (toAdd.length === 0) return prev;
          return [...toAdd, ...prev];
        });
      } catch (e) {
        console.warn("[SUPABASE] Discovery poll error:", e);
      }
    }, 6000);

    // Store cleanup for use in logout/unmount
    if (cleanupListenersRef.current) cleanupListenersRef.current();
    cleanupListenersRef.current = () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("visibilitychange", handleVisibility);
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
    setChats(ch);
    chatRepo.saveChats(user.id, ch);
  };

  const refreshContacts = async () => {
    if (!user) return;
    const cont = await getContacts(user.id);
    setContacts(cont);
    contactRepo.saveContacts(user.id, cont);
  };

  const refreshCalls = async () => {
    if (!user) return;
    const cl = await getCalls(user.id);
    setCalls(cl);
    saveCache(cacheKey(user.id, "calls"), cl);
  };

  // Helper: POST logs to debug server (for terminal viewing)
  function sendLog(level: string, ...args: any[]) {
    try {
      fetch("http://localhost:3456", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ level, args: args.map(a => typeof a === "object" ? JSON.stringify(a) : String(a)) }),
      }).catch(() => {});
    } catch {}
  }

  // Expose debug function globally so user can run it from browser console
  window.__debugChats = async () => {
    if (!user) { console.error("No user logged in"); return; }
    const lines: string[] = [];
    const log = (msg: string) => { lines.push(msg); console.log(msg); sendLog("info", msg); };
    log("=== CHAT DIAGNOSTIC ===");
    log("User ID: " + user.id);
    // 1. Check chat_participants
    const { data: myParts, error: partErr } = await supabase
      .from("chat_participants")
      .select("chat_id, profile_id");
    log("chat_participants: " + JSON.stringify(myParts) + " Error: " + JSON.stringify(partErr));
    // 2. Check chats SELECT via RLS
    const { data: allChats, error: chatErr } = await supabase
      .from("chats")
      .select("*");
    log("chats (all via RLS): " + (allChats?.length || 0) + " Error: " + JSON.stringify(chatErr));
    if (allChats) {
      for (const c of allChats) log("  Chat: " + c.id + " " + c.name + " is_group:" + c.is_group + " profile_id:" + c.profile_id + " admin_id:" + c.admin_id);
    }
    // 3. Check direct participant chats
    const { data: directChats } = await supabase
      .from("chats")
      .select("*")
      .or(`profile_id.eq.${user.id},admin_id.eq.${user.id}`);
    log("direct chats count: " + (directChats?.length || 0));
    // 4. Try fetching chat_participants for each chat
    if (myParts) {
      for (const p of myParts) {
        const { data: chat } = await supabase.from("chats").select("*").eq("id", p.chat_id).single();
        log("Participant chat_id: " + p.chat_id + " fetched: " + (chat?.name || "NULL (RLS BLOCKED)"));
      }
    }
    // 5. Current context chats
    log("Context chats count: " + chats.length);
    log("=== END DIAGNOSTIC ===");
  };

  window.__startAutoDebug = () => {
    console.log("Auto-debug started (every 5s). Run __stopAutoDebug() to stop.");
    if (window.__autoDebugInterval) clearInterval(window.__autoDebugInterval);
    window.__autoDebugInterval = setInterval(() => window.__debugChats(), 5000);
  };
  window.__stopAutoDebug = () => {
    if (window.__autoDebugInterval) {
      clearInterval(window.__autoDebugInterval);
      window.__autoDebugInterval = null;
      console.log("Auto-debug stopped.");
    }
  };

  const logout = async () => {
    // Manual logout: clear the remembered user so SIGNED_OUT goes to login screen
    clearLastUser();
    // Clean up heartbeat, discovery poll, channels, presence channel, event listeners
    if (heartbeatRef.current) { clearInterval(heartbeatRef.current); heartbeatRef.current = null; }
    if (discoveryPollRef.current) { clearInterval(discoveryPollRef.current); discoveryPollRef.current = null; }
    if (profilesChannelRef.current) { supabase.removeChannel(profilesChannelRef.current); profilesChannelRef.current = null; }
    if (participantsChannelRef.current) { supabase.removeChannel(participantsChannelRef.current); participantsChannelRef.current = null; }
    presenceChannelRef.current?.untrack();
    presenceChannelRef.current?.unsubscribe();
    cleanupListenersRef.current?.();
    cleanupListenersRef.current = null;
    if (user) {
      await supabase.from("profiles").update({ status: "offline" }).eq("id", user.id);
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

  return (
    <SupabaseContext.Provider
      value={{
        user,
        profile,
        loading,
        chats,
        contacts,
        calls,
        refreshProfile,
        refreshChats,
        refreshContacts,
        refreshCalls,
        logout,
      }}
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
