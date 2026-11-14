"use client";
import { useEffect, useRef, useState } from "react";
import type { createStreetInstrument } from "./createStreetInstrument";

export function StreetInstrument({
  left,
  right,
  change,
}: {
  left: number;
  right: number;
  change: (a: number, b: number) => void;
}) {
  const host = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    scene = useRef<ReturnType<typeof createStreetInstrument> | null>(null);
  const latest = useRef({ left, right });
  useEffect(() => {
    latest.current = { left, right };
  }, [left, right]);
  const [visible, setVisible] = useState(false),
    [ready, setReady] = useState(false),
    [retry, setRetry] = useState(0),
    [error, setError] = useState(false),
    [top, setTop] = useState(false);
  const drag = useRef<{
    side: "left" | "right";
    y: number;
    value: number;
  } | null>(null);
  useEffect(() => {
    const node = host.current;
    if (!node) return;
    let intersecting = false;
    const sync = () =>
      setVisible(intersecting && document.visibilityState !== "hidden");
    const observer = new IntersectionObserver(([e]) => {
      intersecting = e.isIntersecting;
      sync();
    });
    observer.observe(node);
    document.addEventListener("visibilitychange", sync);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);
  useEffect(() => {
    if (!visible || !canvas.current) return;
    const node = canvas.current;
    let dead = false;
    let active: ReturnType<typeof createStreetInstrument> | null = null;
    let resize: ResizeObserver | null = null;
    const release = () => {
      resize?.disconnect();
      active?.dispose();
      active = null;
      scene.current = null;
    };
    const lost = (e: Event) => {
      e.preventDefault();
      dead = true;
      setError(true);
      setReady(false);
      release();
    };
    const restored = () => setRetry((v) => v + 1);
    node.addEventListener("webglcontextlost", lost);
    node.addEventListener("webglcontextrestored", restored);
    import("./createStreetInstrument")
      .then((m) => {
        if (dead) return;
        active = m.createStreetInstrument(node);
        scene.current = active;
        active.update(latest.current.left, latest.current.right);
        active.view(false);
        const size = () => {
          const b = node.getBoundingClientRect();
          active?.resize(b.width, b.height);
        };
        resize = new ResizeObserver(size);
        resize.observe(node);
        size();
        setReady(true);
        setError(false);
        setTop(false);
      })
      .catch(() => {
        if (!dead) {
          setError(true);
          setReady(false);
          release();
        }
      });
    return () => {
      dead = true;
      setReady(false);
      drag.current = null;
      node.removeEventListener("webglcontextlost", lost);
      node.removeEventListener("webglcontextrestored", restored);
      release();
    };
  }, [visible, retry]);
  useEffect(() => {
    scene.current?.update(left, right);
  }, [left, right]);
  return (
    <div className="ea-street-instrument" ref={host}>
      <div className="ea-scene-label">
        <span>Pull the ground. Watch the connection.</span>
        <small>Invented test street</small>
      </div>
      <div className="ea-street-canvas">
        <canvas
          key={retry}
          ref={canvas}
          aria-label={`3D street: left ${left} cm down, right ${right} cm down. Use the labelled ground handles below.`}
          role="img"
        />
        {!ready && (
          <p className="ea-3d-fallback" role="status">
            {error
              ? "3D unavailable. Both ground handles and the connection diagram still work."
              : "Opening the street…"}
          </p>
        )}
      </div>
      <svg
        className="ea-connection-line"
        viewBox="0 0 600 75"
        role="img"
        aria-label={`Connection difference ${Math.abs(left - right)} cm. This is geometry, not a safety limit.`}
      >
        <path
          d="M70 12H530"
          stroke="#8bcec0"
          strokeDasharray="5 7"
          opacity=".5"
        />
        <path
          d={`M70 ${14 + left}L530 ${14 + right}`}
          stroke="#e7b66e"
          strokeWidth="7"
        />
        <circle cx="70" cy={14 + left} r="9" fill="#8bcec0" />
        <circle cx="530" cy={14 + right} r="9" fill="#8bcec0" />
      </svg>
      <div className="ea-ground-handles">
        {(["left", "right"] as const).map((side) => (
          <label key={side}>
            <span>
              {side === "left" ? "West block" : "East block"}{" "}
              <b>{side === "left" ? left : right} cm ↓</b>
            </span>
            <input
              type="range"
              min="0"
              max="30"
              value={side === "left" ? left : right}
              aria-label={`${side === "left" ? "West" : "East"} block sinking`}
              onChange={(e) =>
                side === "left"
                  ? change(Number(e.target.value), right)
                  : change(left, Number(e.target.value))
              }
            />
            <button
              type="button"
              className="ea-pull-handle"
              aria-label={`Pull ${side === "left" ? "west" : "east"} ground down; drag vertically or use its slider`}
              onPointerDown={(e) => {
                drag.current = {
                  side,
                  y: e.clientY,
                  value: side === "left" ? left : right,
                };
                e.currentTarget.setPointerCapture(e.pointerId);
              }}
              onPointerMove={(e) => {
                const d = drag.current;
                if (!d || d.side !== side) return;
                const v = Math.round(
                  Math.max(0, Math.min(30, d.value + (e.clientY - d.y) / 4)),
                );
                if (side === "left") change(v, latest.current.right);
                else change(latest.current.left, v);
              }}
              onPointerUp={() => {
                const d = drag.current;
                if (d && latest.current[d.side] === d.value) {
                  if (side === "left") change(Math.min(30, left + 3), right);
                  else change(left, Math.min(30, right + 3));
                }
                drag.current = null;
              }}
              onPointerCancel={() => {
                drag.current = null;
              }}
              onClick={(e) => {
                if (e.detail === 0) {
                  if (side === "left") change(Math.min(30, left + 3), right);
                  else change(left, Math.min(30, right + 3));
                }
              }}
            >
              ↕ Pull ground
            </button>
          </label>
        ))}
      </div>
      <div className="ea-street-camera">
        <span>{Math.abs(left - right)} cm of mismatch</span>
        <button
          type="button"
          aria-pressed={top}
          onClick={() => {
            scene.current?.view(!top);
            setTop(!top);
          }}
        >
          {" "}
          {top ? "Street view" : "Look from above"}
        </button>
        {error && (
          <button type="button" onClick={() => setRetry((v) => v + 1)}>
            Retry 3D
          </button>
        )}
      </div>
    </div>
  );
}
