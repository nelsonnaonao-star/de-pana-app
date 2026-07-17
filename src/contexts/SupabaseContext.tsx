import React, { createContext, useContext, useEffect, useState, useRef, ReactNode } from "react";
import { supabase } from "../lib/supabase";
import { Profile, signOut as authSignOut } from "../services/auth";
import { Chat, getChats } from "../services/chats";
import { Contact, getContacts } from "../services/contacts";
import { Call, getCalls } from "../services/calls";
import { registerPushNotifications, unregisterPushNotifications } from "../services/pushNotifications";
import { setupCapacitorPush, unregisterCapacitorPush } from "../services/pushCapacitor";
import toast from "react-hot-toast";

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
  const presenceChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const profilesChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cleanupListenersRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session }, error }) => {
      console.log("[SUPABASE] Session on mount:", session ? "EXISTS" : "NULL", "Error:", error);
      setUser(session?.user || null);
      if (session?.user) {
        loadUserData(session.user.id);
      } else {
        setLoading(false);
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      const userId = session?.user?.id;
      console.log("[AUTH]", event, userId ? userId.slice(0, 8) + "..." : "null");

      switch (event) {
        case "SIGNED_IN":
          if (userId) {
            setUser(session.user);
            loadUserData(userId);
          }
          break;

        case "SIGNED_OUT":
          loadedUserId.current = null;
          setUser(null);
          setProfile(null);
          setChats([]);
          setContacts([]);
          setCalls([]);
          setLoading(false);
          break;

        case "TOKEN_REFRESHED":
          if (userId && session) {
            setUser(session.user);
          }
          break;

        case "INITIAL_SESSION":
          if (userId && !loadedUserId.current) {
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
      // Clean up presence, heartbeat, profiles channel, event listeners on unmount
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      if (profilesChannelRef.current) supabase.removeChannel(profilesChannelRef.current);
      presenceChannelRef.current?.untrack();
      cleanupListenersRef.current?.();
    };
  }, []);

  async function loadUserData(userId: string) {
    loadedUserId.current = userId;
    try {
      const [profilesResult, chatsResult, contactsResult, callsResult] = await Promise.allSettled([
        supabase.from("profiles").select("*").eq("id", userId).single(),
        getChats(userId),
        getContacts(userId),
        getCalls(userId),
      ]);

      if (profilesResult.status === "fulfilled" && profilesResult.value.error) {
        console.warn("[SUPABASE] Profile fetch error:", profilesResult.value.error);
      }
      setProfile(profilesResult.status === "fulfilled" ? (profilesResult.value.data as Profile) || null : null);
      setChats(chatsResult.status === "fulfilled" ? chatsResult.value || [] : []);
      setContacts(contactsResult.status === "fulfilled" ? contactsResult.value || [] : []);
      setCalls(callsResult.status === "fulfilled" ? callsResult.value || [] : []);
    } catch (err) {
      console.error("[SUPABASE] loadUserData error:", err);
    } finally {
      setLoading(false);
    }

    registerPushNotifications(userId).catch(() => {});
    setupCapacitorPush(userId).catch(() => {});

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
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("visibilitychange", handleVisibility);

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
    }
  };

  const refreshChats = async () => {
    if (!user) return;
    const ch = await getChats(user.id);
    setChats(ch);
  };

  const refreshContacts = async () => {
    if (!user) return;
    const cont = await getContacts(user.id);
    setContacts(cont);
  };

  const refreshCalls = async () => {
    if (!user) return;
    const cl = await getCalls(user.id);
    setCalls(cl);
  };

  const logout = async () => {
    // Clean up heartbeat, profiles channel, presence channel, event listeners
    if (heartbeatRef.current) { clearInterval(heartbeatRef.current); heartbeatRef.current = null; }
    if (profilesChannelRef.current) { supabase.removeChannel(profilesChannelRef.current); profilesChannelRef.current = null; }
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
