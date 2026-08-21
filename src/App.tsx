import { useEffect, useRef, useCallback, useState } from "react";
import { Toaster } from "react-hot-toast";
import { App as CapacitorApp } from "@capacitor/app";
import { SplashScreen } from "@capacitor/splash-screen";
import { useSupabase } from "./contexts/SupabaseContext";
import AuthScreen from "./components/AuthScreen";
import PasswordResetScreen from "./components/PasswordResetScreen";
import PhoneSimulator from "./components/PhoneSimulator";
import ErrorBoundary from "./components/ErrorBoundary";
import { db } from "./services/database/DatabaseService";
import { syncService } from "./services/sync/SyncService";
import { syncSoundPrefsFromNative } from "./services/soundService";
import ChatListSkeleton from "./components/ChatListSkeleton";

function AppContent() {
  const { user, loading, passwordRecovery } = useSupabase();
  const [dbReady, setDbReady] = useState(false);
  const backHandlerRef = useRef<(() => boolean) | null>(null);
  const shouldExitOnBackRef = useRef(false);

  const registerBackHandler = useCallback((handler: () => boolean) => {
    console.log("[APP] registerBackHandler called, handler:", !!handler);
    backHandlerRef.current = handler;
  }, []);

  const setShouldExitOnBack = useCallback((shouldExit: boolean) => {
    shouldExitOnBackRef.current = shouldExit;
  }, []);

  useEffect(() => {
    // Hide native splash as soon as the React app paints (login OR home), so the
    // auth/login screen is visible immediately instead of staying behind the splash.
    SplashScreen.hide().catch(() => {});
  }, []);

  useEffect(() => {
    // Safety timeout: don't block UI if SQLite hangs (e.g. on web)
    const t = setTimeout(() => {
      console.warn("[APP] db.initialize() timed out — forcing dbReady");
      setDbReady(true);
    }, 3000);

    // Paint PhoneSimulator first; heavy/async cleanup runs afterwards so the
    // home screen shows as fast as possible.
    db.initialize()
      .then(() => clearTimeout(t))
      .finally(() => {
        setDbReady(true);
      });

    return () => clearTimeout(t);
  }, []);

  // Non-blocking housekeeping, deferred until after first paint.
  useEffect(() => {
    if (!dbReady) return;
    db.cleanupOldData();
    syncSoundPrefsFromNative().catch(() => {});
    syncService.start();
    console.log("[SyncService] started");
  }, [dbReady]);

  // Deferred error-reporting init: load Sentry's heavy JS chunk after first
  // paint so cold-start parsing isn't blocked by it.
  useEffect(() => {
    if (!dbReady) return;
    const t = setTimeout(() => {
      import("./lib/sentry")
        .then(({ initSentryCapacitor }) => initSentryCapacitor())
        .catch(() => {});
    }, 5000);
    return () => clearTimeout(t);
  }, [dbReady]);

  useEffect(() => {
    console.log("[APP] Registering backButton listener...");
    const listenerPromise = CapacitorApp.addListener("backButton", () => {
      console.log("[APP] backButton event fired, handler:", !!backHandlerRef.current);
      const handler = backHandlerRef.current;
      if (handler) {
        const handled = handler();
        console.log("[APP] handler returned:", handled);
        if (handled) return;
      }
      console.log("[APP] No handler or handler returned false — exiting:", shouldExitOnBackRef.current);
      if (shouldExitOnBackRef.current) {
        CapacitorApp.exitApp();
      } else {
        console.log("[APP] Back pressed but should not exit (UI navigation in progress)");
      }
    });

    return () => {
      console.log("[APP] Removing backButton listener");
      listenerPromise.then(l => l.remove());
    };
  }, []);

  if (loading) {
    return (
      <div className="w-screen h-screen bg-white flex flex-col">
        <div className="h-[56px] bg-slate-100 animate-pulse" />
        <ChatListSkeleton count={8} />
      </div>
    );
  }

  return (
    <>
      <Toaster
        position="top-center"
        containerStyle={{ zIndex: 100000 }}
        toastOptions={{
          duration: 4000,
          style: { fontSize: "13px", fontWeight: 600, borderRadius: "12px", padding: "12px 16px" },
          error: { style: { background: "#fef2f2", color: "#b91c1c", border: "1px solid #fecaca" } },
          success: { style: { background: "#f0fdf4", color: "#15803d", border: "1px solid #bbf7d0" } },
        }}
      />
      {!user ? (
        <AuthScreen />
      ) : passwordRecovery ? (
        <PasswordResetScreen />
      ) : dbReady ? (
        <PhoneSimulator 
          onBackPress={registerBackHandler} 
          onSetShouldExit={setShouldExitOnBack}
        />
      ) : (
        <div className="w-screen h-screen bg-white flex flex-col">
          <div className="h-[56px] bg-slate-100 animate-pulse" />
          <ChatListSkeleton count={8} />
        </div>
      )}
    </>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}
