import React, { useState, useRef, useEffect } from "react";
import DOMPurify from "dompurify";
import { apiUrl } from "../lib/api";
import { Send, Terminal, Loader2, Sparkles, Copy, Check, MessageCircle } from "lucide-react";

function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ["strong", "em", "code", "br"],
    ALLOWED_ATTR: ["class"],
  });
}

interface Message {
  role: "user" | "model";
  text: string;
}

const PRESET_QUESTIONS = [
  {
    label: "📱 Solución index.html",
    question: "Dame el código para agregar el viewport-fit=cover en mi index.html y explícame para qué sirve"
  },
  {
    label: "🎨 Configurar CSS (Tailwind)",
    question: "Dame las clases de Tailwind y estilos CSS personalizados para aplicar safe-area-inset arriba y abajo"
  },
  {
    label: "⚡ Capacitor StatusBar",
    question: "¿Cómo uso el plugin StatusBar de Capacitor en React para que la barra de estado superior no tape la cabecera?"
  },
  {
    label: "🤖 Android styles.xml",
    question: "En Android Studio, ¿qué cambios debo hacer en styles.xml para manejar barras translúcidas o fitsSystemWindows?"
  }
];

export default function ChatConsole() {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "model",
      text: `¡Hola Nelson! Soy **OpenCode**, tu asistente de depuración para desarrollo móvil con **Capacitor**.

He analizado detalladamente la captura de pantalla de tu teléfono. Lo que estás experimentando es el clásico **problema de superposición de áreas seguras (Safe Areas / Insets)**. 

### ¿Por qué pasa esto exactamente?
Cuando compilas con Capacitor, el WebView de Android/iOS se extiende a pantalla completa detrás de las barras nativas para dar una experiencia de "pantalla completa" inmersiva. Si no configuras las distancias de área segura, tu cabecera chocará con el reloj/batería en la parte superior, y tu menú inferior chocará con la barra de navegación del sistema Android (el botón de retroceder, inicio, etc.).

**¿Cómo te gustaría resolverlo hoy?** Puedes usar los botones rápidos aquí abajo para que te genere el código de cada archivo, o pegarme fragmentos de tu código aquí mismo para corregirlos.`
    }
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  const handleSend = async (textToSend: string) => {
    if (!textToSend.trim() || isLoading) return;

    const userMsg: Message = { role: "user", text: textToSend };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsLoading(true);

    try {
      const response = await fetch(apiUrl("/api/chat"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: textToSend,
          history: messages
        })
      });

      const data = await response.json();
      if (response.ok && data.response) {
        setMessages((prev) => [...prev, { role: "model", text: data.response }]);
      } else {
        setMessages((prev) => [
          ...prev,
          { role: "model", text: `⚠️ Error: ${data.error || "No se pudo obtener respuesta del servidor."}` }
        ]);
      }
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        { role: "model", text: `❌ Error de red: No se pudo conectar con el servidor de OpenCode. Verifica que tu GEMINI_API_KEY esté configurada.` }
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const copyToClipboard = (text: string, id: number) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Basic custom markdown formatter to render bold, list items, and code blocks beautifully
  const renderMessageText = (text: string, msgIndex: number) => {
    const parts = text.split(/(```[\s\S]*?```)/g);
    
    return parts.map((part, index) => {
      if (part.startsWith("```")) {
        // Extract language and code
        const match = part.match(/```(\w*)\n([\s\S]*?)```/);
        const lang = match ? match[1] : "code";
        const code = match ? match[2] : part.slice(3, -3);
        const codeId = msgIndex * 1000 + index;

        return (
          <div key={index} className="my-3 rounded-lg border border-slate-800 bg-slate-950/90 overflow-hidden font-mono text-xs">
            <div className="flex justify-between items-center px-4 py-2 bg-slate-900 border-b border-slate-800 text-[10px] text-slate-400">
              <span className="uppercase font-semibold tracking-wider text-cyan-400">{lang || "CÓDIGO"}</span>
              <button
                onClick={() => copyToClipboard(code, codeId)}
                className="flex items-center gap-1.5 hover:text-slate-200 transition-colors cursor-pointer"
              >
                {copiedId === codeId ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Copiado</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copiar código</span>
                  </>
                )}
              </button>
            </div>
            <pre className="p-4 overflow-x-auto text-slate-300 leading-relaxed whitespace-pre">
              <code>{code}</code>
            </pre>
          </div>
        );
      }

      // Format inline bold and list items
      const lines = part.split("\n");
      return (
        <div key={index} className="space-y-2">
          {lines.map((line, lineIdx) => {
            let processed = line;
            
            // Check headers
            if (line.startsWith("### ")) {
              return (
                <h4 key={lineIdx} className="text-sm font-bold text-cyan-300 mt-4 mb-2">
                  {line.slice(4)}
                </h4>
              );
            }
            if (line.startsWith("## ")) {
              return (
                <h3 key={lineIdx} className="text-base font-bold text-indigo-300 mt-4 mb-2 border-b border-slate-800 pb-1">
                  {line.slice(3)}
                </h3>
              );
            }

            // Bold styling: replace **text** with <strong>text</strong>
            const boldRegex = /\*\*(.*?)\*\*/g;
            const hasBold = boldRegex.test(processed);
            
            // Inline code styling: replace `code` with <code class="font-mono bg-slate-950 px-1 py-0.5 rounded text-cyan-400">code</code>
            const codeRegex = /`(.*?)`/g;

            if (line.trim().startsWith("- ") || line.trim().startsWith("* ")) {
              const content = line.trim().slice(2);
              return (
                <ul key={lineIdx} className="list-disc pl-5 my-1 text-slate-300">
                  <li dangerouslySetInnerHTML={{ 
                    __html: sanitizeHtml(content
                      .replace(/\*\*(.*?)\*\*/g, '<strong class="font-semibold text-white">$1</strong>')
                      .replace(/`(.*?)`/g, '<code class="font-mono bg-slate-950 text-cyan-400 px-1 py-0.5 rounded text-[11px]">$1</code>'))
                  }} />
                </ul>
              );
            }

            return (
              <p
                key={lineIdx}
                className="text-slate-300 text-sm leading-relaxed"
                dangerouslySetInnerHTML={{
                  __html: sanitizeHtml(processed
                    .replace(/\*\*(.*?)\*\*/g, '<strong class="font-semibold text-white">$1</strong>')
                    .replace(/`(.*?)`/g, '<code class="font-mono bg-slate-950 text-cyan-400 px-1 py-0.5 rounded text-[11px]">$1</code>'))
                }}
              />
            );
          })}
        </div>
      );
    });
  };

  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded-2xl flex flex-col h-[560px] overflow-hidden glow-cyan">
      {/* Console Header */}
      <div className="bg-slate-950 px-4 py-3 border-b border-slate-800 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-pulse"></div>
          <span className="text-xs font-mono font-bold uppercase tracking-wider text-cyan-400 flex items-center gap-1.5">
            <Terminal className="w-3.5 h-3.5" />
            Consola Inteligente OpenCode
          </span>
        </div>
        <div className="text-[10px] bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 px-2 py-0.5 rounded-full font-mono">
          gemini-3.5-flash
        </div>
      </div>

      {/* Messages Log */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-950/40">
        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={`flex gap-3 max-w-[85%] ${
              msg.role === "user" ? "ml-auto flex-row-reverse" : "mr-auto"
            }`}
          >
            {/* Avatar badge */}
            <div
              className={`w-8 h-8 rounded-xl flex items-center justify-center text-xs shrink-0 select-none ${
                msg.role === "user"
                  ? "bg-indigo-600/20 text-indigo-400 border border-indigo-500/30"
                  : "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30"
              }`}
            >
              {msg.role === "user" ? "TU" : "OC"}
            </div>

            {/* Message bubble */}
            <div
              className={`p-4 rounded-2xl ${
                msg.role === "user"
                  ? "bg-indigo-600/15 border border-indigo-500/20 text-indigo-50 rounded-tr-none"
                  : "bg-slate-900 border border-slate-800 text-slate-100 rounded-tl-none"
              }`}
            >
              {renderMessageText(msg.text, idx)}
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex gap-3 max-w-[85%] mr-auto">
            <div className="w-8 h-8 rounded-xl bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 flex items-center justify-center text-xs shrink-0">
              OC
            </div>
            <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl rounded-tl-none flex items-center gap-2 text-xs text-slate-400">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-400" />
              <span>OpenCode está analizando tu código...</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Preset Help Actions */}
      <div className="bg-slate-950/60 p-2 border-t border-slate-800/80 overflow-x-auto whitespace-nowrap flex gap-2">
        {PRESET_QUESTIONS.map((pq, idx) => (
          <button
            key={idx}
            onClick={() => handleSend(pq.question)}
            className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-slate-300 rounded-lg text-xs font-medium transition-all inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Sparkles className="w-3 h-3 text-cyan-400" />
            {pq.label}
          </button>
        ))}
      </div>

      {/* Text Entry Field */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSend(input);
        }}
        className="bg-slate-950 p-3 border-t border-slate-800 flex gap-2"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Escribe tu pregunta sobre Capacitor, Tailwind o pega tu código aquí..."
          className="flex-1 bg-slate-900 text-slate-100 border border-slate-800 focus:border-cyan-500/50 rounded-xl px-4 py-2.5 text-sm outline-none transition-colors"
        />
        <button
          type="submit"
          disabled={!input.trim() || isLoading}
          className="bg-cyan-500 hover:bg-cyan-600 disabled:bg-slate-800 disabled:text-slate-600 text-slate-950 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all flex items-center gap-1.5 cursor-pointer shrink-0"
        >
          <Send className="w-4 h-4" />
          <span>Preguntar</span>
        </button>
      </form>
    </div>
  );
}
