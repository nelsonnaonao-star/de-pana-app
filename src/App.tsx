import { useEffect, useRef, useCallback, useState } from "react";
import { Toaster } from "react-hot-toast";
import { App as CapacitorApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";
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
import FullSplash from "./components/FullSplash";

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

  const [fullSplashVisible, setFullSplashVisible] = useState(true);

  // FASE 3: true solo cuando el arranque viene de una notificación (hay un
  // open-chat pendiente). En ese caso el contenido de la app debe montarse por
  // debajo de FullSplash para que open-chat pueda resolver el destino, mientras
  // FullSplash queda como única cobertura visible. En el arranque normal se
  // mantiene el intercambio exclusivo de siempre.
  const [notificationBoot, setNotificationBoot] = useState(false);

  // ── FASE 1 · Handshake nativo → React ──────────────────────────────────────
  // El splash nativo se retira cuando React confirma que el WebView YA pintó un
  // frame, no cuando expira un temporizador. Un único punto de liberación por
  // proceso de arranque: el ref hace que hide() sea idempotente frente a
  // StrictMode, re-ejecuciones del efecto y remounts.
  const nativeSplashReleasedRef = useRef(false);

  const releaseNativeSplash = useCallback(() => {
    if (nativeSplashReleasedRef.current) return;
    nativeSplashReleasedRef.current = true;
    SplashScreen.hide().catch(() => {});
  }, []);

  const hideFullSplash = useCallback(() => {
    if (fullSplashVisible) {
      setFullSplashVisible(false);
    }
  }, [fullSplashVisible]);

  // Un único punto de retirada de la cobertura React por proceso de arranque.
  const bootCoverageRemovedRef = useRef(false);

  // ── FASE 2/3 · Retirada de la cobertura visual cuando el destino está listo ─
  // PhoneSimulator la invoca solo cuando el ChatRoom destino está montado y su
  // módulo lazy ya está resuelto (precargado), así que en el momento de retirar
  // la cobertura el árbol contiene el destino y no el skeleton.
  //
  // FASE 3: la cobertura que se retira aquí es FullSplash, NO la superficie
  // nativa. El splash nativo ya se liberó temprano (doble rAF del primer commit)
  // para que el WebView pudiera pintar; lo que queda visible durante toda la
  // espera es FullSplash (#0A1F1C + logo), y esto solo lo aparta cuando el
  // destino ya está compuesto. Así nunca se expone el windowBackground #111827.
  const pendingBootRafRef = useRef<number[]>([]);

  const handleBootDestinationReady = useCallback(() => {
    if (bootCoverageRemovedRef.current) return;
    const first = requestAnimationFrame(() => {
      const second = requestAnimationFrame(() => {
        // Red de seguridad: si el splash nativo siguiera puesto, se retira acá.
        // releaseNativeSplash es idempotente (nativeSplashReleasedRef).
        releaseNativeSplash();
        // Un ciclo más para que el compositor haya rasterizado el destino que
        // está por debajo de la cobertura antes de apartarla.
        const third = requestAnimationFrame(() => {
          const fourth = requestAnimationFrame(() => {
            bootCoverageRemovedRef.current = true;
            hideFullSplash();
          });
          pendingBootRafRef.current.push(fourth);
        });
        pendingBootRafRef.current.push(third);
      });
      pendingBootRafRef.current.push(second);
    });
    pendingBootRafRef.current.push(first);
  }, [releaseNativeSplash, hideFullSplash]);

  useEffect(() => {
    return () => {
      pendingBootRafRef.current.forEach((id) => cancelAnimationFrame(id));
      pendingBootRafRef.current = [];
    };
  }, []);

  // Doble requestAnimationFrame: el primer RAF marca el inicio del frame, el
  // segundo confirma que el WebView tuvo oportunidad de dibujarlo. Ese callback
  // corre justo ANTES del dibujado de ese frame, así que cuando el splash
  // nativo se retira la superficie web ya tiene contenido en esa misma pasada.
  //
  // FASE 3: esto corre IGUAL en los dos casos, y esa es la corrección del negro.
  // El bloqueo de dibujado del splash nativo solo permiteFrames si se levanta
  // temprano: mientras sigue puesto, el WebView no rasteriza NADA y al
  // levantarse el primer frame muestra el windowBackground #111827. Liberando
  // temprano, lo que el usuario ve a continuación es FullSplash (#0A1F1C +
  // logo), que queda como cobertura visible hasta que el destino esté listo.
  useEffect(() => {
    let rafFirst = 0;
    let rafSecond = 0;
    let cancelled = false;

    // Lectura de la MISMA clave que escribe MainActivity y consume
    // PhoneSimulator. Es estrictamente de consulta: no se toca el mecanismo de
    // persistencia, ni bootChatId, ni currentScreen, ni la navegación.
    const readPendingBootChatId = async (): Promise<string | null> => {
      if (!Capacitor.isNativePlatform()) return null;
      try {
        const pending = await Preferences.get({ key: "redon_pending_open_chat" });
        const raw = pending?.value;
        if (!raw) return null;
        const data = JSON.parse(raw);
        return data && typeof data === "object" && data.chatId ? data.chatId : null;
      } catch {
        return null;
      }
    };

    (async () => {
      const pendingChatId = await readPendingBootChatId();
      if (cancelled) return;

      // CASO NOTIFICACIÓN: se marca el modo para que el contenido de la app se
      // monte POR DEBAJO de FullSplash y este siga siendo la cobertura visible
      // hasta que PhoneSimulator confirme que el destino está listo.
      if (pendingChatId) {
        setNotificationBoot(true);
        console.log("[APP] open-chat pendiente: FullSplash queda como cobertura", {
          chatId: pendingChatId,
        });
      }

      // CASO NORMAL Y NOTIFICACIÓN: liberación temprana idéntica a Fase 1.
      rafFirst = requestAnimationFrame(() => {
        rafSecond = requestAnimationFrame(() => {
          releaseNativeSplash();
        });
      });
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafFirst);
      cancelAnimationFrame(rafSecond);
    };
  }, [releaseNativeSplash]);

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

  // ── Handshake de cierre del splash ──────────────────────────────────────────
  // `initialDestinationReady` lo enciende PhoneSimulator con una señal de SOLO
  // LECTURA (chatsLoaded && currentScreen === "chats"): el destino inicial
  // normal ya está poblado. No altera navegación ni la carga de Chats.
  //
  // Anti-pantalla-blanca: `!loading && dbReady` dice que Supabase y SQLite
  // respondieron, NO que la lista de Chats esté pintada. Como la raíz de
  // PhoneSimulator es `bg-white` y Chats se monta tras un <Suspense>, retirar
  // el splash con esa condición sola exponía ese blanco entre el splash y la
  // lista. Ahora el retiro exige AMBAS condiciones: boot listo (A) y destino
  // inicial montado (B).
  const [initialDestinationReady, setInitialDestinationReady] = useState(false);

  const handleInitialChatsReady = useCallback(() => {
    setInitialDestinationReady(true);
  }, []);

  useEffect(() => {
    // Arranque desde notificación: la liberación sigue siendo responsabilidad
    // exclusiva de handleBootDestinationReady, igual que antes.
    if (notificationBoot) return;
    // A. Boot de aplicación listo.
    if (loading || !dbReady) return;
    // B. Destino inicial normal (Chats) montado y pintable.
    if (!initialDestinationReady) return;
    hideFullSplash();
  }, [loading, dbReady, notificationBoot, initialDestinationReady, hideFullSplash]);


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

  return (
    <>
      {fullSplashVisible && <FullSplash onHidden={hideFullSplash} maxDurationMs={10000} />}
      {/*
        FASE 4 (arranque normal): el contenido se monta SIEMPRE, también con
        FullSplash encima. Antes era exclusivo en arranque normal, pero entonces
        PhoneSimulator no existía cuando el splash se retiraba y no había forma
        de saber si Chats ya estaba pintado: por eso `!loading && dbReady`
        dejaba expuesta la raíz `bg-white` de PhoneSimulator durante un commit.

        Montarlo por debajo no cambia lo que se ve: FullSplash es opaco
        (inset:0, background #0A1F1C, zIndex 1000000) y el Toaster usa zIndex
        99999, así que ni la app ni los toasts se asoman. Lo que cambia es que
        PhoneSimulator monta, resuelve su <Suspense> y puebla `chats` MIENTRAS
        el splash sigue siendo la única superficie visible; al retraitarlo, Chats
        ya está pintado y no hay pantalla intermedia.

        El flujo de notificación sigue montando por debajo igual que antes y su
        liberación continúa por handleBootDestinationReady, sin cambios.
      */}
      {(
        <>
          <Toaster
            position="top-center"
            containerStyle={{ zIndex: 99999 }}
            toastOptions={{
              duration: 4000,
              style: { fontSize: "13px", fontWeight: 600, borderRadius: "12px", padding: "12px 16px" },
              error: { style: { background: "#fef2f2", color: "#b91c1c", border: "1px solid #fecaca" } },
              success: { style: { background: "#f0fdf4", color: "#15803d", border: "1px solid #bbf7d0" } },
            }}
          />
          {loading ? (
            <div className="w-screen h-screen bg-white flex flex-col">
              <div className="h-[170px] bg-[#0a4d52] relative shrink-0">
                <div
                  className="absolute left-5 right-5 h-10 rounded-full bg-white/80 animate-pulse"
                  style={{ top: "calc(70px + env(safe-area-inset-top))" }}
                />
              </div>
              <div className="px-4 pt-3.5 pb-[14px]">
                <div className="flex justify-between items-center px-1 mb-1">
                  <div className="h-5 w-16 bg-slate-200 rounded-full animate-pulse" />
                  <div className="h-5 w-8 bg-slate-200 rounded-full animate-pulse" />
                </div>
              </div>
              <ChatListSkeleton count={8} />
            </div>
          ) : !user ? (
            <AuthScreen />
          ) : passwordRecovery ? (
            <PasswordResetScreen />
          ) : dbReady ? (
            <PhoneSimulator 
              onBackPress={registerBackHandler} 
              onSetShouldExit={setShouldExitOnBack}
              onBootDestinationReady={handleBootDestinationReady}
              onInitialChatsReady={handleInitialChatsReady}
            />
          ) : (
            <div className="w-screen h-screen bg-white flex flex-col">
              <div className="h-[170px] bg-[#0a4d52] relative shrink-0">
                <div
                  className="absolute left-5 right-5 h-10 rounded-full bg-white/80 animate-pulse"
                  style={{ top: "calc(70px + env(safe-area-inset-top))" }}
                />
              </div>
              <div className="px-4 pt-3.5 pb-[14px]">
                <div className="flex justify-between items-center px-1 mb-1">
                  <div className="h-5 w-16 bg-slate-200 rounded-full animate-pulse" />
                  <div className="h-5 w-8 bg-slate-200 rounded-full animate-pulse" />
                </div>
              </div>
              <ChatListSkeleton count={8} />
            </div>
          )}
        </>
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
