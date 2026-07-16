import React from "react";
import { Check, RefreshCw, Upload, Award, Music } from "lucide-react";
import {
  STATIC_PRESET_IMAGES, PRESET_FILTERS_EXPANDED,
  STICKER_TEMPLATES_PRO, PRESET_MUSIC, ANIMATION_PRESETS,
} from "./editorConstants";

interface EditorTabPanelsProps {
  editorTab: "presets" | "sliders" | "text" | "stickers" | "premium";
  editorMode: "image" | "video";
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  handleImageFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  uploadedImage: string | null;
  setUploadedImage: (v: string | null) => void;
  activePresetIdx: number;
  setActivePresetIdx: (v: number) => void;
  selectedFilterId: string;
  setSelectedFilterId: (v: string) => void;
  adjustments: { brightness: number; contrast: number; saturation: number; blur: number; hue: number; sharpness: number };
  setAdjustments: (v: any) => void;
  handleResetAdjustments: () => void;
  bannerTitle: string;
  setBannerTitle: (v: string) => void;
  bannerProduct: string;
  setBannerProduct: (v: string) => void;
  bannerPrice: string;
  setBannerPrice: (v: string) => void;
  showWhatsApp: boolean;
  setShowWhatsApp: (v: boolean) => void;
  textAnimation: string;
  setTextAnimation: (v: string) => void;
  textSizePercent: number;
  setTextSizePercent: (v: number) => void;
  selectedStickerIdx: number;
  setSelectedStickerIdx: (v: number) => void;
  isPremiumUnlocked: boolean;
  activationCodeInput: string;
  setActivationCodeInput: (v: string) => void;
  codeFeedback: { status: "idle" | "success" | "error"; message: string };
  handleValidatePremiumCode: (e: React.FormEvent) => void;
  selectedMusicId: string;
  setSelectedMusicId: (v: string) => void;
  transitionStyle: "fade" | "zoom" | "slide";
  setTransitionStyle: (v: "fade" | "zoom" | "slide") => void;
  setIsVideoPlaying: (v: boolean) => void;
}

export default function EditorTabPanels(props: EditorTabPanelsProps) {
  const {
    editorTab, editorMode,
    fileInputRef, handleImageFileChange,
    uploadedImage, setUploadedImage,
    activePresetIdx, setActivePresetIdx,
    selectedFilterId, setSelectedFilterId,
    adjustments, setAdjustments, handleResetAdjustments,
    bannerTitle, setBannerTitle,
    bannerProduct, setBannerProduct,
    bannerPrice, setBannerPrice,
    showWhatsApp, setShowWhatsApp,
    textAnimation, setTextAnimation,
    textSizePercent, setTextSizePercent,
    selectedStickerIdx, setSelectedStickerIdx,
    isPremiumUnlocked,
    activationCodeInput, setActivationCodeInput,
    codeFeedback, handleValidatePremiumCode,
    selectedMusicId, setSelectedMusicId,
    transitionStyle, setTransitionStyle,
    setIsVideoPlaying,
  } = props;

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-3 bg-[#0c1617]/90">
      {editorTab === "presets" && (
        <div className="space-y-3 animate-fade-in">
          <div className="flex items-center justify-between">
            <span className="text-[8px] font-black uppercase text-teal-400 tracking-wider">
              1. Elige una Imagen Base o Sube la Tuya
            </span>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="bg-teal-400 hover:bg-teal-500 text-white text-[8px] font-black px-2 py-1 rounded-lg flex items-center gap-1 transition-all cursor-pointer shadow-sm"
            >
              <Upload className="w-3 h-3" /> Subir de mi Celular
            </button>
            <input type="file" ref={fileInputRef} accept="image/*" onChange={handleImageFileChange} className="hidden" />
          </div>

          {!uploadedImage && (
            <div className="grid grid-cols-4 gap-1.5">
              {STATIC_PRESET_IMAGES.map((img, idx) => (
                <button
                  key={idx} type="button" onClick={() => setActivePresetIdx(idx)}
                  className={`aspect-video rounded-lg overflow-hidden border transition-all cursor-pointer relative ${
                    activePresetIdx === idx ? "border-teal-400 scale-102" : "border-white/5 opacity-70 hover:opacity-100"
                  }`}
                >
                  <img src={img.url} alt="Option" className="w-full h-full object-cover" />
                  <span className="absolute bottom-0 inset-x-0 bg-black/60 text-[5px] text-white text-center truncate py-0.5">{img.label}</span>
                </button>
              ))}
            </div>
          )}

          {uploadedImage && (
            <div className="bg-emerald-950/40 p-2 rounded-xl border border-emerald-500/20 flex items-center justify-between">
              <span className="text-[8px] text-emerald-300 font-bold flex items-center gap-1">
                <Check className="w-3 h-3 stroke-[3]" /> Imagen propia cargada con éxito
              </span>
              <button onClick={() => setUploadedImage(null)} className="text-[7.5px] font-mono text-rose-400 hover:text-rose-300 underline cursor-pointer">
                Restaurar predeterminados
              </button>
            </div>
          )}

          <span className="text-[8px] font-black uppercase text-teal-400 tracking-wider block pt-1">
            2. Elige un Filtro Profesional de un Toque (11 variantes)
          </span>

          <div className="grid grid-cols-2 gap-1.5">
            {PRESET_FILTERS_EXPANDED.map((filt) => {
              const isSelected = selectedFilterId === filt.id;
              return (
                <button
                  key={filt.id} onClick={() => setSelectedFilterId(filt.id)}
                  className={`p-2.5 rounded-xl text-left border transition-all cursor-pointer flex flex-col justify-between ${
                    isSelected ? "bg-teal-950/60 border-teal-400 shadow-sm text-white" : "bg-black/20 border-white/5 text-slate-300 hover:bg-black/35 hover:border-white/10"
                  }`}
                >
                  <div className="flex items-center justify-between w-full">
                    <span className="text-[9.5px] font-bold leading-none truncate">{filt.name}</span>
                    {isSelected && (
                      <div className="w-2.5 h-2.5 bg-teal-400 rounded-full flex items-center justify-center">
                        <Check className="w-1.5 h-1.5 text-white stroke-[4]" />
                      </div>
                    )}
                  </div>
                  <span className="text-[6.5px] text-slate-400 font-medium truncate mt-1">{filt.desc}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {editorTab === "sliders" && (
        <div className="space-y-3.5 animate-fade-in text-left">
          <div className="flex items-center justify-between border-b border-white/5 pb-1.5">
            <span className="text-[8px] font-black uppercase text-teal-400 tracking-wider">
              Desliza para calibrar porcentajes en vivo
            </span>
            <button onClick={handleResetAdjustments} className="text-[7.5px] font-extrabold text-rose-400 hover:text-rose-300 flex items-center gap-0.5 transition-colors cursor-pointer">
              <RefreshCw className="w-3 h-3 animate-spin" /> Resetear Valores
            </button>
          </div>

          <div className="space-y-3">
            {[
              { label: "Brillo (Luminosidad)", key: "brightness", min: 50, max: 200, step: 2, unit: "%" },
              { label: "Contraste (Profundidad)", key: "contrast", min: 50, max: 200, step: 2, unit: "%" },
              { label: "Saturación (Intensidad de Color)", key: "saturation", min: 0, max: 200, step: 2, unit: "%" },
            ].map(({ label, key, min, max, step, unit }) => (
              <div key={key} className="space-y-1">
                <div className="flex justify-between items-center text-[8px] font-bold">
                  <span className="text-slate-300">{label}</span>
                  <span className="font-mono text-teal-400 bg-teal-950/60 px-1.5 rounded">{adjustments[key as keyof typeof adjustments]}{unit}</span>
                </div>
                <input type="range" min={min} max={max} step={step} value={adjustments[key as keyof typeof adjustments]}
                  onChange={(e) => setAdjustments((prev: any) => ({ ...prev, [key]: Number(e.target.value) }))}
                  className="w-full accent-teal-400 cursor-pointer bg-slate-800" />
              </div>
            ))}
            <div className="space-y-1">
              <div className="flex justify-between items-center text-[8px] font-bold">
                <span className="text-slate-300">Desenfoque (Estilo Bokeh)</span>
                <span className="font-mono text-teal-400 bg-teal-950/60 px-1.5 rounded">{adjustments.blur} px</span>
              </div>
              <input type="range" min="0" max="8" step="1" value={adjustments.blur}
                onChange={(e) => setAdjustments((prev: any) => ({ ...prev, blur: Number(e.target.value) }))}
                className="w-full accent-teal-400 cursor-pointer bg-slate-800" />
            </div>
            <div className="space-y-1">
              <div className="flex justify-between items-center text-[8px] font-bold">
                <span className="text-slate-300">Filtro de Color / Tono (Giro Hue)</span>
                <span className="font-mono text-teal-400 bg-teal-950/60 px-1.5 rounded">{adjustments.hue}° de color</span>
              </div>
              <input type="range" min="0" max="360" step="5" value={adjustments.hue}
                onChange={(e) => setAdjustments((prev: any) => ({ ...prev, hue: Number(e.target.value) }))}
                className="w-full accent-teal-400 cursor-pointer bg-slate-800" />
            </div>
            <div className="space-y-1">
              <div className="flex justify-between items-center text-[8px] font-bold">
                <span className="text-slate-300">Nitidez Digital (Sharpening Pro)</span>
                <span className="font-mono text-teal-400 bg-teal-950/60 px-1.5 rounded">{adjustments.sharpness}%</span>
              </div>
              <input type="range" min="0" max="100" step="5" value={adjustments.sharpness}
                onChange={(e) => setAdjustments((prev: any) => ({ ...prev, sharpness: Number(e.target.value) }))}
                className="w-full accent-teal-400 cursor-pointer bg-slate-800" />
            </div>
          </div>
        </div>
      )}

      {editorTab === "text" && (
        <div className="space-y-3 animate-fade-in text-left">
          <span className="text-[8px] font-black uppercase text-teal-400 tracking-wider">Contenido de Textos</span>
          <div className="space-y-2 bg-black/20 p-2.5 rounded-xl border border-white/5">
            <div className="space-y-1">
              <span className="text-[7px] text-slate-400 font-bold uppercase">Título Slogan</span>
              <input type="text" value={bannerTitle} onChange={(e) => setBannerTitle(e.target.value)} maxLength={18}
                className="w-full bg-slate-950 border border-white/10 text-[9px] px-2 py-1.5 rounded-lg outline-none focus:border-teal-500 font-bold" />
            </div>
            <div className="space-y-1">
              <span className="text-[7px] text-slate-400 font-bold uppercase">Producto / Detalle Comercial</span>
              <input type="text" value={bannerProduct} onChange={(e) => setBannerProduct(e.target.value)} maxLength={32}
                className="w-full bg-slate-950 border border-white/10 text-[9px] px-2 py-1.5 rounded-lg outline-none focus:border-teal-500 font-medium" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <span className="text-[7px] text-slate-400 font-bold uppercase">Precio Oficial</span>
                <input type="text" value={bannerPrice} onChange={(e) => setBannerPrice(e.target.value)} maxLength={10}
                  className="w-full bg-slate-950 border border-white/10 text-[9px] px-2 py-1.5 rounded-lg outline-none focus:border-teal-500 font-mono text-emerald-400 font-bold" />
              </div>
              <div className="space-y-1">
                <div className="flex justify-between items-center text-[7px] text-slate-400 font-bold uppercase">
                  <span>Escala Texto</span>
                  <span className="font-mono text-teal-400">{textSizePercent}%</span>
                </div>
                <input type="range" min="80" max="120" step="5" value={textSizePercent}
                  onChange={(e) => setTextSizePercent(Number(e.target.value))} className="w-full accent-teal-500 cursor-pointer mt-1" />
              </div>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={() => setShowWhatsApp(!showWhatsApp)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[8px] font-bold transition-all cursor-pointer ${
                  showWhatsApp ? "bg-teal-950/60 border-teal-400 text-teal-300" : "bg-black/20 border-white/5 text-slate-400 hover:bg-black/35"
                }`}
              >
                <span>{showWhatsApp ? "✓" : "+"}</span>
                <span>Badge WhatsApp</span>
              </button>
              <span className="text-[6.5px] text-slate-500">Arrastra los textos en la vista previa para moverlos</span>
            </div>
          </div>

          <span className="text-[8px] font-black uppercase text-teal-400 tracking-wider block pt-1">Animación del Título Comercial</span>
          <div className="grid grid-cols-2 gap-1.5">
            {ANIMATION_PRESETS.map((anim) => {
              const isSelected = textAnimation === anim.id;
              return (
                <button key={anim.id} type="button" onClick={() => setTextAnimation(anim.id)}
                  className={`py-2 px-2.5 rounded-xl text-left border text-[8.5px] font-bold transition-all cursor-pointer ${
                    isSelected ? "bg-teal-950/60 border-teal-400 text-white" : "bg-black/20 border-white/5 text-slate-400 hover:bg-black/35"
                  }`}>
                  {anim.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {editorTab === "stickers" && (
        <div className="space-y-3 animate-fade-in text-left">
          <span className="text-[8px] font-black uppercase text-teal-400 tracking-wider">Adhiere un Sticker de Impacto Comercial</span>
          <div className="grid grid-cols-2 gap-2">
            {STICKER_TEMPLATES_PRO.map((st, idx) => {
              const isSelected = selectedStickerIdx === idx;
              return (
                <button key={st.id} type="button" onClick={() => setSelectedStickerIdx(isSelected ? -1 : idx)}
                  className={`p-3 rounded-2xl border text-center transition-all cursor-pointer relative overflow-hidden flex flex-col justify-center items-center ${
                    isSelected ? "bg-teal-950/60 border-teal-400 text-white scale-102" : "bg-black/20 border-white/5 text-slate-300 hover:bg-black/35 hover:border-white/10"
                  }`}>
                  <span className={`text-[8px] px-2 py-1.5 rounded-full ${st.bg} scale-95`}>{st.text}</span>
                  <span className="text-[6.5px] text-slate-400 font-mono mt-2">
                    {isSelected ? "Activo (Toca de nuevo para quitar)" : "Tocar para insertar"}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {editorTab === "premium" && (
        <div className="space-y-3.5 animate-fade-in text-left">
          <div className="bg-gradient-to-r from-teal-950/80 to-[#10646a]/60 rounded-2xl p-3 border border-teal-500/10 space-y-2 shadow-md">
            <div className="flex items-center gap-1.5 text-teal-300">
              <Award className="w-4.5 h-4.5 text-yellow-400 animate-bounce" />
              <h5 className="text-[10px] font-black uppercase">Membresía Red On VIP</h5>
            </div>
            <p className="text-[8.5px] text-slate-300 leading-relaxed font-medium">
              Al pagar una pequeña mensualidad a Red On, se te asignará un código secreto para remover de inmediato el sello de marca de agua de todos tus flyers y videos.
            </p>
          </div>
          <div className="bg-black/20 p-3 rounded-xl border border-white/5 flex items-center justify-between">
            <span className="text-[8px] font-bold text-slate-300 uppercase">Estado Actual:</span>
            <span className={`text-[8px] font-black px-2.5 py-1 rounded-full uppercase ${
              isPremiumUnlocked ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" : "bg-rose-500/20 text-rose-400 border border-rose-500/30"
            }`}>
              {isPremiumUnlocked ? "👑 Socio Premium Activo" : "❌ Sello de Garantía Activo"}
            </span>
          </div>
          <form onSubmit={handleValidatePremiumCode} className="space-y-2">
            <span className="text-[8px] font-black uppercase text-teal-400 tracking-wider">Ingresa Código de Activación Mensual</span>
            <div className="flex gap-1.5">
              <input type="text" required placeholder="Ej: REDON2026" value={activationCodeInput}
                onChange={(e) => setActivationCodeInput(e.target.value)}
                className="flex-1 bg-slate-950 border border-white/10 text-[9.5px] px-3.5 py-2.5 rounded-xl outline-none focus:border-teal-500 text-center font-mono font-bold tracking-widest text-teal-300 placeholder-slate-600" />
              <button type="submit" className="bg-teal-400 hover:bg-teal-500 text-white font-extrabold text-[9px] px-4 rounded-xl transition-all cursor-pointer shadow-sm shrink-0">Verificar</button>
            </div>
          </form>
          {codeFeedback.message && (
            <div className={`p-2.5 rounded-lg text-[8px] font-bold border ${
              codeFeedback.status === "success" ? "bg-emerald-950/40 border-emerald-500/30 text-emerald-400" : "bg-rose-950/40 border-rose-500/30 text-rose-400"
            }`}>
              {codeFeedback.message}
            </div>
          )}
          <div className="bg-slate-900/40 border border-white/5 rounded-xl p-2.5 space-y-1">
            <span className="text-[7.5px] font-black text-slate-400 block uppercase">Códigos de Prueba:</span>
            <ul className="text-[7px] text-slate-500 space-y-0.5 list-disc pl-3">
              <li><span className="font-mono text-teal-400 font-bold select-all">REDON2026</span> - Remueve la marca de agua</li>
              <li><span className="font-mono text-teal-400 font-bold select-all">NELSON_EMPRENDE</span> - Membresía VIP del Administrador</li>
            </ul>
          </div>
        </div>
      )}

      {editorMode === "video" && (
        <div className="bg-black/30 p-2.5 rounded-xl border border-white/5 space-y-2 text-left pt-2.5 mt-2">
          <span className="text-[8px] font-black uppercase text-teal-400 tracking-wider flex items-center gap-1 leading-none">
            <Music className="w-3 h-3 text-teal-400" /> Banda Sonora & Transiciones
          </span>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <span className="text-[7px] text-slate-400 font-bold uppercase">Música Integrada</span>
              <select value={selectedMusicId} onChange={(e) => { setSelectedMusicId(e.target.value); setIsVideoPlaying(false); }}
                className="w-full bg-slate-950 text-white border border-white/10 text-[8px] p-1.5 rounded-lg outline-none cursor-pointer">
                {PRESET_MUSIC.map(mus => (
                  <option key={mus.id} value={mus.id}>{mus.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <span className="text-[7px] text-slate-400 font-bold uppercase">Tipo Transición</span>
              <select value={transitionStyle} onChange={(e) => setTransitionStyle(e.target.value as any)}
                className="w-full bg-slate-950 text-white border border-white/10 text-[8px] p-1.5 rounded-lg outline-none cursor-pointer">
                <option value="fade">Disolvencia Fluida 🌊</option>
                <option value="zoom">Zoom Cinemático 🔎</option>
                <option value="slide">Barrido Rápido ➔</option>
              </select>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
