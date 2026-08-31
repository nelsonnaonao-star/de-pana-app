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
      style={{ width: size, height: size }}
    >
      <div
        className="relative"
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: "50%",
          overflow: "hidden",
          background: "#0A2E28",
        }}
      >
        <div
          style={{
            ...blobBase,
            animation: "orb-morph-1 3.2s ease-in-out infinite",
            animationPlayState: animate ? "running" : "paused",
            width: 32 * scale,
            height: 32 * scale,
            left: 8 * scale,
            top: 8 * scale,
            background: "#5EB7FF",
            filter: `blur(${9 * scale}px)`,
            opacity: 0.9,
          }}
        />
        <div
          style={{
            ...blobBase,
            animation: "orb-morph-2 2.6s ease-in-out infinite",
            animationPlayState: animate ? "running" : "paused",
            width: 24 * scale,
            height: 24 * scale,
            left: 12 * scale,
            top: 12 * scale,
            background: "#C65EFF",
            filter: `blur(${8 * scale}px)`,
            opacity: 0.8,
          }}
        />
        <div
          style={{
            ...blobBase,
            animation: "orb-morph-3 3.8s ease-in-out infinite",
            animationPlayState: animate ? "running" : "paused",
            width: 20 * scale,
            height: 20 * scale,
            left: 14 * scale,
            top: 14 * scale,
            background: "#4ADE80",
            filter: `blur(${7 * scale}px)`,
            opacity: 0.65,
          }}
        />
      </div>
    </div>
  );
}