import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  ChevronLeft,
  ChevronRight,
  CircleUser,
  Compass,
  MessageSquareMore,
  Plus,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import {
  isOnboardingTourDone,
  markOnboardingTourDone,
  onOnboardingTourCloseRequested,
  onOnboardingTourRequested,
} from "../services/onboardingTour";

interface OnboardingTourProps {
  enabled?: boolean;
}

interface TourStep {
  id: string;
  title: string;
  description: string;
  icon: ReactNode;
  target?: string;
}

interface SpotlightRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const STEPS: TourStep[] = [
  {
    id: "welcome",
    title: "¡Bienvenido a WEPA!",
    description:
      "Te damos un recorrido rápido por lo esencial. Puedes saltarlo cuando quieras y repetirlo luego desde tu Perfil.",
    icon: <Sparkles className="w-5 h-5" />,
  },
  {
    id: "search",
    title: "Busca y encuentra",
    description:
      "En la barra superior puedes buscar cualquier conversación por nombre. Abajo verás tus chats más recientes.",
    target: '[data-tour="header"]',
    icon: <Search className="w-5 h-5" />,
  },
  {
    id: "chats",
    title: "Tus conversaciones",
    description:
      "Aquí viven tus chats. Toca uno para abrirlo o mantén presionado para silenciarlo, borrarlo o fijarlo.",
    target: '[data-tour="chat-list"]',
    icon: <MessageSquareMore className="w-5 h-5" />,
  },
  {
    id: "fab",
    title: "Crea y conecta",
    description:
      "El botón + te permite sincronizar tu agenda, crear un grupo, escanear QR, agregar contactos y ver tus llamadas.",
    target: '[data-tour="fab"]',
    icon: <Plus className="w-5 h-5" />,
  },
  {
    id: "tabs",
    title: "Todo a un toque",
    description:
      "Navega entre Chats, Contactos, Momentos, Tasas, Negocio y Perfil con esta barra inferior.",
    target: '[data-tour="tabbar"]',
    icon: <Compass className="w-5 h-5" />,
  },
  {
    id: "profile",
    title: "Tu perfil y ajustes",
    description:
      "Desde Perfil puedes editar tus datos, activar el bloqueo biométrico, gestionar notificaciones y volver a ver este tutorial.",
    target: '[data-tour="tab-profile"]',
    icon: <CircleUser className="w-5 h-5" />,
  },
];

const FALLBACK_BOTTOM = "calc(16px + env(safe-area-inset-bottom))";

export default function OnboardingTour({ enabled = false }: OnboardingTourProps) {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<SpotlightRect | null>(null);
  const [viewport, setViewport] = useState(() => ({
    width: typeof window === "undefined" ? 0 : window.innerWidth,
    height: typeof window === "undefined" ? 0 : window.innerHeight,
  }));
  const autoStartedRef = useRef(false);

  const step = STEPS[Math.min(index, STEPS.length - 1)];
  const isLast = index >= STEPS.length - 1;

  const finish = useCallback(() => {
    setOpen(false);
    setRect(null);
    void markOnboardingTourDone();
  }, []);

  const measure = useCallback(() => {
    if (typeof window === "undefined") return;
    setViewport({ width: window.innerWidth, height: window.innerHeight });
    if (!step?.target) {
      setRect(null);
      return;
    }
    const el = document.querySelector(step.target) as HTMLElement | null;
    if (!el) {
      setRect(null);
      return;
    }
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) {
      setRect(null);
      return;
    }
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, [step]);

  useEffect(() => {
    if (!enabled || autoStartedRef.current) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    isOnboardingTourDone()
      .then((done) => {
        if (cancelled || done) return;
        timer = setTimeout(() => {
          if (cancelled || autoStartedRef.current) return;
          if (!document.querySelector('[data-tour="header"]')) return;
          autoStartedRef.current = true;
          setIndex(0);
          setOpen(true);
        }, 1600);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [enabled]);

  useEffect(() => {
    return onOnboardingTourRequested(() => {
      autoStartedRef.current = true;
      setIndex(0);
      setOpen(true);
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    return onOnboardingTourCloseRequested(finish);
  }, [open, finish]);

  useEffect(() => {
    if (!open) return;

    const firstMeasure = setTimeout(measure, 80);
    const settleMeasure = setTimeout(measure, 420);

    const onViewportChange = () => measure();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") finish();
    };

    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
    window.addEventListener("keydown", onKeyDown);

    return () => {
      clearTimeout(firstMeasure);
      clearTimeout(settleMeasure);
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, measure, finish]);

  if (!open) return null;

  const spot = rect
    ? {
        left: Math.max(4, rect.left - 6),
        top: Math.max(4, rect.top - 6),
        width: Math.min(viewport.width - 8, rect.width + 12),
        height: Math.min(viewport.height - 8, rect.height + 12),
      }
    : null;

  const cardStyle: CSSProperties = {
    left: 16,
    right: 16,
    bottom: FALLBACK_BOTTOM,
  };

  if (rect && viewport.height > 0) {
    const targetIsLow = rect.top > viewport.height * 0.55;
    if (targetIsLow) {
      cardStyle.bottom = Math.max(16, viewport.height - rect.top + 14);
    }
  }

  const goNext = () => {
    if (isLast) {
      finish();
      return;
    }
    setIndex((current) => Math.min(current + 1, STEPS.length - 1));
  };

  const goPrev = () => setIndex((current) => Math.max(0, current - 1));

  return (
    <div
      data-wepa-tour="open"
      className="fixed inset-0 z-[90000]"
      role="dialog"
      aria-modal="true"
      aria-label="Tutorial de WEPA"
    >
      {spot ? (
        <div
          className="absolute rounded-2xl pointer-events-none"
          style={{
            left: spot.left,
            top: spot.top,
            width: spot.width,
            height: spot.height,
            border: "2px solid rgba(45, 212, 191, 0.95)",
            boxShadow: "0 0 0 9999px rgba(4, 20, 24, 0.78)",
            transition: "left 220ms ease, top 220ms ease, width 220ms ease, height 220ms ease",
          }}
        />
      ) : (
        <div className="absolute inset-0 bg-[#041418]/[0.82]" />
      )}

      <div
        className="absolute bg-white rounded-3xl shadow-2xl p-5 animate-slide-up"
        style={cardStyle}
      >
        <button
          onClick={finish}
          className="absolute top-3 right-3 w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center transition-colors cursor-pointer"
          aria-label="Cerrar tutorial"
        >
          <X className="w-3.5 h-3.5" />
        </button>

        <div className="flex items-center gap-3 pr-8">
          <div className="w-11 h-11 rounded-2xl bg-teal-500/10 text-teal-600 flex items-center justify-center shrink-0">
            {step.icon}
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-widest text-teal-600">
              Paso {index + 1} de {STEPS.length}
            </p>
            <h3 className="text-base font-extrabold text-slate-900 leading-tight">
              {step.title}
            </h3>
          </div>
        </div>

        <p className="text-[12.5px] text-slate-500 leading-relaxed mt-3">
          {step.description}
        </p>

        <div className="flex items-center gap-1.5 mt-3">
          {STEPS.map((s, i) => (
            <span
              key={s.id}
              className={`h-1.5 rounded-full transition-all ${
                i === index ? "w-5 bg-teal-500" : "w-1.5 bg-slate-200"
              }`}
            />
          ))}
        </div>

        <div className="flex items-center justify-between gap-3 mt-4">
          <button
            onClick={finish}
            className="text-[11px] font-bold text-slate-400 hover:text-slate-600 transition-colors cursor-pointer px-1 py-2"
          >
            Saltar
          </button>

          <div className="flex items-center gap-2">
            {index > 0 && (
              <button
                onClick={goPrev}
                className="flex items-center gap-1 px-3 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 text-[11px] font-bold transition-colors cursor-pointer"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                Atrás
              </button>
            )}
            <button
              onClick={goNext}
              className="flex items-center gap-1 px-4 py-2.5 rounded-xl bg-[#0a4d52] hover:bg-[#10646a] text-white text-[11px] font-extrabold shadow-sm transition-colors cursor-pointer"
            >
              {isLast ? "Listo" : "Siguiente"}
              {!isLast && <ChevronRight className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
