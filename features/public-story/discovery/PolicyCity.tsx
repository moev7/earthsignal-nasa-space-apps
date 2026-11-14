"use client";

import { useId, useEffect, useRef, useState, type ReactNode } from "react";
import { planResult, type CityPlan } from "../../../lib/discovery-play";
import { useOptionalStory } from "@/features/ground-truth/components/story/StoryProvider";
import { usePrefersReducedMotion } from "@/features/ground-truth/lib/useTimeline";
import { Droplets, Radar, Gauge } from "lucide-react";
import "./policy-city.css";

export type PolicyCityProps = {
  plan: CityPlan;
  onChange: (key: keyof CityPlan) => void;
  children?: ReactNode;
};

// Authored isometric illustration, not geographic coordinates or a physical model.
function point(u: number, v: number, height = 0) {
  return `${380 + (u - v) * 1.05},${65 + (u + v) * 0.4 - height}`;
}

function Building({
  u,
  v,
  width,
  depth,
  height,
  warm = false,
}: {
  u: number;
  v: number;
  width: number;
  depth: number;
  height: number;
  warm?: boolean;
}) {
  return (
    <g className="policy-city__building" data-warm={warm}>
      <polygon
        className="policy-city__building-shadow"
        points={`${point(u, v + depth)} ${point(u + width, v + depth)} ${point(u + width + 20, v + depth + 16)} ${point(u + 20, v + depth + 16)}`}
      />
      <polygon
        className="policy-city__wall-light"
        points={`${point(u, v + depth, height)} ${point(u + width, v + depth, height)} ${point(u + width, v + depth)} ${point(u, v + depth)}`}
      />
      <polygon
        className="policy-city__wall-shade"
        points={`${point(u + width, v, height)} ${point(u + width, v + depth, height)} ${point(u + width, v + depth)} ${point(u + width, v)}`}
      />
      <polygon
        className="policy-city__roof"
        points={`${point(u, v, height)} ${point(u + width, v, height)} ${point(u + width, v + depth, height)} ${point(u, v + depth, height)}`}
      />
      <polygon
        className="policy-city__rooftop"
        points={`${point(u + 7, v + 7, height + 3)} ${point(u + width - 7, v + 7, height + 3)} ${point(u + width - 7, v + depth - 7, height + 3)} ${point(u + 7, v + depth - 7, height + 3)}`}
      />
      {[16, 31, 46, 61]
        .filter((z) => z < height - 7)
        .map((z) => (
          <g key={z} className="policy-city__windows">
            <path
              d={`M${point(u + 7, v + depth, z)} L${point(u + width - 7, v + depth, z)}`}
            />
            <path
              d={`M${point(u + width, v + 6, z)} L${point(u + width, v + depth - 6, z)}`}
            />
          </g>
        ))}
    </g>
  );
}

function Tree({ u, v }: { u: number; v: number }) {
  return (
    <g transform={`translate(${380 + (u - v) * 1.05} ${65 + (u + v) * 0.4})`}>
      <ellipse cy="1" rx="10" ry="4" fill="#121617" opacity=".16" />
      <path d="M0 0v-15" stroke="#53605b" strokeWidth="3" />
      <path d="M0-36 12-15 0-9-12-15Z" fill="#61958b" />
      <path d="M0-36v27l12-6Z" fill="#44786f" />
    </g>
  );
}

const choices: { key: keyof CityPlan; label: string; detail: string }[] = [
  { key: "limits", label: "Limit withdrawals", detail: "Turn down the well" },
  {
    key: "supply",
    label: "Use other water supplies",
    detail: "Connect another route",
  },
  { key: "monitor", label: "Keep measuring", detail: "Observe what changes" },
];

/** Controlled, qualitative water-policy toy. No timers, simulation or idle motion. */
export function PolicyCity({ plan, onChange, children }: PolicyCityProps) {
  const id = useId();
  const host = useRef<HTMLElement>(null),
    paused = useOptionalStory()?.paused ?? false,
    reduced = usePrefersReducedMotion();
  const [visible, setVisible] = useState(false),
    [documentVisible, setDocumentVisible] = useState(true);
  useEffect(() => {
    const changed = () =>
      setDocumentVisible(document.visibilityState !== "hidden");
    changed();
    document.addEventListener("visibilitychange", changed);
    const observer =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(([entry]) =>
            setVisible(entry.isIntersecting),
          );
    if (host.current) observer?.observe(host.current);
    return () => {
      observer?.disconnect();
      document.removeEventListener("visibilitychange", changed);
    };
  }, []);

  const actsOnWater = plan.limits || plan.supply;
  const nextKey = !actsOnWater ? "limits" : !plan.monitor ? "monitor" : null;
  const next =
    nextKey === "limits"
      ? "Start with the well: limit withdrawals."
      : nextKey === "monitor"
        ? "Now keep measuring to check what changes."
        : "Response connected. Try another combination.";
  const flow = plan.limits ? "limited" : plan.supply ? "reduced" : "high";

  return (
    <section
      className="policy-city"
      ref={host}
      data-motion={
        paused || reduced || !visible || !documentVisible ? "still" : "active"
      }
      aria-label="Illustrative city water decisions"
      data-limits={plan.limits}
      data-supply={plan.supply}
      data-monitor={plan.monitor}
    >
      <div className="policy-city__heading">
        <span>City water network</span>
        <span className="policy-city__disclaimer">
          Illustration—not a forecast
        </span>
      </div>
      <figure className="policy-city__model">
        <div
          className="play-city-hotspots"
          role="group"
          aria-label="Touch the city instruments"
        >
          <button
            type="button"
            className="play-city-source"
            aria-label="Connect the reservoir"
            aria-pressed={plan.supply}
            onClick={() => onChange("supply")}
            title="Connect another water route"
          >
            <Droplets size={19} />
          </button>
          <button
            type="button"
            className="play-city-well"
            aria-label="Turn the well down"
            aria-pressed={plan.limits}
            onClick={() => onChange("limits")}
            title="Limit the well"
          >
            <Gauge size={19} />
          </button>
          <button
            type="button"
            className="play-city-satellite"
            aria-label="Send a monitoring pass"
            aria-pressed={plan.monitor}
            onClick={() => onChange("monitor")}
            title="Observe the change"
          >
            <Radar size={19} />
          </button>
        </div>
        <svg
          className="policy-city__art"
          viewBox="0 0 760 370"
          role="img"
          aria-labelledby={`${id}-title ${id}-description`}
        >
          <title id={`${id}-title`}>
            A city, its water routes and an observing satellite
          </title>
          <desc id={`${id}-description`}>
            {`Well withdrawals ${plan.limits ? "limited" : "not limited"}. Other water supplies ${plan.supply ? "connected" : "disconnected"}. Repeat monitoring ${plan.monitor ? "on" : "off"}. Monitoring observes change; it does not reduce withdrawals or restore lost ground height. All flows are qualitative.`}
          </desc>
          <g aria-hidden="true">
            <ellipse
              cx="380"
              cy="323"
              rx="272"
              ry="30"
              fill="#121617"
              opacity=".22"
            />
            <g className="policy-city__ground" data-ground="fixed">
              <path d="M65 185 380 305 380 351 65 231Z" fill="#817b69" />
              <path d="M380 305 695 185 695 231 380 351Z" fill="#605f53" />
              <path
                d="M65 198 380 318 695 198v9L380 327 65 207Z"
                fill="#b5a88a"
              />
              <path
                d="M65 217 380 337 695 217v7L380 344 65 224Z"
                fill="#8bcec0"
                opacity=".5"
              />
              <path d="M65 185 380 65 695 185 380 305Z" fill="#bfc5b3" />
              <path
                d="m65 185 315 120 315-120"
                fill="none"
                stroke="#f1eee7"
                strokeWidth="2"
                opacity=".6"
              />
            </g>

            <g transform="matrix(1.05 .4 -1.05 .4 380 65)">
              <path d="M138 0h29v300h-29Z M0 123h300v27H0Z" fill="#636e68" />
              <path
                d="M152 4v291M5 136h290"
                fill="none"
                stroke="#d5d4bd"
                strokeWidth="1.5"
                strokeDasharray="7 9"
              />
              <path
                d="M5 158h119v120H5Z M182 173h103v110H182Z"
                fill="#96ac94"
              />
              <path
                d="M17 170h95v95H17Z"
                fill="none"
                stroke="#d6d9c4"
                strokeWidth="2"
              />
              <path
                d="M8 116h121M173 116h117M130 5v111M173 5v111"
                fill="none"
                stroke="#e4e2d3"
                strokeWidth="4"
              />
              <path
                className="policy-city__pipe-bed"
                d="M72 214H122V142H260V260M152 142V76H112M152 101h63"
              />
              <path
                className="policy-city__supply-route"
                data-water-route="supply"
                data-connected={plan.supply}
                d={
                  plan.supply
                    ? "M72 214H122V142H152V76H112M152 101h63"
                    : "M72 214h33"
                }
              />
              <path
                className="policy-city__well-route"
                data-water-route="well"
                data-flow={flow}
                d="M260 260V142H152V76H112M152 101h63"
                strokeWidth={plan.limits ? 3 : plan.supply ? 5 : 9}
              />
              <path
                className="policy-city__flow-marks"
                d={
                  plan.limits
                    ? "m260 190 4 6-4 6"
                    : "m260 190 4 6-4 6m0 25 4 6-4 6m0-64 4 6-4 6"
                }
              />
              <circle
                cx="152"
                cy="142"
                r="7"
                fill="#f1eee7"
                stroke="#44786f"
                strokeWidth="3"
              />
              <path
                d="M35 130v13m6-13v13m6-13v13M138 30h29m-29 6h29m-29 6h29"
                stroke="#f1eee7"
                strokeWidth="2"
              />
            </g>

            <Building u={38} v={25} width={34} depth={35} height={49} />
            <Building u={88} v={22} width={35} depth={40} height={77} />
            <Building u={186} v={20} width={32} depth={35} height={67} />
            <Building u={238} v={30} width={35} depth={41} height={50} warm />
            <Building u={35} v={79} width={47} depth={29} height={32} warm />
            <Building u={96} v={82} width={29} depth={29} height={54} />
            <Building u={186} v={84} width={42} depth={27} height={43} warm />
            <Tree u={20} v={107} />
            <Tree u={277} v={92} />
            <Tree u={196} v={191} />
            <Tree u={219} v={177} />
            <Tree u={210} v={213} />
            <Tree u={282} v={199} />
            <Tree u={281} v={231} />

            <g className="policy-city__reservoir">
              <path
                d="M166 158 236 131 312 160 242 187v17l-76-29Z"
                fill="#d6d9c4"
              />
              <path d="m242 187 70-27v17l-70 27Z" fill="#81988b" />
              <path
                d="m177 158 59-22 64 24-58 22Z"
                fill={plan.supply ? "#8bcec0" : "#6b9691"}
              />
              <path
                d="m192 158 43-16m-20 25 46-18m-20 25 42-16"
                stroke="#f1eee7"
                strokeWidth="2"
                opacity=".55"
              />
              <path d="m176 182 56 21v9l-56-21Z" fill="#61958b" />
              <circle
                cx="235"
                cy="191"
                r="5"
                fill={plan.supply ? "#8bcec0" : "#47534e"}
                stroke="#f1eee7"
                strokeWidth="2"
              />
            </g>

            <g className="policy-city__well" data-flow={flow}>
              <path d="M380 281v62" stroke="#343f3b" strokeWidth="14" />
              <path
                d="M380 281v62"
                stroke="#35adbc"
                strokeWidth={plan.limits ? 3 : plan.supply ? 5 : 8}
              />
              <path
                d="m376 332 4-5 4 5"
                fill="none"
                stroke="#f1eee7"
                strokeWidth="2"
              />
              {!plan.limits && (
                <path
                  d="m376 313 4-5 4 5"
                  fill="none"
                  stroke="#f1eee7"
                  strokeWidth="2"
                />
              )}
              <ellipse cx="380" cy="279" rx="25" ry="10" fill="#47534e" />
              <path d="M355 263v15c0 13 50 13 50 0v-15" fill="#b5bcb8" />
              <ellipse cx="380" cy="263" rx="25" ry="10" fill="#f1eee7" />
              <path
                d="M380 264v-17h23v-10"
                fill="none"
                stroke="#47534e"
                strokeWidth="7"
                strokeLinejoin="round"
              />
              <rect
                x="367"
                y="245"
                width="25"
                height="15"
                rx="3"
                fill="#61958b"
                stroke="#343f3b"
                strokeWidth="1.5"
              />
              <g
                className="policy-city__motor"
                transform={`translate(379 252) rotate(${plan.limits ? 30 : 90})`}
              >
                <path d="M-8 0H8M0-5V5" stroke="#f1eee7" strokeWidth="2" />
                <circle r="2" fill="#343f3b" />
              </g>
              <path
                d="M393 254h16"
                stroke={plan.limits ? "#8bcec0" : "#e7b66e"}
                strokeWidth="3"
                strokeDasharray={plan.limits ? "3 5" : undefined}
              />
            </g>

            <g className="policy-city__monitor" data-observing={plan.monitor}>
              {plan.monitor && (
                <g data-observation="beam">
                  <path
                    d="m607 57-180 106 96 28Z"
                    fill="#e7b66e"
                    opacity=".12"
                  />
                  <path
                    d="m607 57-132 122"
                    stroke="#e7b66e"
                    strokeWidth="1.5"
                    strokeDasharray="4 5"
                  />
                  <ellipse
                    cx="475"
                    cy="179"
                    rx="44"
                    ry="16"
                    fill="none"
                    stroke="#e7b66e"
                    strokeWidth="1.5"
                  />
                  <path
                    d="M463 179h24m-12-8v16"
                    stroke="#e7b66e"
                    strokeWidth="1.5"
                  />
                </g>
              )}
              <g transform="translate(609 43)">
                <path
                  d="m-48-4 29-11 19 9-29 11Zm64 24 29-11 19 9-29 11Z"
                  fill="#44786f"
                  stroke="#8bcec0"
                  strokeWidth="1.5"
                />
                <path
                  d="m-39-7 19 9m-9-13 19 9m36 19 19 9m-9-13 19 9"
                  stroke="#8bcec0"
                  strokeWidth="1"
                />
                <path d="m-13-15 29 11v23L-13 8Z" fill="#b5bcb8" />
                <path d="m-13-15 18-7 29 11-18 7Z" fill="#f1eee7" />
                <path d="m16-4 18-7v23l-18 7Z" fill="#81988b" />
                <path
                  d="m-3 15 12 5 9-9c-3 14-17 16-21 4Z"
                  fill={plan.monitor ? "#e7b66e" : "#b5bcb8"}
                />
              </g>
              <g transform="translate(558 240)">
                <path
                  d="M0 0v30m-12 5 12-5 12 5"
                  fill="none"
                  stroke="#b5bcb8"
                  strokeWidth="3"
                />
                <rect
                  x="-18"
                  y="-15"
                  width="36"
                  height="26"
                  rx="4"
                  fill="#222627"
                  stroke={plan.monitor ? "#e7b66e" : "#81988b"}
                  strokeWidth="2"
                />
                {plan.monitor ? (
                  <path
                    d="m-12 3 6-5 6 3 6-9 6 3"
                    fill="none"
                    stroke="#e7b66e"
                    strokeWidth="2"
                  />
                ) : (
                  <path d="M-9-2H9" stroke="#81988b" strokeWidth="2" />
                )}
              </g>
            </g>
          </g>
        </svg>
        <figcaption className="policy-city__legend">
          <span>
            <i data-route="supply" />
            Other supplies {plan.supply ? "connected" : "off"}
          </span>
          <span>
            <i data-route="well" />
            Well draw {actsOnWater ? "reduced" : "unchanged"}
          </span>
          <span>
            <i data-route="monitor" />
            Observation {plan.monitor ? "on" : "off"}
          </span>
        </figcaption>
      </figure>

      <div
        className="policy-city__controls"
        role="group"
        aria-label="Choose the city response"
      >
        {choices.map(({ key, label, detail }) => (
          <button
            key={key}
            type="button"
            className="policy-city__choice"
            aria-label={label}
            aria-pressed={plan[key]}
            data-route-key={key}
            data-affordance="route"
            data-current={nextKey === key}
            onClick={() => onChange(key)}
          >
            <span className="policy-city__choice-icon" aria-hidden="true">
              {plan[key] ? "✓" : "+"}
            </span>
            <span className="policy-city__choice-copy">
              <strong>{label}</strong>
              <small>{detail}</small>
            </span>
          </button>
        ))}
      </div>
      <div
        className="policy-city__readout"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        <p className="policy-city__next">{next}</p>
        <p className="policy-city__result">{planResult(plan)}</p>
      </div>
      {children && <div className="policy-city__companion">{children}</div>}
    </section>
  );
}
