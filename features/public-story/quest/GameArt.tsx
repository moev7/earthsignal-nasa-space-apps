"use client";

import { useId } from "react";
import { Check, ArrowUpRight } from "lucide-react";
import { MISSION_IDS } from "@/lib/story-missions";
import { useMissions } from "../missions/StoryMissions";
import { useGame, type GameChapter } from "./GameDirector";
import { CLUES } from "./quest-model";
import { ClueIcon } from "./QuestExperience";
import { STATIONS } from "./game-content";

/** A code-native field instrument; expressions change only on player actions. */
export function EchoPortrait({
  mood = "curious",
}: {
  mood?: "curious" | "thinking" | "found";
}) {
  const id = useId();
  return (
    <svg
      className="eg-echo-portrait"
      viewBox="0 0 150 130"
      aria-hidden="true"
      data-mood={mood}
    >
      <defs>
        <linearGradient id={id} x2="0.8" y2="1">
          <stop stopColor="#d5fff0" />
          <stop offset="1" stopColor="#60bcb1" />
        </linearGradient>
      </defs>
      <ellipse cx="75" cy="117" rx="40" ry="5" fill="#84cfc0" opacity=".12" />
      <g className="eg-echo-body">
        <path
          d="M33 53 8 45 5 61 32 68 M117 53 142 45 145 61 118 68"
          fill="#2f5d60"
          stroke="#94d8c5"
          strokeWidth="2"
        />
        <path
          d="M17 48 14 63 M25 51 22 66 M133 48 136 63 M125 51 128 66"
          stroke="#94d8c5"
          opacity=".5"
        />
        <path d="M75 31V16m-5 0h10" stroke="#ffce85" strokeWidth="3" />
        <circle cx="75" cy="12" r="5" fill="#ffce85" />
        <rect
          x="30"
          y="32"
          width="90"
          height="65"
          rx="24"
          fill={`url(#${id})`}
        />
        <rect x="39" y="42" width="72" height="40" rx="16" fill="#132c31" />
        {mood === "found" ? (
          <path
            d="m49 61 7-5 7 5m24 0 7-5 7 5"
            stroke="#b7ffdb"
            strokeWidth="4"
            fill="none"
            strokeLinecap="round"
          />
        ) : (
          <>
            <rect
              x="52"
              y={mood === "thinking" ? 57 : 53}
              width="9"
              height={mood === "thinking" ? 7 : 16}
              rx="4"
              fill="#b7ffdb"
            />
            <rect x="89" y="53" width="9" height="16" rx="4" fill="#b7ffdb" />
          </>
        )}
        <path
          d="M69 71q6 5 12 0"
          stroke="#b7ffdb"
          strokeWidth="2"
          fill="none"
        />
        <circle cx="75" cy="89" r="3" fill="#173a3c" />
        <path
          d="m60 97-5 9m35-9 5 9"
          stroke="#94d8c5"
          strokeWidth="4"
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
}

export function FieldMap({ compact = false }: { compact?: boolean }) {
  const director = useGame()!,
    { progress } = useMissions();
  return (
    <nav
      className={`eg-field-map ed-station-list ${compact ? "eg-map-compact" : ""}`}
      aria-label="Field station mission map"
    >
      <ol>
        {MISSION_IDS.map((id, index) => {
          const earned = progress.completed.includes(id),
            selected = director.chapter === CLUES[id].chapter;
          return (
            <li
              key={id}
              className={`eg-map-node eg-map-node-${index}`}
              data-earned={earned}
              data-selected={selected}
            >
              <a
                href={`#${CLUES[id].chapter}`}
                onClick={(event) => {
                  event.preventDefault();
                  director.navigate(CLUES[id].chapter as GameChapter);
                }}
                aria-current={selected ? "location" : undefined}
                aria-label={`Experiment ${index + 1}: ${CLUES[id].title}. ${earned ? "Found" : "Explore"}`}
              >
                <span className="eg-map-pin">
                  {earned ? (
                    <Check size={25} />
                  ) : (
                    <ClueIcon id={id} size={26} />
                  )}
                </span>
                <span className="eg-map-label">
                  <strong>{CLUES[id].title}</strong>
                  <span>{STATIONS[id].place}</span>
                </span>
                <ArrowUpRight size={16} />
              </a>
            </li>
          );
        })}
      </ol>
      <p className="eg-map-note">
        Five stations. Any order. Follow your curiosity.
      </p>
    </nav>
  );
}
