export const STATIC_PRESET_IMAGES = [
  { url: "https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=400&q=80", label: "Zapatos Deportivos 👟" },
  { url: "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=400&q=80", label: "Auriculares Pro 🎧" },
  { url: "https://images.unsplash.com/photo-1485968579580-b6d095142e6e?auto=format&fit=crop&w=400&q=80", label: "Hamburguesa Gourmet 🍔" },
  { url: "https://images.unsplash.com/photo-1511556532299-8f662fc26c06?auto=format&fit=crop&w=400&q=80", label: "Prendas de Moda 👗" }
];

export const PRESET_FILTERS_EXPANDED = [
  { id: "normal", name: "Original 💎", css: "", desc: "Sin alteraciones" },
  { id: "caribe", name: "Caribe Vívido 🌴", css: "saturate-150 contrast-110 brightness-105", desc: "Saturación tropical alta" },
  { id: "retro", name: "Retro VHS 📼", css: "sepia saturate-115 contrast-90 hue-rotate-15", desc: "Aspecto análogo cálido" },
  { id: "cine", name: "Cine de Oro 🎬", css: "contrast-130 brightness-95 saturate-120", desc: "Contraste dramático de película" },
  { id: "polar", name: "Fresco Polar ❄️", css: "hue-rotate-180 saturate-120 contrast-105", desc: "Tonos fríos cian" },
  { id: "bw", name: "B&N Editorial 🖤", css: "grayscale contrast-130 brightness-100", desc: "Monocromático de alta costura" },
  { id: "sunset", name: "Atardecer Cálido 🌅", css: "sepia-30 saturate-135 hue-rotate-340 brightness-105", desc: "Brillo dorado nostálgico" },
  { id: "cyber", name: "Cyberpunk Neon 👾", css: "hue-rotate-290 saturate-200 brightness-110 contrast-125", desc: "Psicodélico futurista" },
  { id: "dream", name: "Ensueño Glow ✨", css: "brightness-110 contrast-95 saturate-125 blur-[0.5px]", desc: "Atmósfera suave y mágica" },
  { id: "drama", name: "Drama Intenso 🎭", css: "contrast-160 brightness-90 saturate-75", desc: "Sombras profundas editoriales" },
  { id: "forest", name: "Místico Bosque 🌲", css: "hue-rotate-90 saturate-110 brightness-95", desc: "Tonos verdosos orgánicos" }
];

export const STICKER_TEMPLATES_PRO = [
  { id: "oferta", text: "🔥 ¡SÚPER OFERTA!", bg: "bg-red-600 text-white border-2 border-white font-black animate-bounce" },
  { id: "nuevo", text: "⚡ NUEVO MODELO", bg: "bg-teal-500 text-white border-2 border-white font-black" },
  { id: "top", text: "★ TOP VENTAS ★", bg: "bg-amber-400 text-slate-950 border-2 border-slate-950 font-black animate-pulse" },
  { id: "delivery", text: "ENVÍO GRATUITO 🚚", bg: "bg-indigo-600 text-white border-2 border-white font-black" },
  { id: "vip", text: "💎 DESCUENTO VIP", bg: "bg-purple-600 text-white border-2 border-white font-black" },
  { id: "last", text: "⏳ ÚLTIMOS CUPOS", bg: "bg-orange-500 text-white border-2 border-white font-black" },
  { id: "quality", text: "🛡️ GARANTIZADO 100%", bg: "bg-blue-600 text-white border-2 border-white font-black" },
  { id: "promo", text: "🎁 COMPRA & GANA", bg: "bg-pink-600 text-white border-2 border-white font-black" }
];

export const PRESET_MUSIC = [
  { id: "none", name: "Sin Música", url: "" },
  { id: "lofi", name: "Lofi Calm Beats ☕", url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3" },
  { id: "pop", name: "Chill Pop Emprendedor 🚀", url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3" },
  { id: "synth", name: "Synthwave Sunset 🌆", url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3" }
];

export const ANIMATION_PRESETS = [
  { id: "none", name: "Estático", class: "" },
  { id: "bounce", name: "Rebote Divertido 🦘", class: "animate-bounce" },
  { id: "pulse", name: "Latido Suave 💓", class: "animate-pulse" },
  { id: "typing", name: "Máquina de escribir ⌨️", class: "animate-typing" },
  { id: "zoom", name: "Efecto Pop 🔎", class: "animate-zoom-in-out" },
  { id: "shake", name: "Vibración Alerta ⚠️", class: "animate-vibrate" },
  { id: "slide", name: "Entrada Deslizante ➔", class: "animate-slide-right" }
];
