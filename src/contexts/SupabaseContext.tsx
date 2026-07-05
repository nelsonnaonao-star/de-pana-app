import React, { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { supabase } from "../lib/supabase";
import { Profile, signOut as authSignOut } from "../services/auth";
import { Chat } from "../services/chats";
import { Contact } from "../services/contacts";
import { Call } from "../services/calls";
import { getAllUserData, getProfileFromServer, getChatsFromServer, getContactsFromServer, getCallsFromServer } from "../services/server-api";
import { registerPushNotifications, unregisterPushNotifications } from "../services/pushNotifications";

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
      setUser(session?.user || null);
      if (session?.user) {
        loadUserData(session.user.id);
      } else if (event !== "SIGNED_UP") {
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
    try {
      const data = await getAllUserData(userId);
      setProfile(data.profile);
      setChats(data.chats);
      setContacts(data.contacts);
      setCalls(data.calls);
    } catch (err) {
      console.warn("loadUserData: /all endpoint failed, trying individual endpoints:", err);
      try {
        const [prof, ch, cont, cl] = await Promise.all([
          getProfileFromServer(userId).catch(() => null),
          getChatsFromServer(userId).catch(() => []),
          getContactsFromServer(userId).catch(() => []),
          getCallsFromServer(userId).catch(() => []),
        ]);
        setProfile(prof);
        setChats(ch);
        setContacts(cont);
        setCalls(cl);
      } catch (e) {
        console.error("loadUserData: individual endpoints also failed:", e);
      }
    } finally {
      setLoading(false);
    }

    registerPushNotifications(userId).catch(() => {});
  }

  const refreshProfile = async () => {
    if (!user) return;
    const prof = await getProfileFromServer(user.id);
    setProfile(prof);
  };

  const refreshChats = async () => {
    if (!user) return;
    const ch = await getChatsFromServer(user.id);
    setChats(ch);
  };

  const refreshContacts = async () => {
    if (!user) return;
    const cont = await getContactsFromServer(user.id);
    setContacts(cont);
  };

  const refreshCalls = async () => {
    if (!user) return;
    const cl = await getCallsFromServer(user.id);
    setCalls(cl);
  };

  const logout = async () => {
    await unregisterPushNotifications();
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
