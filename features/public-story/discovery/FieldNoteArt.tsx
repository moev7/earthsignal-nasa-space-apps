import type { EchoTelemetry } from "@/lib/echo-director";
import { phaseTransect, policyScenario } from "@/lib/field-investigation";
import { radarSample } from "@/lib/radar-interferometry";

/** Small visual receipts from kept scalars. Full labelled values remain text. */
export function FieldNoteArt({ note: n }: { note: EchoTelemetry }) {
  let art;
  switch (n.kind) {
    case "water":
      art = (
        <>
          <path d="M20 20H300M20 65H300" strokeDasharray="4 4" />
          {Array.from({ length: 18 }, (_, i) => (
            <circle
              key={i}
              cx={35 + (i % 9) * (29 - n.compacted * 5)}
              cy={42 + Math.floor(i / 9) * (25 - n.compacted * 12)}
              r="7"
            />
          ))}
          <rect
            x="20"
            y={25 + n.depletion * 45}
            width="280"
            height={(1 - n.depletion) * 45}
            opacity=".25"
          />
        </>
      );
      break;
    case "season":
      art = (
        <>
          {Array.from({ length: 4 }, (_, i) => (
            <g key={i}>
              <rect
                x={25 + i * 72}
                y="20"
                width="48"
                height="48"
                fillOpacity={i < n.season ? 0.25 : 0.03}
              />
              <path
                d={`M${37 + i * 72} 45l7 8 16-20`}
                opacity={i < n.balanced ? 1 : 0.15}
              />
            </g>
          ))}
        </>
      );
      break;
    case "street":
      art = (
        <>
          <path d="M20 15H300" strokeDasharray="4 4" />
          <path
            d={`M20 ${25 + n.westCm}H125L195 ${25 + n.eastCm}H300`}
            strokeWidth="3"
          />
          <path
            d={`M20 ${38 + n.westCm}H125L195 ${38 + n.eastCm}H300`}
            opacity=".4"
          />
        </>
      );
      break;
    case "radar": {
      const samples = phaseTransect(n.sinkingM),
        s = radarSample(n.xM, n.zM, n.sinkingM);
      art = (
        <>
          <path
            d={samples
              .map(
                (s, i) =>
                  `${i ? "L" : "M"}${15 + i * 1.9} ${18 + (1 - s.wrappedCycles) * 42}`,
              )
              .join(" ")}
          />
          <circle cx="279" cy="43" r="25" opacity=".4" />
          <path
            d="M279 43V20"
            transform={`rotate(${s.wrappedCycles * 360} 279 43)`}
            strokeWidth="3"
          />
        </>
      );
      break;
    }
    case "ground":
      art =
        n.rate === null ? (
          <>
            <rect
              x="20"
              y="15"
              width="280"
              height="52"
              fillOpacity=".02"
              strokeDasharray="4 5"
            />
            {Array.from({ length: 13 }, (_, i) => (
              <path key={i} d={`M${24 + i * 22} 67l30-52`} opacity=".25" />
            ))}
            <text x="160" y="48" textAnchor="middle">
              NO MEASUREMENT
            </text>
          </>
        ) : (
          <>
            <path d="M160 15V70M20 43H300" opacity=".35" />
            <path
              d={`M160 43H${160 + Math.max(-130, Math.min(130, (n.rate / 400) * 130))}`}
              strokeWidth="5"
            />
            <circle
              cx={160 + Math.max(-130, Math.min(130, (n.rate / 400) * 130))}
              cy="43"
              r="5"
            />
            <text x="20" y="80">
              Relative rate · mm/yr
            </text>
          </>
        );
      break;
    case "backscatter":
      art = (
        <>
          <path d="M160 15V65M20 43H300" opacity=".35" />
          {n.differenceDb !== null ? (
            <>
              <path
                d={`M160 43H${160 + Math.max(-130, Math.min(130, (n.differenceDb / 15) * 130))}`}
                strokeWidth="5"
              />
              <text x="20" y="80">
                HH echo difference · dB
              </text>
            </>
          ) : (
            <text x="30" y="65">
              EXCLUDED CELL
            </text>
          )}
        </>
      );
      break;
    case "footprint": {
      const ratio =
        n.tilt !== null && n.sigma !== null && n.sigma > 0
          ? Math.min(2, n.tilt / (2 * n.sigma))
          : null;
      art = (
        <>
          <path d="M30 18H93V66H30ZM125 42H300" opacity=".35" />
          <path d="M215 25V60" strokeDasharray="3 3" />
          {ratio !== null && (
            <path d={`M125 42H${125 + ratio * 90}`} strokeWidth="4" />
          )}
          <text x="211" y="80">
            2σ
          </text>
        </>
      );
      break;
    }
    case "policy": {
      const points = policyScenario(n.actionStep, n.reduction).points;
      art = (
        <>
          <path d="M20 16L300 70" strokeDasharray="4 5" opacity=".35" />
          <path
            d={points
              .map(
                (p, i) =>
                  `${i ? "L" : "M"}${20 + i * 14} ${16 + (p.acted / 20) * 54}`,
              )
              .join(" ")}
            strokeWidth="3"
          />
          <path d={`M${20 + n.actionStep * 14} 15V73`} opacity=".4" />
        </>
      );
      break;
    }
  }
  return (
    <svg className="ex-note-art" viewBox="0 0 320 88" aria-hidden="true">
      {art}
    </svg>
  );
}
