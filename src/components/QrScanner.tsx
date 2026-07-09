import React, { useState, useEffect, useRef, useCallback } from "react";
import { Check, UserPlus, X, Loader2 } from "lucide-react";
import jsQR from "jsqr";
import { Camera } from "@capacitor/camera";
import { supabase } from "../lib/supabase";
import { createChat } from "../services/chats";
import { addContact } from "../services/contacts";
import { useSupabase } from "../contexts/SupabaseContext";

interface QrScannerProps {
  userName: string;
  userPhone: string;
  onBack: () => void;
  onContactAdded: (name: string, avatar: string) => void;
}

type ScanStatus = "scanning" | "found" | "looking_up" | "error";

interface FoundProfile {
  id: string;
  name: string;
  username?: string;
  phone_number?: string;
  avatar_url?: string;
  bio?: string;
}

export default function QrScanner({ userName, userPhone, onBack, onContactAdded }: QrScannerProps) {
  const { user } = useSupabase();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanLoopRef = useRef<number>(0);
  const scanCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [status, setStatus] = useState<ScanStatus>("scanning");
  const [foundProfile, setFoundProfile] = useState<FoundProfile | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [cameraError, setCameraError] = useState(false);

  const getCurrentUserId = useCallback(async (): Promise<string | null> => {
    try {
      const { data: { user: u } } = await supabase.auth.getUser();
      return u?.id || null;
    } catch {
      return user?.id || null;
    }
  }, [user]);

  const stopCamera = useCallback(() => {
    if (scanLoopRef.current) cancelAnimationFrame(scanLoopRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function initCamera() {
      try {
        const permission = await Camera.checkPermissions();
        if (permission.camera !== "granted") {
          const req = await Camera.requestPermissions({ permissions: ["camera"] });
          if (req.camera !== "granted") {
            setCameraError(true);
            setErrorMsg("Permiso de cámara denegado. Actívalo en Configuración > Apps > Red On > Permisos");
            return;
          }
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          try { await videoRef.current.play(); } catch (e) {}
          scanLoop();
        }
      } catch (e: any) {
        console.error("[QR_SCANNER] Camera error:", e.name, e.message, e);
        if (!cancelled) {
          setCameraError(true);
          const msg =
            e.name === "NotAllowedError"
              ? "Permiso de cámara denegado"
              : e.name === "NotFoundError"
              ? "No se encontró la cámara trasera"
              : e.name === "NotReadableError"
              ? "Cámara ocupada por otra aplicación"
              : e.name === "OverconstrainedError"
              ? "Cámara no compatible"
              : `Error de cámara: ${e.message}`;
          setErrorMsg(msg);
        }
      }
    }

    function scanLoop() {
      if (cancelled) return;
      const video = videoRef.current;
      if (!video || video.readyState < video.HAVE_ENOUGH_DATA) {
        scanLoopRef.current = requestAnimationFrame(scanLoop);
        return;
      }

      if (!scanCanvasRef.current) scanCanvasRef.current = document.createElement("canvas");
      const canvas = scanCanvasRef.current;
      const scale = 0.5;
      canvas.width = video.videoWidth * scale;
      canvas.height = video.videoHeight * scale;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) { scanLoopRef.current = requestAnimationFrame(scanLoop); return; }

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: "attemptBoth",
      });

      if (code) {
        setStatus("looking_up");
        handleDecoded(code.data);
        return;
      }
      scanLoopRef.current = requestAnimationFrame(scanLoop);
    }

    initCamera();

    return () => {
      cancelled = true;
      if (scanLoopRef.current) cancelAnimationFrame(scanLoopRef.current);
      stopCamera();
    };
  }, []);

  async function handleDecoded(data: string) {
    const trimmed = data.trim();

    try {
      let userId = "";
      let groupCode = "";

      if (trimmed.startsWith("redon://user/")) {
        userId = trimmed.replace("redon://user/", "").split("?")[0];
      } else if (trimmed.startsWith("redon://group/")) {
        setErrorMsg("Unirse a grupo por QR no implementado aún");
        setStatus("error");
        setTimeout(() => setStatus("scanning"), 2000);
        return;
      } else if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) {
        userId = trimmed.toLowerCase();
      } else if (trimmed.length >= 4 && trimmed.length <= 8) {
        groupCode = trimmed.toUpperCase();
        setErrorMsg("Código de grupo no implementado aún");
        setStatus("error");
        setTimeout(() => setStatus("scanning"), 2000);
        return;
      } else {
        setErrorMsg("Formato QR no reconocido");
        setStatus("error");
        setTimeout(() => setStatus("scanning"), 2000);
        return;
      }

      // Lookup profile directamente desde Supabase
      stopCamera();
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("id, name, username, phone_number, avatar_url, bio")
        .eq("id", userId)
        .single();

      if (profileError || !profile) {
        setErrorMsg("Usuario no encontrado");
        setStatus("error");
        setTimeout(() => setStatus("scanning"), 2000);
        return;
      }

      setFoundProfile(profile);
      setStatus("found");
    } catch (e) {
      console.error("QR handle error:", e);
      setErrorMsg("Error al procesar QR");
      setStatus("error");
    }
  }

  async function handleAddContact() {
    if (!foundProfile) return;

    try {
      const currentUserId = await getCurrentUserId();
      if (!currentUserId) {
        setErrorMsg("Debes iniciar sesión");
        setStatus("error");
        return;
      }

      // Insertar en tabla contacts
      await addContact(
        currentUserId,
        foundProfile.id,
        foundProfile.name,
        foundProfile.avatar_url || "",
        foundProfile.phone_number || ""
      );

      // Crear chat
      await createChat({
        name: foundProfile.name,
        avatar: foundProfile.avatar_url || "",
        username: foundProfile.username || "",
        phone: foundProfile.phone_number || "",
        bio: foundProfile.bio || "",
        profile_id: foundProfile.id,
        admin_id: currentUserId,
      });

      onContactAdded(
        foundProfile.name,
        foundProfile.avatar_url || ""
      );
    } catch (e) {
      console.error("Add contact error:", e);
      setErrorMsg("Error al agregar contacto");
      setStatus("error");
    }
  }

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-black relative select-none">
      {!cameraError ? (
        <video
          ref={videoRef}
          playsInline
          muted
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-900 p-6">
          <div className="text-center space-y-2">
            <p className="text-white text-xs font-medium">No se pudo acceder a la cámara</p>
            {errorMsg && (
              <p className="text-rose-300 text-[10px] max-w-xs">{errorMsg}</p>
            )}
          </div>
        </div>
      )}
      <canvas ref={canvasRef} className="hidden" />

      <div className="absolute inset-0 pointer-events-none">
        <div className="w-full h-full flex items-center justify-center">
          <div className="relative">
            <div className="w-64 h-64 rounded-2xl border-2 border-white/50 shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]" />
            <div className="absolute -top-1 -left-1 w-8 h-8 border-t-4 border-l-4 border-teal-400 rounded-tl-xl" />
            <div className="absolute -top-1 -right-1 w-8 h-8 border-t-4 border-r-4 border-teal-400 rounded-tr-xl" />
            <div className="absolute -bottom-1 -left-1 w-8 h-8 border-b-4 border-l-4 border-teal-400 rounded-bl-xl" />
            <div className="absolute -bottom-1 -right-1 w-8 h-8 border-b-4 border-r-4 border-teal-400 rounded-br-xl" />
          </div>
        </div>
        {status === "scanning" && !cameraError && (
          <div className="absolute left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2 w-56 h-0.5 bg-teal-400 shadow-[0_0_12px_#14b8a6] animate-scan-line" />
        )}
      </div>

      <div className="relative z-10 flex items-center justify-between px-4 pt-12 pb-3">
        <button onClick={() => { stopCamera(); onBack(); }} className="p-2 bg-black/40 rounded-full backdrop-blur-sm text-white cursor-pointer">
          <X className="w-5 h-5" />
        </button>
        <span className="text-white text-[10px] font-mono bg-black/40 px-3 py-1 rounded-full backdrop-blur-sm">
          {status === "scanning" ? "ESCANEANDO..." : status === "looking_up" ? "BUSCANDO..." : ""}
        </span>
      </div>

      <div className="relative z-10 mt-auto px-6 pb-8 text-center">
        {status === "scanning" && !cameraError && (
          <p className="text-white/80 text-[11px] font-medium bg-black/30 backdrop-blur-sm px-4 py-2 rounded-full inline-block">
            Apunta al código QR para escanear automáticamente
          </p>
        )}
        {status === "looking_up" && (
          <div className="flex items-center justify-center gap-2 text-white text-[11px] bg-black/30 backdrop-blur-sm px-4 py-2 rounded-full inline-block">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Buscando perfil...
          </div>
        )}
        {status === "error" && (
          <p className="text-rose-300 text-[11px] font-medium bg-black/40 backdrop-blur-sm px-4 py-2 rounded-full inline-block">
            {errorMsg}
          </p>
        )}
      </div>

      {status === "found" && foundProfile && (
        <div className="absolute inset-0 bg-black/60 z-20 flex items-center justify-center p-6">
          <div className="bg-white rounded-2xl p-5 w-full max-w-xs shadow-2xl animate-fade-in space-y-4">
            <div className="flex flex-col items-center text-center gap-2">
              <div className="w-14 h-14 rounded-full bg-teal-100 flex items-center justify-center overflow-hidden">
                {foundProfile.avatar_url ? (
                  <img
                    src={foundProfile.avatar_url}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <Check className="w-6 h-6 text-teal-600" />
                )}
              </div>
              <div>
                <span className="text-[9px] font-bold text-teal-600 bg-teal-50 px-2 py-0.5 rounded-full uppercase">
                  ¡Código Detectado!
                </span>
                <h4 className="text-sm font-bold text-slate-800 mt-1.5">{foundProfile.name}</h4>
                {foundProfile.username && (
                  <p className="text-[10px] text-slate-400 font-mono">@{foundProfile.username}</p>
                )}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => { stopCamera(); onBack(); }}
                className="flex-1 py-2.5 text-[11px] font-bold text-slate-500 bg-slate-100 rounded-xl hover:bg-slate-200 transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                onClick={handleAddContact}
                className="flex-1 py-2.5 text-[11px] font-bold text-white bg-[#0a4d52] rounded-xl hover:bg-[#10646a] transition-colors flex items-center justify-center gap-1 cursor-pointer"
              >
                <UserPlus className="w-3.5 h-3.5" /> Agregar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
