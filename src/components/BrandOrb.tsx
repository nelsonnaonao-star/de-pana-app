import React, { useEffect, useRef } from "react";

interface BrandOrbProps {
  size?: number;
  animate?: boolean;
}

const ORB_KEYFRAMES = `
  @keyframes orb-morph-1 {
    0%,100% { transform: translate(-5px,-3px) scale(1); }
    50% { transform: translate(5px,3px) scale(1.15); }
  }
  @keyframes orb-morph-2 {
    0%,100% { transform: translate(4px,-4px) scale(1.05); }
    50% { transform: translate(-4px,4px) scale(0.9); }
  }
  @keyframes orb-morph-3 {
    0%,100% { transform: translate(-3px,5px) scale(0.95); }
    50% { transform: translate(3px,-5px) scale(1.1); }
  }
`;

export default function BrandOrb({ size = 60, animate = true }: BrandOrbProps) {
  const styleRef = useRef<HTMLStyleElement | null>(null);

  useEffect(() => {
    if (!styleRef.current) {
      const style = document.createElement("style");
      style.textContent = ORB_KEYFRAMES;
      document.head.appendChild(style);
      styleRef.current = style;
    }
    return () => {
      if (styleRef.current) {
        styleRef.current.remove();
        styleRef.current = null;
      }
    };
  }, []);

  const scale = size / 48;
  const blobBase = { position: "absolute" as const, borderRadius: "50%" };

  return (
    <div
      className="relative shrink-0"
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        boxShadow: "0 1px 2px rgba(0,0,0,0.45), 0 3px 7px rgba(0,0,0,0.2)",
      }}
    >
      <div
        className="relative"
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: "50%",
          overflow: "hidden",
          border: "1px solid rgba(255,255,255,0.14)",
          background:
            "radial-gradient(circle at 50% 38%, #1A6154 0%, #11473D 30%, #0A2E28 60%, #05201B 100%)",
          boxShadow:
            "inset 0 1px 2px rgba(255,255,255,0.1), inset 0 -3px 7px rgba(0,0,0,0.38)",
        }}
      >
        <div
          style={{
            ...blobBase,
            animation: "orb-morph-1 3.2s ease-in-out infinite",
            animationPlayState: animate ? "running" : "paused",
            width: 33 * scale,
            height: 33 * scale,
            left: 6 * scale,
            top: 6 * scale,
            background: "#5EB7FF",
            filter: `blur(${10 * scale}px)`,
            opacity: 0.9,
          }}
        />
        <div
          style={{
            ...blobBase,
            animation: "orb-morph-2 2.6s ease-in-out infinite",
            animationPlayState: animate ? "running" : "paused",
            width: 26 * scale,
            height: 26 * scale,
            left: 11 * scale,
            top: 12 * scale,
            background: "#C65EFF",
            filter: `blur(${9 * scale}px)`,
            opacity: 0.8,
          }}
        />
        <div
          style={{
            ...blobBase,
            animation: "orb-morph-3 3.8s ease-in-out infinite",
            animationPlayState: animate ? "running" : "paused",
            width: 23 * scale,
            height: 23 * scale,
            left: 15 * scale,
            top: 14 * scale,
            background: "#4ADE80",
            filter: `blur(${8 * scale}px)`,
            opacity: 0.65,
          }}
        />
      </div>
    </div>
  );
}