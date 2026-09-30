import { CSSProperties } from "react";

interface MsgTicksProps {
  status: "sent" | "delivered" | "read";
}

// Check propietario de WEPA (silueta icons8-done).
// - sent: 1 check gris
// - delivered: 2 checks grises
// - read: 2 checks en cian (color de "visto" que ya usa WEPA)
// El segundo check entra con un fade muy sutil cuando aparece.
// Componente puramente visual: no determina ni modifica el estado del mensaje.
const SENT_COLOR = "#94a3b8"; // slate-400
const READ_COLOR = "#06b6d4"; // cyan-500

// Silueta única del check (viewBox 0 0 100 100).
const DONE_PATH =
  "m90.37,18.05c-3.74-3.37-9.51-3.16-13.26.19l-39.85,36.72-14.68-9.52c-4.12-2.87-9.81-2.56-13.31,1.04-3.94,4.05-3.81,10.48.21,14.36l21.49,20.73c4.03,3.88,10.45,3.71,14.26-.38l45.77-49.19c3.68-3.96,3.49-10.23-.63-13.95Z";

function CheckGlyph({ color, style }: { color: string; style?: CSSProperties }) {
  return (
    <svg viewBox="0 0 100 100" width={15} height={15} style={style} aria-hidden="true">
      <path d={DONE_PATH} fill={color} />
    </svg>
  );
}

export default function MsgTicks({ status }: MsgTicksProps) {
  const color = status === "read" ? READ_COLOR : SENT_COLOR;
  const showSecond = status !== "sent";

  return (
    <span
      className="relative inline-block"
      style={{ width: showSecond ? 20 : 15, height: 17, lineHeight: 0, verticalAlign: "-2px" }}
    >
      {showSecond && (
        <span style={{ position: "absolute", left: 0, top: 0 }}>
          <svg viewBox="0 0 100 100" width={15} height={15} aria-hidden="true">
            <g style={{ opacity: 0 }}>
              <animate attributeName="opacity" from="0" to="1" dur="250ms" fill="freeze" />
              <path d={DONE_PATH} fill={color} />
            </g>
          </svg>
        </span>
      )}
      <span style={{ position: "absolute", left: showSecond ? 5 : 0, top: showSecond ? 3.5 : 0 }}>
        <CheckGlyph color={color} />
      </span>
    </span>
  );
}