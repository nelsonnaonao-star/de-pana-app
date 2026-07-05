import React, { useEffect, useRef, useState } from "react";
import { ArrowLeft, Download, Share2, User } from "lucide-react";
import QRCode from "qrcode";

interface MyQrCodeProps {
  userId: string;
  name: string;
  phone: string;
  avatar: string;
  onBack: () => void;
}

export default function MyQrCode({ userId, name, phone, avatar, onBack }: MyQrCodeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [qrDataUrl, setQrDataUrl] = useState("");

  useEffect(() => {
    const qrContent = `redon://user/${userId}`;
    QRCode.toDataURL(qrContent, {
      width: 400,
      margin: 2,
      color: { dark: "#0a4d52", light: "#ffffff" },
    })
      .then((url) => setQrDataUrl(url))
      .catch((err) => console.error("QR generation error:", err));
  }, [userId]);

  return (
    <div className="flex-1 bg-[#f1f5f9] flex flex-col h-full overflow-hidden">
      <div className="bg-gradient-to-r from-[#0a4d52] to-[#05292c] text-white px-4 py-3 shrink-0 flex items-center gap-3 z-10 shadow-sm">
        <button onClick={onBack} className="p-1 text-teal-300 hover:text-white transition-colors cursor-pointer">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h3 className="text-sm font-black tracking-tight">Mi Código QR</h3>
      </div>

      <div className="flex-1 flex items-center justify-center p-6">
        <div className="bg-white rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.08)] p-6 w-full max-w-xs text-center space-y-4">
          <div className="w-16 h-16 rounded-full mx-auto overflow-hidden bg-slate-100">
            {avatar ? (
              <img src={avatar} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-teal-100 text-teal-600">
                <User className="w-6 h-6" />
              </div>
            )}
          </div>
          <div>
            <p className="text-sm font-bold text-slate-800">{name}</p>
            <p className="text-[10px] text-slate-400 font-mono">{phone || "Sin teléfono"}</p>
          </div>

          <div className="bg-white rounded-xl p-3 border border-slate-100 shadow-inner">
            {qrDataUrl ? (
              <img src={qrDataUrl} alt="QR Code" className="w-full aspect-square" />
            ) : (
              <div className="w-full aspect-square flex items-center justify-center text-slate-300 text-xs">
                Generando...
              </div>
            )}
          </div>

          <p className="text-[8px] text-slate-400 leading-relaxed">
            Escanea este código con RED ON para agregarme como contacto
          </p>

          <div className="flex gap-2">
            <button
              onClick={() => {
                const link = document.createElement("a");
                link.download = `redon-${name}.png`;
                link.href = qrDataUrl;
                link.click();
              }}
              className="flex-1 py-2 bg-slate-100 text-slate-700 rounded-xl text-[9px] font-bold flex items-center justify-center gap-1 hover:bg-slate-200 transition-colors cursor-pointer"
            >
              <Download className="w-3 h-3" /> Guardar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
