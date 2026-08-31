import React, { useEffect, useState } from "react";

interface FullSplashProps {
  onHidden: () => void;
  maxDurationMs?: number;
}

export default function FullSplash({ onHidden, maxDurationMs = 10000 }: FullSplashProps) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    let mounted = true;
    const timer = setTimeout(() => {
      if (mounted) {
        setVisible(false);
        onHidden();
      }
    }, maxDurationMs);

    return () => {
      mounted = false;
      clearTimeout(timer);
    };
  }, [maxDurationMs, onHidden]);

  if (!visible) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#0A1F1C",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000000,
      }}
      aria-hidden="true"
    >
      <img
        src="/splash.png"
        alt=""
        style={{
          width: "100%",
          height: "100%",
          objectFit: "contain",
        }}
      />
    </div>
  );
}