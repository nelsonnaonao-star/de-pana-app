export const CHAT_BACKGROUNDS = [
  { id: "default", name: "Clásico Red On 📱", value: "#f8fafc" },
  { id: "minimal_white", name: "Minimalista Blanco 🤍", value: "#ffffff" },
  { id: "dark_simple", name: "Sencillo Oscuro 🖤", value: "#0f172a" },
  { id: "marble", name: "Mármol Elegante 🪨", value: "url('/assets/backgrounds/mansion_elegante.jpg') center/cover no-repeat" },

  // 1. NATURALEZA
  { id: "naturaleza_forest", name: "Bosque Encantado 🌲", value: "url('/assets/backgrounds/bosque_encantado.jpg') center/cover no-repeat" },
  { id: "naturaleza_waterfall", name: "Cascada Escondida 🏔️", value: "url('/assets/backgrounds/cascada_escondida.jpg') center/cover no-repeat" },
  { id: "naturaleza_meadow", name: "Prado Alpino 🌿", value: "url('/assets/backgrounds/prado_alpino.jpg') center/cover no-repeat" },

  // 2. CIUDADES
  { id: "ciudad_tokyo", name: "Tokio Nocturna 🌃", value: "url('/assets/backgrounds/tokio_nocturna.jpg') center/cover no-repeat" },
  { id: "ciudad_ny", name: "Manhattan Skyline 🏙️", value: "url('/assets/backgrounds/manhattan_skyline.jpg') center/cover no-repeat" },
  { id: "ciudad_paris", name: "París Elegante 🗼", value: "url('/assets/backgrounds/paris_elegante.jpg') center/cover no-repeat" },

  // 3. TECNOLOGÍA
  { id: "tech_circuit", name: "Circuito Futurista 🤖", value: "url('/assets/backgrounds/circuito_futurista.jpg') center/cover no-repeat" },
  { id: "tech_data", name: "Data Center 🌐", value: "url('/assets/backgrounds/data_center.jpg') center/cover no-repeat" },
  { id: "tech_space", name: "Nebulosa Espacial 🛸", value: "url('/assets/backgrounds/nebulosa_espacial.jpg') center/cover no-repeat" },

  // 4. PAISAJE
  { id: "paisaje_mountain", name: "Montañas Majestuosas ⛰️", value: "url('/assets/backgrounds/montanas_majestuosas.jpg') center/cover no-repeat" },
  { id: "paisaje_sunset", name: "Atardecer Dorado 🌅", value: "url('/assets/backgrounds/atardecer_dorado.jpg') center/cover no-repeat" },
  { id: "paisaje_valley", name: "Valle Sereno 🏞️", value: "url('/assets/backgrounds/valle_sereno.jpg') center/cover no-repeat" },

  // 5. MARES
  { id: "mares_beach", name: "Playa Paraíso 🏖️", value: "url('/assets/backgrounds/playa_paraiso.jpg') center/cover no-repeat" },
  { id: "mares_ocean", name: "Océano Profundo 🌊", value: "url('/assets/backgrounds/oceano_profundo.jpg') center/cover no-repeat" },
  { id: "mares_coral", name: "Arrecife de Coral 🐠", value: "url('/assets/backgrounds/arrecife_coral.jpg') center/cover no-repeat" },

  { id: "stars", name: "Noche Estrellada 🌌", value: "url('/assets/backgrounds/noche_estrellada.jpg') center/cover no-repeat" },
  { id: "marble_old", name: "Mármol Clásico 🪨", value: "url('/assets/backgrounds/marmol_clasico.jpg') center/cover no-repeat" },

  // 6. LOCALES (bundled - carga instantánea)
  { id: "local_forest", name: "Bosque Real 🌲", value: "url('/assets/backgrounds/forest.jpg') center/cover no-repeat" },
  { id: "local_ocean", name: "Océano Azul 🌊", value: "url('/assets/backgrounds/ocean.jpg') center/cover no-repeat" },
  { id: "local_sunset", name: "Atardecer Fuego 🔥", value: "url('/assets/backgrounds/sunset.jpg') center/cover no-repeat" },
  { id: "local_mountain", name: "Montaña Solitaria ⛰️", value: "url('/assets/backgrounds/mountain.jpg') center/cover no-repeat" },
  { id: "local_galaxy", name: "Galaxia Lejana 🌌", value: "url('/assets/backgrounds/galaxy.jpg') center/cover no-repeat" },
  { id: "local_marble", name: "Mármol Blanco 🤍", value: "url('/assets/backgrounds/marble.jpg') center/cover no-repeat" },

  // 7. GRADIENTES (sin imágenes, carga instantánea)
  { id: "grad_sunset", name: "Atardecer Vibora 🌅", value: "linear-gradient(135deg, #ff6b35 0%, #f7c59f 50%, #1a1a2e 100%)" },
  { id: "grad_ocean", name: "Océano Profundo 🌊", value: "linear-gradient(135deg, #0077b6 0%, #023e8a 50%, #001d3d 100%)" },
  { id: "grad_forest", name: "Bosque Nocturno 🌲", value: "linear-gradient(135deg, #2d6a4f 0%, #1b4332 50%, #081c15 100%)" },
  { id: "grad_neon", name: "Neón Cyberpunk 🤖", value: "linear-gradient(135deg, #f72585 0%, #7209b7 33%, #3a0ca3 66%, #4361ee 100%)" },
  { id: "grad_pastel", name: "Pastel Suave 🎨", value: "linear-gradient(135deg, #ffecd2 0%, #fcb69f 50%, #ff9a9e 100%)" },
  { id: "grad_dark", name: "Noche Oscura 🖤", value: "linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)" },
  { id: "grad_emerald", name: "Esmeralda Real 💚", value: "linear-gradient(135deg, #11998e 0%, #38ef7d 100%)" },
  { id: "grad_fire", name: "Fuego Ardiente 🔥", value: "linear-gradient(135deg, #f12711 0%, #f5af19 100%)" },
  { id: "grad_pink_purple", name: "Rosa a Púrpura 💜", value: "linear-gradient(135deg, #ff9a9e 0%, #fecfef 50%, #a18cd1 100%)" },
  { id: "grad_mint", name: "Menta Fresca 🌿", value: "linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)" },
  { id: "grad_sky", name: "Cielo Azul ☁️", value: "linear-gradient(135deg, #a1c4fd 0%, #c2e9fb 100%)" },
  { id: "grad_peach", name: "Durazno Dulce 🍑", value: "linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)" },
  { id: "grad_lavender", name: "Lavanda Suave 💜", value: "linear-gradient(135deg, #e0c3fc 0%, #8ec5fc 100%)" },
  { id: "grad_coral", name: "Coral Vibrante 🪸", value: "linear-gradient(135deg, #ff9a9e 0%, #fad0c4 50%, #ffecd2 100%)" },
  { id: "grad_aurora", name: "Aurora Boreal 🌌", value: "linear-gradient(135deg, #00c6ff 0%, #0072ff 33%, #7c3aed 66%, #f472b6 100%)" },

  // 8. PATRONES SVG (código puro, sin imágenes)
  { id: "pattern_stars_blue", name: "Estrellas Azules ⭐", value: "pattern:stars|blue|purple" },
  { id: "pattern_bubbles_teal", name: "Burbujas Acuáticas 🫧", value: "pattern:bubbles|teal|cyan" },
  { id: "pattern_dots_pink", name: "Puntos Rosa 💗", value: "pattern:dots|pink|rose" },
  { id: "pattern_constellation", name: "Constelación 🌌", value: "pattern:constellation|indigo|violet" },
  { id: "pattern_sparkle_emerald", name: "Destellos Verde ✨", value: "pattern:sparkle|emerald|teal" },
  { id: "pattern_waves_ocean", name: "Ondas del Mar 🌊", value: "pattern:waves|slate|blue" },
  { id: "pattern_stars_pink", name: "Estrellas Rosa 🌸", value: "pattern:stars|rose|pink" },
  { id: "pattern_bubbles_orange", name: "Burbujas Naranja 🧡", value: "pattern:bubbles|orange|amber" },
  { id: "pattern_dots_indigo", name: "Puntos Índigo 💙", value: "pattern:dots|indigo|violet" },
  { id: "pattern_waves_mint", name: "Ondas Menta 🌿", value: "pattern:waves|emerald|teal" },
  { id: "pattern_sparkle_gold", name: "Destellos Dorados 👑", value: "pattern:sparkle|orange|amber" },
  { id: "pattern_constellation_night", name: "Constelación Nocturna 🌙", value: "pattern:constellation|slate|blue" }
];

export const BUBBLE_PRESETS_ME = [
  { id: "teal_dark", name: "Clásico Red On 📱", css: "bg-gradient-to-br from-[#10646a] to-[#0a4d52] text-white rounded-br-none" },
  { id: "blue", name: "Azul Real 💙", css: "bg-gradient-to-br from-blue-600 to-blue-800 text-white rounded-br-none" },
  { id: "purple", name: "Púrpura Místico 💜", css: "bg-gradient-to-br from-purple-600 to-purple-800 text-white rounded-br-none" },
  { id: "emerald", name: "Verde Esmeralda 💚", css: "bg-gradient-to-br from-emerald-600 to-emerald-800 text-white rounded-br-none" },
  { id: "pink", name: "Rosa Vibrante 💗", css: "bg-gradient-to-br from-pink-500 to-pink-700 text-white rounded-br-none" },
  { id: "orange", name: "Naranja Energía 🧡", css: "bg-gradient-to-br from-orange-500 to-orange-700 text-white rounded-br-none" },
  { id: "red", name: "Fuego Carmesí ❤️", css: "bg-gradient-to-br from-red-600 to-red-800 text-white rounded-br-none" },
  { id: "slate", name: "Negro Carbón 🖤", css: "bg-gradient-to-br from-slate-800 to-slate-950 text-white rounded-br-none" },
  { id: "gold", name: "Oro Imperial 👑", css: "bg-gradient-to-br from-amber-500 to-amber-700 text-slate-950 font-semibold rounded-br-none" },
  { id: "glass", name: "Vidrio ✨", css: "bg-white/20 backdrop-blur-md border border-white/30 shadow-lg text-white rounded-br-none" }
];

export const BUBBLE_PRESETS_THEM = [
  { id: "white", name: "Blanco Puro 🤍", css: "bg-white text-slate-800 rounded-bl-none border border-slate-100" },
  { id: "slate_light", name: "Gris Moderno 🏐", css: "bg-slate-200 text-slate-900 rounded-bl-none border border-slate-300" },
  { id: "emerald_dark", name: "Verde Esmeralda 💚", css: "bg-emerald-600 text-white rounded-bl-none" },
  { id: "blue_vibrant", name: "Azul Intenso 💙", css: "bg-blue-600 text-white rounded-bl-none" },
  { id: "purple_vibrant", name: "Violeta Eléctrico 💜", css: "bg-purple-600 text-white rounded-bl-none" },
  { id: "rose_vibrant", name: "Rosa Chicle 💗", css: "bg-pink-500 text-white rounded-bl-none" },
  { id: "amber_dark", name: "Oro Imperial 👑", css: "bg-amber-500 text-slate-950 font-semibold rounded-bl-none" },
  { id: "red_vibrant", name: "Rojo Pasión ❤️", css: "bg-red-500 text-white rounded-bl-none" },
  { id: "dark", name: "Oscuro Elegante 🖤", css: "bg-slate-900 text-slate-100 rounded-bl-none border border-slate-800" },
  { id: "glass", name: "Vidrio ✨", css: "bg-black/10 backdrop-blur-md border border-white/20 shadow-lg text-slate-800 rounded-bl-none" }
];
