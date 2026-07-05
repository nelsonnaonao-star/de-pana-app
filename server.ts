import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT || "3000", 10);

app.use(express.json());
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (_req.method === 'OPTIONS') {
    res.sendStatus(200);
    return;
  }
  next();
});

// Lazy-initialize Gemini client to prevent crash if key is missing on start
let aiClient: GoogleGenAI | null = null;

function getAiClient(): GoogleGenAI {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY context variable is missing. Please set it in Settings > Secrets.");
    }
    aiClient = new GoogleGenAI({
      apiKey: apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
  }
  return aiClient;
}

// OpenCode Assistant API Endpoint
app.post("/api/chat", async (req, res) => {
  try {
    const { message, history } = req.body;
    if (!message) {
      return res.status(400).json({ error: "El mensaje es requerido." });
    }

    const ai = getAiClient();
    
    // Structure contents for multi-turn generateContent
    const formattedContents: any[] = [];
    if (history && Array.isArray(history)) {
      for (const msg of history) {
        formattedContents.push({
          role: msg.role === 'user' ? 'user' : 'model',
          parts: [{ text: msg.text }]
        });
      }
    }
    
    // Add latest user message
    formattedContents.push({
      role: 'user',
      parts: [{ text: message }]
    });

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: formattedContents,
      config: {
        systemInstruction: `Eres OpenCode, una ingeniera de software de élite experta en desarrollo móvil híbrido con Capacitor, Cordova, React y Tailwind CSS, así como configuraciones nativas de Android (Java/Kotlin, XML) e iOS (Swift, Storyboards).
Tu tarea es actuar como un asistente de depuración interactivo. Ayuda al usuario a solucionar problemas de superposición móvil donde la barra de estado superior o los botones de navegación de Android tapan la aplicación.

Explica con precisión científica pero de forma didáctica por qué ocurren estos problemas:
1. El viewport web no está configurado con "viewport-fit=cover" en el archivo index.html.
2. No se están usando variables CSS de área segura (safe area insets) como env(safe-area-inset-top) y env(safe-area-inset-bottom) para dar padding o márgenes a las barras de cabecera (header) y navegación (footer).
3. La configuración de Capacitor para ocultar, mostrar u overlayear la barra de estado (StatusBar.setOverlaysWebView).
4. El archivo styles.xml (o themes.xml) de Android que tiene banderas translúcidas (windowTranslucentNavigation, windowTranslucentStatus) sin configurar el ajuste automático de ventanas (fitsSystemWindows) o sin manejarlo en la capa web.

Ofrece siempre bloques de código listos para Visual Studio Code con explicaciones detalladas de dónde colocarlos y qué comandos ejecutar.
Responde con un tono empático, amigable, claro y en español.`
      }
    });

    res.json({ response: response.text });
  } catch (error: any) {
    console.error("Error in /api/chat:", error);
    res.status(500).json({ error: error.message || "Ocurrió un error al procesar tu solicitud con OpenCode." });
  }
});

// Vite Middleware & Static Client Serving
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    const url = process.env.APP_URL || `http://localhost:${PORT}`;
    console.log(`Red On running on ${url}`);
  });
}

startServer();
