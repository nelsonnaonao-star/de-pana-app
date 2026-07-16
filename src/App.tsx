import { useEffect, useRef, useCallback, useState } from "react";
import { Toaster } from "react-hot-toast";
import { App as CapacitorApp } from "@capacitor/app";
import { useSupabase } from "./contexts/SupabaseContext";
import AuthScreen from "./components/AuthScreen";
import PhoneSimulator from "./components/PhoneSimulator";
import ErrorBoundary from "./components/ErrorBoundary";

function AppContent() {
  const { user, loading } = useSupabase();
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

  return (
    <>
      <Toaster
        position="top-center"
        toastOptions={{
          duration: 4000,
          style: { fontSize: "13px", fontWeight: 600, borderRadius: "12px", padding: "12px 16px" },
          error: { style: { background: "#fef2f2", color: "#b91c1c", border: "1px solid #fecaca" } },
          success: { style: { background: "#f0fdf4", color: "#15803d", border: "1px solid #bbf7d0" } },
        }}
      />
      {loading ? (
        <div className="w-screen h-screen bg-[#070b13] flex items-center justify-center">
          <div className="text-center space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-teal-400 to-[#0a4d52] mx-auto flex items-center justify-center animate-pulse">
              <span className="text-xl font-black text-white">R</span>
            </div>
            <p className="text-slate-400 text-sm font-medium">Cargando Red On...</p>
          </div>
        </div>
      ) : !user ? (
        <AuthScreen />
      ) : (
        <PhoneSimulator 
          onBackPress={registerBackHandler} 
          onSetShouldExit={setShouldExitOnBack}
        />
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
