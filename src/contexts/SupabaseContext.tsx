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
      if (userId && userId !== loadedUserId.current) {
        setUser(session.user);
        loadUserData(userId);
      } else if (!userId && event !== "SIGNED_UP") {
        setUser(null);
        setProfile(null);
        setChats([]);
        setContacts([]);
        setCalls([]);
        setLoading(false);
      }
    });

    return () => listener?.subscription?.unsubscribe();
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
  }

  const refreshProfile = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();
    setProfile(data as Profile);
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
    presenceChannelRef.current?.untrack();
    presenceChannelRef.current?.unsubscribe();
    if (user) {
      await supabase.from("profiles").update({ status: "offline" }).eq("id", user.id);
    }
    await unregisterPushNotifications();
    await unregisterCapacitorPush();
    await authSignOut();
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
