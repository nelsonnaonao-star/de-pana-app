import React from "react";

type PatternTheme = "stars" | "bubbles" | "dots" | "constellation" | "waves" | "sparkle";

interface ChatPatternBackgroundProps {
  theme?: PatternTheme;
  gradientFrom?: string;
  gradientTo?: string;
  strokeOpacity?: number;
  className?: string;
}

const STARS_PATTERN = (
  <>
    {/* 5-point star */}
    <path d="M20 2l4 8h9l-7 5 3 9-9-6-9 6 3-9-7-5h9z" stroke="currentColor" strokeWidth="1" fill="none" />
    {/* Small star */}
    <path d="M35 30l2 4h4l-3 2 1 4-4-3-4 3 1-4-3-2h4z" stroke="currentColor" strokeWidth="0.8" fill="none" />
    {/* Tiny star */}
    <path d="M8 35l1 2h2l-1 1 1 2-2-1-2 1 1-2-1-1h2z" stroke="currentColor" strokeWidth="0.6" fill="none" />
    {/* Sparkle dot */}
    <circle cx="32" cy="8" r="1" fill="currentColor" />
    <circle cx="5" cy="15" r="0.8" fill="currentColor" />
  </>
);

const BUBBLES_PATTERN = (
  <>
    {/* Large bubble */}
    <circle cx="15" cy="15" r="8" stroke="currentColor" strokeWidth="1" fill="none" />
    {/* Medium bubble */}
    <circle cx="35" cy="35" r="5" stroke="currentColor" strokeWidth="1" fill="none" />
    {/* Small bubbles */}
    <circle cx="30" cy="10" r="3" stroke="currentColor" strokeWidth="0.8" fill="none" />
    <circle cx="8" cy="32" r="2.5" stroke="currentColor" strokeWidth="0.8" fill="none" />
    {/* Tiny bubbles */}
    <circle cx="25" cy="25" r="1.5" stroke="currentColor" strokeWidth="0.6" fill="none" />
    <circle cx="38" cy="18" r="1" stroke="currentColor" strokeWidth="0.6" fill="none" />
    {/* Shine on large bubble */}
    <path d="M12 12q3-2 5 1" stroke="currentColor" strokeWidth="0.5" fill="none" />
  </>
);

const DOTS_PATTERN = (
  <>
    {/* Large dot */}
    <circle cx="10" cy="10" r="3" fill="currentColor" />
    {/* Medium dots */}
    <circle cx="30" cy="10" r="2" fill="currentColor" />
    <circle cx="10" cy="30" r="2" fill="currentColor" />
    <circle cx="30" cy="30" r="2" fill="currentColor" />
    {/* Small dots */}
    <circle cx="20" cy="20" r="1.5" fill="currentColor" />
    <circle cx="5" cy="20" r="1" fill="currentColor" />
    <circle cx="35" cy="20" r="1" fill="currentColor" />
    <circle cx="20" cy="5" r="1" fill="currentColor" />
    <circle cx="20" cy="35" r="1" fill="currentColor" />
    {/* Tiny dots */}
    <circle cx="15" cy="5" r="0.5" fill="currentColor" />
    <circle cx="25" cy="35" r="0.5" fill="currentColor" />
    <circle cx="35" cy="15" r="0.5" fill="currentColor" />
    <circle cx="5" cy="25" r="0.5" fill="currentColor" />
  </>
);

const CONSTELLATION_PATTERN = (
  <>
    {/* Stars */}
    <circle cx="10" cy="10" r="2" fill="currentColor" />
    <circle cx="30" cy="15" r="1.5" fill="currentColor" />
    <circle cx="20" cy="30" r="1.8" fill="currentColor" />
    <circle cx="35" cy="35" r="1.2" fill="currentColor" />
    <circle cx="5" cy="35" r="1" fill="currentColor" />
    <circle cx="38" cy="5" r="0.8" fill="currentColor" />
    {/* Connection lines */}
    <line x1="10" y1="10" x2="30" y2="15" stroke="currentColor" strokeWidth="0.4" />
    <line x1="30" y1="15" x2="20" y2="30" stroke="currentColor" strokeWidth="0.4" />
    <line x1="20" y1="30" x2="35" y2="35" stroke="currentColor" strokeWidth="0.4" />
    <line x1="10" y1="10" x2="5" y2="35" stroke="currentColor" strokeWidth="0.3" />
  </>
);

const WAVES_PATTERN = (
  <>
    {/* Wave 1 */}
    <path d="M0 10 Q10 5 20 10 T40 10" stroke="currentColor" strokeWidth="1" fill="none" />
    {/* Wave 2 */}
    <path d="M0 25 Q10 20 20 25 T40 25" stroke="currentColor" strokeWidth="0.8" fill="none" />
    {/* Wave 3 */}
    <path d="M0 38 Q10 33 20 38 T40 38" stroke="currentColor" strokeWidth="0.6" fill="none" />
    {/* Dots on waves */}
    <circle cx="10" cy="10" r="1" fill="currentColor" />
    <circle cx="30" cy="10" r="1" fill="currentColor" />
    <circle cx="20" cy="25" r="1.2" fill="currentColor" />
  </>
);

const SPARKLE_PATTERN = (
  <>
    {/* 4-point sparkle */}
    <path d="M20 15v-8M20 23v-8M16 19h-8M28 19h-8" stroke="currentColor" strokeWidth="1" />
    {/* Small sparkle */}
    <path d="M35 35v-4M35 39v-4M33 37h-4M37 37h-4" stroke="currentColor" strokeWidth="0.8" />
    {/* Tiny sparkle */}
    <path d="M8 8v-3M8 11v-3M6 9h-3M11 9h-3" stroke="currentColor" strokeWidth="0.6" />
    {/* Dots */}
    <circle cx="30" cy="10" r="1" fill="currentColor" />
    <circle cx="10" cy="30" r="0.8" fill="currentColor" />
    <circle cx="38" cy="25" r="0.6" fill="currentColor" />
  </>
);

const PATTERNS: Record<PatternTheme, React.ReactNode> = {
  stars: STARS_PATTERN,
  bubbles: BUBBLES_PATTERN,
  dots: DOTS_PATTERN,
  constellation: CONSTELLATION_PATTERN,
  waves: WAVES_PATTERN,
  sparkle: SPARKLE_PATTERN,
};

const GRADIENT_MAP: Record<string, { from: string; to: string }> = {
  "blue|purple": { from: "#60a5fa", to: "#a78bfa" },
  "teal|cyan": { from: "#2dd4bf", to: "#22d3ee" },
  "pink|rose": { from: "#f472b6", to: "#fb7185" },
  "emerald|teal": { from: "#34d399", to: "#2dd4bf" },
  "orange|amber": { from: "#fb923c", to: "#fbbf24" },
  "indigo|violet": { from: "#818cf8", to: "#a78bfa" },
  "slate|blue": { from: "#94a3b8", to: "#60a5fa" },
  "rose|pink": { from: "#fb7185", to: "#f472b6" },
};

function getGradientColors(from: string, to: string): { from: string; to: string } {
  const key = `${from}|${to}`;
  return GRADIENT_MAP[key] || { from: "#3b82f6", to: "#8b5cf6" };
}

export default function ChatPatternBackground({
  theme = "stars",
  gradientFrom = "blue",
  gradientTo = "purple",
  strokeOpacity = 0.35,
  className = "",
}: ChatPatternBackgroundProps) {
  const colors = getGradientColors(gradientFrom, gradientTo);
  const patternId = `pattern-${theme}`;

  return (
    <div
      className={`absolute inset-0 z-0 overflow-hidden ${className}`}
      style={{
        background: `linear-gradient(135deg, ${colors.from} 0%, ${colors.to} 100%)`,
      }}
    >
      <svg
        width="100%"
        height="100%"
        className="absolute inset-0"
        style={{ opacity: strokeOpacity }}
      >
        <defs>
          <pattern
            id={patternId}
            x="0"
            y="0"
            width="40"
            height="40"
            patternUnits="userSpaceOnUse"
          >
            <g style={{ color: "white" }}>
              {PATTERNS[theme]}
            </g>
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${patternId})`} />
      </svg>
    </div>
  );
}
